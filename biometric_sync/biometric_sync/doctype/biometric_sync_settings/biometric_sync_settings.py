from frappe.model.document import Document
from frappe.utils import cint

NON_NEGATIVE = ("duplicate_punch_window", "retry_days", "log_retention_days", "sync_log_retention_days", "adms_offline_after")


class BiometricSyncSettings(Document):
	def validate(self):
		for field in NON_NEGATIVE:
			if cint(self.get(field)) < 0:
				self.set(field, 0)
