frappe.query_reports["Unmatched Biometric Users"] = {
	filters: [
		{ fieldname: "device", label: __("Device"), fieldtype: "Link", options: "Biometric Device" },
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date", default: frappe.datetime.add_days(frappe.datetime.get_today(), -30), reqd: 1 },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date", default: frappe.datetime.get_today(), reqd: 1 },
	],
	onload(report) {
		report.page.add_inner_button(__("Retry Unmatched Punches"), () => {
			frappe.call({ method: "biometric_sync.api.reprocess_logs", args: { statuses: ["Employee Not Found"] }, freeze: true })
				.then((r) => { frappe.msgprint(r.message.message); report.refresh(); });
		});
	},
};
