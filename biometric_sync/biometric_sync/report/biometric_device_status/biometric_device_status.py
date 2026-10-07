from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, get_datetime, today

STATUSES = ("Synced", "Duplicate", "Employee Not Found", "Ignored", "Failed", "Pending")


def execute(filters=None):
	filters = frappe._dict(filters or {})
	from_dt = get_datetime(f"{filters.from_date or add_days(today(), -7)} 00:00:00")
	to_dt = get_datetime(f"{filters.to_date or today()} 23:59:59")

	counts = defaultdict(lambda: defaultdict(int))
	for device, status, count in frappe.db.sql(
		"""select device, status, count(*) from `tabBiometric Log`
		where timestamp between %s and %s group by device, status""",
		(from_dt, to_dt),
	):
		counts[device][status] = count

	devices = frappe.get_all(
		"Biometric Device",
		fields=["name", "protocol", "enabled", "status", "last_sync_at", "last_sync_status", "adms_last_seen", "last_punch_time", "last_error"],
		order_by="name",
	)
	data = []
	for d in devices:
		c = counts[d.name]
		data.append(
			{
				**d,
				"device": d.name,
				"total": sum(c.values()),
				"synced": c["Synced"],
				"duplicate": c["Duplicate"],
				"unmatched": c["Employee Not Found"],
				"ignored": c["Ignored"],
				"failed": c["Failed"],
				"pending": c["Pending"],
			}
		)

	chart = {
		"data": {
			"labels": [row["device"] for row in data],
			"datasets": [
				{"name": _("Synced"), "values": [row["synced"] for row in data]},
				{"name": _("Unmatched"), "values": [row["unmatched"] for row in data]},
				{"name": _("Failed"), "values": [row["failed"] for row in data]},
			],
		},
		"type": "bar",
		"barOptions": {"stacked": 1},
	}
	return get_columns(), data, None, chart


def get_columns():
	return [
		{"fieldname": "device", "label": _("Device"), "fieldtype": "Link", "options": "Biometric Device", "width": 180},
		{"fieldname": "protocol", "label": _("Protocol"), "fieldtype": "Data", "width": 160},
		{"fieldname": "enabled", "label": _("Enabled"), "fieldtype": "Check", "width": 70},
		{"fieldname": "status", "label": _("Status"), "fieldtype": "Data", "width": 90},
		{"fieldname": "last_sync_at", "label": _("Last Sync"), "fieldtype": "Datetime", "width": 160},
		{"fieldname": "last_sync_status", "label": _("Last Result"), "fieldtype": "Data", "width": 90},
		{"fieldname": "adms_last_seen", "label": _("Last Seen (Push)"), "fieldtype": "Datetime", "width": 160},
		{"fieldname": "last_punch_time", "label": _("Latest Punch"), "fieldtype": "Datetime", "width": 160},
		{"fieldname": "total", "label": _("Punches"), "fieldtype": "Int", "width": 90},
		{"fieldname": "synced", "label": _("Synced"), "fieldtype": "Int", "width": 80},
		{"fieldname": "unmatched", "label": _("Unmatched"), "fieldtype": "Int", "width": 90},
		{"fieldname": "failed", "label": _("Failed"), "fieldtype": "Int", "width": 70},
		{"fieldname": "duplicate", "label": _("Duplicate"), "fieldtype": "Int", "width": 90},
		{"fieldname": "ignored", "label": _("Ignored"), "fieldtype": "Int", "width": 80},
		{"fieldname": "pending", "label": _("Pending"), "fieldtype": "Int", "width": 80},
		{"fieldname": "last_error", "label": _("Last Error"), "fieldtype": "Data", "width": 300},
	]
