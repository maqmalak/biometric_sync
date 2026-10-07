frappe.ui.form.on("Biometric Log", {
	refresh(frm) {
		if (frm.is_new()) return;
		if (["Pending", "Employee Not Found", "Failed"].includes(frm.doc.status)) {
			frm.add_custom_button(__("Reprocess"), () => {
				frm.call({ method: "reprocess", doc: frm.doc, freeze: true }).then((r) => {
					frappe.show_alert({ message: __("Status: {0}", [r.message]), indicator: "blue" });
					frm.reload_doc();
				});
			});
		}
		if (frm.doc.employee_checkin) {
			frm.add_custom_button(__("Employee Checkin"), () =>
				frappe.set_route("Form", "Employee Checkin", frm.doc.employee_checkin)
			, __("View"));
		}
		if (frm.doc.status === "Employee Not Found") {
			frm.set_intro(__("No employee has this device user id. Set it on the Employee (Attendance Device ID) and the punch is retried automatically."), "orange");
		}
	},
});
