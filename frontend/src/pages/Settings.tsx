/* Settings (Biometric Sync Settings + machine-wide actions), laid out like the standalone tool's settings. */
import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { get, post } from "../lib/api";
import { fmtDate, fmtNum, MODE_LABEL } from "../lib/format";
import { useStore } from "../lib/store";
import { BusyButton, confirmDialog, Icon, Loading, Modal, Switch, toast, toastError } from "../lib/ui";

const SECTIONS: [string, string, string][] = [
  ["sync", "calendar", "Sync & schedule"], ["punches", "sliders", "Punch rules"], ["machines", "fingerprint", "Machine defaults"],
  ["display", "monitor", "Check-in Display"], ["adms", "cloud", "ADMS / push machines"], ["notify", "bell", "Notifications"],
  ["security", "shield", "Security"], ["maintenance", "wrench", "Maintenance"],
];
const MODES = ["Device Punch State", "Always IN", "Always OUT", "Alternate IN/OUT", "Leave Blank"];

export default function Settings() {
  const { boot } = useStore();
  const nav = useNavigate();
  const seg = useLocation().pathname.split("/")[2];
  const sec = SECTIONS.some((s) => s[0] === seg) ? seg : "sync";
  const [data, setData] = useState<any>(null);
  const [v, setV] = useState<Record<string, any>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const init = (d: any) => { setData(d); setV({ ...d.values }); setDirty(false); setLocked(false); };
  const reload = () => get("settings").then(init).catch((e) => { if (e.locked) { setLocked(true); setData(null); } else toastError(e); });
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (locked) return <SettingsUnlock onDone={reload} />;
  if (!data) return <Loading />;
  const ro = !boot.can_write;
  const set = (k: string, x: any) => { setV((o) => ({ ...o, [k]: x })); setDirty(true); };
  const save = async () => {
    setBusy(true);
    try { init(await post("settings_save", { values: v })); toast("Settings saved.", "success"); } catch (e) { toastError(e, "Could not save"); }
    setBusy(false);
  };
  const saveFirst = async () => { if (dirty) { await save(); } };

  /* field helpers */
  const toggle = (k: string, t: string, d?: ReactNode) => (
    <div className="toggle-row"><div><div className="t">{t}</div>{d && <div className="d">{d}</div>}</div><Switch checked={!!Number(v[k])} disabled={ro} onChange={(x) => set(k, x ? 1 : 0)} /></div>);
  const num = (k: string, label: string, hint?: ReactNode, attrs: any = {}) => (
    <div className="field"><label>{label}</label><input className="input" type="number" disabled={ro} value={v[k] ?? ""} {...attrs}
      onChange={(e) => set(k, e.target.value === "" ? null : Number(e.target.value))} />{hint && <div className="hint">{hint}</div>}</div>);
  const text = (k: string, label: string, hint?: ReactNode, placeholder = "") => (
    <div className="field"><label>{label}</label><input className="input" disabled={ro} value={v[k] ?? ""} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} />{hint && <div className="hint">{hint}</div>}</div>);
  const select = (k: string, label: string, opts: [string, string][], hint?: ReactNode) => (
    <div className="field"><label>{label}</label><select className="input" disabled={ro} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)}>
      {opts.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>{hint && <div className="hint">{hint}</div>}</div>);
  const applyBtn = (fields: string[] | null, label = "Apply to all machines") => !ro && (
    <BusyButton className="btn btn-sm" busyText="Applying…" onClick={async () => {
      if (!await confirmDialog({ title: "Apply to every machine?", message: `These values are copied to all ${data.machines.length} machine(s), replacing their own values.`, confirm: "Apply" })) return;
      try { await saveFirst(); const r = await post("apply_machine_defaults", { fields }); toast(`Applied to ${r.machines} machine(s).`, "success"); reload(); } catch (e) { toastError(e); }
    }}><Icon name="copy" /> {label}</BusyButton>);

  const sched = data.scheduler;
  const allAuto = data.machines.filter((m: any) => m.enabled).every((m: any) => m.auto_sync);

  return (
    <div className="grid settings-grid" style={{ gridTemplateColumns: "230px minmax(0,1fr)", alignItems: "start" }}>
      <div className="card" style={{ padding: 8, position: "sticky", top: 84 }}>
        {SECTIONS.map(([id, ic, l]) => (
          <button key={id} className={`btn btn-ghost ${sec === id ? "active" : ""}`} style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => nav(`/settings/${id}`)}><Icon name={ic} /> {l}</button>))}
        <hr />
        <a className="btn btn-ghost" style={{ width: "100%", justifyContent: "flex-start" }} href="/app/biometric-sync-settings" target="_blank" rel="noreferrer"><Icon name="external" /> Open in desk</a>
        {data.console_password_enabled && <button type="button" className="btn btn-ghost" style={{ width: "100%", justifyContent: "flex-start" }}
          onClick={async () => { await post("lock").catch(() => {}); setLocked(true); }}><Icon name="lock" /> Lock settings</button>}
      </div>
      <form className="card" autoComplete="off" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="card-body">

          {sec === "sync" && <section className="form-section" style={{ borderTop: 0 }}>
            <h3><Icon name="calendar" /> Sync &amp; schedule</h3><p className="desc">How the machines are read. Each read stores the punches as Biometric Logs and creates the Employee Checkins.</p>
            <div className="toggle-row"><div><div className="t">Site scheduler ({sched.site})</div>
              <div className="d">{sched.enabled ? "On. Background jobs of this site run (Biometric Sync, auto attendance, e-mails…)." : <span className="st-failed">Off. Nothing runs automatically on this site.</span>} A background worker must also be running.
                {!sched.can_toggle && " Only a System Manager can change this."}</div></div>
              <Switch checked={sched.enabled} disabled={ro || !sched.can_toggle} onChange={async (x) => {
                if (!x && !await confirmDialog({ title: "Turn off the site scheduler?", message: <>This stops <b>every</b> scheduled job of {sched.site}, not only Biometric Sync (also auto attendance and e-mail).</>, confirm: "Turn off", danger: true })) return;
                try { await post("set_site_scheduler", { enabled: x ? 1 : 0 }); toast(`Site scheduler ${x ? "on" : "off"}.`, "success"); reload(); } catch (e) { toastError(e); }
              }} /></div>
            {toggle("enable_scheduled_sync", "Automatic sync", "Reads every machine that has “Read automatically” on, on its own interval. Turn off to pause all automatic reading; Sync Now still works.")}
            <div className="toggle-row"><div><div className="t">Read every machine automatically</div><div className="d">{allAuto ? "On for all enabled machines." : "Off for some machines (see the table below)."}</div></div>
              <div className="row">
                <input className="input" type="number" min={1} max={1440} style={{ width: 90 }} disabled={ro} value={v.default_sync_interval ?? 15} onChange={(e) => set("default_sync_interval", Number(e.target.value))} title="Every N minutes" />
                <span className="small muted">min</span>
                <Switch checked={allAuto} disabled={ro} onChange={async (x) => {
                  try { await saveFirst(); const r = await post("set_machines_auto_sync", { enabled: x ? 1 : 0, interval: v.default_sync_interval || 15 }); toast(`Automatic reading ${x ? "on" : "off"} for ${r.machines} machine(s).`, "success"); reload(); } catch (e) { toastError(e); }
                }} /></div></div>
            <div className="table-wrap mt-2"><table className="table"><thead><tr><th>Machine</th><th>Read automatically</th><th>Every</th><th>Import from</th><th>Newest punch read</th></tr></thead><tbody>
              {data.machines.map((m: any) => <tr key={m.id}><td className="strong">{m.name} {!m.enabled && <span className="badge outline">disabled</span>}</td>
                <td>{m.auto_sync ? <span className="badge success">On</span> : <span className="badge outline">Off</span>}</td><td>{m.sync_interval} min</td>
                <td className="small">{m.sync_from ? fmtDate(m.sync_from) : "—"}</td><td className="small">{m.last_punch_time ? fmtDate(m.last_punch_time) : "—"}</td></tr>)}
            </tbody></table></div>
            <div className="row mt-2">{applyBtn(["default_sync_interval"], "Apply the interval to all machines")}<Link className="btn btn-sm btn-ghost" to="/devices"><Icon name="edit" /> Set per machine</Link></div>
            <div className="form-grid mt-3">
              {num("retry_days", "Retry unmatched punches of the last (days)", "Punches waiting for an employee are matched again every hour.")}
            </div>
            {toggle("retry_unmatched", "Retry unmatched / failed punches hourly", "Punches with “No employee with this ID” are created as soon as HR sets the employee's Attendance Device ID.")}
          </section>}

          {sec === "punches" && <section className="form-section" style={{ borderTop: 0 }}>
            <h3><Icon name="sliders" /> Punch rules</h3><p className="desc">How punches are read and turned into check-ins.</p>
            <div className="form-grid">
              <div className="field"><label>Import punches from</label><input className="input" type="date" disabled={ro} value={v.default_import_from || ""} onChange={(e) => set("default_import_from", e.target.value || null)} />
                <div className="hint">Older punches on the machines are ignored. Empty = no limit. Applied to every machine.</div></div>
              {select("default_log_type_mode", "Punch direction (log type)", MODES.map((m) => [m, MODE_LABEL[m]]), <>For new machines. <b>From the punch key</b> uses the key pressed on the machine (0/4 = IN, 1/5 = OUT).</>)}
              {num("duplicate_punch_window", "Ignore repeated punches within (seconds)", "Employees often punch twice. 0 = keep every punch.")}
              {num("default_time_offset", "Machine clock offset (minutes)", "Only when the machines run in another time zone than ERPNext.")}
            </div>
            <div className="row mt-2">
              {applyBtn(["default_import_from"], "Apply the import date to all machines")}
              {!ro && v.default_import_from && <BusyButton className="btn btn-sm" busyText="Starting…" onClick={async () => {
                if (!await confirmDialog({ title: `Read all machines from ${v.default_import_from}?`, message: "Every machine is read again from this date. Punches already stored are skipped as duplicates, so nothing is created twice.", confirm: "Read now" })) return;
                try { await saveFirst(); await post("apply_machine_defaults", { fields: ["default_import_from"] }); const r = await post("start_sync", { from_date: `${v.default_import_from} 00:00:00` }); toast(`Reading ${r.queued.length} machine(s) from ${v.default_import_from}.`, "success"); nav("/progress"); } catch (e) { toastError(e); }
              }}><Icon name="history" /> Read machines from this date now</BusyButton>}
              {applyBtn(["default_log_type_mode", "default_time_offset"], "Apply direction & offset to all machines")}
            </div>
          </section>}

          {sec === "machines" && <section className="form-section" style={{ borderTop: 0 }}>
            <h3><Icon name="fingerprint" /> Machine defaults</h3><p className="desc">Used when a machine is added. <b>Apply to all machines</b> copies them to every machine (Machines → Edit changes one).</p>
            <div className="form-grid">
              {num("default_port", "Port", "ZKTeco default: 4370.", { min: 1, max: 65535 })}
              {num("default_comm_key", "Communication password (comm key)", "Menu → Comm. on the machine. 0 = none.", { min: 0 })}
              {num("default_timeout", "Connection timeout (seconds)", "Raise it for machines with many records.", { min: 3, max: 600 })}
              {num("default_sync_interval", "Sync every (minutes)", undefined, { min: 1, max: 1440 })}
            </div>
            {toggle("default_force_udp", "Use UDP instead of TCP", "Needed for some older machines.")}
            {toggle("default_ping_before_connect", "Ping before connecting", "Turn off if ping (ICMP) is blocked on your network but the machine port works.")}
            {toggle("default_disable_device_during_sync", "Lock the machine while reading", "Disables the keypad / sensor for a few seconds while the log is read, so no punch is missed. Recommended.")}
            {toggle("default_sync_device_time", "Set the machine clock on every sync", "Keeps punch times correct when the machine clock drifts.")}
            <div className="row mt-2">{applyBtn(null)}</div>
          </section>}

          {sec === "display" && <section className="form-section" style={{ borderTop: 0 }}>
            <h3><Icon name="monitor" /> Check-in Display</h3><p className="desc">The live board of check-ins and check-outs (<code>/checkin-display</code>, add <code>?kiosk=1</code> for a wall TV in full screen).</p>
            <div className="form-grid">
              {text("display_title", "Screen title", "Shown in the display header.", "e.g. Baogee Dyeing — Main Gate")}
              {select("display_language", "Default language", [["en", "English"], ["ur", "اردو (Urdu)"]], "Each screen can still switch; its own choice is remembered.")}
              <div className="field"><label>Day starts at</label><input type="time" className="input" disabled={ro} value={String(v.display_day_start || "00:00").slice(0, 5)} onChange={(e) => set("display_day_start", e.target.value + ":00")} />
                <div className="hint">For night shifts, e.g. 07:00: punches after midnight stay with the right shift.</div></div>
              {select("display_direction", "Decide In / Out by", [["machine", "What the machine records"], ["alternate", "Alternate through the day (1st In, 2nd Out, …)"]])}
              {select("display_view", "Default employee view", [["cards", "Cards"], ["list", "List"]])}
              {num("display_recent_count", "Punches in the Activity list", undefined, { min: 5, max: 200 })}
              {num("display_refresh_seconds", "Refresh every (seconds)", undefined, { min: 5, max: 3600 })}
            </div>
            {toggle("display_show_photos", "Employee photos", "From the Employee image. Initials are shown when there is no photo.")}
            {toggle("display_urdu_names", "Urdu names", "In Urdu mode, show the Urdu employee, department and designation names.")}
            <div className="field mt-2"><label>Shown on the latest punch</label><div className="check-list">
              {[["display_show_division", "Division"], ["display_show_department", "Department"], ["display_show_sub_department", "Sub Department"], ["display_show_designation", "Designation"]].map(([k, l]) => (
                <label key={k}><input type="checkbox" disabled={ro} checked={!!Number(v[k])} onChange={(e) => set(k, e.target.checked ? 1 : 0)} /> {l}</label>))}</div></div>
            <div className="mt-2"><Link className="btn btn-sm" to="/display"><Icon name="monitor" /> Open the display</Link> <a className="btn btn-sm" href="/checkin-display?kiosk=1" target="_blank" rel="noreferrer"><Icon name="maximize" /> Open in full screen</a></div>
          </section>}

          {sec === "adms" && <section className="form-section" style={{ borderTop: 0 }}>
            <h3><Icon name="cloud" /> ADMS / push machines</h3><p className="desc">ZKTeco machines can push their punches to this site themselves (Comm → Cloud Server: this site's address, path <code>/iclock</code>).</p>
            {toggle("enable_adms", "Accept ADMS push from machines", "Turn on only when a machine is set up for push.")}
            {toggle("adms_auto_register", "Register unknown machines automatically", "A new machine that pushes is added (disabled) for you to review.")}
            <div className="form-grid">{num("adms_offline_after", "Mark a push machine offline after (minutes)", "Without a heartbeat.")}</div>
          </section>}

          {sec === "notify" && <section className="form-section" style={{ borderTop: 0 }}>
            <h3><Icon name="bell" /> Notifications</h3><p className="desc">E-mails are sent with this site's outgoing e-mail account.</p>
            {toggle("notify_on_failure", "E-mail when a sync fails", "For example a machine not reachable.")}
            <div className="field"><label>Send to</label><textarea className="input" rows={3} disabled={ro} value={v.notification_recipients || ""} placeholder="hr@yourcompany.com, it@yourcompany.com" onChange={(e) => set("notification_recipients", e.target.value)} />
              <div className="hint">E-mail addresses, one per line or separated by commas.</div></div>
          </section>}

          {sec === "security" && <Security enabled={data.console_password_enabled} canWrite={boot.can_write} onChanged={reload} onLock={() => setLocked(true)} />}

          {sec === "maintenance" && <section className="form-section" style={{ borderTop: 0 }}>
            <h3><Icon name="wrench" /> Maintenance</h3>
            <div className="form-grid">
              {num("log_retention_days", "Keep Biometric Logs (punches) for (days)", "Older logs are deleted daily. Check-ins are not touched. 0 = keep forever.")}
              {num("sync_log_retention_days", "Keep sync history for (days)", "0 = keep forever.")}
            </div>
            <div className="btn-group mt-2">
              <Link className="btn" to="/stats/history"><Icon name="history" /> Sync history (clear…)</Link>
              <a className="btn" href="/app/biometric-log" target="_blank" rel="noreferrer"><Icon name="list" /> Biometric Logs in desk</a>
              <a className="btn" href="/app/biometric-device" target="_blank" rel="noreferrer"><Icon name="fingerprint" /> Machines in desk</a>
            </div>
            <div className="hint mt-2">Backups are part of the site backup (<code>bench --site {data.site} backup</code>). {fmtNum(data.machines.length)} machine(s) configured.</div>
          </section>}
        </div>
        {boot.can_write && !["security"].includes(sec) && <div className="modal-foot" style={{ borderTop: "1px solid var(--border)" }}>
          <span className="muted small">{dirty ? "Unsaved changes" : "All changes saved"}</span><span className="spacer" />
          <button type="button" className="btn" disabled={!dirty} onClick={() => init(data)}>Discard</button>
          <button type="submit" className="btn btn-primary" disabled={!dirty || busy}><Icon name="check" /> Save settings</button>
        </div>}
      </form>
    </div>
  );
}

function SettingsUnlock({ onDone }: { onDone: () => void }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="card" style={{ maxWidth: 460, margin: "40px auto" }}><div className="card-body">
      <div className="row mb-3" style={{ gap: 14 }}><div className="stat-icon warning" style={{ width: 46, height: 46 }}><Icon name="lock" /></div>
        <div><h2>Settings are locked</h2><div className="muted small">Enter the settings password. The other pages work without it.</div></div></div>
      <form className="stack" autoComplete="off" onSubmit={async (e) => {
        e.preventDefault(); if (busy) return; setBusy(true); setErr("");
        try { await post("unlock", { password: pwd }); onDone(); } catch (x: any) { setErr(x.message); setBusy(false); }
      }}>
        <div className="field"><label>Settings password</label><input className="input" type="password" autoComplete="current-password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus required /></div>
        {err && <div className="alert danger"><Icon name="xCircle" /><div>{err}</div></div>}
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy}><Icon name="lock" /> {busy ? "Checking…" : "Unlock settings"}</button>
      </form>
      <div className="hint mt-2">Forgot it? A System Manager can remove it in the desk: Biometric Sync Settings → Console Security.</div>
    </div></div>
  );
}

function Security({ enabled, canWrite, onChanged, onLock }: { enabled: boolean; canWrite: boolean; onChanged: () => void; onLock: () => void }) {
  const [dlg, setDlg] = useState<"set" | "remove" | null>(null);
  return (
    <section className="form-section" style={{ borderTop: 0 }}>
      <h3><Icon name="shield" /> Security</h3>
      <p className="desc">Only users with the HR Manager or System Manager role can change machines and settings; HR users can view. Everyone logs in with their ERPNext account.</p>
      <div className="toggle-row"><div><div className="t">Settings password</div>
        <div className="d">{enabled ? "Enabled. The Settings page asks for this password once per login session (also for its API). The other pages are not locked." : "Off. Any user who may change Biometric Sync can open Settings."}</div></div>
        {canWrite && <div className="btn-group">
          <button type="button" className="btn btn-sm" onClick={() => setDlg("set")}><Icon name="lock" /> {enabled ? "Change password" : "Set password"}</button>
          {enabled && <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => setDlg("remove")}>Remove</button>}
        </div>}</div>
      {enabled && <div className="toggle-row"><div><div className="t">Lock Settings now</div><div className="d">Settings ask for the password again in this browser.</div></div>
        <button type="button" className="btn btn-sm" onClick={async () => { await post("lock").catch(() => {}); onLock(); }}><Icon name="lock" /> Lock</button></div>}
      <div className="alert info mt-2"><Icon name="key" /><div>The password is stored encrypted on the site. Machine comm keys are under <Link to="/settings/machines">Machine defaults</Link> and on each machine.</div></div>
      {dlg && <PasswordDialog mode={dlg} enabled={enabled} onClose={() => setDlg(null)} onDone={() => { setDlg(null); onChanged(); }} />}
    </section>
  );
}

function PasswordDialog({ mode, enabled, onClose, onDone }: { mode: "set" | "remove"; enabled: boolean; onClose: () => void; onDone: () => void }) {
  const [cur, setCur] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;  // Enter in a field and the button must not send it twice
    setErr("");
    if (mode === "set" && p1 !== p2) return setErr("The two passwords are different.");
    setBusy(true);
    try {
      if (mode === "set") { await post("set_console_password", { password: p1, current: cur }); toast("Settings password saved.", "success"); }
      else { await post("remove_console_password", { current: cur }); toast("Settings password removed.", "success"); }
      onDone();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={mode === "set" ? (enabled ? "Change settings password" : "Set settings password") : "Remove settings password"} icon="lock" onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>Cancel</button><button className={`btn ${mode === "remove" ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={go}>{busy ? "Saving…" : mode === "set" ? "Save password" : "Remove"}</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); go(); }} autoComplete="off">
        {enabled && <div className="field"><label>Current password</label><input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus /></div>}
        {mode === "set" && <>
          <div className="field"><label>New password</label><input className="input" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} autoFocus={!enabled} /><div className="hint">At least 4 characters.</div></div>
          <div className="field"><label>Repeat new password</label><input className="input" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></div>
        </>}
        {err && <div className="alert danger"><Icon name="xCircle" /><div>{err}</div></div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
