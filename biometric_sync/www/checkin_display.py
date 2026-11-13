"""/checkin-display → the Check-in Display (login required)."""
import frappe

no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/checkin-display"
		raise frappe.Redirect
	qs = frappe.request.query_string.decode() if frappe.request and frappe.request.query_string else ""
	frappe.local.flags.redirect_location = "/assets/biometric_sync/display/index.html" + (f"?{qs}" if qs else "")
	raise frappe.Redirect
