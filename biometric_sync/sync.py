import hashlib
import json
from datetime import datetime, time, timedelta

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, cstr, get_datetime, now_datetime, strip_html, time_diff_in_seconds
from frappe.utils.background_jobs import is_job_enqueued

from biometric_sync.connectors import get_connector
from biometric_sync.connectors.base import DeviceConnectionError
from biometric_sync.constants import (
	DEFAULT_PUNCH_MAP,
	DUPLICATE,
	FAILED,
	IGNORED,
	MODE_ALTERNATE,
	MODE_BLANK,
	MODE_IN,
	MODE_OUT,
	NOT_FOUND,
	PENDING,
	PULL_PROTOCOLS,
	RETRYABLE_STATUSES,
	SYNCED,
	ZK_PULL,
)

OVERLAP_MINUTES = 120  # re-read this much before the last stored punch (late uploads, clock drift)
COMMIT_EVERY = 200


# -----------------------------------------------------------------------------
# helpers
# -----------------------------------------------------------------------------
def get_settings():
	return frappe.get_cached_doc("Biometric Sync Settings")


def new_stats():
	return frappe._dict(
		fetched=0,
		new_logs=0,
		duplicates=0,
		out_of_range=0,
		checkins_created=0,
		double_punches=0,
		unmatched=0,
		ignored=0,
		failed=0,
		errors=[],
	)


def summarize(stats):
	return _(
		"Fetched {0}, new {1}, check-ins {2}, duplicates {3}, unmatched {4}, ignored {5}, failed {6}"
	).format(
		stats.fetched,
		stats.new_logs,
		stats.checkins_created,
		stats.duplicates + stats.double_punches,
		stats.unmatched,
		stats.ignored,
		stats.failed,
	)


def make_hash(device_name, user_id, timestamp):
	raw = f"{device_name}|{user_id}|{get_datetime(timestamp):%Y-%m-%d %H:%M:%S}"
	return hashlib.sha1(raw.encode()).hexdigest()


def normalize_user_id(device, user_id):
	value = cstr(user_id).strip()
	if cint(device.strip_leading_zeros) and value:
		value = value.lstrip("0") or "0"
	return value


def resolve_log_type(device, punch_state):
	"""Return IN / OUT / "" or "Ignore" for a raw punch state."""
	mode = device.log_type_mode
	if mode == MODE_IN:
		return "IN"
	if mode == MODE_OUT:
		return "OUT"
	if mode in (MODE_BLANK, MODE_ALTERNATE):
		return ""

	state = cstr(punch_state).strip().lower()
	for row in device.get("punch_map") or []:
		if cstr(row.punch_state).strip().lower() == state:
			return {"IN": "IN", "OUT": "OUT", "Ignore": "Ignore"}.get(row.log_type, "")
	return DEFAULT_PUNCH_MAP.get(state, "")


def shift(value, minutes):
	return add_to_date(value, minutes=minutes) if value and minutes else value


def update_device(device_name, **values):
	frappe.db.set_value("Biometric Device", device_name, values, update_modified=False)


class EmployeeResolver:
	"""Cached device user id -> Employee lookup for one device."""

	def __init__(self, device):
		self.field = device.employee_field or "attendance_device_id"
		self.company = device.company
		self.cache = {}

	def get(self, user_id):
		if user_id not in self.cache:
			filters = {self.field: user_id}
			if self.company:
				filters["company"] = self.company
			rows = frappe.get_all("Employee", filters=filters, fields=["name", "employee_name", "status"], limit=20)
			rows.sort(key=lambda row: row.status != "Active")
			self.cache[user_id] = rows[0] if rows else None
		return self.cache[user_id]


# -----------------------------------------------------------------------------
# ingestion: raw records -> Biometric Log -> Employee Checkin
# -----------------------------------------------------------------------------
def ingest_records(device, records, source, sync_log=None, stats=None, since=None, until=None):
	"""Store punch records (device-local time) as Biometric Logs and create check-ins.

	Used by every protocol (pull, ADMS push, webhook, file import)."""
	stats = stats if stats is not None else new_stats()
	settings = get_settings()
	offset = cint(device.time_offset_minutes)
	sync_from = get_datetime(device.sync_from) if device.sync_from else None

	prepared = []
	for record in records:
		user_id = normalize_user_id(device, record.user_id)
		if not user_id or not record.timestamp:
			stats.ignored += 1
			continue
		timestamp = shift(record.timestamp, offset)
		if (sync_from and timestamp < sync_from) or (since and timestamp < since) or (until and timestamp > until):
			stats.out_of_range += 1
			continue
		record.user_id, record.timestamp = user_id, timestamp
		record.log_hash = make_hash(device.name, user_id, timestamp)
		prepared.append(record)

	existing = set()
	hashes = [r.log_hash for r in prepared]
	for i in range(0, len(hashes), 500):
		existing.update(
			frappe.get_all("Biometric Log", filters={"log_hash": ["in", hashes[i : i + 500]]}, pluck="log_hash")
		)

	prepared.sort(key=lambda r: r.timestamp)  # chronological order matters for Alternate IN/OUT
	resolver = EmployeeResolver(device)
	create_checkins = cint(device.create_checkins)
	latest = None

	for i, record in enumerate(prepared, 1):
		latest = record.timestamp if not latest or record.timestamp > latest else latest
		if record.log_hash in existing:
			stats.duplicates += 1
			continue
		existing.add(record.log_hash)

		try:
			log = insert_log(device, record, source, sync_log)
		except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
			frappe.clear_messages()
			stats.duplicates += 1
			continue
		except Exception as e:
			stats.failed += 1
			stats.errors.append(f"{record.user_id} @ {record.timestamp}: {strip_html(cstr(e))}")
			continue

		stats.new_logs += 1
		if log.status == IGNORED:
			stats.ignored += 1
		elif create_checkins:
			process_log(log, device, settings, resolver, stats)

		if i % COMMIT_EVERY == 0:
			frappe.db.commit()

	if latest and (not device.last_punch_time or latest > get_datetime(device.last_punch_time)):
		update_device(device.name, last_punch_time=latest)
		device.last_punch_time = latest
	return stats


def insert_log(device, record, source, sync_log=None):
	log_type = resolve_log_type(device, record.punch_state)
	raw = record.raw
	if raw is not None and not isinstance(raw, str):
		raw = json.dumps(raw, default=str)

	log = frappe.new_doc("Biometric Log")
	log.update(
		{
			"device": device.name,
			"user_id": record.user_id,
			"timestamp": record.timestamp,
			"punch_state": record.punch_state,
			"verify_type": record.verify_type,
			"log_type": "" if log_type == "Ignore" else log_type,
			"status": IGNORED if log_type == "Ignore" else PENDING,
			"error": _("Punch state {0} is mapped to Ignore").format(record.punch_state) if log_type == "Ignore" else None,
			"source": source,
			"sync_log": sync_log,
			"log_hash": record.log_hash,
			"raw_data": raw,
		}
	)
	log.flags.skip_processing = True
	log.insert(ignore_permissions=True)
	return log


def process_log(log, device, settings=None, resolver=None, stats=None):
	"""Create the Employee Checkin for one Biometric Log. Returns the resulting status."""
	settings = settings or get_settings()
	resolver = resolver or EmployeeResolver(device)
	stats = stats if stats is not None else new_stats()

	if log.status in (SYNCED, IGNORED, DUPLICATE):
		return log.status

	employee = resolver.get(log.user_id)
	if not employee:
		_set(log, status=NOT_FOUND, employee=None, employee_name=None, error=_("No Employee with {0} = {1}").format(resolver.field, log.user_id))
		stats.unmatched += 1
		return NOT_FOUND

	timestamp = get_datetime(log.timestamp)
	log_type = log.log_type or ""
	if device.log_type_mode == MODE_ALTERNATE:
		day_start = datetime.combine(timestamp.date(), time.min)
		previous = frappe.db.count(
			"Employee Checkin",
			{"employee": employee.name, "time": ["between", [day_start, timestamp - timedelta(seconds=1)]]},
		)
		log_type = "IN" if previous % 2 == 0 else "OUT"

	window = cint(settings.duplicate_punch_window)
	time_filter = (
		["between", [timestamp - timedelta(seconds=window), timestamp + timedelta(seconds=window)]] if window > 0 else timestamp
	)
	existing = frappe.db.get_value("Employee Checkin", {"employee": employee.name, "time": time_filter}, "name")
	if existing:
		_set(
			log,
			status=DUPLICATE,
			employee=employee.name,
			employee_name=employee.employee_name,
			employee_checkin=existing,
			log_type=log_type,
			error=_("Employee already has check-in {0} at / near this time").format(existing),
		)
		stats.double_punches += 1
		return DUPLICATE

	checkin = frappe.new_doc("Employee Checkin")
	checkin.update(
		{
			"employee": employee.name,
			"time": timestamp,
			"log_type": log_type or None,
			"device_id": (device.checkin_device_id or device.name)[:140],
			"skip_auto_attendance": cint(device.skip_auto_attendance),
		}
	)
	if device.latitude or device.longitude:
		checkin.latitude, checkin.longitude = device.latitude, device.longitude

	frappe.db.savepoint("biometric_checkin")
	try:
		checkin.insert(ignore_permissions=True)
	except Exception as e:
		frappe.db.rollback(save_point="biometric_checkin")
		frappe.clear_messages()
		error = strip_html(cstr(e)) or repr(e)
		_set(log, status=FAILED, employee=employee.name, employee_name=employee.employee_name, log_type=log_type, error=error[:1000])
		stats.failed += 1
		stats.errors.append(f"{log.user_id} @ {timestamp}: {error}")
		return FAILED

	_set(
		log,
		status=SYNCED,
		employee=employee.name,
		employee_name=employee.employee_name,
		employee_checkin=checkin.name,
		log_type=log_type,
		error=None,
	)
	stats.checkins_created += 1
	return SYNCED


def _set(log, **values):
	log.db_set(values, update_modified=False)


# -----------------------------------------------------------------------------
# pull sync jobs
# -----------------------------------------------------------------------------
def enqueue_sync(device_name, trigger="Manual", from_date=None, to_date=None, notify_user=None):
	"""Queue a pull sync; returns False when one is already queued / running for the device."""
	job_id = f"biometric_sync::{device_name}"
	if is_job_enqueued(job_id):
		return False
	frappe.enqueue(
		"biometric_sync.sync.sync_device",
		queue="long",
		timeout=3600,
		job_id=job_id,
		deduplicate=True,
		device_name=device_name,
		trigger=trigger,
		from_date=from_date,
		to_date=to_date,
		notify_user=notify_user,
	)
	return True


def get_sync_window(device, from_date=None, to_date=None):
	sync_from = get_datetime(device.sync_from) if device.sync_from else None
	if from_date:
		since = get_datetime(from_date)
	elif device.last_punch_time:
		since = add_to_date(get_datetime(device.last_punch_time), minutes=-OVERLAP_MINUTES)
	else:
		since = sync_from
	if sync_from and since and since < sync_from:
		since = sync_from
	until = get_datetime(to_date) if to_date else None
	return since, until


def sync_device(device_name, trigger="Manual", from_date=None, to_date=None, notify_user=None):
	"""Pull punches from one device. Safe to call directly (bench execute) or as a job."""
	device = frappe.get_doc("Biometric Device", device_name)
	if device.protocol not in PULL_PROTOCOLS:
		frappe.throw(_("{0} is a push device; it cannot be pulled.").format(device_name))

	started = now_datetime()
	sync_log = frappe.get_doc(
		{
			"doctype": "Biometric Sync Log",
			"device": device.name,
			"protocol": device.protocol,
			"trigger": trigger,
			"status": "In Progress",
			"start_time": started,
			"from_date": from_date,
			"to_date": to_date,
		}
	).insert(ignore_permissions=True)
	frappe.db.commit()

	stats, status, message = new_stats(), "Failed", ""
	offset = cint(device.time_offset_minutes)
	since, until = get_sync_window(device, from_date, to_date)

	try:
		with get_connector(device) as connector:
			# connectors work in device time; ingestion converts back with the offset
			records = connector.fetch_logs(shift(since, -offset), shift(until, -offset))
			stats.fetched = len(records)
			ingest_records(device, records, "Pull", sync_log.name, stats, since, until)
			frappe.db.commit()
			message = post_sync_actions(device, connector, stats)

		status = "Success" if not stats.failed else "Partial"
		update_device(device.name, status="Online", last_sync_at=now_datetime(), last_sync_status=status, last_error="")
	except Exception as e:
		frappe.db.rollback()
		message = strip_html(cstr(e)) or repr(e)
		connection_error = isinstance(e, DeviceConnectionError)
		if not connection_error:
			frappe.log_error(title=f"Biometric sync failed: {device_name}", reference_doctype="Biometric Device", reference_name=device_name)
		update_device(
			device.name,
			status="Offline" if connection_error else "Error",
			last_sync_at=now_datetime(),
			last_sync_status="Failed",
			last_error=message[:1000],
		)
		notify_failure(device, message)
	finally:
		finished = now_datetime()
		details = "\n".join(filter(None, [message, *stats.errors[:200]]))
		frappe.db.set_value(
			"Biometric Sync Log",
			sync_log.name,
			{
				"status": status,
				"end_time": finished,
				"duration": time_diff_in_seconds(finished, started),
				"logs_fetched": stats.fetched,
				"new_logs": stats.new_logs,
				"duplicates": stats.duplicates,
				"out_of_range": stats.out_of_range,
				"checkins_created": stats.checkins_created,
				"double_punches": stats.double_punches,
				"unmatched": stats.unmatched,
				"ignored": stats.ignored,
				"failed": stats.failed,
				"message": details,
			},
			update_modified=False,
		)
		frappe.db.commit()

	if notify_user:
		frappe.publish_realtime(
			"biometric_sync_complete",
			{"device": device_name, "status": status, "summary": summarize(stats), "message": message, "sync_log": sync_log.name},
			user=notify_user,
		)
	return {"status": status, "sync_log": sync_log.name, **{k: v for k, v in stats.items() if k != "errors"}}


def post_sync_actions(device, connector, stats):
	if device.protocol != ZK_PULL:
		return ""
	notes = []
	if cint(device.sync_device_time):
		try:
			connector.set_time(shift(now_datetime(), -cint(device.time_offset_minutes)))
			notes.append(_("Device time synchronised."))
		except Exception as e:
			notes.append(_("Could not set device time: {0}").format(e))
	if cint(device.clear_device_logs_after_sync) and stats.fetched and not stats.failed:
		try:
			connector.clear_logs()
			notes.append(_("Device attendance log cleared."))
		except Exception as e:
			notes.append(_("Could not clear device log: {0}").format(e))
	return " ".join(notes)


def notify_failure(device, message):
	settings = get_settings()
	if not cint(settings.notify_on_failure) or device.status in ("Offline", "Error"):
		return  # disabled, or already notified for this outage
	recipients = [r.strip() for r in cstr(settings.notification_recipients).replace("\n", ",").split(",") if r.strip()]
	if not recipients:
		return
	try:
		frappe.sendmail(
			recipients=recipients,
			subject=_("Biometric device {0} failed to sync").format(device.name),
			message=_("Device <b>{0}</b> ({1}) could not be synced:<br><pre>{2}</pre>").format(
				device.name, device.protocol, frappe.utils.escape_html(message)
			),
			reference_doctype="Biometric Device",
			reference_name=device.name,
		)
	except Exception:
		frappe.log_error(title="Biometric Sync: failure notification could not be sent")


# -----------------------------------------------------------------------------
# reprocessing
# -----------------------------------------------------------------------------
def reprocess_log_names(names):
	settings = get_settings()
	devices, resolvers, stats = {}, {}, new_stats()
	for i, name in enumerate(names, 1):
		log = frappe.get_doc("Biometric Log", name)
		if log.status not in RETRYABLE_STATUSES:
			continue
		if log.device not in devices:
			devices[log.device] = frappe.get_doc("Biometric Device", log.device)
			resolvers[log.device] = EmployeeResolver(devices[log.device])
		device = devices[log.device]
		if log.status == FAILED:
			log.status = PENDING
		process_log(log, device, settings, resolvers[log.device], stats)
		if i % COMMIT_EVERY == 0:
			frappe.db.commit()
	frappe.db.commit()
	stats.pop("errors", None)
	return stats


def on_employee_update(doc, method=None):
	"""When an employee gets / changes a device id, retry the punches that were waiting for it."""
	fields = set(frappe.get_all("Biometric Device", pluck="employee_field", distinct=True) or []) or {"attendance_device_id"}
	user_ids = set()
	for field in fields:
		if field and doc.get(field) and doc.has_value_changed(field):
			value = cstr(doc.get(field)).strip()
			user_ids.update({value, value.lstrip("0") or "0"})
	if not user_ids:
		return
	names = frappe.get_all(
		"Biometric Log",
		filters={"status": NOT_FOUND, "user_id": ["in", list(user_ids)]},
		pluck="name",
		order_by="timestamp asc",
		limit=10000,
	)
	if names:
		frappe.enqueue("biometric_sync.sync.reprocess_log_names", queue="long", names=names, enqueue_after_commit=True)


# -----------------------------------------------------------------------------
# device users
# -----------------------------------------------------------------------------
def upsert_device_users(device, users):
	resolver = EmployeeResolver(device)
	linked = 0
	for user in users:
		user_id = normalize_user_id(device, user.get("user_id"))
		if not user_id:
			continue
		name = frappe.db.get_value("Biometric Device User", {"device": device.name, "user_id": user_id})
		doc = frappe.get_doc("Biometric Device User", name) if name else frappe.new_doc("Biometric Device User")
		employee = resolver.get(user_id)
		doc.update(
			{
				"device": device.name,
				"user_id": user_id,
				"uid": cint(user.get("uid")),
				"user_name": user.get("user_name"),
				"privilege": user.get("privilege") or "User",
				"card_no": user.get("card_no"),
				"employee": employee.name if employee else None,
				"employee_name": employee.employee_name if employee else None,
			}
		)
		doc.save(ignore_permissions=True)
		linked += 1 if employee else 0
	return len(users), linked


def get_employees_for_device(device, employees=None):
	field = device.employee_field or "attendance_device_id"
	filters = {"status": "Active", field: ["is", "set"]}
	if device.company:
		filters["company"] = device.company
	if employees:
		filters["name"] = ["in", employees]
	return [
		{"user_id": cstr(row.get(field)).strip(), "name": row.employee_name or row.name}
		for row in frappe.get_all("Employee", filters=filters, fields=["name", "employee_name", field])
	]


def push_employees_to_zk(device_name, employees=None, notify_user=None):
	device = frappe.get_doc("Biometric Device", device_name)
	rows = get_employees_for_device(device, employees)
	try:
		with get_connector(device) as connector:
			added, updated, errors = connector.push_users(rows)
		message = _("Pushed employees to {0}: {1} added, {2} updated, {3} failed.").format(device_name, added, updated, len(errors))
		if errors:
			message += "<br>" + "<br>".join(frappe.utils.escape_html(e) for e in errors[:50])
	except Exception as e:
		message = _("Could not push employees to {0}: {1}").format(device_name, e)
	if notify_user:
		frappe.publish_realtime("msgprint", message, user=notify_user)
	return message
