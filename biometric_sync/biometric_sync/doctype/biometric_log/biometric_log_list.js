frappe.listview_settings["Biometric Log"] = {
	add_fields: ["status", "log_type"],
	get_indicator(doc) {
		const colors = {
			Synced: "green",
			Pending: "blue",
			Duplicate: "gray",
			Ignored: "gray",
			"Employee Not Found": "orange",
			Failed: "red",
		};
		return [__(doc.status), colors[doc.status] || "gray", "status,=," + doc.status];
	},
	onload(listview) {
		const run = (args) =>
			frappe.call({ method: "biometric_sync.api.reprocess_logs", args, freeze: true }).then((r) => {
				frappe.msgprint(r.message.message);
				listview.refresh();
			});
		listview.page.add_actions_menu_item(__("Reprocess"), () => run({ names: listview.get_checked_items(true) }));
		listview.page.add_inner_button(__("Retry Unmatched / Failed"), () => run({}));
	},
};
