ZK_PULL = "ZKTeco (TCP/UDP)"
ZK_ADMS = "ZKTeco ADMS (Push)"
BIOTIME = "ZKBio Time / BioTime"
HTTP_PULL = "HTTP API (Pull)"
WEBHOOK = "Webhook (Push)"

PROTOCOLS = (ZK_PULL, ZK_ADMS, BIOTIME, HTTP_PULL, WEBHOOK)
PULL_PROTOCOLS = (ZK_PULL, BIOTIME, HTTP_PULL)
PUSH_PROTOCOLS = (ZK_ADMS, WEBHOOK)

# Biometric Log status
PENDING = "Pending"
SYNCED = "Synced"
DUPLICATE = "Duplicate"
NOT_FOUND = "Employee Not Found"
IGNORED = "Ignored"
FAILED = "Failed"
RETRYABLE_STATUSES = (PENDING, NOT_FOUND, FAILED)

# Punch direction modes
MODE_DEVICE = "Device Punch State"
MODE_IN = "Always IN"
MODE_OUT = "Always OUT"
MODE_ALTERNATE = "Alternate IN/OUT"
MODE_BLANK = "Leave Blank"

# punch state (as sent by the device, lower-cased) -> Employee Checkin log type
DEFAULT_PUNCH_MAP = {
	"0": "IN",  # check in
	"1": "OUT",  # check out
	"2": "OUT",  # break out
	"3": "IN",  # break in
	"4": "IN",  # overtime in
	"5": "OUT",  # overtime out
	"in": "IN",
	"i": "IN",
	"checkin": "IN",
	"check in": "IN",
	"check-in": "IN",
	"check_in": "IN",
	"entry": "IN",
	"break in": "IN",
	"overtime in": "IN",
	"ot in": "IN",
	"out": "OUT",
	"o": "OUT",
	"checkout": "OUT",
	"check out": "OUT",
	"check-out": "OUT",
	"check_out": "OUT",
	"exit": "OUT",
	"break out": "OUT",
	"overtime out": "OUT",
	"ot out": "OUT",
}
