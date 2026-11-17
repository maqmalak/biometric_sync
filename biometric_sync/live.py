"""Live capture: punches reach the site the moment they are scanned.

One long-running process per site (supervisor runs it; locally: `bench --site <site> execute biometric_sync.live.run`)
keeps a connection open to every enabled ZKTeco (TCP/UDP) machine with "Live Capture" on and stores each punch at once
through the same path as a pull (`ingest_records`: Biometric Log → Employee Checkin), so duplicate rules and employee
matching are identical. The scheduled pull stays on as a safety net for anything missed while a machine was offline.

A ZKTeco machine takes one connection at a time: whenever something else needs the machine (the scheduled pull, Test,
Fetch Users, Sync Time …) the ZK connector sets a pause flag; the live thread lets go within a few seconds and
reconnects when the flag is cleared.
"""
import os
import socket
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
# The machines sit behind a router on the internet: an idle TCP connection can be dropped on the way without either
# end noticing, and the thread would "listen" on a dead socket for hours (seen 2026-11-17: 0 punches all day while
# the pulls kept working). pyzk sends nothing while it waits, so reconnect after a quiet spell and at a maximum age.
IDLE_RECONNECT = 90                 # seconds without a punch → reconnect
MAX_SESSION = 600                   # reconnect at least this often


SERVICE_KEY = "bs_live_service"     # {"pid", "host", "started", "seen"} while a service runs (heartbeat)
STOP_KEY = "bs_live_stop"           # set by Stop in the console; the service exits within a few seconds


def _get(key):
	"""Read straight from Redis: frappe.cache keeps a per-process copy that a long-running process never clears, so
	this service would not see Stop / pause requests (and others would see stale status)."""
	return frappe.cache.get_value(key, use_local_cache=False)


def live_devices():
	return frappe.get_all("Biometric Device", {"enabled": 1, "live_capture": 1, "protocol": ZK_PULL}, pluck="name")


def status(device):
	return _get(STATUS_KEY.format(device)) or {"status": "off"}


def _set_status(device, state, error=None, punches=None):
	cur = _get(STATUS_KEY.format(device)) or {}
	val = {"status": state, "since": cur.get("since") if cur.get("status") == state else str(now_datetime()),
		"error": error, "punches": punches if punches is not None else cur.get("punches", 0), "seen": str(now_datetime())}
	frappe.cache.set_value(STATUS_KEY.format(device), val, expires_in_sec=HEARTBEAT * 6)


def _paused(device):
	return bool(_get(PAUSE_KEY.format(device)))


# ------------------------------------------------------------------ used by the ZK connector (pull, test, users …)
def pause(device, wait=12):
	"""Ask the live thread to release the machine; returns once it has (or after `wait` seconds)."""
	frappe.cache.set_value(PAUSE_KEY.format(device), 1, expires_in_sec=900)
	deadline = time.time() + wait
	while _get(HOLD_KEY.format(device)) and time.time() < deadline:
		time.sleep(0.5)


def resume(device):
	frappe.cache.delete_value(PAUSE_KEY.format(device))


# ------------------------------------------------------------------ the service
def _pid_alive(pid):
	try:
		os.kill(int(pid), 0)
		return True
	except (OSError, ValueError, TypeError):
		return False


def service_info():
	"""The running service (from its heartbeat), or None."""
	info = _get(SERVICE_KEY)
	if not info:
		return None
	if info.get("host") == socket.gethostname() and not _pid_alive(info.get("pid")):
		frappe.cache.delete_value(SERVICE_KEY)   # killed without cleaning up
		return None
	return info


def _beat(started):
	frappe.cache.set_value(SERVICE_KEY, {"pid": os.getpid(), "host": socket.gethostname(), "started": started,
		"seen": str(now_datetime())}, expires_in_sec=RELOAD * 3)


def run():
	"""Start one capture thread per live machine; keep the set in step with the settings. Runs until stopped
	(Ctrl+C, or Stop in the console's Check-in Display page)."""
	site, sites_path = frappe.local.site, frappe.local.sites_path
	other = service_info()
	if other and other.get("pid") != os.getpid():
		print(f"live capture already running for {site} (pid {other.get('pid')} on {other.get('host')})", flush=True)
		return
	frappe.cache.delete_value(STOP_KEY)
	started = str(now_datetime())
	threads: dict[str, tuple[threading.Thread, threading.Event]] = {}
	print(f"biometric_sync live capture for {site} (pid {os.getpid()})", flush=True)
	try:
		_loop(site, sites_path, threads, started)
	finally:
		for th, stop in threads.values():
			stop.set()
		for th, _stop in threads.values():
			th.join(timeout=15)
		info = _get(SERVICE_KEY)
		if info and info.get("pid") == os.getpid():
			frappe.cache.delete_value(SERVICE_KEY)
		print("live capture stopped", flush=True)


def _loop(site, sites_path, threads, started):
	while True:
		_beat(started)
		if _get(STOP_KEY):
			frappe.cache.delete_value(STOP_KEY)
			print("stop requested from the console", flush=True)
			return
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
		for _i in range(RELOAD):
			if _get(STOP_KEY):
				break
			time.sleep(1)


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

	punches = status(name).get("punches", 0) or 0
	started = last_event = time.time()
	for att in conn.live_capture(new_timeout=HEARTBEAT):
		if stop.is_set() or _paused(name):
			conn.end_live_capture = True
			continue
		frappe.cache.set_value(HOLD_KEY.format(name), 1, expires_in_sec=HEARTBEAT * 6)
		if att is None:   # no punch in the last few seconds: heartbeat
			_set_status(name, "listening", punches=punches)
			if time.time() - last_event > IDLE_RECONNECT or time.time() - started > MAX_SESSION:
				conn.end_live_capture = True   # the worker loop reconnects at once
			continue
		last_event = time.time()
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
