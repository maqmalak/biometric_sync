"""API for the Biometric Sync console (React app in frontend/, served at /biometric).

The console is a port of the standalone biometric-attendance-sync tool's UI; here every page reads and writes
biometric_sync's own records instead of a local database:

    machines        Biometric Device          punches     Biometric Log
    sync runs/logs  Biometric Sync Log        users       Biometric Device User
    settings        Biometric Sync Settings   check-ins   Employee Checkin (HRMS)
"""
import csv
import io
import ipaddress
import socket
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils.scheduler import is_scheduler_disabled
from frappe.utils import add_days, cint, cstr, flt, get_datetime, getdate, now_datetime, nowdate

from biometric_sync.constants import (
	DUPLICATE, FAILED, IGNORED, NOT_FOUND, PENDING, PULL_PROTOCOLS, RETRYABLE_STATUSES, SYNCED, ZK_PULL,
)

VERSION = "1.0.0"
# Biometric Log status -> console status (the standalone tool's vocabulary)
STATUS = {PENDING: "pending", SYNCED: "synced", DUPLICATE: "synced", NOT_FOUND: "failed", FAILED: "failed", IGNORED: "skipped"}
REASON = {DUPLICATE: "duplicate", NOT_FOUND: "unknown_employee", IGNORED: "skipped", FAILED: "erp_error"}
DOC_STATUSES = {"pending": [PENDING], "synced": [SYNCED, DUPLICATE], "failed": [NOT_FOUND, FAILED], "skipped": [IGNORED]}
RUN_STATUS = {"In Progress": "running", "Success": "success", "Partial": "partial", "Failed": "failed"}


# ---------------------------------------------------------------- access
def _can_read(check_lock=False):
	if frappe.session.user == "Guest" or not frappe.has_permission("Biometric Log", "read"):
		frappe.throw(_("You are not allowed to use Biometric Sync."), frappe.PermissionError)
	if check_lock:
		_require_unlocked()


def _require_unlocked():
	"""The settings password protects the Settings page (and its API) only."""
	if _locked():
		frappe.throw(_("Settings are locked. Enter the settings password."), frappe.PermissionError, title="Locked")


UNLOCK_TTL = 12 * 3600


def _unlock_key():
	return f"bs_console_unlock:{frappe.session.sid}"


def _locked():
	"""The console has a password and this login session has not entered it yet."""
	if not cint(frappe.db.get_single_value("Biometric Sync Settings", "console_password_enabled")):
		return False
	return not frappe.cache.get_value(_unlock_key())


def _can_write():
	_can_read()
	if not frappe.has_permission("Biometric Device", "write"):
		frappe.throw(_("Only HR / System Managers can change Biometric Sync."), frappe.PermissionError)


def _ts(v):
	return get_datetime(v).strftime("%Y-%m-%d %H:%M:%S") if v else None


def _parse(v):
	return frappe.parse_json(v) if isinstance(v, str) and v[:1] in "[{" else v


@frappe.whitelist()
def csrf():
	"""CSRF token for the console's POST calls (session cookie auth)."""
	_can_read(check_lock=False)
	from frappe.sessions import get_csrf_token

	return get_csrf_token()


@frappe.whitelist()
def boot():
	_can_read(check_lock=False)
	return {
		"locked": False,  # the whole console is never locked; only Settings (see settings_locked)
		"settings_locked": _locked(),
		"user": frappe.session.user,
		"full_name": frappe.utils.get_fullname(frappe.session.user),
		"can_write": bool(frappe.has_permission("Biometric Device", "write")),
		"version": VERSION,
		"site": frappe.local.site,
		"employee_field": "attendance_device_id",
		"scheduler": not is_scheduler_disabled(verbose=False),
	}


# ---------------------------------------------------------------- machines
def _device_stats():
	today = nowdate()
	rows = frappe.db.sql("""select device, count(*) total,
			sum(status = %(p)s) pending, sum(status in %(f)s) failed, sum(status in %(s)s) synced, sum(status = %(i)s) skipped,
			sum(timestamp >= %(t)s) today, max(timestamp) last_punch
		from `tabBiometric Log` group by device""",
		{"p": PENDING, "f": (NOT_FOUND, FAILED), "s": (SYNCED, DUPLICATE), "i": IGNORED, "t": today}, as_dict=True)
	return {r.device: r for r in rows}


def _public_device(d, stats=None):
	st = (stats or {}).get(d.name) or {}
	return {
		"id": d.name, "name": d.device_name or d.name, "device_id": d.checkin_device_id or d.name,
		"protocol": d.protocol, "ip": d.ip_address, "port": d.port, "timeout": d.timeout, "force_udp": bool(cint(d.force_udp)),
		"enabled": bool(cint(d.enabled)), "auto_sync": bool(cint(d.auto_sync)), "sync_interval": cint(d.sync_interval) or 15,
		"status": (d.status or "Unknown").lower(), "last_success_at": _ts(d.last_sync_at), "last_sync_status": d.last_sync_status,
		"last_error": d.last_error, "last_punch_time": _ts(d.last_punch_time), "company": d.company,
		"log_type_mode": d.log_type_mode, "sync_from": _ts(d.sync_from), "time_offset_minutes": cint(d.time_offset_minutes),
		"clear_after_sync": bool(cint(d.clear_device_logs_after_sync)), "sync_device_time": bool(cint(d.sync_device_time)),
		"latitude": d.latitude, "longitude": d.longitude, "has_password": bool(cint(d.comm_key)),
		"skip_auto_attendance": bool(cint(d.skip_auto_attendance)), "employee_field": d.employee_field or "attendance_device_id",
		"info": {"serial": d.device_serial, "firmware": d.firmware_version, "platform": d.platform, "device_name": d.device_model,
			"mac": d.mac_address, "users": d.user_count, "records": d.log_count, "fingers": d.fingerprint_count,
			"faces": d.face_count, "clock": _ts(d.device_time), "read_at": _ts(d.info_updated_at)},
		"stats": {k: cint(st.get(k)) for k in ("total", "pending", "failed", "synced", "skipped", "today")} | {"last_punch": _ts(st.get("last_punch"))},
	}


@frappe.whitelist()
def devices():
	_can_read()
	stats = _device_stats()
	return [_public_device(d, stats) for d in frappe.get_all("Biometric Device", fields="*", order_by="device_name")]


@frappe.whitelist()
def device_save(data, name=None):
	_can_write()
	data = _parse(data) or {}
	doc = frappe.get_doc("Biometric Device", name) if name else frappe.new_doc("Biometric Device")
	if not name:
		doc.device_name = cstr(data.get("name")).strip()
		doc.protocol = data.get("protocol") or ZK_PULL
		doc.create_checkins = 1
		doc.employee_field = "attendance_device_id"
		st = frappe.get_cached_doc("Biometric Sync Settings")
		for field, default in (("port", "default_port"), ("timeout", "default_timeout"), ("comm_key", "default_comm_key"),
				("force_udp", "default_force_udp"), ("ping_before_connect", "default_ping_before_connect"),
				("disable_device_during_sync", "default_disable_device_during_sync"), ("sync_device_time", "default_sync_device_time"),
				("time_offset_minutes", "default_time_offset"), ("log_type_mode", "default_log_type_mode"), ("sync_interval", "default_sync_interval")):
			if st.get(default) not in (None, ""):
				doc.set(field, st.get(default))
		if not data.get("sync_from"):
			doc.sync_from = f"{st.default_import_from} 00:00:00" if st.default_import_from else now_datetime()
	fields = {"protocol": "protocol", "device_id": "checkin_device_id", "ip": "ip_address", "port": "port", "timeout": "timeout",
		"force_udp": "force_udp", "enabled": "enabled", "auto_sync": "auto_sync", "sync_interval": "sync_interval",
		"log_type_mode": "log_type_mode", "sync_from": "sync_from", "time_offset_minutes": "time_offset_minutes",
		"clear_after_sync": "clear_device_logs_after_sync", "sync_device_time": "sync_device_time", "latitude": "latitude",
		"longitude": "longitude", "company": "company", "skip_auto_attendance": "skip_auto_attendance"}
	for key, field in fields.items():
		if key in data:
			v = data[key]
			doc.set(field, (1 if v else 0) if isinstance(v, bool) else v)
	if data.get("password") not in (None, ""):
		doc.comm_key = cint(data["password"])
	if not cstr(doc.device_name).strip():
		frappe.throw(_("Enter a name for the machine."))
	if doc.protocol in PULL_PROTOCOLS and doc.protocol == ZK_PULL and not cstr(doc.ip_address).strip():
		frappe.throw(_("Enter the IP address or host name of the machine."))
	doc.save(ignore_permissions=False) if name else doc.insert()
	return _public_device(frappe.get_doc("Biometric Device", doc.name), _device_stats())


@frappe.whitelist(methods=["POST"])
def device_delete(name):
	_can_write()
	frappe.delete_doc("Biometric Device", name)
	return {"ok": True}


def _call(name, method, *args, **kwargs):
	doc = frappe.get_doc("Biometric Device", name)
	doc.check_permission("write")
	return getattr(doc, method)(*args, **kwargs)


@frappe.whitelist(methods=["POST"])
def device_test(name):
	_can_write()
	t = now_datetime()
	_call(name, "test_connection")
	d = _public_device(frappe.get_doc("Biometric Device", name))
	info = d["info"] | {"response_ms": int((now_datetime() - t).total_seconds() * 1000)}
	if info.get("clock"):
		info["drift_seconds"] = int((get_datetime(info["clock"]) - now_datetime()).total_seconds())
	return info


@frappe.whitelist(methods=["POST"])
def device_sync_time(name):
	_can_write()
	_call(name, "sync_device_time")
	return {"clock": _ts(now_datetime())}


@frappe.whitelist(methods=["POST"])
def device_toggle(name, enabled):
	_can_write()
	frappe.db.set_value("Biometric Device", name, "enabled", cint(enabled))
	return {"ok": True}


@frappe.whitelist()
def device_users(name, refresh=0):
	_can_read()
	if cint(refresh):
		_can_write()
		_call(name, "fetch_users")
	rows = frappe.get_all("Biometric Device User", {"device": name},
		["user_id", "user_name as name", "uid", "privilege", "card_no as card", "employee", "employee_name", "modified as fetched_at"],
		limit_page_length=0)
	rows.sort(key=lambda u: (int(u.user_id) if cstr(u.user_id).isdigit() else 10**12, cstr(u.user_id)))
	for u in rows:
		u.fetched_at = _ts(u.fetched_at)
	return rows


@frappe.whitelist()
def local_network():
	_can_read()
	try:
		s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
		s.connect(("8.8.8.8", 80))
		ip = s.getsockname()[0]
		s.close()
		return {"network": str(ipaddress.ip_network(f"{ip}/24", strict=False))}
	except Exception:
		return {"network": "192.168.1.0/24"}


@frappe.whitelist(methods=["POST"])
def scan_network(network, port=4370):
	"""Which hosts answer on the ZKTeco port (only checks the port; changes nothing)."""
	_can_write()
	net = ipaddress.ip_network(cstr(network).strip(), strict=False)
	if net.num_addresses > 1024:
		frappe.throw(_("Scan at most a /22 network (1024 addresses)."))
	port = cint(port) or 4370

	def probe(ip):
		try:
			with socket.create_connection((str(ip), port), timeout=0.6):
				return str(ip)
		except OSError:
			return None

	with ThreadPoolExecutor(max_workers=64) as pool:
		found = [ip for ip in pool.map(probe, list(net.hosts())) if ip]
	known = set(frappe.get_all("Biometric Device", pluck="ip_address"))
	return {"network": str(net), "found": [{"ip": ip, "known": ip in known} for ip in found]}


# ---------------------------------------------------------------- sync runs (Biometric Sync Log)
def _public_run(r):
	dur = flt(r.duration) or ((get_datetime(r.end_time) - get_datetime(r.start_time)).total_seconds() if r.end_time and r.start_time else None)
	return {
		"id": r.name, "device": r.device, "device_name": r.device_name or r.device, "trigger": (r.trigger or "").lower(),
		"status": RUN_STATUS.get(r.status, (r.status or "").lower()), "started_at": _ts(r.start_time), "finished_at": _ts(r.end_time),
		"duration": dur, "fetched": cint(r.logs_fetched), "new_punches": cint(r.new_logs), "duplicates": cint(r.duplicates),
		"pushed": cint(r.checkins_created), "unmatched": cint(r.unmatched), "skipped": cint(r.ignored) + cint(r.out_of_range),
		"double_punches": cint(r.double_punches), "failed": cint(r.failed), "summary": r.message, "from_date": _ts(r.from_date), "to_date": _ts(r.to_date),
	}


def _runs_query(where="", params=None, limit=50, offset=0):
	return frappe.db.sql(f"""select l.*, d.device_name from `tabBiometric Sync Log` l
		left join `tabBiometric Device` d on d.name = l.device {where}
		order by l.creation desc limit %(limit)s offset %(offset)s""", {**(params or {}), "limit": cint(limit), "offset": cint(offset)}, as_dict=True)


@frappe.whitelist()
def runs(limit=50, offset=0, status=None, trigger=None, device=None):
	_can_read()
	conds, params = [], {}
	rev = {v: k for k, v in RUN_STATUS.items()}
	if status:
		conds.append("l.status = %(status)s")
		params["status"] = rev.get(status, status)
	if trigger:
		conds.append("l.`trigger` = %(trigger)s")
		params["trigger"] = trigger.title()
	if device:
		conds.append("l.device = %(device)s")
		params["device"] = device
	where = (" where " + " and ".join(conds)) if conds else ""
	total = frappe.db.sql(f"select count(*) from `tabBiometric Sync Log` l{where}", params)[0][0]
	return {"total": total, "rows": [_public_run(r) for r in _runs_query(where, params, limit, offset)]}


@frappe.whitelist()
def run(name):
	_can_read()
	r = _runs_query(" where l.name = %(n)s", {"n": name}, 1)
	if not r:
		frappe.throw(_("Sync run not found"), frappe.DoesNotExistError)
	breakdown = frappe.db.sql("select status, count(*) n from `tabBiometric Log` where sync_log = %s group by status", name, as_dict=True)
	return {"run": _public_run(r[0]), "breakdown": {b.status: b.n for b in breakdown}}


@frappe.whitelist()
def active():
	"""Syncs running now, plus devices queued for a sync, and the last few finished runs (for Live Progress)."""
	_can_read()
	from frappe.utils.background_jobs import is_job_enqueued

	running = [_public_run(r) for r in _runs_query(" where l.status = 'In Progress' and l.creation > now() - interval 3 hour", {}, 50)]
	busy = {r["device"] for r in running}
	queued = [{"device": d.name, "device_name": d.device_name} for d in frappe.get_all("Biometric Device", ["name", "device_name"])
		if d.name not in busy and is_job_enqueued(f"biometric_sync::{d.name}")]
	recent = [_public_run(r) for r in _runs_query(" where l.status != 'In Progress'", {}, 10)]
	return {"running": running, "queued": queued, "recent": recent}


@frappe.whitelist(methods=["POST"])
def start_sync(devices=None, from_date=None, to_date=None, push_only=0):
	"""Sync now: read the chosen machines (all pull machines when none given), or with push_only just reprocess
	the waiting punches."""
	_can_write()
	from biometric_sync.sync import enqueue_sync

	if cint(push_only):
		return {"queued": [], "reprocess": reprocess(status="pending,failed")}
	names = _parse(devices) or frappe.get_all("Biometric Device", {"enabled": 1, "protocol": ["in", PULL_PROTOCOLS]}, pluck="name")
	queued, busy = [], []
	for n in names:
		(queued if enqueue_sync(n, "Manual", from_date or None, to_date or None, frappe.session.user) else busy).append(n)
	return {"queued": queued, "busy": busy}


# ---------------------------------------------------------------- punches (Biometric Log)
def _punch_where(status=None, device=None, q=None, date_from=None, date_to=None, reason=None, user_id=None, run=None):
	conds, params = [], {}
	if run:
		conds.append("l.sync_log = %(run)s")
		params["run"] = run
	if status:
		sts = [s for x in cstr(status).split(",") for s in DOC_STATUSES.get(x, [])]
		if sts:
			conds.append("l.status in %(sts)s")
			params["sts"] = tuple(sts)
	if reason:
		conds.append("l.status = %(reason_st)s")
		params["reason_st"] = {v: k for k, v in REASON.items()}.get(reason, reason)
	if device:
		conds.append("l.device = %(device)s")
		params["device"] = device
	if user_id:
		conds.append("l.user_id = %(uid)s")
		params["uid"] = user_id
	if date_from:
		conds.append("l.timestamp >= %(df)s")
		params["df"] = date_from
	if date_to:
		conds.append("l.timestamp <= %(dt)s")
		params["dt"] = f"{date_to} 23:59:59"
	if q:
		conds.append("(l.user_id like %(q)s or l.employee like %(q)s or l.employee_name like %(q)s or l.employee_checkin like %(q)s or l.error like %(q)s)")
		params["q"] = f"%{q}%"
	return (" where " + " and ".join(conds)) if conds else "", params


def _public_punch(p):
	return {"id": p.name, "user_id": p.user_id, "ts": _ts(p.timestamp), "device": p.device, "device_name": p.device_name or p.device,
		"log_type": p.log_type, "punch": p.punch_state, "sync_status": STATUS.get(p.status, "pending"), "status": p.status,
		"reason": REASON.get(p.status), "last_error": p.error, "erp_name": p.employee_checkin, "employee_id": p.employee,
		"employee_name": p.employee_name, "source": p.source, "synced_at": _ts(p.modified) if p.status == SYNCED else None}


@frappe.whitelist()
def punches(limit=100, offset=0, status=None, device=None, q=None, date_from=None, date_to=None, reason=None, user_id=None, run=None):
	_can_read()
	where, params = _punch_where(status, device, q, date_from, date_to, reason, user_id, run)
	total = frappe.db.sql(f"select count(*) from `tabBiometric Log` l{where}", params)[0][0]
	rows = frappe.db.sql(f"""select l.*, d.device_name from `tabBiometric Log` l left join `tabBiometric Device` d on d.name = l.device
		{where} order by l.timestamp desc, l.name desc limit %(limit)s offset %(offset)s""",
		{**params, "limit": min(cint(limit) or 100, 1000), "offset": cint(offset)}, as_dict=True)
	counts = {}
	for st, n in frappe.db.sql("select status, count(*) from `tabBiometric Log` group by status"):
		key = STATUS.get(st, "pending")
		counts[key] = counts.get(key, 0) + n
	reasons = [{"reason": REASON[st], "n": n} for st, n in frappe.db.sql(
		"select status, count(*) n from `tabBiometric Log` where status in %s group by status order by n desc", ((DUPLICATE, NOT_FOUND, FAILED, IGNORED),))]
	return {"total": total, "rows": [_public_punch(p) for p in rows], "counts": counts, "reasons": reasons}


def _scope(ids=None, **filters):
	ids = _parse(ids)
	if ids:
		return list(ids)
	where, params = _punch_where(**{k: v for k, v in filters.items() if v})
	return frappe.db.sql_list(f"select l.name from `tabBiometric Log` l{where} limit 50000", params)


@frappe.whitelist(methods=["POST"])
def reprocess(ids=None, status=None, device=None, reason=None, user_id=None, date_from=None, date_to=None, run=None, q=None):
	"""Retry punches: match the employee again and create the check-in."""
	_can_write()
	from biometric_sync.api import reprocess_logs

	names = _scope(ids, status=status or "pending,failed,skipped", device=device, reason=reason, user_id=user_id, date_from=date_from, date_to=date_to, run=run, q=q)
	names = frappe.get_all("Biometric Log", {"name": ["in", names], "status": ["in", list(RETRYABLE_STATUSES) + [IGNORED]]}, pluck="name") if names else []
	if names:
		frappe.db.sql("update `tabBiometric Log` set status = %s where name in %s and status = %s", (PENDING, tuple(names), IGNORED))
		reprocess_logs(names=names)
	return {"count": len(names)}


@frappe.whitelist(methods=["POST"])
def skip(ids):
	_can_write()
	names = _scope(ids)
	if names:
		frappe.db.sql("update `tabBiometric Log` set status = %s where name in %s and status in %s",
			(IGNORED, tuple(names), tuple(RETRYABLE_STATUSES)))
	return {"count": len(names)}


def _csv_download(rows, filename):
	out = io.StringIO()
	if rows:
		w = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
		w.writeheader()
		w.writerows(rows)
	frappe.response["type"] = "download"
	frappe.response["filename"] = filename
	frappe.response["filecontent"] = out.getvalue()
	frappe.response["content_type"] = "text/csv"


@frappe.whitelist()
def punches_export(status=None, device=None, q=None, date_from=None, date_to=None, reason=None, user_id=None, run=None):
	_can_read()
	where, params = _punch_where(status, device, q, date_from, date_to, reason, user_id, run)
	rows = frappe.db.sql(f"""select l.timestamp punch_time, l.user_id, l.employee, l.employee_name, d.device_name machine, l.log_type,
			l.status, l.employee_checkin, l.error from `tabBiometric Log` l left join `tabBiometric Device` d on d.name = l.device
		{where} order by l.timestamp desc limit 200000""", params, as_dict=True)
	_csv_download(rows, "punches.csv")


# ---------------------------------------------------------------- employee mapping
@frappe.whitelist()
def mapping():
	_can_read()
	emps = frappe.get_all("Employee", ["name", "employee_name", "department", "company", "status", "attendance_device_id"], limit_page_length=0)
	by_id = {}
	for e in emps:
		uid = cstr(e.attendance_device_id).strip()
		if uid:
			by_id.setdefault(uid, []).append(e)
	users = frappe.db.sql("""select u.user_id, max(u.user_name) name, group_concat(distinct coalesce(d.device_name, u.device) separator ', ') devices,
		max(u.modified) fetched from `tabBiometric Device User` u left join `tabBiometric Device` d on d.name = u.device group by u.user_id""", as_dict=True)
	punch = {r.user_id: r for r in frappe.db.sql("""select user_id, count(*) punches, max(timestamp) last_punch,
		sum(status = %s) pending, sum(status in %s) failed from `tabBiometric Log` group by user_id""", (PENDING, (NOT_FOUND, FAILED)), as_dict=True)}
	ids = {u.user_id: u for u in users}
	for uid in punch:
		ids.setdefault(uid, frappe._dict(user_id=uid, name=None, devices=None, fetched=None))
	rows = []
	for uid, u in ids.items():
		hits = by_id.get(cstr(uid).strip()) or by_id.get(cstr(uid).lstrip("0")) or []
		e = hits[0] if hits else None
		p = punch.get(uid) or {}
		issue = None if hits else "not_in_erpnext"
		if len(hits) > 1:
			issue = "duplicate_id"
		elif e and e.status != "Active":
			issue = "inactive"
		rows.append({"user_id": uid, "device_user_name": u.name, "devices": u.devices, "employee": e.name if e else None,
			"employee_name": e.employee_name if e else None, "department": e.department if e else None,
			"employee_status": e.status if e else None, "punches": cint(p.get("punches")), "last_punch": _ts(p.get("last_punch")),
			"pending": cint(p.get("pending")), "failed": cint(p.get("failed")), "issue": issue})
	rows.sort(key=lambda r: (r["issue"] is None, -r["failed"], cint(r["user_id"]) if cstr(r["user_id"]).isdigit() else 0))
	unlinked = [{"name": e.name, "employee_name": e.employee_name, "department": e.department, "company": e.company}
		for e in emps if e.status == "Active" and not cstr(e.attendance_device_id).strip()]
	fetched = max((u.fetched for u in users if u.fetched), default=None)
	return {"fieldname": "attendance_device_id", "rows": rows, "unlinked_employees": unlinked,
		"employee_count": len(emps), "users_fetched_at": _ts(fetched), "employees_fetched_at": _ts(now_datetime())}


@frappe.whitelist(methods=["POST"])
def link_employee(employee, user_id):
	_can_write()
	uid = cstr(user_id).strip()
	clash = frappe.db.get_value("Employee", {"attendance_device_id": uid, "name": ["!=", employee]}, "name")
	if clash:
		frappe.throw(_("Device ID {0} is already used by {1}.").format(uid, clash))
	doc = frappe.get_doc("Employee", employee)
	doc.attendance_device_id = uid
	doc.save()  # biometric_sync re-queues this ID's waiting punches on Employee update
	waiting = frappe.db.count("Biometric Log", {"user_id": uid, "status": ["in", [PENDING, NOT_FOUND, FAILED]]})
	return {"requeued": waiting}


@frappe.whitelist(methods=["POST"])
def read_device_users():
	_can_write()
	out = []
	for d in frappe.get_all("Biometric Device", {"enabled": 1, "protocol": ["in", PULL_PROTOCOLS]}, ["name", "device_name"]):
		try:
			_call(d.name, "fetch_users")
			out.append({"device": d.device_name, "ok": True, "count": frappe.db.count("Biometric Device User", {"device": d.name})})
		except Exception as e:
			frappe.clear_messages()
			out.append({"device": d.device_name, "ok": False, "error": cstr(e)})
	return out


# ---------------------------------------------------------------- logs (sync runs + errors)
LEVEL = {"Success": "SUCCESS", "Partial": "WARNING", "Failed": "ERROR", "In Progress": "INFO"}


@frappe.whitelist()
def logs(level=None, device=None, q=None, run_id=None, limit=200, offset=0):
	_can_read()
	levels = set(cstr(level).split(",")) if level else {"ERROR", "WARNING", "SUCCESS", "INFO"}
	statuses = tuple(k for k, v in LEVEL.items() if v in levels) or ("-",)
	conds, params = ["l.status in %(sts)s"], {"sts": statuses}
	if device:
		conds.append("(l.device = %(dev)s or d.device_name = %(dev)s)")
		params["dev"] = device
	if run_id:
		conds.append("l.name = %(run)s")
		params["run"] = run_id
	if q:
		conds.append("(l.message like %(q)s or l.device like %(q)s)")
		params["q"] = f"%{q}%"
	where = " where " + " and ".join(conds)
	total = frappe.db.sql(f"select count(*) from `tabBiometric Sync Log` l left join `tabBiometric Device` d on d.name = l.device{where}", params)[0][0]
	rows = frappe.db.sql(f"""select l.name, l.creation, l.status, l.device, d.device_name, l.message, l.logs_fetched, l.new_logs,
			l.checkins_created, l.duplicates, l.unmatched, l.failed from `tabBiometric Sync Log` l
		left join `tabBiometric Device` d on d.name = l.device {where} order by l.creation desc limit %(limit)s offset %(offset)s""",
		{**params, "limit": cint(limit) or 200, "offset": cint(offset)}, as_dict=True)
	out = []
	for r in rows:
		summary = f"Read {r.logs_fetched} · {r.new_logs} new · {r.checkins_created} check-ins · {r.duplicates} duplicates · {r.unmatched} unmatched · {r.failed} failed"
		out.append({"id": r.name, "ts": _ts(r.creation), "level": LEVEL.get(r.status, "INFO"), "device": r.device_name or r.device,
			"employee": None, "message": summary if r.status != "Failed" else (cstr(r.message).splitlines() or ["Sync failed"])[0],
			"detail": r.message or "", "run_id": r.name})
	if "ERROR" in levels and not run_id and cint(offset) == 0:  # recent errors logged by biometric_sync jobs
		errs = frappe.get_all("Error Log", {"method": ["like", "%iometric%"], "creation": [">", add_days(now_datetime(), -7)]},
			["name", "creation", "method", "error"], order_by="creation desc", limit=20)
		out += [{"id": e.name, "ts": _ts(e.creation), "level": "ERROR", "device": None, "employee": None,
			"message": e.method, "detail": e.error, "run_id": None} for e in errs if not q or q.lower() in cstr(e.error).lower()]
		out.sort(key=lambda x: x["ts"], reverse=True)
	return {"total": total, "rows": out}


@frappe.whitelist()
def logs_export():
	_can_read()
	rows = frappe.db.sql("""select l.creation time, l.status, coalesce(d.device_name, l.device) machine, l.logs_fetched fetched,
		l.new_logs new, l.checkins_created checkins, l.duplicates, l.unmatched, l.failed, l.message
		from `tabBiometric Sync Log` l left join `tabBiometric Device` d on d.name = l.device order by l.creation desc limit 100000""", as_dict=True)
	_csv_download(rows, "sync-logs.csv")


# ---------------------------------------------------------------- statistics
@frappe.whitelist()
def stats_summary(days=30):
	_can_read()
	since = add_days(nowdate(), -cint(days) + 1)
	counts = punches(limit=1)["counts"]
	runs_by = dict(frappe.db.sql("select status, count(*) from `tabBiometric Sync Log` where creation >= %s group by status", since))
	reads = sum(runs_by.values())
	reads_ok = cint(runs_by.get("Success")) + cint(runs_by.get("Partial"))
	devs = frappe.get_all("Biometric Device", ["name", "enabled", "status", "auto_sync", "sync_interval", "last_sync_at"])
	enabled = [d for d in devs if cint(d.enabled)]
	today = nowdate()
	t = frappe.db.sql("""select count(*), count(distinct user_id), sum(status in %s) from `tabBiometric Log` where timestamp >= %s""",
		((SYNCED, DUPLICATE), today))[0]
	last = _runs_query(" where l.status != 'In Progress'", {}, 1)
	next_runs = sorted(get_datetime(d.last_sync_at) + timedelta(minutes=cint(d.sync_interval) or 15)
		for d in enabled if cint(d.auto_sync) and d.last_sync_at)
	return {
		"counts": counts, "punches_total": sum(counts.values()), "retrying": 0,
		"devices": len(devs), "devices_enabled": len(enabled),
		"devices_online": sum(1 for d in enabled if d.status == "Online"), "devices_offline": sum(1 for d in enabled if d.status in ("Offline", "Error")),
		"today_punches": cint(t[0]), "today_employees": cint(t[1]), "today_synced": cint(t[2]),
		"period_synced": frappe.db.count("Biometric Log", {"status": SYNCED, "timestamp": [">=", since]}),
		"period_fetched": frappe.db.count("Biometric Log", {"creation": [">=", since]}),
		"runs": reads, "runs_ok": cint(runs_by.get("Success")), "runs_partial": cint(runs_by.get("Partial")), "runs_failed": cint(runs_by.get("Failed")),
		"device_reads": reads, "device_reads_ok": reads_ok, "read_success_rate": round(100 * reads_ok / reads, 1) if reads else None,
		"last_run": _public_run(last[0]) if last else None,
		"next_runs": [_ts(max(n, now_datetime())) for n in next_runs][:3],
		"sync_enabled": bool(cint(frappe.db.get_single_value("Biometric Sync Settings", "enable_scheduled_sync"))),
		"sync_interval": min((cint(d.sync_interval) or 15 for d in enabled if cint(d.auto_sync)), default=None),
	}


@frappe.whitelist()
def stats_daily(days=30):
	_can_read()
	since = add_days(nowdate(), -min(cint(days), 365) + 1)
	rows = frappe.db.sql("""select date(timestamp) day, status, count(*) n, count(distinct user_id) emps from `tabBiometric Log`
		where timestamp >= %s group by 1, 2""", since, as_dict=True)
	emps = dict(frappe.db.sql("select date(timestamp), count(distinct user_id) from `tabBiometric Log` where timestamp >= %s group by 1", since))
	out, d = [], getdate(since)
	while d <= getdate(nowdate()):
		day = {"day": str(d), "synced": 0, "pending": 0, "skipped": 0, "failed": 0, "employees": cint(emps.get(d))}
		for r in rows:
			if r.day == d:
				day[STATUS.get(r.status, "pending")] += r.n
		out.append(day)
		d = d + timedelta(days=1)
	return out


@frappe.whitelist()
def stats_hourly(day=None):
	_can_read()
	day = day or nowdate()
	counts = dict(frappe.db.sql("select hour(timestamp), count(*) from `tabBiometric Log` where date(timestamp) = %s group by 1", day))
	if not counts:  # punches that came another way (old imports, mobile) still show
		counts = dict(frappe.db.sql("select hour(time), count(*) from `tabEmployee Checkin` where date(time) = %s group by 1", day))
	return [{"hour": h, "count": cint(counts.get(h))} for h in range(24)]


@frappe.whitelist()
def stats_devices(days=30):
	_can_read()
	since = add_days(nowdate(), -cint(days) + 1)
	reads = {r.device: r for r in frappe.db.sql("""select device, count(*) n_reads, sum(status in ('Success','Partial')) n_ok,
		avg(duration) avg_fetch from `tabBiometric Sync Log` where creation >= %s group by device""", since, as_dict=True)}
	out = []
	for d in devices():
		r = reads.get(d["id"]) or {}
		out.append(d | {"reads": cint(r.get("n_reads")), "reads_ok": cint(r.get("n_ok")), "avg_fetch": flt(r.get("avg_fetch")) if r.get("avg_fetch") else None})
	return out


@frappe.whitelist()
def runs_export(days=365):
	_can_read()
	rows = frappe.db.sql("""select l.name run, l.start_time started, l.end_time finished, l.`trigger`, l.status,
		coalesce(d.device_name, l.device) machine, l.logs_fetched, l.new_logs, l.checkins_created, l.duplicates, l.unmatched, l.failed
		from `tabBiometric Sync Log` l left join `tabBiometric Device` d on d.name = l.device
		where l.creation >= %s order by l.creation desc""", add_days(nowdate(), -cint(days)), as_dict=True)
	_csv_download(rows, "sync-runs.csv")


@frappe.whitelist(methods=["POST"])
def clear_history(before_days=0):
	_can_write()
	cutoff = add_days(now_datetime(), -cint(before_days))
	names = frappe.get_all("Biometric Sync Log", {"creation": ["<", cutoff], "status": ["!=", "In Progress"]}, pluck="name")
	if names:
		frappe.db.sql("update `tabBiometric Log` set sync_log = null where sync_log in %s", (tuple(names),))
		frappe.db.delete("Biometric Sync Log", {"name": ["in", names]})
	return {"deleted": len(names)}


# ---------------------------------------------------------------- settings
SETTINGS_FIELDS = (
	"enable_scheduled_sync", "default_sync_interval", "duplicate_punch_window", "retry_unmatched", "retry_days",
	"enable_adms", "adms_auto_register", "adms_offline_after", "log_retention_days", "sync_log_retention_days",
	"notify_on_failure", "notification_recipients", "default_import_from", "default_log_type_mode", "default_time_offset",
	"default_port", "default_comm_key", "default_timeout", "default_force_udp", "default_ping_before_connect",
	"default_disable_device_during_sync", "default_sync_device_time",
	"display_title", "display_language", "display_view", "display_direction", "display_day_start", "display_show_photos",
	"display_urdu_names", "display_show_division", "display_show_department", "display_show_sub_department",
	"display_show_designation", "display_recent_count", "display_refresh_seconds",
)
# settings field -> Biometric Device field, for "apply to all machines"
MACHINE_DEFAULTS = {
	"default_import_from": "sync_from", "default_sync_interval": "sync_interval", "default_log_type_mode": "log_type_mode",
	"default_time_offset": "time_offset_minutes", "default_port": "port", "default_comm_key": "comm_key", "default_timeout": "timeout",
	"default_force_udp": "force_udp", "default_ping_before_connect": "ping_before_connect",
	"default_disable_device_during_sync": "disable_device_during_sync", "default_sync_device_time": "sync_device_time",
}


@frappe.whitelist()
def settings():
	_can_read()
	_require_unlocked()
	doc = frappe.get_single("Biometric Sync Settings")
	values = {k: doc.get(k) for k in SETTINGS_FIELDS if doc.meta.has_field(k)}
	for k, v in values.items():
		if hasattr(v, "isoformat"):
			values[k] = str(v)
	devices = frappe.get_all("Biometric Device", ["name", "device_name", "auto_sync", "sync_interval", "sync_from", "last_punch_time", "enabled"])
	return {
		"values": values,
		"console_password_enabled": bool(cint(doc.console_password_enabled)),
		"scheduler": {"site": frappe.local.site, "enabled": not is_scheduler_disabled(verbose=False),
			"can_toggle": "System Manager" in frappe.get_roles()},
		"machines": [{"id": d.name, "name": d.device_name, "auto_sync": bool(cint(d.auto_sync)), "enabled": bool(cint(d.enabled)),
			"sync_interval": cint(d.sync_interval), "sync_from": _ts(d.sync_from), "last_punch_time": _ts(d.last_punch_time)} for d in devices],
		"site": frappe.local.site,
	}


@frappe.whitelist(methods=["POST"])
def settings_save(values):
	_can_write()
	_require_unlocked()
	values = _parse(values) or {}
	doc = frappe.get_single("Biometric Sync Settings")
	for k, v in values.items():
		if k in SETTINGS_FIELDS and doc.meta.has_field(k):
			doc.set(k, v)
	doc.save()
	return settings()


@frappe.whitelist(methods=["POST"])
def apply_machine_defaults(fields=None):
	"""Copy machine defaults (all, or the given settings fields) to every machine."""
	_can_write()
	_require_unlocked()
	doc = frappe.get_single("Biometric Sync Settings")
	fields = _parse(fields) or list(MACHINE_DEFAULTS)
	values = {}
	for f in fields:
		target = MACHINE_DEFAULTS.get(f)
		if not target:
			continue
		v = doc.get(f)
		if f == "default_import_from":
			v = f"{v} 00:00:00" if v else None
		elif v in (None, ""):
			continue
		values[target] = v
	names = frappe.get_all("Biometric Device", pluck="name")
	for n in names:
		frappe.db.set_value("Biometric Device", n, values, update_modified=True)
	return {"machines": len(names), "fields": list(values)}


@frappe.whitelist(methods=["POST"])
def set_machines_auto_sync(enabled, interval=None):
	"""Automatic reading on / off (and the interval) for every machine at once."""
	_can_write()
	_require_unlocked()
	values = {"auto_sync": cint(enabled)}
	if cint(interval):
		values["sync_interval"] = cint(interval)
	names = frappe.get_all("Biometric Device", {"protocol": ["in", PULL_PROTOCOLS]}, pluck="name")
	for n in names:
		frappe.db.set_value("Biometric Device", n, values)
	return {"machines": len(names)}


@frappe.whitelist(methods=["POST"])
def set_site_scheduler(enabled):
	"""The site's background scheduler (every scheduled job of this site, not only Biometric Sync)."""
	_can_write()
	_require_unlocked()
	frappe.only_for("System Manager")
	from frappe.utils.scheduler import disable_scheduler, enable_scheduler

	enable_scheduler() if cint(enabled) else disable_scheduler()
	return {"enabled": not is_scheduler_disabled(verbose=False)}


# ---------------------------------------------------------------- console password
@frappe.whitelist(methods=["POST"])
def set_console_password(password, current=None):
	_can_write()
	_require_unlocked()
	if len(cstr(password)) < 4:
		frappe.throw(_("Use at least 4 characters."))
	_lock_settings_row()
	doc = frappe.get_single("Biometric Sync Settings")
	if cint(doc.console_password_enabled) and not _check_password(current):
		frappe.throw(_("The current console password is wrong."))
	from frappe.utils.password import set_encrypted_password

	set_encrypted_password(doc.doctype, doc.name, password, "console_password")
	frappe.db.set_single_value(doc.doctype, {"console_password": "*" * 8, "console_password_enabled": 1})
	frappe.cache.set_value(_unlock_key(), 1, expires_in_sec=UNLOCK_TTL)
	return {"enabled": True}


@frappe.whitelist(methods=["POST"])
def remove_console_password(current):
	_can_write()
	_require_unlocked()
	_lock_settings_row()
	if not _check_password(current):
		frappe.throw(_("The current console password is wrong."))
	frappe.db.set_single_value("Biometric Sync Settings", {"console_password": None, "console_password_enabled": 0})
	return {"enabled": False}


def _lock_settings_row():
	"""Serialize password changes: a second request (e.g. a double-submitted form) waits here instead of
	deadlocking with the first on tabSingles / __Auth."""
	frappe.db.sql("select value from tabSingles where doctype = %s and field = 'console_password_enabled' for update",
		"Biometric Sync Settings")


def _check_password(pwd):
	from frappe.utils.password import get_decrypted_password

	saved = get_decrypted_password("Biometric Sync Settings", "Biometric Sync Settings", "console_password", raise_exception=False)
	import hmac

	return bool(saved) and hmac.compare_digest(cstr(saved), cstr(pwd))


@frappe.whitelist(methods=["POST"])
def unlock(password):
	_can_read(check_lock=False)
	if not _check_password(password):
		frappe.throw(_("Wrong password."), title=_("Locked"))  # not AuthenticationError: that would end the login session
	frappe.cache.set_value(_unlock_key(), 1, expires_in_sec=UNLOCK_TTL)
	return {"ok": True}


@frappe.whitelist(methods=["POST"])
def lock():
	_can_read(check_lock=False)
	frappe.cache.delete_value(_unlock_key())
	return {"ok": True}
