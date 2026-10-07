import frappe
from frappe import _

from biometric_sync.constants import BIOTIME, HTTP_PULL, ZK_PULL


def get_connector(device):
	"""Return the connector instance for a Biometric Device (pull protocols only)."""
	from biometric_sync.connectors.biotime import BioTimeConnector
	from biometric_sync.connectors.http_api import HTTPConnector
	from biometric_sync.connectors.zk import ZKConnector

	connectors = {ZK_PULL: ZKConnector, BIOTIME: BioTimeConnector, HTTP_PULL: HTTPConnector}
	connector = connectors.get(device.protocol)
	if not connector:
		frappe.throw(
			_("Protocol {0} pushes data to ERPNext; it cannot be pulled.").format(frappe.bold(device.protocol))
		)
	return connector(device)
