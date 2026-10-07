import hmac

import frappe
from frappe import _
from frappe.utils import cint

from biometric_sync.connectors.base import dig, make_record
from biometric_sync.constants import PULL_PROTOCOLS, RETRYABLE_STATUSES, WEBHOOK
from biometric_sync.sync import enqueue_sync, ingest_records, reprocess_log_names, summarize, update_device

MAX_PUSH = 5000
INLINE_REPROCESS_LIMIT = 300
MANAGER_ROLES = ("System Manager", "HR Manager")


@frappe.whitelist(allow_guest=True, methods=["POST"])
def push_logs(device=None, token=None, logs=None):
	"""Webhook for middleware / devices that can POST JSON.

	Headers: X-Biometric-Device, X-Biometric-Token (or `device` / `token` in the body)
	Body:    {"logs": [{"user_id": "101", "timestamp": "2025-01-31 09:01:12", "punch": "0"}, ...]}
	"""
	device = device or frappe.get_request_header("X-Biometric-Device")
	token = token or frappe.get_request_header("X-Biometric-Token")
	if not device or not token or not frappe.db.exists("Biometric Device", device):
		raise frappe.AuthenticationError(_("Invalid device or token"))

	doc = frappe.get_doc("Biometric Device", device)
	expected = doc.get_password("push_token", raise_exception=False) or ""
	if doc.protocol != WEBHOOK or not expected or not hmac.compare_digest(expected, token):
		raise frappe.AuthenticationError(_("Invalid device or token"))
	if not cint(doc.enabled):
		frappe.throw(_("Device is disabled"), frappe.PermissionError)

	logs = frappe.parse_json(logs) if isinstance(logs, str) else logs
	if isinstance(logs, dict):
		logs = logs.get("logs") or [logs]
	if not isinstance(logs, list):
		frappe.throw(_("`logs` must be a list"))
	if len(logs) > MAX_PUSH:
		frappe.throw(_("Send at most {0} logs per request").format(MAX_PUSH))

	user_key = doc.http_user_id_key or "user_id"
	time_key = doc.http_timestamp_key or "timestamp"
	punch_key = doc.http_punch_key or "punch"
	records, rejected = [], []
	for index, row in enumerate(logs):
		try:
			records.append(
				make_record(
					dig(row, user_key),
					dig(row, time_key),
					dig(row, punch_key),
					dig(row, "verify_type"),
					raw=row,
					time_format=doc.http_time_format or None,
				)
			)
		except Exception as e:
			rejected.append({"index": index, "error": str(e)})

	stats = ingest_records(doc, records, "Webhook")
	update_device(doc.name, status="Online", adms_last_seen=frappe.utils.now_datetime(), last_error="")
	frappe.db.commit()
	return {"received": len(logs), "rejected": rejected, **{k: v for k, v in stats.items() if k != "errors"}}


@frappe.whitelist()
def sync_all_devices():
	frappe.only_for(MANAGER_ROLES)
	devices = frappe.get_all(
		"Biometric Device", filters={"enabled": 1, "protocol": ["in", PULL_PROTOCOLS]}, pluck="name"
	)
	queued = [d for d in devices if enqueue_sync(d, "Manual", notify_user=frappe.session.user)]
	return {"message": _("Sync queued for {0} of {1} pull devices.").format(len(queued), len(devices))}


@frappe.whitelist()
def reprocess_logs(names=None, device=None, statuses=None):
	"""Retry Pending / Employee Not Found / Failed logs (selected names, a device, or all)."""
	frappe.only_for(MANAGER_ROLES)
	names = frappe.parse_json(names) if isinstance(names, str) else names
	statuses = frappe.parse_json(statuses) if isinstance(statuses, str) else statuses
	filters = {"status": ["in", statuses or list(RETRYABLE_STATUSES)]}
	if names:
		filters["name"] = ["in", names]
	if device:
		filters["device"] = device

	logs = frappe.get_all("Biometric Log", filters=filters, pluck="name", order_by="timestamp asc", limit=50000)
	if not logs:
		return {"message": _("Nothing to reprocess.")}
	if len(logs) > INLINE_REPROCESS_LIMIT:
		frappe.enqueue("biometric_sync.sync.reprocess_log_names", queue="long", timeout=3600, names=logs)
		return {"message": _("{0} logs queued for reprocessing in the background.").format(len(logs))}

	stats = reprocess_log_names(logs)
	stats.fetched = len(logs)
	return {"message": _("Reprocessed {0} logs: {1} check-ins created, {2} still unmatched, {3} failed, {4} duplicates.").format(
		len(logs), stats.checkins_created, stats.unmatched, stats.failed, stats.double_punches
	), "summary": summarize(stats)}
