from frappe.utils import cint

from biometric_sync.connectors.base import BaseConnector, DeviceConnectionError, make_record

USER_ADMIN = 14  # zk.const.USER_ADMIN


class ZKConnector(BaseConnector):
	"""ZKTeco standalone terminals over TCP/UDP 4370 via pyzk."""

	conn = None
	_disabled = False

	def connect(self):
		try:
			from zk import ZK
		except ImportError:
			raise DeviceConnectionError("pyzk is not installed. Run: bench pip install pyzk")

		device = self.device
		if not device.ip_address:
			raise DeviceConnectionError("IP Address is required")
		if cint(device.get("live_capture")):   # the live capture service holds the machine: ask it to let go first
			from biometric_sync import live

			live.pause(device.name)
			self._paused_live = True

		zk = ZK(
			device.ip_address.strip(),
			port=cint(device.port) or 4370,
			timeout=self.timeout,
			password=cint(device.comm_key),
			force_udp=bool(cint(device.force_udp)),
			ommit_ping=not cint(device.ping_before_connect),
		)
		try:
			self.conn = zk.connect()
		except Exception as e:
			self._resume_live()   # no disconnect() follows a failed connect
			raise DeviceConnectionError(f"Could not connect to {device.ip_address}:{device.port} - {e}")

		if cint(device.disable_device_during_sync):
			try:
				self.conn.disable_device()
				self._disabled = True
			except Exception:
				pass

	def _resume_live(self):
		if getattr(self, "_paused_live", False):
			from biometric_sync import live

			live.resume(self.device.name)
			self._paused_live = False

	def disconnect(self):
		try:
			if not self.conn:
				return
			try:
				if self._disabled:
					self.conn.enable_device()
			finally:
				try:
					self.conn.disconnect()
				finally:
					self.conn = None
		finally:
			self._resume_live()   # the live capture service may reconnect now

	def get_info(self):
		info = {}
		for key, method in (
			("device_serial", "get_serialnumber"),
			("firmware_version", "get_firmware_version"),
			("platform", "get_platform"),
			("device_model", "get_device_name"),
			("mac_address", "get_mac"),
			("device_time", "get_time"),
		):
			try:
				info[key] = getattr(self.conn, method)()
			except Exception:
				pass
		try:
			self.conn.read_sizes()
			info.update(
				user_count=self.conn.users,
				fingerprint_count=self.conn.fingers,
				face_count=getattr(self.conn, "faces", 0),
				log_count=self.conn.records,
			)
		except Exception:
			pass
		return info

	def fetch_logs(self, since=None, until=None):
		try:
			attendances = self.conn.get_attendance() or []
		except Exception as e:
			raise DeviceConnectionError(f"Could not read attendance from device: {e}")

		records = []
		for att in attendances:
			timestamp = att.timestamp
			if (since and timestamp < since) or (until and timestamp > until):
				continue
			records.append(
				make_record(
					att.user_id,
					timestamp,
					punch_state=att.punch,  # 0 in, 1 out, 2 break out, 3 break in, 4 OT in, 5 OT out
					verify_type=att.status,  # verification mode (finger, face, card, ...)
					raw={"uid": att.uid, "user_id": att.user_id, "timestamp": str(timestamp), "status": att.status, "punch": att.punch},
				)
			)
		return records

	def get_users(self):
		return [
			{
				"uid": user.uid,
				"user_id": str(user.user_id),
				"user_name": user.name,
				"privilege": "Admin" if user.privilege == USER_ADMIN else "User",
				"card_no": str(user.card or ""),
				"group_id": str(user.group_id or ""),
			}
			for user in self.conn.get_users() or []
		]

	def push_users(self, employees):
		"""employees: list of dicts {user_id, name}. Creates or renames users on the device."""
		existing = {str(u.user_id): u for u in self.conn.get_users() or []}  # also primes next_uid
		added, updated, errors = 0, 0, []
		for emp in employees:
			user_id, name = str(emp["user_id"]), (emp["name"] or "")[:24]
			user = existing.get(user_id)
			try:
				if user:
					self.conn.set_user(
						uid=user.uid,
						name=name,
						privilege=user.privilege,
						password=user.password or "",
						group_id=user.group_id or "",
						user_id=user_id,
						card=user.card or 0,
					)
					updated += 1
				else:
					self.conn.set_user(uid=None, name=name, privilege=0, password="", group_id="", user_id=user_id, card=0)
					added += 1
			except Exception as e:
				errors.append(f"{user_id} ({name}): {e}")
		return added, updated, errors

	def set_time(self, value):
		self.conn.set_time(value)

	def clear_logs(self):
		self.conn.clear_attendance()

	def restart(self):
		self.conn.restart()
		self.conn = None  # connection is gone after a restart
