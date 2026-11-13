/* Help & Guide. */
import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import { Icon } from "../lib/ui";

const STEPS: [string, string, JSX.Element][] = [
  ["fingerprint", "1. Add your machines", <>Open <Link to="/devices">Machines</Link> → <b>Add machine</b>. Enter the IP address (or use <b>Find machines on network</b>), the port (usually 4370) and the comm key (usually 0). Click <b>Test</b> to check the connection: you see the serial number, users and records on the machine.</>],
  ["users", "2. Match machine users to employees", <>Each punch carries the machine's <b>User ID</b>. A check-in is created for the employee whose <b>Attendance Device ID</b> equals it. Open <Link to="/employees">Employee Mapping</Link>, click <b>Read users from machines</b>, and fix the IDs listed under <b>Problems</b>. Punches waiting for an employee are matched again automatically.</>],
  ["calendar", "3. Let it run", <>With <b>Read automatically</b> on (Machines → Edit), each machine is read every N minutes by the site's scheduler. <b>Sync Now</b> at the top right reads them immediately. <Link to="/progress">Live Progress</Link> shows each machine while it is read.</>],
  ["list", "4. Check the punches", <><Link to="/punches">Punches</Link> lists every punch read from the machines with its result: <b>Synced</b> (check-in created), <b>Already there</b> (duplicate), <b>Failed</b> (no employee with that ID) or <b>Skipped</b>. Retry or skip them in bulk, or export to CSV.</>],
  ["monitor", "5. Show the gate board", <><Link to="/display">Check-in Display</Link> is the live board for a wall TV at the gate, in English or Urdu. Open <code>/checkin-display?kiosk=1</code> on the TV. Its title, language and columns are under <Link to="/settings">Settings → Check-in Display</Link>.</>],
];

const FAQ: [string, JSX.Element][] = [
  ["A machine shows Offline", <>The server could not reach it. Check that it is switched on, its IP and port, and that the server's network can reach it (port forwarding for remote sites). Punches stay on the machine and are read on the next successful sync.</>],
  ["Punches are Failed with “No employee with this ID”", <>Set the employee's <b>Attendance Device ID</b> (Employee Mapping → Link). The punches are retried automatically.</>],
  ["The machine clock is wrong", <>Machines → More tools → <b>Sync time</b>, or turn on <b>Set the machine clock on every sync</b> in the machine settings.</>],
  ["Nothing is read automatically", <>The site's scheduler and a background worker must run (<code>bench start</code>, or the baogee scheduler / worker services). The dashboard warns when the scheduler is off.</>],
  ["Attendance is not marked", <>Check-ins become Attendance through the Shift Type's auto attendance (hourly). Employees need a default shift, and the shift needs <b>Enable Auto Attendance</b>.</>],
];

export default function Help() {
  const { boot } = useStore();
  return (
    <div className="stack">
      <div className="card"><div className="card-body"><div className="row" style={{ gap: 18 }}>
        <div className="stat-icon" style={{ width: 52, height: 52 }}><Icon name="fingerprint" /></div>
        <div style={{ flex: 1 }}><h2>Biometric Sync</h2><p className="muted mt-1">Reads punches from biometric attendance machines (ZKTeco TCP/UDP and ADMS push, ZKBio Time, HTTP API, webhook) and creates <b>Employee Checkin</b> records on this site ({boot.site}). Every punch is kept as a <b>Biometric Log</b>, every read as a <b>Biometric Sync Log</b>.</p></div>
        <a className="btn" href="/app/biometric-sync" target="_blank" rel="noreferrer"><Icon name="external" /> Desk workspace</a>
      </div></div></div>
      <div className="grid grid-2">{STEPS.map(([ic, t, body]) => (
        <div key={t} className="card"><div className="card-body"><div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
          <div className="stat-icon info"><Icon name={ic} /></div><div style={{ flex: 1 }}><h3>{t}</h3><p className="muted small mt-1">{body}</p></div></div></div></div>))}
      </div>
      <div className="card"><div className="card-head"><h3><Icon name="help" /> Troubleshooting</h3></div><div className="card-body stack">
        {FAQ.map(([q, a]) => <details key={q}><summary className="strong" style={{ cursor: "pointer" }}>{q}</summary><p className="muted small mt-1">{a}</p></details>)}
      </div></div>
    </div>
  );
}
