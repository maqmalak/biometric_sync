from frappe import _


def get_data():
	return {
		"fieldname": "device",
		"transactions": [
			{"label": _("Attendance"), "items": ["Biometric Log", "Biometric Sync Log"]},
			{"label": _("Device"), "items": ["Biometric Device User"]},
		],
	}
