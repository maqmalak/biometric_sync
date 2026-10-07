frappe.ui.form.on("Biometric Sync Settings", {
	refresh(frm) {
		frm.add_custom_button(__("Sync All Devices Now"), () => {
			frappe.call({ method: "biometric_sync.api.sync_all_devices", freeze: true }).then((r) => {
				frappe.msgprint(r.message.message);
			});
		});
		frm.add_custom_button(__("Retry Unmatched / Failed Logs"), () => {
			frappe.call({ method: "biometric_sync.api.reprocess_logs", freeze: true }).then((r) => {
				frappe.msgprint(r.message.message);
			});
		});
		frm.get_field("adms_help").$wrapper.html(`
			<div class="text-muted small">
				${__("ADMS endpoint for this site")}: <code>${window.location.origin}/iclock/cdata</code><br>
				${__("Webhook endpoint")}: <code>${window.location.origin}/api/method/biometric_sync.api.push_logs</code>
			</div>`);
	},
});
