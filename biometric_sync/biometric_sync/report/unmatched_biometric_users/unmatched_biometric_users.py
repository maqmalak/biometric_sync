import frappe
from frappe import _
from frappe.utils import add_days, get_datetime, today


def execute(filters=None):
	filters = frappe._dict(filters or {})
	params = {
		"from_dt": get_datetime(f"{filters.from_date or add_days(today(), -30)} 00:00:00"),
		"to_dt": get_datetime(f"{filters.to_date or today()} 23:59:59"),
		"device": filters.device,
	}
	data = frappe.db.sql(
		f"""
		select l.device, l.user_id, count(*) as punches, min(l.timestamp) as first_punch, max(l.timestamp) as last_punch,
			(select u.user_name from `tabBiometric Device User` u where u.device = l.device and u.user_id = l.user_id limit 1) as device_user_name
		from `tabBiometric Log` l
		where l.status = 'Employee Not Found' and l.timestamp between %(from_dt)s and %(to_dt)s
			{"and l.device = %(device)s" if filters.device else ""}
		group by l.device, l.user_id
		order by punches desc
		""",
		params,
		as_dict=True,
	)
	columns = [
		{"fieldname": "device", "label": _("Device"), "fieldtype": "Link", "options": "Biometric Device", "width": 180},
		{"fieldname": "user_id", "label": _("Device User ID"), "fieldtype": "Data", "width": 130},
		{"fieldname": "device_user_name", "label": _("Name on Device"), "fieldtype": "Data", "width": 180},
		{"fieldname": "punches", "label": _("Unmatched Punches"), "fieldtype": "Int", "width": 140},
		{"fieldname": "first_punch", "label": _("First Punch"), "fieldtype": "Datetime", "width": 160},
		{"fieldname": "last_punch", "label": _("Last Punch"), "fieldtype": "Datetime", "width": 160},
	]
	return columns, data
