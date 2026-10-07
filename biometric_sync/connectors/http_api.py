import requests
from frappe.utils import cstr

from biometric_sync.connectors.base import BaseConnector, DeviceConnectionError, dig, make_record

MAX_PAGES = 1000


class HTTPConnector(BaseConnector):
	"""Generic JSON API. Field names / paths come from the device's HTTP settings."""

	session = None

	def connect(self):
		device = self.device
		if not device.http_url:
			raise DeviceConnectionError("HTTP URL is required")
		self.session = requests.Session()
		self.session.headers["Accept"] = "application/json"

		key = device.get_password("http_api_key", raise_exception=False) or ""
		secret = device.get_password("http_api_secret", raise_exception=False) or ""
		auth = device.http_auth_type or "None"
		if auth == "Bearer Token":
			self.session.headers["Authorization"] = f"Bearer {key}"
		elif auth == "API Key Header":
			self.session.headers[device.http_api_key_header or "X-API-Key"] = key
		elif auth == "Basic Auth":
			self.session.auth = (key, secret)
		elif auth == "Frappe Token":
			self.session.headers["Authorization"] = f"token {key}:{secret}"

	def disconnect(self):
		if self.session:
			self.session.close()

	def _request(self, url, params):
		method = (self.device.http_method or "GET").upper()
		try:
			if method == "POST":
				response = self.session.post(url, json=params, timeout=self.timeout)
			else:
				response = self.session.get(url, params=params, timeout=self.timeout)
			response.raise_for_status()
			return response.json()
		except (requests.RequestException, ValueError) as e:
			raise DeviceConnectionError(f"HTTP request failed: {e}")

	def get_info(self):
		# a cheap call that proves URL + credentials work
		self._request(self.device.http_url, self._params(None, None))
		return {"platform": "HTTP API"}

	def _params(self, since, until):
		device, params = self.device, {}
		fmt = device.http_param_format or "%Y-%m-%d %H:%M:%S"
		if since and device.http_since_param:
			params[device.http_since_param] = since.strftime(fmt)
		if until and device.http_until_param:
			params[device.http_until_param] = until.strftime(fmt)
		return params

	def fetch_logs(self, since=None, until=None):
		device = self.device
		url, params = device.http_url, self._params(since, until)
		user_key = device.http_user_id_key or "user_id"
		time_key = device.http_timestamp_key or "timestamp"
		punch_key = device.http_punch_key

		records = []
		for _page in range(MAX_PAGES):
			payload = self._request(url, params)
			rows = dig(payload, device.http_records_path) if device.http_records_path else payload
			if isinstance(rows, dict):
				rows = [rows]
			for row in rows or []:
				user_id, timestamp = dig(row, user_key), dig(row, time_key)
				if user_id in (None, "") or timestamp in (None, ""):
					continue
				try:
					records.append(
						make_record(
							user_id,
							timestamp,
							dig(row, punch_key) if punch_key else None,
							raw=row,
							time_format=device.http_time_format or None,
						)
					)
				except ValueError:
					continue
			next_url = cstr(dig(payload, device.http_next_path)) if device.http_next_path and isinstance(payload, dict) else ""
			if not next_url or next_url == url:
				break
			url, params = next_url, None
		return records
