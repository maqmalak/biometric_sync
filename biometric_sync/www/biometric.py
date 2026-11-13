"""/biometric → the Biometric Sync console (React app, built into public/console). Login required."""
import frappe

no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/biometric"
		raise frappe.Redirect
	# ?v=<build time>: the browser fetches a fresh index.html (and so the new bundle) after every build
	import os

	index = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public", "console", "index.html")
	v = int(os.path.getmtime(index)) if os.path.exists(index) else 0
	frappe.local.flags.redirect_location = f"/assets/biometric_sync/console/index.html?v={v}"
	raise frappe.Redirect
