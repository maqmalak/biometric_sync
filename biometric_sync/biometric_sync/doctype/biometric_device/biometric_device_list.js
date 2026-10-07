frappe.listview_settings["Biometric Device"] = {
	add_fields: ["status", "enabled"],
	get_indicator(doc) {
		if (!doc.enabled) return [__("Disabled"), "gray", "enabled,=,0"];
		const colors = { Online: "green", Offline: "red", Error: "red", Unknown: "gray" };
		return [__(doc.status || "Unknown"), colors[doc.status] || "gray", "status,=," + (doc.status || "Unknown")];
	},
	onload(listview) {
		listview.page.add_inner_button(__("Sync All Devices"), () => {
			frappe.call({ method: "biometric_sync.api.sync_all_devices", freeze: true }).then((r) => {
				frappe.msgprint(r.message.message);
			});
		});
	},
};
