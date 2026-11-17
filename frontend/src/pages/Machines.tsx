/* Machines: list, add / edit, test, clock, users, network scan (Biometric Device). */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { get, post } from "../lib/api";
import { openDeviceEditor, openSync } from "../lib/events";
import { fmtDate, fmtNum, fmtRelative, MODE_LABEL, todayStr } from "../lib/format";
import { useStore } from "../lib/store";
import { PROTOCOLS, PULL, type Device } from "../lib/types";
import { BusyButton, confirmDialog, EmptyState, Icon, Loading, Modal, StatusBadge, Switch, toast, toastError } from "../lib/ui";

export default function Machines() {
  const { boot, tick } = useStore();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [users, setUsers] = useState<Device | null>(null);
  const [more, setMore] = useState<Device | null>(null);
  const [scan, setScan] = useState(false);
  const [tested, setTested] = useState<{ d: Device; info: any } | null>(null);
  const load = useCallback(async () => { try { setDevices(await get<Device[]>("devices")); } catch (e) { toastError(e); } }, []);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { const f = () => load(); window.addEventListener("bs-devices-changed", f); return () => window.removeEventListener("bs-devices-changed", f); }, [load]);

  const test = async (d: Device) => {
    try { const info = await post("device_test", { name: d.id }); setTested({ d, info }); load(); }
    catch (e) { toastError(e, `${d.name}: connection failed`); load(); }
  };

  return (
    <>
      <div className="row mb-3">
        <div className="muted" style={{ flex: 1, minWidth: 240 }}>Your biometric attendance machines (ZKTeco and compatible). Their punches become Employee Checkins on this ERPNext site.</div>
        {boot.can_write && <>
          <button className="btn" onClick={() => setScan(true)}><Icon name="scan" /> Find machines on network</button>
          <button className="btn btn-primary" onClick={() => openDeviceEditor()}><Icon name="plus" /> Add machine</button></>}
      </div>
      <div className="stack">
        {!devices ? <Loading /> : !devices.length ? (
          <div className="card"><EmptyState icon="fingerprint" title="No machines yet" text="Add a biometric machine by its IP address, or search the local network for machines.">
            {boot.can_write && <div className="btn-group" style={{ justifyContent: "center" }}><button className="btn" onClick={() => setScan(true)}><Icon name="scan" /> Find machines</button>
              <button className="btn btn-primary" onClick={() => openDeviceEditor()}><Icon name="plus" /> Add machine</button></div>}</EmptyState></div>
        ) : devices.map((d) => <DeviceCard key={d.id} d={d} canWrite={boot.can_write} onTest={() => test(d)} onUsers={() => setUsers(d)} onMore={() => setMore(d)} />)}
      </div>
      {users && <UsersDialog d={users} canWrite={boot.can_write} onClose={() => setUsers(null)} />}
      {more && <MoreMenu d={more} onClose={() => setMore(null)} onChanged={load} />}
      {scan && <ScanDialog onClose={() => setScan(false)} />}
      {tested && <TestResult d={tested.d} i={tested.info} onClose={() => setTested(null)} />}
    </>
  );
}

function DeviceCard({ d, canWrite, onTest, onUsers, onMore }: { d: Device; canWrite: boolean; onTest: () => Promise<void>; onUsers: () => void; onMore: () => void }) {
  const i = d.info || {};
  const avatar = !d.enabled ? "" : d.status === "online" ? "ok" : d.status === "offline" || d.status === "error" ? "bad" : "";
  const pull = PULL.includes(d.protocol);
  return (
    <div className="card server-card device-card">
      <div className="server-head">
        <div className={`server-avatar ${avatar}`}><Icon name={d.status === "offline" ? "wifiOff" : "fingerprint"} /></div>
        <div className="server-title">
          <div className="name">{d.name} {!d.enabled && <span className="badge outline">Disabled</span>} <StatusBadge status={d.status} />
            {d.auto_sync ? <span className="badge info" title="Read automatically"><Icon name="calendar" /> every {d.sync_interval} min</span> : <span className="badge outline">Auto sync off</span>}
            {d.live_capture && <LiveBadge live={d.live} />}
            {d.clear_after_sync && <span className="badge warning" title="The machine log is cleared after every sync"><Icon name="trash" /> Clears after sync</span>}
          </div>
          <div className="meta">
            {d.ip && <span title="IP address and port"><Icon name="globe" /> {d.ip}{d.port ? `:${d.port}` : ""}</span>}
            <span title="Device ID on Employee Checkin"><Icon name="hash" /> {d.device_id}</span>
            <span title="Protocol"><Icon name="network" /> {d.protocol}</span>
            <span title="Punch direction"><Icon name="sliders" /> {MODE_LABEL[d.log_type_mode] || d.log_type_mode}</span>
            {i.serial && <span title="Serial number / firmware"><Icon name="cpu" /> {i.serial}{i.firmware ? ` · ${i.firmware}` : ""}</span>}
            <span><Icon name="clock" /> Last read {d.last_success_at ? <span title={fmtDate(d.last_success_at, true)}>{fmtRelative(d.last_success_at)}</span> : "never"}</span>
          </div>
        </div>
        <div className="btn-group">
          {canWrite && pull && <BusyButton className="btn btn-sm" busyText="Testing…" onClick={onTest}><Icon name="plug" /> Test</BusyButton>}
          {canWrite && pull && <button className="btn btn-sm btn-primary" onClick={() => openSync({ deviceIds: [d.id] })}><Icon name="refresh" /> Sync now</button>}
          <button className="btn btn-sm" onClick={onUsers}><Icon name="users" /> Users</button>
          {canWrite && <button className="btn btn-sm" onClick={() => openDeviceEditor(d)}><Icon name="edit" /> Edit</button>}
          {canWrite && <button className="btn btn-sm btn-ghost" title="More tools" onClick={onMore}><Icon name="more" /></button>}
        </div>
      </div>
      {(d.status === "offline" || d.status === "error") && d.last_error && (
        <div style={{ padding: "0 20px 14px" }}><div className="alert danger"><Icon name="wifiOff" /><div style={{ flex: 1 }}><div className="t">Not reachable</div>{d.last_error}
          <div className="small mt-1">Punches stay stored on the machine and are read automatically once it is reachable again.</div></div></div></div>
      )}
      <div className="device-kpis">
        <div><div className="l">Today</div><div className="v">{fmtNum(d.stats.today)}</div></div>
        <div><div className="l">Waiting</div><div className={`v ${d.stats.pending ? "" : "muted"}`}>{fmtNum(d.stats.pending)}</div></div>
        <div><div className="l">Failed</div><div className={`v ${d.stats.failed ? "st-failed" : "muted"}`}>{fmtNum(d.stats.failed)}</div></div>
        <div><div className="l">Stored in ERPNext</div><div className="v">{fmtNum(d.stats.total)}</div></div>
        <div><div className="l">On machine</div><div className="v">{i.records != null ? fmtNum(i.records) : "—"} <small>{i.users != null ? `· ${fmtNum(i.users)} users` : ""}</small></div></div>
      </div>
    </div>
  );
}

function LiveBadge({ live }: { live: Device["live"] }) {
  const st = live?.status || "off";
  const tone = st === "listening" ? "success" : st === "paused" ? "warning" : "danger";
  const label = st === "listening" ? `Live${live.punches ? ` · ${live.punches} today` : ""}` : st === "paused" ? "Live paused (reading)" : st === "not running" ? "Live: service not running" : `Live: ${st}`;
  return <span className={`badge ${tone}`} title={live?.error || (st === "not running" ? "Start the live capture service (bench --site <site> execute biometric_sync.live.run, or supervisor in production)." : "Punches arrive within seconds")}>
    <Icon name={st === "listening" ? "activity" : "wifiOff"} /> {label}</span>;
}

function TestResult({ d, i, onClose }: { d: Device; i: any; onClose: () => void }) {
  return (
    <Modal title={`${d.name}: connected`} icon="checkCircle" onClose={onClose}
      foot={<><SyncTimeButton d={d} /><button className="btn btn-primary" onClick={onClose}>Close</button></>}>
      <div className="alert success mb-3"><Icon name="checkCircle" /><div>The machine answered in {fmtNum(i.response_ms)} ms.</div></div>
      <div className="kv">
        <div>Device model</div><div>{i.device_name || "—"}</div>
        <div>Serial number</div><div className="mono">{i.serial || "—"}</div>
        <div>Platform / firmware</div><div>{i.platform || "—"} · {i.firmware || "—"}</div>
        <div>MAC address</div><div className="mono">{i.mac || "—"}</div>
        <div>Users</div><div>{fmtNum(i.users)}</div>
        <div>Fingerprints / faces</div><div>{i.fingers ?? "—"} / {i.faces ?? "—"}</div>
        <div>Attendance records</div><div>{fmtNum(i.records)}</div>
        <div>Machine clock</div><div>{i.clock || "—"} {i.drift_seconds != null && <span className={Math.abs(i.drift_seconds) > 60 ? "st-failed" : "muted"}>({i.drift_seconds > 0 ? "+" : ""}{i.drift_seconds}s vs the server)</span>}</div>
      </div>
    </Modal>
  );
}

function SyncTimeButton({ d, className = "btn" }: { d: Device; className?: string }) {
  return (
    <BusyButton className={className} busyText="Setting…" onClick={async () => {
      if (!await confirmDialog({ title: "Set machine clock?", message: <>Set the clock of <b>{d.name}</b> to the server's time ({new Date().toLocaleString()})?</>, confirm: "Set time" })) return;
      try { await post("device_sync_time", { name: d.id }); toast("Machine clock set.", "success"); } catch (e) { toastError(e, "Could not set the time"); }
    }}><Icon name="clock" /> Sync time</BusyButton>
  );
}

function UsersDialog({ d, canWrite, onClose }: { d: Device; canWrite: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [users, setUsers] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const load = async (refresh = false) => {
    try { setUsers(await get("device_users", { name: d.id, refresh: refresh ? 1 : 0 })); }
    catch (e) { toastError(e, "Could not read users"); setUsers((u) => u || []); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const rows = (users || []).filter((u) => !q || `${u.user_id} ${u.name || ""} ${u.employee_name || ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title={`${d.name}: users`} icon="users" size="wide" onClose={onClose} foot={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      <div className="row mb-2">
        <input className="input" placeholder="Filter by ID or name…" style={{ maxWidth: 280 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="spacer" /><span className="muted small">{users?.length ? `${users.length} user(s) · read ${fmtRelative(users[0].fetched_at)}` : ""}</span>
        {canWrite && <BusyButton className="btn btn-sm" busyText="Reading…" onClick={() => load(true)}><Icon name="download" /> Read from machine</BusyButton>}
      </div>
      <div className="table-wrap" style={{ maxHeight: 420 }}><table className="table"><thead><tr><th>User ID</th><th>Name on machine</th><th>ERPNext employee</th><th>Privilege</th><th>Card</th></tr></thead><tbody>
        {!users ? <tr><td colSpan={5}><Loading /></td></tr> : rows.length ? rows.map((u) => (
          <tr key={u.user_id}><td className="strong mono">{u.user_id}</td><td>{u.name}</td>
            <td className="small">{u.employee ? <>{u.employee_name}<div className="tiny muted">{u.employee}</div></> : <span className="st-failed small">not linked</span>}</td>
            <td>{u.privilege === "Admin" ? <span className="badge primary">Admin</span> : <span className="muted small">User</span>}</td>
            <td className="mono small">{u.card && u.card !== "0" ? u.card : ""}</td></tr>))
          : <tr><td colSpan={5}><EmptyState icon="users" title={users.length ? "No match" : "No users read yet"} text={users.length ? "" : "Click “Read from machine”."} /></td></tr>}
      </tbody></table></div>
      <div className="hint mt-2">The <b>User ID</b> must match the employee's <b>Attendance Device ID</b>. Check all machines at once under{" "}
        <a href="#/employees" onClick={(e) => { e.preventDefault(); onClose(); nav("/employees"); }}>Employee Mapping</a>.</div>
    </Modal>
  );
}

function MoreMenu({ d, onClose, onChanged }: { d: Device; onClose: () => void; onChanged: () => void }) {
  const nav = useNavigate();
  return (
    <Modal title={d.name} icon="fingerprint" onClose={onClose}>
      <div className="stack">
        <SyncTimeButton d={d} />
        <button className="btn" onClick={() => { onClose(); openSync({ deviceIds: [d.id], resync: true, from: todayStr(-7), to: todayStr() }); }}><Icon name="history" /> Read a date range again…</button>
        <button className="btn" onClick={() => { onClose(); nav(`/punches/device/${encodeURIComponent(d.id)}`); }}><Icon name="list" /> View punches from this machine</button>
        <button className="btn" onClick={() => { onClose(); nav(`/logs/device/${encodeURIComponent(d.id)}`); }}><Icon name="logs" /> View sync logs for this machine</button>
        <a className="btn" href={`/app/biometric-device/${encodeURIComponent(d.id)}`} target="_blank" rel="noreferrer"><Icon name="external" /> Open in ERPNext desk (push employees, clear log, restart…)</a>
        <button className="btn" onClick={async () => { onClose(); try { await post("device_toggle", { name: d.id, enabled: d.enabled ? 0 : 1 }); toast(`Machine ${d.enabled ? "disabled" : "enabled"}.`, "success"); onChanged(); } catch (e) { toastError(e); } }}>
          <Icon name="power" /> {d.enabled ? "Disable" : "Enable"} this machine</button>
        <button className="btn" onClick={() => { onClose(); openDeviceEditor(null, { ...d, name: `${d.name} (copy)`, device_id: `${d.device_id}_2`, ip: "" }); }}><Icon name="copy" /> Duplicate settings (new machine)</button>
        <button className="btn btn-soft-danger" onClick={async () => {
          onClose();
          if (!await confirmDialog({ title: "Delete machine?", message: <>Remove <b>{d.name}</b>? Its {fmtNum(d.stats.total)} Biometric Logs stay, check-ins in ERPNext are not touched. A machine with logs can't be deleted; disable it instead.</>, confirm: "Delete", danger: true })) return;
          try { await post("device_delete", { name: d.id }); toast("Machine deleted.", "success"); onChanged(); } catch (e) { toastError(e, "Could not delete"); }
        }}><Icon name="trash" /> Delete machine</button>
      </div>
    </Modal>
  );
}

const MODES = ["Device Punch State", "Always IN", "Always OUT", "Alternate IN/OUT", "Leave Blank"];

export function DeviceEditor({ device, prefill = {}, onClose }: { device: Device | null; prefill?: any; onClose: () => void }) {
  const isNew = !device;
  const base: any = device || { enabled: true, auto_sync: true, sync_interval: 15, protocol: "ZKTeco (TCP/UDP)", log_type_mode: "Device Punch State", port: 4370, timeout: 10, ...prefill };
  const [f, setF] = useState<any>({ ...base, password: "", sync_from: (base.sync_from || "").slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const zk = f.protocol === "ZKTeco (TCP/UDP)";
  const save = async (thenTest: boolean) => {
    setBusy(true);
    const num = (v: any) => (v === "" || v == null ? null : Number(v));
    const data = {
      name: f.name, device_id: f.device_id, protocol: f.protocol, ip: f.ip, port: num(f.port), timeout: num(f.timeout), force_udp: !!f.force_udp,
      enabled: !!f.enabled, auto_sync: !!f.auto_sync, sync_interval: num(f.sync_interval) || 15, log_type_mode: f.log_type_mode,
      sync_from: f.sync_from ? `${f.sync_from} 00:00:00` : null, time_offset_minutes: num(f.time_offset_minutes) || 0,
      clear_after_sync: !!f.clear_after_sync, sync_device_time: !!f.sync_device_time, latitude: num(f.latitude), longitude: num(f.longitude),
      skip_auto_attendance: !!f.skip_auto_attendance, password: f.password || null, live_capture: !!f.live_capture,
    };
    try {
      const saved = await post<Device>("device_save", { data, name: isNew ? null : device!.id });
      toast(isNew ? "Machine added." : "Machine saved.", "success");
      window.dispatchEvent(new Event("bs-devices-changed"));
      onClose();
      if (thenTest && PULL.includes(saved.protocol)) {
        try { await post("device_test", { name: saved.id }); toast(`${saved.name}: connected.`, "success"); } catch (e) { toastError(e, `${saved.name}: connection failed`); }
        window.dispatchEvent(new Event("bs-devices-changed"));
      }
    } catch (e) { toastError(e, "Could not save"); setBusy(false); }
  };
  return (
    <Modal title={isNew ? "Add machine" : `Edit ${device!.name}`} icon="fingerprint" size="wide" onClose={onClose}
      foot={<>{!isNew && <button className="btn" disabled={busy} onClick={() => save(true)}><Icon name="plug" /> Save &amp; test</button>}<span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => save(isNew)}><Icon name="check" /> {isNew ? "Add machine" : "Save"}</button></>}>
      <form className="stack" autoComplete="off" onSubmit={(e) => { e.preventDefault(); save(isNew); }}>
        <div className="form-section" style={{ padding: 0, border: 0 }}><h3><Icon name="info" /> General</h3>
          <div className="form-grid">
            <div className="field"><label>Name</label><input className="input" value={f.name || ""} disabled={!isNew} placeholder="Main gate" required
              onChange={(e) => { set("name", e.target.value); if (isNew && !f._touched) set("device_id", e.target.value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30)); }} />
              {!isNew && <div className="hint">The name can't be changed (it names the record).</div>}</div>
            <div className="field"><label>Device ID (on Employee Checkin)</label><input className="input mono" value={f.device_id || ""} placeholder="MAIN_GATE" onChange={(e) => { set("device_id", e.target.value); set("_touched", true); }} />
              <div className="hint">Shown as <i>Device ID</i> on each Employee Checkin and on the Check-in Display.</div></div>
            <div className="field"><label>Protocol</label><select className="input" value={f.protocol} disabled={!isNew} onChange={(e) => set("protocol", e.target.value)}>{PROTOCOLS.map((p) => <option key={p}>{p}</option>)}</select>
              {!zk && <div className="hint">ADMS, BioTime, HTTP and webhook options are set in the ERPNext desk form after saving.</div>}</div>
            <div className="field"><label>&nbsp;</label><Switch checked={f.enabled} onChange={(v) => set("enabled", v)} label="Machine enabled" /></div>
          </div></div>
        {zk && <div className="form-section" style={{ padding: 0, border: 0 }}><h3><Icon name="network" /> Connection</h3>
          <div className="form-grid">
            <div className="field"><label>IP address or host name</label><input className="input mono" value={f.ip || ""} placeholder="192.168.1.201" required onChange={(e) => set("ip", e.target.value)} /></div>
            <div className="field"><label>Port</label><input className="input" type="number" min={1} max={65535} value={f.port ?? ""} placeholder="4370" onChange={(e) => set("port", e.target.value)} /></div>
            <div className="field"><label>Communication password (comm key)</label><input className="input" type="password" inputMode="numeric" value={f.password} placeholder={f.has_password ? "•••••• (saved, leave empty to keep)" : "0 = none"} onChange={(e) => set("password", e.target.value)} />
              <div className="hint">Menu → Comm. on the machine. Usually 0.</div></div>
            <div className="field"><label>Timeout (seconds)</label><input className="input" type="number" min={3} max={600} value={f.timeout ?? ""} placeholder="10" onChange={(e) => set("timeout", e.target.value)} /></div>
            <div className="field"><label>Transport</label><select className="input" value={f.force_udp ? "1" : "0"} onChange={(e) => set("force_udp", e.target.value === "1")}><option value="0">TCP</option><option value="1">UDP (older machines)</option></select></div>
          </div></div>}
        <div className="form-section" style={{ padding: 0, border: 0 }}><h3><Icon name="calendar" /> Schedule</h3>
          <div className="form-grid">
            <div className="field"><label>&nbsp;</label><Switch checked={f.auto_sync} onChange={(v) => set("auto_sync", v)} label="Read automatically" sub="Needs the site's scheduler" /></div>
            <div className="field"><label>Every (minutes)</label><input className="input" type="number" min={1} max={1440} value={f.sync_interval ?? 15} onChange={(e) => set("sync_interval", e.target.value)} /></div>
            {zk && <div className="field" style={{ gridColumn: "1 / -1" }}><Switch checked={!!f.live_capture} onChange={(v) => set("live_capture", v)} label="Live capture (real time)"
              sub="Each punch is stored and shown on the Check-in Display within seconds. Keep “Read automatically” on as a safety net." /></div>}
            <div className="field"><label>Import punches from</label><input className="input" type="date" value={f.sync_from || ""} onChange={(e) => set("sync_from", e.target.value)} /><div className="hint">Older punches on the machine are ignored. New machines start from now.</div></div>
            <div className="field"><label>Machine clock offset (minutes)</label><input className="input" type="number" value={f.time_offset_minutes ?? 0} onChange={(e) => set("time_offset_minutes", e.target.value)} /><div className="hint">When the machine runs in another time zone.</div></div>
          </div></div>
        <div className="form-section" style={{ padding: 0, border: 0 }}><h3><Icon name="sliders" /> Punches</h3>
          <div className="form-grid">
            <div className="field"><label>Punch direction (log type)</label><select className="input" value={f.log_type_mode} onChange={(e) => set("log_type_mode", e.target.value)}>{MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select>
              <div className="hint">Use <b>Always IN</b> / <b>Always OUT</b> for separate entry and exit machines. The key → IN/OUT map is in the desk form.</div></div>
            <div className="field"><label>&nbsp;</label><Switch checked={f.skip_auto_attendance} onChange={(v) => set("skip_auto_attendance", v)} label="Skip auto attendance" sub="Check-ins don't mark attendance" /></div>
            <div className="field"><label>Latitude (optional)</label><input className="input" type="number" step="any" value={f.latitude ?? ""} onChange={(e) => set("latitude", e.target.value)} /></div>
            <div className="field"><label>Longitude (optional)</label><input className="input" type="number" step="any" value={f.longitude ?? ""} onChange={(e) => set("longitude", e.target.value)} /></div>
          </div></div>
        {zk && <div className="form-section" style={{ padding: 0, border: 0 }}><h3><Icon name="shield" /> Machine</h3>
          <div className="toggle-row"><div><div className="t">Set the machine clock on every sync</div><div className="d">Keeps punch times correct when the machine clock drifts.</div></div><Switch checked={f.sync_device_time} onChange={(v) => set("sync_device_time", v)} /></div>
          <div className="toggle-row"><div><div className="t">Clear machine log after sync</div><div className="d">Frees memory on the machine. The punches stay stored in ERPNext as Biometric Logs.</div></div>
            <Switch checked={f.clear_after_sync} onChange={async (v) => { if (v && !await confirmDialog({ title: "Clear the machine log?", message: "After each successful sync, the attendance log on the machine is deleted. Continue?", confirm: "Enable", danger: true })) return; set("clear_after_sync", v); }} /></div>
        </div>}
      </form>
    </Modal>
  );
}

function ScanDialog({ onClose }: { onClose: () => void }) {
  const [net, setNet] = useState("");
  const [port, setPort] = useState(4370);
  const [out, setOut] = useState<any>(null);
  useEffect(() => { get("local_network").then((r) => setNet(r.network)).catch(() => {}); }, []);
  return (
    <Modal title="Find machines on the network" icon="scan" size="wide" onClose={onClose} foot={<button className="btn" onClick={onClose}>Close</button>}>
      <p className="muted mt-0">Searches the server's network for devices that answer on the ZKTeco port. It only checks whether the port is open; it does not change anything.</p>
      <div className="row">
        <div className="field" style={{ flex: 1, minWidth: 200 }}><label>Network</label><input className="input mono" value={net} placeholder="192.168.1.0/24" onChange={(e) => setNet(e.target.value)} /></div>
        <div className="field" style={{ width: 120 }}><label>Port</label><input className="input" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} /></div>
        <div className="field"><label>&nbsp;</label><BusyButton className="btn btn-primary" busyText="Scanning…" onClick={async () => {
          setOut("loading");
          try { setOut(await post("scan_network", { network: net, port })); } catch (e) { setOut(null); toastError(e); }
        }}><Icon name="search" /> Scan</BusyButton></div>
      </div>
      <div className="mt-3">
        {out === "loading" ? <Loading text="Scanning, this takes a few seconds…" /> : out && (out.found.length ? <>
          <div className="label mb-1">{out.found.length} device(s) found in {out.network}</div>
          <div className="scan-list">{out.found.map((x: any) => (
            <div key={x.ip} className="row"><Icon name="fingerprint" /><span className="mono strong">{x.ip}</span><span className="spacer" />
              {x.known ? <span className="badge success">already added</span> : <button className="btn btn-sm btn-primary" onClick={() => { onClose(); openDeviceEditor(null, { ip: x.ip, port, name: `Machine ${x.ip.split(".").pop()}` }); }}><Icon name="plus" /> Add</button>}</div>))}</div>
        </> : <EmptyState icon="search" title="No machines found" text="Check that the machines are switched on and on the same network, or enter another network range." />)}
      </div>
    </Modal>
  );
}
