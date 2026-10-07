from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import cstr, get_datetime, get_system_timezone


class DeviceConnectionError(Exception):
	"""The device / server could not be reached or refused the request."""


class BaseConnector:
	def __init__(self, device):
		self.device = device

	def __enter__(self):
		self.connect()
		return self

	def __exit__(self, *exc):
		try:
			self.disconnect()
		except Exception:
			pass
		return False

	def connect(self):
		pass

	def disconnect(self):
		pass

	def get_info(self) -> dict:
		return {}

	def fetch_logs(self, since=None, until=None) -> list:
		"""Return punch records (see make_record) with device-local timestamps."""
		raise NotImplementedError

	def get_users(self) -> list:
		raise DeviceConnectionError(f"Fetching users is not supported for {self.device.protocol}")

	@property
	def timeout(self):
		return max(int(self.device.timeout or 30), 1)


def make_record(user_id, timestamp, punch_state=None, verify_type=None, raw=None, time_format=None):
	return frappe._dict(
		user_id=cstr(user_id).strip(),
		timestamp=to_naive_datetime(timestamp, time_format),
		punch_state="" if punch_state is None else cstr(punch_state).strip(),
		verify_type="" if verify_type is None else cstr(verify_type).strip(),
		raw=raw,
	)


def to_naive_datetime(value, time_format=None):
	"""Parse str / epoch / datetime into a naive datetime (system timezone when tz-aware)."""
	if value in (None, ""):
		raise ValueError("Empty timestamp")

	if isinstance(value, datetime):
		dt = value
	elif isinstance(value, (int, float)) or (isinstance(value, str) and value.strip().isdigit()):
		seconds = float(value)
		if seconds > 1e11:  # epoch milliseconds
			seconds /= 1000
		dt = datetime.fromtimestamp(seconds, tz=timezone.utc)
	else:
		text = cstr(value).strip()
		if time_format:
			dt = datetime.strptime(text, time_format)
		else:
			try:
				dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
			except ValueError:
				dt = get_datetime(text)

	if dt.tzinfo:
		dt = dt.astimezone(ZoneInfo(get_system_timezone())).replace(tzinfo=None)
	return dt.replace(microsecond=0)


def dig(obj, path, default=None):
	"""Read a dotted path ("data.items.0.id") from nested dicts / lists."""
	if not path:
		return obj
	current = obj
	for part in cstr(path).split("."):
		if isinstance(current, dict):
			current = current.get(part)
		elif isinstance(current, (list, tuple)) and part.isdigit() and int(part) < len(current):
			current = current[int(part)]
		else:
			return default
		if current is None:
			return default
	return current
