import frappe
from frappe.utils import add_days, add_to_date, cint, get_datetime, now_datetime, time_diff_in_seconds

from biometric_sync.constants import FAILED, NOT_FOUND, PENDING, PULL_PROTOCOLS, PUSH_PROTOCOLS
from biometric_sync.sync import enqueue_sync, get_settings, reprocess_log_names


def schedule_device_syncs():
	"""Every minute: queue pull devices whose interval has elapsed; flag silent push devices offline."""
	settings = get_settings()
	now = now_datetime()

	if cint(settings.enable_scheduled_sync):
		devices = frappe.get_all(
			"Biometric Device",
			filters={"enabled": 1, "auto_sync": 1, "protocol": ["in", PULL_PROTOCOLS]},
			fields=["name", "sync_interval", "last_sync_at"],
		)
		for device in devices:
			interval = max(cint(device.sync_interval) or 15, 1) * 60
			if not device.last_sync_at or time_diff_in_seconds(now, device.last_sync_at) >= interval - 30:
				enqueue_sync(device.name, "Scheduled")

	offline_after = max(cint(settings.adms_offline_after) or 10, 2)
	cutoff = add_to_date(now, minutes=-offline_after)
	for name in frappe.get_all(
		"Biometric Device",
		filters={"enabled": 1, "protocol": ["in", PUSH_PROTOCOLS], "status": "Online", "adms_last_seen": ["<", cutoff]},
		pluck="name",
	):
		frappe.db.set_value("Biometric Device", name, "status", "Offline", update_modified=False)


def retry_unmatched_logs():
	settings = get_settings()
	if not cint(settings.retry_unmatched):
		return
	since = add_days(now_datetime(), -(cint(settings.retry_days) or 30))
	names = frappe.get_all(
		"Biometric Log",
		filters={
			"status": ["in", [NOT_FOUND, FAILED, PENDING]],
			"timestamp": [">=", since],
			"creation": ["<", add_to_date(now_datetime(), minutes=-10)],
		},
		pluck="name",
		order_by="timestamp asc",
		limit=20000,
	)
	if names:
		reprocess_log_names(names)


def cleanup_old_logs():
	settings = get_settings()
	if cint(settings.log_retention_days) > 0:
		cutoff = add_days(now_datetime(), -cint(settings.log_retention_days))
		frappe.db.delete(
			"Biometric Log", {"timestamp": ["<", cutoff], "status": ["in", ["Synced", "Duplicate", "Ignored"]]}
		)
	if cint(settings.sync_log_retention_days) > 0:
		cutoff = add_days(now_datetime(), -cint(settings.sync_log_retention_days))
		frappe.db.delete("Biometric Sync Log", {"start_time": ["<", cutoff]})
	frappe.db.commit()
