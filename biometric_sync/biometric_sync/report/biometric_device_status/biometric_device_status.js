frappe.query_reports["Biometric Device Status"] = {
	filters: [
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date", default: frappe.datetime.add_days(frappe.datetime.get_today(), -7), reqd: 1 },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date", default: frappe.datetime.get_today(), reqd: 1 },
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "status" && data) {
			const color = { Online: "green", Offline: "red", Error: "red" }[data.status] || "gray";
			value = `<span class="indicator-pill ${color}">${value}</span>`;
		}
		return value;
	},
};
