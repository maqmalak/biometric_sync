frappe.provide("biometric_sync");

biometric_sync.PROTOCOLS = {
	ZK: "ZKTeco (TCP/UDP)",
	ADMS: "ZKTeco ADMS (Push)",
	BIOTIME: "ZKBio Time / BioTime",
	HTTP: "HTTP API (Pull)",
	WEBHOOK: "Webhook (Push)",
};

biometric_sync.run = function (frm, method, args, freeze_message) {
	if (frm.is_dirty()) {
		frappe.msgprint(__("Please save the device first."));
		return Promise.resolve();
	}
	return frm
		.call({ method, doc: frm.doc, args: args || {}, freeze: true, freeze_message: freeze_message || __("Working...") })
		.then((r) => {
			const message = r && r.message && r.message.message;
			if (message) frappe.msgprint({ title: frm.doc.name, message, indicator: "blue" });
			frm.reload_doc();
			return r;
		});
};

biometric_sync.confirm_run = function (frm, question, method, args) {
	frappe.confirm(question, () => biometric_sync.run(frm, method, args));
};

frappe.ui.form.on("Biometric Device", {
	onload(frm) {
		if (biometric_sync._listening) return;
		biometric_sync._listening = true;
		frappe.realtime.on("biometric_sync_complete", (data) => {
			const indicator = { Success: "green", Partial: "orange" }[data.status] || "red";
			frappe.show_alert(
				{
					message: `<b>${frappe.utils.escape_html(data.device)}</b>: ${__(data.status)}<br>${data.summary || ""}` +
						(data.message ? `<br>${frappe.utils.escape_html(data.message)}` : ""),
					indicator,
				},
				15
			);
			if (window.cur_frm && cur_frm.doctype === "Biometric Device" && cur_frm.doc.name === data.device) {
				cur_frm.reload_doc();
			}
		});
	},

	refresh(frm) {
		frm.trigger("render_help");
		if (frm.is_new()) return;

		const P = biometric_sync.PROTOCOLS;
		const p = frm.doc.protocol;
		const colors = { Online: "green", Offline: "red", Error: "red" };
		frm.page.set_indicator(__(frm.doc.enabled ? frm.doc.status || "Unknown" : "Disabled"), frm.doc.enabled ? colors[frm.doc.status] || "gray" : "gray");

		const sync = __("Sync");
		const dev = __("Device");

		if ([P.ZK, P.BIOTIME, P.HTTP].includes(p)) {
			frm.add_custom_button(__("Sync Now"), () => biometric_sync.run(frm, "sync_now"), sync);
			frm.add_custom_button(__("Sync Date Range"), () => frm.events.sync_date_range(frm), sync);
			frm.add_custom_button(__("Test Connection"), () => biometric_sync.run(frm, "test_connection", {}, __("Connecting to device...")), dev);
		}
		if ([P.ZK, P.BIOTIME, P.ADMS].includes(p)) {
			frm.add_custom_button(__("Fetch Users"), () => biometric_sync.run(frm, "fetch_users", {}, __("Reading users...")), dev);
		}
		if ([P.ZK, P.ADMS].includes(p)) {
			frm.add_custom_button(__("Push Employees to Device"), () => frm.events.push_employees(frm), dev);
			frm.add_custom_button(__("Clear Device Attendance Log"), () =>
				biometric_sync.confirm_run(frm, __("Delete ALL attendance records stored on the device? Make sure they are synced first. This cannot be undone."), "clear_device_logs"), dev);
			frm.add_custom_button(__("Restart Device"), () => biometric_sync.confirm_run(frm, __("Restart the device now?"), "restart_device"), dev);
		}
		if (p === P.ZK) {
			frm.add_custom_button(__("Sync Device Time"), () => biometric_sync.run(frm, "sync_device_time"), dev);
		}
		if (p === P.ADMS) {
			frm.add_custom_button(__("Request Log Upload"), () => frm.events.request_log_upload(frm), sync);
		}
		if (p === P.WEBHOOK) {
			frm.add_custom_button(__("Show Push Token"), () => biometric_sync.run(frm, "show_push_token"), dev);
			frm.add_custom_button(__("Regenerate Push Token"), () =>
				biometric_sync.confirm_run(frm, __("Generate a new token? The current one stops working."), "regenerate_push_token"), dev);
		}

		frm.add_custom_button(__("Reprocess Unmatched / Failed"), () => biometric_sync.run(frm, "reprocess_unmatched"), sync);
		frm.add_custom_button(__("Import Attendance File"), () => frm.events.import_file(frm), sync);

		frm.add_custom_button(__("Raw Logs"), () => frappe.set_route("List", "Biometric Log", { device: frm.doc.name }), __("View"));
		frm.add_custom_button(__("Sync History"), () => frappe.set_route("List", "Biometric Sync Log", { device: frm.doc.name }), __("View"));
		frm.add_custom_button(__("Device Users"), () => frappe.set_route("List", "Biometric Device User", { device: frm.doc.name }), __("View"));
		frm.add_custom_button(__("Unmatched Users Report"), () => frappe.set_route("query-report", "Unmatched Biometric Users", { device: frm.doc.name }), __("View"));
	},

	protocol(frm) {
		const P = biometric_sync.PROTOCOLS;
		if (frm.doc.protocol === P.ZK && !frm.doc.port) frm.set_value("port", 4370);
		frm.trigger("render_help");
	},

	render_help(frm) {
		const P = biometric_sync.PROTOCOLS;
		const loc = window.location;
		const port = loc.port || (loc.protocol === "https:" ? "443" : "80");
		const is_ip = /^[0-9.]+$/.test(loc.hostname);
		let html = "";

		if (frm.doc.protocol === P.ADMS) {
			html = `<b>${__("Configure the terminal")}</b> (${__("Menu → COMM → Cloud Server Setting / ADMS")}):
				<ul>
					<li>${__("Server Address")}: <code>${loc.hostname}</code></li>
					<li>${__("Server Port")}: <code>${port}</code></li>
					<li>${__("Enable Domain Name")}: <b>${is_ip ? "OFF" : "ON"}</b> · HTTPS: <b>${loc.protocol === "https:" ? "ON" : "OFF"}</b> · ${__("Proxy")}: <b>OFF</b></li>
					<li>${__("Serial Number below must match Menu → System Info → Device Info")}</li>
				</ul>
				${__("Endpoint")}: <code>${loc.origin}/iclock/cdata</code>`;
		} else if (frm.doc.protocol === P.WEBHOOK) {
			const name = frm.doc.name && !frm.is_new() ? frm.doc.name : "<device name>";
			html = `<b>${__("POST punches to")}</b> <code>${loc.origin}/api/method/biometric_sync.api.push_logs</code>
				<pre class="small">X-Biometric-Device: ${frappe.utils.escape_html(name)}
X-Biometric-Token: &lt;${__("Device → Show Push Token")}&gt;
Content-Type: application/json

{"logs": [{"${frm.doc.http_user_id_key || "user_id"}": "101", "${frm.doc.http_timestamp_key || "timestamp"}": "2025-01-31 09:01:12", "${frm.doc.http_punch_key || "punch"}": "0"}]}</pre>`;
		} else if (frm.doc.protocol === P.HTTP) {
			html = `${__("ERPNext calls the URL with")} <code>${frm.doc.http_since_param || "since"}=&lt;${__("last punch time")}&gt;</code>
				${__("and reads records from")} <code>${frm.doc.http_records_path || __("response root")}</code>.`;
		} else if (frm.doc.protocol === P.BIOTIME) {
			html = `${__("Uses")} <code>${frm.doc.server_url || "http://biotime:8081"}/iclock/api/transactions/</code>. ${__("The API user needs permission to read transactions and employees.")}`;
		} else if (frm.doc.protocol === P.ZK) {
			html = `${__("The server must reach the device on")} <code>${frm.doc.ip_address || "&lt;ip&gt;"}:${frm.doc.port || 4370}</code> (TCP, ${__("or UDP when Force UDP is set")}).`;
		}
		frm.get_field("setup_help").$wrapper.html(html ? `<div class="alert alert-info small">${html}</div>` : "");
	},

	sync_date_range(frm) {
		const d = new frappe.ui.Dialog({
			title: __("Re-sync a period"),
			fields: [
				{ fieldname: "from_date", fieldtype: "Datetime", label: __("From"), reqd: 1 },
				{ fieldname: "to_date", fieldtype: "Datetime", label: __("To"), reqd: 1, default: frappe.datetime.now_datetime() },
				{ fieldtype: "HTML", options: `<p class="text-muted small">${__("Already stored punches are skipped automatically.")}</p>` },
			],
			primary_action_label: __("Sync"),
			primary_action(values) {
				d.hide();
				biometric_sync.run(frm, "sync_now", values);
			},
		});
		d.show();
	},

	request_log_upload(frm) {
		const d = new frappe.ui.Dialog({
			title: __("Ask device to re-send punches"),
			fields: [
				{ fieldname: "from_date", fieldtype: "Datetime", label: __("From"), reqd: 1 },
				{ fieldname: "to_date", fieldtype: "Datetime", label: __("To"), reqd: 1, default: frappe.datetime.now_datetime() },
			],
			primary_action_label: __("Queue Command"),
			primary_action(values) {
				d.hide();
				biometric_sync.run(frm, "request_log_upload", values);
			},
		});
		d.show();
	},

	push_employees(frm) {
		const filters = { status: "Active" };
		if (frm.doc.company) filters.company = frm.doc.company;
		const d = new frappe.ui.Dialog({
			title: __("Push Employees to Device"),
			fields: [
				{
					fieldname: "employees",
					fieldtype: "MultiSelectList",
					label: __("Employees"),
					description: __("Leave empty to push every active employee that has {0} set.", [frm.doc.employee_field || "attendance_device_id"]),
					get_data: (txt) => frappe.db.get_link_options("Employee", txt, filters),
				},
			],
			primary_action_label: __("Push"),
			primary_action(values) {
				d.hide();
				biometric_sync.run(frm, "push_employees", { employees: values.employees || [] });
			},
		});
		d.show();
	},

	import_file(frm) {
		const d = new frappe.ui.Dialog({
			title: __("Import Attendance File"),
			fields: [
				{ fieldname: "file_url", fieldtype: "Attach", label: __("File"), reqd: 1 },
				{
					fieldname: "punch_column",
					fieldtype: "Select",
					label: __("Punch State Column"),
					options: [
						{ value: "3", label: __("Column 3 (ADMS text / CSV: user_id,timestamp,punch)") },
						{ value: "4", label: __("Column 4 (USB attlog.dat)") },
					],
					default: "3",
				},
				{ fieldtype: "HTML", options: `<p class="text-muted small">${__("Each line: user id, date time (YYYY-MM-DD HH:MM:SS), ... separated by TAB or comma. Duplicates are skipped.")}</p>` },
			],
			primary_action_label: __("Import"),
			primary_action(values) {
				d.hide();
				biometric_sync.run(frm, "import_attendance_file", values, __("Importing..."));
			},
		});
		d.show();
	},
});
