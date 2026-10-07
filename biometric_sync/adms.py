"""ZKTeco ADMS ("push SDK" / iclock) server.

The terminal is configured with this site as "Cloud Server"; it then calls
  GET  /iclock/cdata?SN=..&options=all      -> we answer with the device options
  POST /iclock/cdata?SN=..&table=ATTLOG     -> attendance lines  "PIN\\tYYYY-MM-DD HH:MM:SS\\tstate\\tverify..."
  POST /iclock/cdata?SN=..&table=OPERLOG    -> user / operation lines ("USER PIN=1\\tName=..")
  GET  /iclock/getrequest?SN=..             -> heartbeat; we hand out queued commands
  POST /iclock/devicecmd?SN=..              -> command results
"""

import time as time_module
from datetime import datetime
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import cint, cstr, get_system_timezone, now_datetime
from frappe.website.page_renderers.base_renderer import BaseRenderer
from werkzeug.wrappers import Response

from biometric_sync.connectors.base import make_record
from biometric_sync.constants import ZK_ADMS
from biometric_sync.sync import get_settings, ingest_records, update_device, upsert_device_users


class ADMSRenderer(BaseRenderer):
	def can_render(self):
		return cstr(self.path).strip("/").split("/", 1)[0].lower() == "iclock"

	def render(self):
		try:
			text = handle_request(self.path)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title="Biometric Sync: ADMS request failed")
			text = "ERROR"
		return Response(text, status=200, mimetype="text/plain")


def handle_request(path):
	request = frappe.request
	args = request.args
	endpoint = cstr(path).strip("/").split("/")[-1].split(".")[0].lower()  # cdata.aspx -> cdata
	serial = cstr(args.get("SN") or args.get("sn")).strip().upper()

	settings = get_settings()
	if not cint(settings.enable_adms):
		return "ERROR: ADMS disabled"
	if not serial:
		return "OK"

	device = get_device(serial, settings)
	if not device:
		return "ERROR: unknown device"
	if not cint(device.enabled):
		return "ERROR: device disabled"

	remote_ip = getattr(frappe.local, "request_ip", None) or request.remote_addr
	allowed = {ip.strip() for ip in cstr(device.adms_allowed_ips).replace("\n", ",").split(",") if ip.strip()}
	if allowed and remote_ip not in allowed:
		return "ERROR: IP not allowed"

	update_device(device.name, adms_last_seen=now_datetime(), adms_ip=remote_ip, status="Online")

	if endpoint == "cdata":
		if request.method == "GET":
			return device_options(device, serial)
		table = cstr(args.get("table")).upper()
		body = request.get_data(as_text=True) or ""
		if table == "ATTLOG":
			count = handle_attlog(device, body)
			if args.get("Stamp"):
				update_device(device.name, adms_attlog_stamp=cstr(args.get("Stamp"))[:140])
			return f"OK: {count}"
		if table in ("OPERLOG", "USERINFO"):
			return f"OK: {handle_operlog(device, body)}"
		return "OK"

	if endpoint == "getrequest":
		update_info(device, args.get("INFO"))
		return pop_commands(device)

	return "OK"  # devicecmd, ping, registry, push, ...


def get_device(serial, settings):
	name = frappe.db.get_value("Biometric Device", {"serial_number": serial, "protocol": ZK_ADMS})
	if not name and cint(settings.adms_auto_register):
		device = frappe.get_doc(
			{
				"doctype": "Biometric Device",
				"device_name": f"ADMS {serial}",
				"protocol": ZK_ADMS,
				"serial_number": serial,
				"enabled": 1,
			}
		).insert(ignore_permissions=True)
		name = device.name
	return frappe.get_doc("Biometric Device", name) if name else None


def device_options(device, serial):
	offset = datetime.now(ZoneInfo(get_system_timezone())).utcoffset().total_seconds() / 3600
	lines = [
		f"GET OPTION FROM: {serial}",
		f"ATTLOGStamp={device.adms_attlog_stamp or 'None'}",
		"OPERLOGStamp=9999",
		"ATTPHOTOStamp=None",
		"ErrorDelay=30",
		f"Delay={cint(device.adms_delay) or 10}",
		"TransTimes=00:00;14:05",
		f"TransInterval={cint(device.adms_trans_interval) or 1}",
		"TransFlag=TransData AttLog OpLog EnrollUser ChgUser",
		f"TimeZone={int(offset) if offset == int(offset) else offset}",
		f"Realtime={1 if cint(device.adms_realtime) else 0}",
		"Encrypt=None",
	]
	return "\n".join(lines)


def parse_punch_lines(text, punch_column=3, verify_column=4):
	"""Parse tab / comma separated punch lines: PIN, datetime, ... (1-based column numbers)."""
	records = []
	for line in cstr(text).splitlines():
		line = line.strip()
		if not line:
			continue
		parts = [p.strip() for p in (line.split("\t") if "\t" in line else line.split(","))]
		if len(parts) < 2 or not parts[0]:
			continue
		try:
			records.append(
				make_record(
					parts[0],
					parts[1],
					parts[punch_column - 1] if len(parts) >= punch_column else None,
					parts[verify_column - 1] if len(parts) >= verify_column else None,
					raw=line,
				)
			)
		except (ValueError, TypeError, OverflowError):
			continue  # header row or malformed line
	return records


def handle_attlog(device, body):
	records = parse_punch_lines(body, punch_column=3, verify_column=4)
	if records:
		ingest_records(device, records, "ADMS Push")
	return len(records)


def handle_operlog(device, body):
	users = []
	for line in cstr(body).splitlines():
		line = line.strip()
		if not line.upper().startswith("USER "):
			continue
		values = dict(part.split("=", 1) for part in line[5:].split("\t") if "=" in part)
		if values.get("PIN"):
			users.append(
				{
					"user_id": values.get("PIN"),
					"user_name": values.get("Name"),
					"privilege": "Admin" if cint(values.get("Pri")) == 14 else "User",
					"card_no": values.get("Card"),
					"uid": values.get("PIN") if cstr(values.get("PIN")).isdigit() else 0,
				}
			)
	if users:
		upsert_device_users(device, users)
	return len(users)


def update_info(device, info):
	# INFO=Ver 8.0.4.2,UserCount,FPCount,AttCount,IP,FPVersion,FaceVersion,FaceCount,...
	if not info:
		return
	parts = cstr(info).split(",")
	values = {"firmware_version": parts[0][:140], "info_updated_at": now_datetime(), "device_serial": device.serial_number}
	for index, field in ((1, "user_count"), (2, "fingerprint_count"), (3, "log_count"), (7, "face_count")):
		if len(parts) > index and parts[index].strip().isdigit():
			values[field] = cint(parts[index])
	update_device(device.name, **values)


def queue_command(device_name, command):
	pending = cstr(frappe.db.get_value("Biometric Device", device_name, "adms_pending_commands"))
	commands = [c for c in pending.splitlines() if c.strip()] + [command]
	update_device(device_name, adms_pending_commands="\n".join(commands))


def pop_commands(device):
	commands = [c for c in cstr(device.adms_pending_commands).splitlines() if c.strip()]
	if not commands:
		return "OK"
	update_device(device.name, adms_pending_commands="")
	base = int(time_module.time()) % 1000000 * 10
	return "\n".join(f"C:{base + i}:{command}" for i, command in enumerate(commands)) + "\n"
