import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, get_datetime

from biometric_sync.constants import IGNORED, PENDING, RETRYABLE_STATUSES


class BiometricLog(Document):
	def before_insert(self):
		if self.flags.skip_processing:
			return  # created by the sync engine, already normalised

		# manual entry / Data Import: normalise like the sync engine does
		from biometric_sync.sync import make_hash, normalize_user_id, resolve_log_type

		device = frappe.get_cached_doc("Biometric Device", self.device)
		self.user_id = normalize_user_id(device, self.user_id)
		self.timestamp = get_datetime(self.timestamp).replace(microsecond=0)
		self.source = self.source or "Manual"
		self.log_hash = make_hash(device.name, self.user_id, self.timestamp)
		if frappe.db.exists("Biometric Log", {"log_hash": self.log_hash}):
			frappe.throw(_("Punch of {0} at {1} on {2} already exists").format(self.user_id, self.timestamp, device.name), frappe.DuplicateEntryError)

		log_type = self.log_type or resolve_log_type(device, self.punch_state)
		self.status = IGNORED if log_type == "Ignore" else PENDING
		self.log_type = "" if log_type == "Ignore" else log_type

	def after_insert(self):
		if self.flags.skip_processing or self.status != PENDING:
			return
		from biometric_sync.sync import process_log

		device = frappe.get_cached_doc("Biometric Device", self.device)
		if cint(device.create_checkins):
			process_log(self, device)

	@frappe.whitelist()
	def reprocess(self):
		self.check_permission("write")
		if self.status not in RETRYABLE_STATUSES:
			frappe.throw(_("Only Pending, Employee Not Found or Failed logs can be reprocessed"))
		from biometric_sync.sync import process_log

		self.status = PENDING
		return process_log(self, frappe.get_doc("Biometric Device", self.device))
