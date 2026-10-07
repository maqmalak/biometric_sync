import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def after_install():
	# ERPNext ships "Attendance Device ID" on Employee; create it if this setup lacks it
	if not frappe.get_meta("Employee").has_field("attendance_device_id"):
		create_custom_fields(
			{
				"Employee": [
					{
						"fieldname": "attendance_device_id",
						"label": "Attendance Device ID (Biometric/RF tag ID)",
						"fieldtype": "Data",
						"insert_after": "employee_number",
					}
				]
			}
		)

	# materialise defaults of the single settings doctype
	frappe.get_single("Biometric Sync Settings").save(ignore_permissions=True)
