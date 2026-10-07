import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, cstr, now_datetime
from frappe.utils.password import set_encrypted_password

from biometric_sync.connectors import get_connector
from biometric_sync.connectors.base import DeviceConnectionError
from biometric_sync.constants import (
	BIOTIME,
	HTTP_PULL,
	NOT_FOUND,
	FAILED,
	PENDING,
	PULL_PROTOCOLS,
	WEBHOOK,
	ZK_ADMS,
	ZK_PULL,
)

REQUIRED = {
	ZK_PULL: ("ip_address", "port"),
	ZK_ADMS: ("serial_number",),
	BIOTIME: ("server_url", "api_username", "api_password"),
	HTTP_PULL: ("http_url", "http_user_id_key", "http_timestamp_key"),
	WEBHOOK: (),
}


class BiometricDevice(Document):
	def validate(self):
		self.device_name = cstr(self.device_name).strip()
		for fieldname in REQUIRED.get(self.protocol, ()):
			if not self.get(fieldname):
				frappe.throw(_("{0} is required for protocol {1}").format(frappe.bold(_(self.meta.get_label(fieldname))), self.protocol))

		self.employee_field = cstr(self.employee_field).strip() or "attendance_device_id"
		if not frappe.get_meta("Employee").has_field(self.employee_field):
			frappe.throw(_("Employee has no field named {0}").format(frappe.bold(self.employee_field)))

		if self.serial_number:
			self.serial_number = self.serial_number.strip().upper()
		if self.protocol != ZK_ADMS:
			self.serial_number = None
		self.sync_interval = max(cint(self.sync_interval) or 15, 1)

		seen = set()
		for row in self.punch_map:
			key = cstr(row.punch_state).strip().lower()
			if key in seen:
				frappe.throw(_("Row {0}: punch state {1} is mapped twice").format(row.idx, row.punch_state))
			seen.add(key)

		if self.protocol == WEBHOOK and not self.push_token:
			self.push_token = frappe.generate_hash(length=32)

	# ------------------------------------------------------------------ helpers
	def _require(self, *protocols):
		self.check_permission("write")
		if protocols and self.protocol not in protocols:
			frappe.throw(_("This action is not available for protocol {0}").format(self.protocol))

	def _run(self, action):
		"""Open a connection, run action(connector) and translate connection errors."""
		try:
			with get_connector(self) as connector:
				return action(connector)
		except DeviceConnectionError as e:
			frappe.db.set_value(self.doctype, self.name, {"status": "Offline", "last_error": cstr(e)[:1000]}, update_modified=False)
			frappe.db.commit()
			frappe.throw(cstr(e), title=_("Device not reachable"))

	# ------------------------------------------------------------------ actions
	@frappe.whitelist()
	def test_connection(self):
		self._require(*PULL_PROTOCOLS)
		info = self._run(lambda c: c.get_info())
		values = {k: v for k, v in info.items() if self.meta.has_field(k) and v not in (None, "")}
		values.update(status="Online", last_error="", info_updated_at=now_datetime())
		frappe.db.set_value(self.doctype, self.name, values, update_modified=False)
		details = "".join(f"<br>{frappe.bold(_(self.meta.get_label(k)))}: {frappe.utils.escape_html(cstr(v))}" for k, v in values.items() if k not in ("status", "last_error", "info_updated_at"))
		return {"message": _("Connected successfully.") + details}

	@frappe.whitelist()
	def sync_now(self, from_date=None, to_date=None):
		self._require(*PULL_PROTOCOLS)
		from biometric_sync.sync import enqueue_sync

		if enqueue_sync(self.name, "Manual", from_date, to_date, frappe.session.user):
			return {"message": _("Sync started in the background. You will be notified when it finishes.")}
		return {"message": _("A sync for this device is already queued or running.")}

	@frappe.whitelist()
	def fetch_users(self):
		self._require(ZK_PULL, BIOTIME, ZK_ADMS)
		if self.protocol == ZK_ADMS:
			from biometric_sync.adms import queue_command

			queue_command(self.name, "DATA QUERY USERINFO")
			return {"message": _("Command queued. The device uploads its users on its next heartbeat.")}

		from biometric_sync.sync import upsert_device_users

		users = self._run(lambda c: c.get_users())
		total, linked = upsert_device_users(self, users)
		return {"message": _("{0} users fetched, {1} linked to employees.").format(total, linked)}

	@frappe.whitelist()
	def push_employees(self, employees=None):
		self._require(ZK_PULL, ZK_ADMS)
		employees = frappe.parse_json(employees) if isinstance(employees, str) else employees
		from biometric_sync.sync import get_employees_for_device

		rows = get_employees_for_device(self, employees)
		if not rows:
			frappe.throw(_("No active employees with {0} found.").format(self.employee_field))

		if self.protocol == ZK_ADMS:
			from biometric_sync.adms import queue_command

			for row in rows:
				name = cstr(row["name"]).replace("\t", " ")[:24]
				queue_command(self.name, f"DATA UPDATE USERINFO PIN={row['user_id']}\tName={name}\tPri=0")
			return {"message": _("{0} employees queued for upload on the next heartbeat.").format(len(rows))}

		frappe.enqueue(
			"biometric_sync.sync.push_employees_to_zk",
			queue="long",
			timeout=3600,
			device_name=self.name,
			employees=employees,
			notify_user=frappe.session.user,
		)
		return {"message": _("Uploading {0} employees in the background.").format(len(rows))}

	@frappe.whitelist()
	def sync_device_time(self):
		self._require(ZK_PULL)
		from biometric_sync.sync import shift

		self._run(lambda c: c.set_time(shift(now_datetime(), -cint(self.time_offset_minutes))))
		return {"message": _("Device time set.")}

	@frappe.whitelist()
	def clear_device_logs(self):
		self._require(ZK_PULL, ZK_ADMS)
		if self.protocol == ZK_ADMS:
			from biometric_sync.adms import queue_command

			queue_command(self.name, "CLEAR LOG")
			return {"message": _("Clear command queued.")}
		self._run(lambda c: c.clear_logs())
		return {"message": _("Attendance log on the device cleared.")}

	@frappe.whitelist()
	def restart_device(self):
		self._require(ZK_PULL, ZK_ADMS)
		if self.protocol == ZK_ADMS:
			from biometric_sync.adms import queue_command

			queue_command(self.name, "REBOOT")
			return {"message": _("Reboot command queued.")}
		self._run(lambda c: c.restart())
		return {"message": _("Device is restarting.")}

	@frappe.whitelist()
	def request_log_upload(self, from_date, to_date):
		self._require(ZK_ADMS)
		from biometric_sync.adms import queue_command

		queue_command(self.name, f"DATA QUERY ATTLOG StartTime={from_date}\tEndTime={to_date}")
		return {"message": _("Command queued. The device re-sends punches on its next heartbeat.")}

	@frappe.whitelist()
	def show_push_token(self):
		self._require(WEBHOOK)
		return {"message": _("Push token: {0}").format(f"<code>{self.get_password('push_token')}</code>")}

	@frappe.whitelist()
	def regenerate_push_token(self):
		self._require(WEBHOOK)
		token = frappe.generate_hash(length=32)
		set_encrypted_password(self.doctype, self.name, token, "push_token")
		frappe.db.set_value(self.doctype, self.name, "push_token", "*" * len(token), update_modified=False)
		return {"message": _("New push token: {0}<br>Update your middleware - the old token no longer works.").format(f"<code>{token}</code>")}

	@frappe.whitelist()
	def reprocess_unmatched(self):
		self.check_permission("write")
		from biometric_sync.api import reprocess_logs

		return reprocess_logs(device=self.name, statuses=[PENDING, NOT_FOUND, FAILED])

	@frappe.whitelist()
	def import_attendance_file(self, file_url, punch_column=3):
		"""Import attlog.dat (USB download), ADMS text or CSV (user_id,timestamp,punch)."""
		self.check_permission("write")
		from biometric_sync.adms import parse_punch_lines
		from biometric_sync.sync import ingest_records, summarize

		file_doc = frappe.get_doc("File", {"file_url": file_url})
		content = file_doc.get_content()
		if isinstance(content, bytes):
			content = content.decode("utf-8-sig", errors="ignore")
		punch_column = cint(punch_column) or 3
		records = parse_punch_lines(content, punch_column=punch_column, verify_column=punch_column + 1)
		if not records:
			frappe.throw(_("No punches found in the file."))
		stats = ingest_records(self, records, "File Import")
		stats.fetched = len(records)
		return {"message": _("File imported.") + "<br>" + summarize(stats)}
