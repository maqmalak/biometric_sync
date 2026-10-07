# Biometric Sync for ERPNext / HRMS

Sync attendance punches from **any number of biometric devices** into HRMS
**Employee Checkin**, with raw-log audit trail, de-duplication, retries and
per-device configuration.

| Protocol | Direction | Use it for |
|---|---|---|
| **ZKTeco (TCP/UDP)** | ERPNext pulls (port 4370) | ZKTeco / eSSL / Identix / most "ZK" terminals reachable from the server |
| **ZKTeco ADMS (Push)** | Device pushes to `/iclock/` | Devices behind NAT / on other branches with "Cloud Server / ADMS" menu |
| **ZKBio Time / BioTime** | ERPNext pulls REST API | Sites already running ZKBio Time 8.x / BioTime |
| **HTTP API (Pull)** | ERPNext pulls JSON | Any vendor API / middleware (configurable JSON field mapping, paging, auth) |
| **Webhook (Push)** | Middleware POSTs JSON | Hikvision / Suprema / custom scripts that can call a URL |

## Features

* Unlimited devices, mixed protocols, each with its own schedule (every N minutes)
* Incremental sync (high-water mark + overlap) and SHA1 de-duplication of punches
* Raw **Biometric Log** for every punch (status: Synced / Duplicate / Employee Not Found / Ignored / Failed)
* **Sync History** per run with counters and errors; realtime notification when a manual sync ends
* Employee matching by any Employee field (default `attendance_device_id`), optional company restriction, strip leading zeros
* Punch direction: device punch state (with custom mapping table), Always IN, Always OUT, Alternate IN/OUT per day, or leave blank
* Double-punch window (ignore repeated punches within N seconds)
* Device clock offset correction, "ignore punches before" date, date-range re-sync
* Automatic retry of unmatched punches when an Employee gets a device ID (and hourly)
* ZKTeco tools: Test connection & device info, Fetch users, Push employees to device, Sync device time, Clear device logs, Restart
* ADMS tools: online/offline tracking, request historic log upload, fetch users, push employees, clear logs, reboot, IP allow-list, optional auto-registration
* Import USB `attlog.dat` / ADMS text / CSV files; Data Import into Biometric Log is also processed
* Reports: **Biometric Device Status**, **Unmatched Biometric Users**; workspace "Biometric Sync"
* Log retention / cleanup, failure e-mail notifications

## Installation

```bash
cd ~/frappe-bench
# copy / clone the generated folder into apps/  (or: bench get-app /path/to/biometric_sync)
cp -r /path/to/biometric_sync apps/
./env/bin/pip install -e apps/biometric_sync
grep -qx biometric_sync sites/apps.txt || echo biometric_sync >> sites/apps.txt
bench --site <your-site> install-app biometric_sync
bench --site <your-site> migrate
bench restart
```

Requires Frappe v15+, ERPNext and **HRMS** (Employee Checkin lives in HRMS), and a running
scheduler + `long` queue worker (`bench --site <site> enable-scheduler`).

## Quick start

1. **Employee**: fill *Attendance Device ID (Biometric/RF tag ID)* with the user ID enrolled on the device.
2. **Biometric Sync → Biometric Device → New**, choose the protocol and fill the highlighted section.
3. Save → **Device → Test Connection** (pull protocols) → **Sync → Sync Now**.
4. Check **Biometric Log** / **Sync History**; fix "Employee Not Found" with the *Unmatched Biometric Users* report.

### ZKTeco ADMS (push) device setup

On the terminal: *Menu → COMM → Cloud Server Setting* (a.k.a. *ADMS*):

* Server address: your ERPNext host or IP, Server port: 80 / 443 / bench port
* Enable domain name: ON when using a host name, HTTPS according to your site, proxy OFF

Create a Biometric Device with protocol *ZKTeco ADMS (Push)* and the device **Serial Number**
(*Menu → System Info → Device Info*). The device calls `/iclock/cdata` and `/iclock/getrequest`.
On a multi-site bench the request must reach the right site: use the site's domain as server address
or make the site the default site (`bench use <site>`).

### Webhook (push)

```
POST /api/method/biometric_sync.api.push_logs
X-Biometric-Device: <Biometric Device name>
X-Biometric-Token: <Push Token, see Device → Show Push Token>
Content-Type: application/json

{"logs": [{"user_id": "101", "timestamp": "2025-01-31 09:01:12", "punch": "0"}]}
```

Key names follow the device's *Field Mapping* section (defaults `user_id`, `timestamp`, `punch`).
Timestamps may be `YYYY-MM-DD HH:MM:SS` (device local time), ISO-8601 with offset, or epoch seconds/ms.

### HTTP API (pull)

ERPNext calls `HTTP URL` (GET or POST) with `<since param>=<last punch time>`; the response may be a list
or an object (set *Records Path*, e.g. `data.items`). Paging is followed through *Next Page Path* (e.g. `next`).

### Command line

```bash
bench --site <site> execute biometric_sync.sync.sync_device --kwargs "{'device_name': 'Main Gate'}"
bench --site <site> execute biometric_sync.tasks.retry_unmatched_logs
```

## Punch-state defaults

`0 → IN, 1 → OUT, 2 → OUT (break out), 3 → IN (break in), 4 → IN (OT in), 5 → OUT (OT out)`,
and text values like `in`, `out`, `check in`, `check-out`. Override per device in *Punch State Mapping*.
