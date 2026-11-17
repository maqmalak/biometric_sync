"""Live capture: punches reach the site the moment they are scanned.

One long-running process per site (supervisor runs it; locally: `bench --site <site> execute biometric_sync.live.run`)
keeps a connection open to every enabled ZKTeco (TCP/UDP) machine with "Live Capture" on and stores each punch at once
through the same path as a pull (`ingest_records`: Biometric Log → Employee Checkin), so duplicate rules and employee
matching are identical. The scheduled pull stays on as a safety net for anything missed while a machine was offline.

A ZKTeco machine takes one connection at a time: whenever something else needs the machine (the scheduled pull, Test,
Fetch Users, Sync Time …) the ZK connector sets a pause flag; the live thread lets go within a few seconds and
reconnects when the flag is cleared.
"""
import threading
import time

import frappe
from frappe.utils import cint, cstr, now_datetime

from biometric_sync.constants import ZK_PULL

PAUSE_KEY = "bs_live_pause:{}"      # set while another connection needs the machine
HOLD_KEY = "bs_live_holding:{}"     # set while the live thread holds the connection
STATUS_KEY = "bs_live_status:{}"    # {"status", "since", "error", "punches"} for the console / display
HEARTBEAT = 5                       # seconds between checks while waiting for punches
RELOAD = 30                         # seconds between re-reading which machines are live


def live_devices():
	return frappe.get_all("Biometric Device", {"enabled": 1, "live_capture": 1, "protocol": ZK_PULL}, pluck="name")


def status(device):
	return frappe.cache.get_value(STATUS_KEY.format(device)) or {"status": "off"}


def _set_status(device, state, error=None, punches=None):
	cur = frappe.cache.get_value(STATUS_KEY.format(device)) or {}
	val = {"status": state, "since": cur.get("since") if cur.get("status") == state else str(now_datetime()),
		"error": error, "punches": punches if punches is not None else cur.get("punches", 0), "seen": str(now_datetime())}
	frappe.cache.set_value(STATUS_KEY.format(device), val, expires_in_sec=HEARTBEAT * 6)


def _paused(device):
	return bool(frappe.cache.get_value(PAUSE_KEY.format(device)))


# ------------------------------------------------------------------ used by the ZK connector (pull, test, users …)
def pause(device, wait=12):
	"""Ask the live thread to release the machine; returns once it has (or after `wait` seconds)."""
	frappe.cache.set_value(PAUSE_KEY.format(device), 1, expires_in_sec=900)
	deadline = time.time() + wait
	while frappe.cache.get_value(HOLD_KEY.format(device)) and time.time() < deadline:
		time.sleep(0.5)


def resume(device):
	frappe.cache.delete_value(PAUSE_KEY.format(device))


# ------------------------------------------------------------------ the service
def run():
	"""Start one capture thread per live machine; keep the set in step with the settings. Runs until stopped."""
	site, sites_path = frappe.local.site, frappe.local.sites_path
	threads: dict[str, tuple[threading.Thread, threading.Event]] = {}
	print(f"biometric_sync live capture for {site}", flush=True)
	while True:
		try:
			frappe.db.rollback()   # see changes made by other processes
			wanted = set(live_devices())
		except Exception as e:
			print(f"cannot read devices: {e}", flush=True)
			wanted = set(threads)
		for name in wanted:
			t = threads.get(name)
			if not t or not t[0].is_alive():
				stop = threading.Event()
				th = threading.Thread(target=_worker, args=(site, sites_path, name, stop), name=f"live:{name}", daemon=True)
				th.start()
				threads[name] = (th, stop)
				print(f"{name}: capture started", flush=True)
		for name in list(threads):
			if name not in wanted:
				threads.pop(name)[1].set()
				print(f"{name}: capture stopped (live capture turned off)", flush=True)
		time.sleep(RELOAD)


def _worker(site, sites_path, name, stop):
	frappe.init(site=site, sites_path=sites_path)
	frappe.connect()
	frappe.set_user("Administrator")
	backoff = 5
	try:
		while not stop.is_set():
			if _paused(name):
				_set_status(name, "paused")
				time.sleep(1)
				continue
			conn = None
			try:
				conn = _connect(name)
				frappe.cache.set_value(HOLD_KEY.format(name), 1, expires_in_sec=HEARTBEAT * 6)
				_set_status(name, "listening")
				backoff = 5
				_capture(name, conn, stop)
			except Exception as e:
				msg = cstr(e)[:300] or repr(e)
				_set_status(name, "error", error=msg)
				print(f"{name}: {msg} (retry in {backoff}s)", flush=True)
				frappe.db.rollback()
				_sleep(stop, backoff, name)
				backoff = min(backoff * 2, 120)
			finally:
				if conn:
					try:
						conn.end_live_capture = True
						conn.disconnect()
					except Exception:
						pass
				frappe.cache.delete_value(HOLD_KEY.format(name))
	finally:
		_set_status(name, "off")
		frappe.destroy()


def _sleep(stop, seconds, name):
	end = time.time() + seconds
	while time.time() < end and not stop.is_set() and not _paused(name):
		time.sleep(1)


def _connect(name):
	from zk import ZK

	d = frappe.get_doc("Biometric Device", name)
	zk = ZK(d.ip_address.strip(), port=cint(d.port) or 4370, timeout=max(cint(d.timeout) or 10, 5), password=cint(d.comm_key),
		force_udp=bool(cint(d.force_udp)), ommit_ping=not cint(d.ping_before_connect))
	return zk.connect()


def _capture(name, conn, stop):
	from biometric_sync.connectors.base import make_record
	from biometric_sync.sync import ingest_records, new_stats, update_device

	punches = 0
	for att in conn.live_capture(new_timeout=HEARTBEAT):
		if stop.is_set() or _paused(name):
			conn.end_live_capture = True
			continue
		frappe.cache.set_value(HOLD_KEY.format(name), 1, expires_in_sec=HEARTBEAT * 6)
		if att is None:   # no punch in the last few seconds: heartbeat
			_set_status(name, "listening", punches=punches)
			continue
		device = frappe.get_doc("Biometric Device", name)
		rec = make_record(att.user_id, att.timestamp, punch_state=att.punch, verify_type=att.status,
			raw={"uid": att.uid, "user_id": att.user_id, "timestamp": str(att.timestamp), "status": att.status, "punch": att.punch, "live": 1})
		stats = new_stats()
		ingest_records(device, [rec], "Live Capture", stats=stats)
		update_device(name, status="Online", last_error="")
		frappe.db.commit()
		punches += 1
		_set_status(name, "listening", punches=punches)
		print(f"{name}: punch {att.user_id} {att.timestamp} → {stats.checkins_created} check-in(s)", flush=True)
