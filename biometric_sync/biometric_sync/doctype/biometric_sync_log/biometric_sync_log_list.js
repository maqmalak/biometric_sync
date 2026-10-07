frappe.listview_settings["Biometric Sync Log"] = {
	add_fields: ["status"],
	get_indicator(doc) {
		const colors = { Success: "green", Partial: "orange", Failed: "red", "In Progress": "blue" };
		return [__(doc.status), colors[doc.status] || "gray", "status,=," + doc.status];
	},
};
