"""Check-in Display: live board of the day's punches (Employee Checkin), ported from the local
biometric-attendance-sync tool's /#/display. Served at /checkin-display; settings live in
Biometric Sync Settings → Check-in Display.

`today()` returns the same shape the local tool's /api/display/today did, so its screen code runs unchanged."""
import re
from datetime import datetime, timedelta

import frappe
from frappe.utils import cint, get_datetime, now_datetime

REPEAT_SCAN_SECONDS = 180  # scans of one person closer than this count as one
SETTING_KEYS = ("display_title", "display_language", "display_view", "display_direction", "display_day_start",
	"display_show_photos", "display_urdu_names", "display_show_division", "display_show_department",
	"display_show_sub_department", "display_show_designation", "display_recent_count", "display_refresh_seconds")
TS = "%Y-%m-%d %H:%M:%S"


def _has(doctype, field):
	return frappe.get_meta(doctype).has_field(field)


def _urdu_col():
	"""Employee's Urdu name column when the site has one (e.g. baogee_textile's mm_urdu_name)."""
	return "e.mm_urdu_name" if _has("Employee", "mm_urdu_name") else "null"


def _check_access():
	if frappe.session.user == "Guest":
		raise frappe.PermissionError
	if not frappe.has_permission("Employee Checkin", "read"):
		raise frappe.PermissionError


@frappe.whitelist()
def settings():
	_check_access()
	s = frappe.get_cached_doc("Biometric Sync Settings")
	out = {k: s.get(k) for k in SETTING_KEYS}
	for k in SETTING_KEYS:
		if k.startswith("display_show") or k == "display_urdu_names":
			out[k] = bool(cint(out[k]))
	out["display_day_start"] = str(out["display_day_start"] or "00:00")[:5]
	out["display_recent_count"] = cint(out["display_recent_count"]) or 40
	out["display_refresh_seconds"] = max(5, cint(out["display_refresh_seconds"]) or 30)
	return out


@frappe.whitelist()
def devices():
	"""Machines for the filter: every device_id seen on punches, named from Biometric Device where it exists."""
	_check_access()
	names = {d.checkin_device_id or d.name: d.device_name or d.name
		for d in frappe.get_all("Biometric Device", ["name", "device_name", "checkin_device_id"])}
	ids = frappe.db.sql_list("""select distinct device_id from `tabEmployee Checkin`
		where ifnull(device_id, '') != '' and time > now() - interval 60 day""")
	return [{"id": i, "name": names.get(i, i)} for i in sorted(set(ids) | set(names))]


def _org(departments, dept):
	"""Division / Department / Sub Department (+ Urdu) from the department tree (Department.mm_level)."""
	out = {}
	seen = 0
	while dept and dept in departments and seen < 6:
		d = departments[dept]
		level = {"Division": "division", "Department": "department", "Sub Department": "sub_department"}.get(d.get("mm_level"))
		if level and level not in out:
			out[level] = d.department_name
			out[level + "_ur"] = d.get("mm_urdu_name")
		dept, seen = d.parent_department, seen + 1
	if not out and dept:
		out["department"] = departments.get(dept, {}).get("department_name") or dept
	return out


@frappe.whitelist()
def today(date: str | None = None, device: str | None = None, limit: int = 40):
	_check_access()
	s = settings()
	sh, sm = (int(x) for x in (s["display_day_start"] if re.fullmatch(r"\d{2}:\d{2}", s["display_day_start"]) else "00:00").split(":"))
	now = now_datetime()
	if date:
		if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
			frappe.throw("Invalid date.")
		day = date
	else:
		cur = now if (now.hour, now.minute) >= (sh, sm) else now - timedelta(days=1)
		day = cur.strftime("%Y-%m-%d")
	win_start = datetime.strptime(day, "%Y-%m-%d").replace(hour=sh, minute=sm)
	win_end = win_start + timedelta(days=1) - timedelta(seconds=1)

	cond, params = "c.time between %(a)s and %(b)s", {"a": win_start, "b": win_end}
	if device:
		cond += " and c.device_id = %(dev)s"
		params["dev"] = device
	rows = frappe.db.sql(f"""select c.name, c.employee, c.time, c.log_type, c.device_id, e.employee_name, {_urdu_col()} mm_urdu_name,
			e.attendance_device_id, e.department, e.designation, e.image, e.status emp_status
		from `tabEmployee Checkin` c left join tabEmployee e on e.name = c.employee
		where {cond} order by c.time, c.name""", params, as_dict=True)

	dfields = ["name", "department_name", "parent_department"] + [f for f in ("mm_level", "mm_urdu_name") if _has("Department", f)]
	departments = {d.name: d for d in frappe.get_all("Department", dfields)} if rows else {}
	desig_ur = dict(frappe.get_all("Designation", ["name", "mm_urdu_name"], as_list=True)) if rows and _has("Designation", "mm_urdu_name") else {}
	dev_names = {d["id"]: d["name"] for d in devices()} if rows else {}
	alternate = s["display_direction"] == "alternate"

	people, recent = {}, []
	for r in rows:
		org = _org(departments, r.department)
		key = r.employee or r.device_id
		p = {
			"id": r.name, "user_id": r.attendance_device_id or r.employee, "ts": r.time.strftime(TS),
			"sync_status": "synced", "reason": None, "device_name": dev_names.get(r.device_id, r.device_id),
			"employee_id": r.employee, "employee_name": r.employee_name, "device_user_name": None,
			"employee_name_ur": r.mm_urdu_name, "designation": r.designation, "designation_ur": desig_ur.get(r.designation),
			"division": org.get("division"), "division_ur": org.get("division_ur"),
			"department": org.get("department"), "department_ur": org.get("department_ur"),
			"sub_department": org.get("sub_department"), "sub_department_ur": org.get("sub_department_ur"),
			"photo": r.image or None,
		}
		person = people.setdefault(key, {**{k: p[k] for k in ("user_id", "employee_id", "employee_name_ur", "designation",
			"designation_ur", "division", "division_ur", "department", "department_ur", "sub_department", "sub_department_ur",
			"photo")}, "name": r.employee_name, "punches": 0, "first_in": None, "last_out": None, "last_ts": None,
			"last_type": None, "last_device": None, "_active": r.emp_status == "Active"})
		t, guessed = r.log_type, False
		if alternate or not t:
			last = person.get("_last_dt")
			if last and (r.time - last).total_seconds() < REPEAT_SCAN_SECONDS and person["last_type"]:
				t = person["last_type"]
			else:
				t = "IN" if person.get("_turns", 0) % 2 == 0 else "OUT"
				person["_turns"] = person.get("_turns", 0) + 1
			person["_last_dt"] = r.time
			guessed = not alternate
		p["type"], p["type_guessed"] = t, guessed
		person["punches"] += 1
		if t == "IN" and not person.get("_open"):
			person["_open"] = r.time
		elif t == "OUT" and person.get("_open"):
			person["_worked"] = person.get("_worked", 0) + int((r.time - person.pop("_open")).total_seconds())
		if t == "IN" and not person["first_in"]:
			person["first_in"] = p["ts"]
		if t == "OUT":
			person["last_out"] = p["ts"]
		person["last_ts"], person["last_type"], person["last_device"] = p["ts"], t, p["device_name"]
		recent.append(p)

	is_today = win_start <= now <= win_end
	present_active = 0
	for person in people.values():
		person["status"] = "in" if person["last_type"] == "IN" else "out"
		worked, open_ts = person.pop("_worked", None), person.pop("_open", None)
		person["worked_running"] = False
		if open_ts and is_today:
			worked = (worked or 0) + max(0, int((now - open_ts).total_seconds()))
			person["worked_running"] = True
		person["worked_seconds"] = worked
		present_active += 1 if person.pop("_active") else 0
		for k in ("_last_dt", "_turns"):
			person.pop(k, None)

	active = frappe.db.count("Employee", {"status": "Active", "attendance_device_id": ["is", "set"]})
	plist = sorted(people.values(), key=lambda x: x["last_ts"] or "", reverse=True)
	limit = max(1, min(cint(limit) or 40, 200))
	return {
		"date": day,
		"is_today": is_today,
		"window": [win_start.strftime(TS), win_end.strftime(TS)],
		"previous": _previous(win_start, device) if not rows else None,
		"summary": {
			"punches": len(rows), "present": len(people),
			"in": sum(1 for x in plist if x["status"] == "in"), "out": sum(1 for x in plist if x["status"] == "out"),
			"active_employees": active, "present_active": present_active,
			"unlinked": max(0, len(people) - present_active),
			"absent": max(0, active - present_active) if active else None,
			"synced": len(rows), "pending": 0, "failed": 0,
		},
		"recent": list(reversed(recent[-limit:])),
		"people": plist,
		"last_read_at": _last_read(),
		"live": {"enabled": False, "machines": []},
		"service": _service(),
	}


def _previous(before, device):
	cond, params = "c.time < %(b)s", {"b": before}
	if device:
		cond += " and c.device_id = %(dev)s"
		params["dev"] = device
	r = frappe.db.sql(f"""select c.name, c.employee, c.time, c.log_type, c.device_id, e.employee_name, {_urdu_col()} mm_urdu_name,
			e.attendance_device_id, e.designation, e.image
		from `tabEmployee Checkin` c left join tabEmployee e on e.name = c.employee
		where {cond} order by c.time desc limit 1""", params, as_dict=True)
	if not r:
		return None
	r = r[0]
	return {"id": r.name, "user_id": r.attendance_device_id or r.employee, "ts": r.time.strftime(TS), "type": r.log_type,
		"type_guessed": False, "sync_status": "synced", "device_name": r.device_id, "employee_id": r.employee,
		"employee_name": r.employee_name, "employee_name_ur": r.mm_urdu_name, "designation": r.designation,
		"photo": r.image or None}


def _last_read():
	"""When punches last arrived: the newest Biometric Device sync, else the newest check-in."""
	t = frappe.db.sql("select max(last_sync_at) from `tabBiometric Device` where enabled = 1")[0][0]
	c = frappe.db.sql("select max(creation) from `tabEmployee Checkin`")[0][0]
	best = max([x for x in (t, c) if x], default=None)
	return best.strftime(TS) if best else None


def _service():
	"""Status bar: machines configured in Biometric Sync and their last sync."""
	devs = frappe.get_all("Biometric Device", {"enabled": 1}, ["device_name", "status", "last_sync_at", "last_sync_status", "last_error"])
	last = max((d for d in devs if d.last_sync_at), key=lambda d: d.last_sync_at, default=None)
	return {
		"started_at": None, "version": None, "syncing": False, "erp_configured": True,
		"erp_down_since": None, "erp_last_error": None, "pending_total": 0, "failed_total": 0,
		"last_sync": {"status": "success" if (last.last_sync_status or "").lower().startswith("success") else "failed",
			"finished_at": get_datetime(last.last_sync_at).strftime(TS), "trigger": "schedule"} if last else None,
		"devices": [{"name": d.device_name, "status": d.status, "last_sync_at": str(d.last_sync_at or ""), "last_error": d.last_error} for d in devs],
	}
