import requests
from frappe.utils import cint

from biometric_sync.connectors.base import BaseConnector, DeviceConnectionError, make_record


class BioTimeConnector(BaseConnector):
	"""ZKBio Time / BioTime 8.x REST API."""

	session = None

	def connect(self):
		device = self.device
		base = (device.server_url or "").strip().rstrip("/")
		if not base:
			raise DeviceConnectionError("Server URL is required")
		if not base.startswith(("http://", "https://")):
			base = "http://" + base
		self.base = base

		jwt = device.biotime_auth == "JWT"
		self.session = requests.Session()
		self.session.headers.update({"Content-Type": "application/json", "Accept": "application/json"})
		try:
			response = self.session.post(
				base + ("/jwt-api-token-auth/" if jwt else "/api-token-auth/"),
				json={
					"username": device.api_username,
					"password": device.get_password("api_password", raise_exception=False) or "",
				},
				timeout=self.timeout,
			)
			response.raise_for_status()
			token = response.json().get("token")
		except (requests.RequestException, ValueError) as e:
			raise DeviceConnectionError(f"BioTime login failed: {e}")
		if not token:
			raise DeviceConnectionError("BioTime login did not return a token")
		self.session.headers["Authorization"] = f"{'JWT' if jwt else 'Token'} {token}"

	def disconnect(self):
		if self.session:
			self.session.close()

	def _paged(self, path, params=None):
		url = self.base + path
		params = dict(params or {}, page_size=cint(self.device.page_size) or 500)
		while url:
			try:
				response = self.session.get(url, params=params, timeout=self.timeout)
				response.raise_for_status()
				payload = response.json()
			except (requests.RequestException, ValueError) as e:
				raise DeviceConnectionError(f"BioTime request failed ({path}): {e}")

			if isinstance(payload, list):
				yield from payload
				return
			rows = payload.get("data")
			if not isinstance(rows, list):
				rows = payload.get("results") or []
			yield from rows
			url, params = payload.get("next"), None  # "next" already carries the query string

	def get_info(self):
		terminals = list(self._paged("/iclock/api/terminals/"))
		return {
			"platform": "ZKBio Time",
			"device_model": ", ".join(sorted({str(t.get("terminal_name") or t.get("alias") or t.get("sn")) for t in terminals}))[:140],
			"device_serial": ", ".join(str(t.get("sn")) for t in terminals if t.get("sn"))[:140],
		}

	def fetch_logs(self, since=None, until=None):
		params = {}
		if since:
			params["start_time"] = since.strftime("%Y-%m-%d %H:%M:%S")
		if until:
			params["end_time"] = until.strftime("%Y-%m-%d %H:%M:%S")
		terminals = {t.strip() for t in (self.device.terminal_filter or "").replace("\n", ",").split(",") if t.strip()}

		records = []
		for row in self._paged("/iclock/api/transactions/", params):
			if terminals and not {str(row.get("terminal_sn")), str(row.get("terminal_alias"))} & terminals:
				continue
			if not row.get("emp_code") or not row.get("punch_time"):
				continue
			records.append(
				make_record(row.get("emp_code"), row.get("punch_time"), row.get("punch_state"), row.get("verify_type"), raw=row)
			)
		return records

	def get_users(self):
		users = []
		for row in self._paged("/personnel/api/employees/"):
			name = " ".join(filter(None, [row.get("first_name"), row.get("last_name")]))
			users.append(
				{
					"uid": row.get("id"),
					"user_id": str(row.get("emp_code")),
					"user_name": name,
					"privilege": "User",
					"card_no": str(row.get("card_no") or ""),
				}
			)
		return users
