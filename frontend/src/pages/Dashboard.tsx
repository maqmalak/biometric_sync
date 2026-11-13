import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../lib/api";
import { ChartBox, cssVar } from "../lib/charts";
import { openDeviceEditor, openRun, openSync } from "../lib/events";
import { fmtDate, fmtDuration, fmtNum, fmtRelative, fmtTime, triggerLabel } from "../lib/format";
import { useStore } from "../lib/store";
import type { Device } from "../lib/types";
import { EmptyState, Icon, Loading, Stat, StatusBadge, toast, toastError, useInterval } from "../lib/ui";

export default function Dashboard() {
  const { boot, active, tick } = useStore();
  const [d, setD] = useState<any>(null);
  const load = useCallback(async () => {
    try {
      const [sum, runs, devices, hourly] = await Promise.all([get("stats_summary", { days: 30 }), get("runs", { limit: 8 }), get<Device[]>("devices"), get("stats_hourly")]);
      setD({ sum, runs: runs.rows, devices, hourly });
    } catch (e) { toastError(e); }
  }, []);
  useEffect(() => { load(); }, [load, tick]);
  useInterval(load, 60000);
  if (!d) return <div className="stack"><Loading /></div>;
  const { sum: s, runs, devices, hourly } = d;
  const c = s.counts || {};
  const pending = c.pending || 0, failed = c.failed || 0;
  const next = s.next_runs?.[0];
  const running = active.running.length + active.queued.length;

  return (
    <div className="stack">
      {!s.devices && (
        <div className="card"><div className="card-body"><div className="row" style={{ gap: 18, alignItems: "flex-start" }}>
          <div className="stat-icon" style={{ width: 52, height: 52 }}><Icon name="rocket" /></div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h2>Welcome to Biometric Sync</h2><p className="muted mt-1">Get started in two steps:</p>
            <ol className="steps">
              <li><b>Add your machines</b> with their IP address, or let the app scan the network for them.</li>
              <li>Click <b>Sync Now</b>. After that, each machine is read automatically on its own schedule.</li>
            </ol>
          </div>
          <div className="btn-group"><button className="btn btn-primary" onClick={() => openDeviceEditor()}><Icon name="plus" /> Add a machine</button><Link className="btn" to="/help"><Icon name="help" /> Read the guide</Link></div>
        </div></div></div>
      )}
      {!boot.scheduler && <div className="alert danger"><Icon name="alert" /><div><div className="t">The scheduler of this site is off</div>Machines are not read automatically. Run <code>bench --site {boot.site} enable-scheduler</code> and make sure a worker is running.</div></div>}
      {failed > 0 && (
        <div className="alert warning"><Icon name="alert" /><div style={{ flex: 1 }}><div className="t">{fmtNum(failed)} punch(es) could not be turned into check-ins</div>Usually no employee has this machine user ID as Attendance Device ID. Fix it in Employee Mapping; the punches are retried automatically.</div>
          <div className="btn-group"><Link className="btn btn-sm" to="/punches/failed">View</Link><Link className="btn btn-sm" to="/employees">Employee mapping</Link></div></div>
      )}

      <div className="grid grid-4">
        <Stat icon={s.devices_offline ? "wifiOff" : "fingerprint"} tone={!s.devices_enabled ? "" : s.devices_offline ? "danger" : "success"} label="Machines online"
          value={<>{s.devices_online} <span className="muted" style={{ fontSize: 16 }}>/ {s.devices_enabled}</span></>}
          meta={s.devices_offline ? <span className="st-failed">{s.devices_offline} offline</span> : "All reachable at last read"} />
        <Stat icon="users" tone="info" label="Today" value={<>{fmtNum(s.today_punches)} <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>punches</span></>}
          meta={`${fmtNum(s.today_employees)} employee(s) · ${fmtNum(s.today_synced)} in ERPNext`} />
        <Stat icon={failed ? "alert" : pending ? "clock" : "checkCircle"} tone={failed ? "danger" : pending ? "warning" : "success"} label="Waiting / failed"
          value={<>{fmtNum(pending)} <span className="muted" style={{ fontSize: 16 }}>/ {fmtNum(failed)}</span></>} meta={pending ? "being processed" : "Nothing waiting"} />
        <Stat icon="cloud" tone={s.read_success_rate == null ? "" : s.read_success_rate >= 95 ? "success" : s.read_success_rate >= 70 ? "warning" : "danger"}
          label="Check-ins created (30 days)" value={fmtNum(s.period_synced)}
          meta={`Machine reads OK: ${s.read_success_rate == null ? "—" : s.read_success_rate + "%"} · ${fmtNum(s.punches_total)} punches stored`} />
      </div>

      <div className="grid grid-3">
        <div className="card" style={{ gridColumn: "span 2" }}>
          {!running ? <>
            <div className="card-head"><h3><Icon name="activity" /> Activity</h3></div>
            <div className="card-body"><div className="row" style={{ gap: 18 }}>
              <div className="stat-icon success" style={{ width: 52, height: 52 }}><Icon name="shield" /></div>
              <div style={{ flex: 1, minWidth: 200 }}><div className="strong">No sync is running</div><div className="muted small">Punches are collected automatically on schedule. You can also sync right now.</div></div>
              {boot.can_write && <div className="btn-group">
                <button className="btn btn-lg" title="Process waiting punches without contacting the machines"
                  onClick={async () => { try { const r = await post("start_sync", { push_only: 1 }); toast(`${fmtNum(r.reprocess?.count || 0)} waiting punch(es) queued.`, "success"); } catch (e) { toastError(e); } }}>
                  <Icon name="send" /> Send pending</button>
                <button className="btn btn-primary btn-lg" onClick={() => openSync()}><Icon name="refresh" /> Sync Now</button></div>}
            </div></div>
          </> : <>
            <div className="card-head"><h3><Icon name="activity" /> Syncing now</h3><Link className="btn btn-sm" to="/progress"><Icon name="eye" /> Live progress</Link></div>
            <div className="card-body stack">
              {active.running.map((r) => (
                <div key={r.id}><div className="row small"><span className="strong">{r.device_name}</span><span className="muted">started {fmtTime(r.started_at)}</span><span className="spacer" /><span className="muted">reading machine…</span></div>
                  <div className="bar bar-lg mt-1 striped"><span style={{ width: "60%" }} /></div></div>))}
              {active.queued.map((q) => <div key={q.device} className="row small"><Icon name="clock" /> <span className="strong">{q.device_name}</span><span className="muted">queued</span></div>)}
            </div>
          </>}
        </div>
        <div className="card">
          <div className="card-head"><h3><Icon name="calendar" /> Schedule</h3><Link className="btn btn-sm btn-ghost" to="/devices">Edit</Link></div>
          <div className="card-body">
            {next && s.sync_enabled ? <><div className="label muted">Next automatic sync</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmtTime(next)}</div>
              <div className="muted small">{fmtRelative(next)} · every {s.sync_interval} min</div></>
              : <><div className="muted">Automatic sync is off.</div><Link className="btn btn-sm mt-2" to="/settings"><Icon name="calendar" /> Turn it on</Link></>}
            <hr />
            <div className="label muted">Last sync</div>
            {s.last_run ? <><div className="row mt-1"><StatusBadge status={s.last_run.status} /><span className="small">{fmtDate(s.last_run.finished_at)}</span></div>
              <div className="muted small mt-1">{s.last_run.device_name}: {fmtNum(s.last_run.new_punches)} new · {fmtNum(s.last_run.pushed)} check-ins</div></>
              : <div className="muted small">No sync yet</div>}
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3><Icon name="fingerprint" /> Machines</h3><Link className="btn btn-sm btn-ghost" to="/devices">Manage</Link></div>
          <div className="card-body">{devices.length ? devices.map((m: Device) => (
            <div key={m.id} className="health-row">
              <div className={`stat-icon ${!m.enabled ? "" : m.status === "online" ? "success" : m.status === "offline" || m.status === "error" ? "danger" : ""}`}><Icon name={m.status === "offline" ? "wifiOff" : "fingerprint"} /></div>
              <div style={{ flex: 1, minWidth: 0 }}><div className="t truncate">{m.name} {!m.enabled && <span className="badge outline">disabled</span>}</div>
                <div className="d truncate">{m.ip} · last read {fmtRelative(m.last_success_at)}{m.last_error && m.status !== "online" ? <> · <span className="st-failed">{m.last_error}</span></> : null}</div></div>
              <div style={{ textAlign: "right" }} className="small"><div className="strong">{fmtNum(m.stats.today)} today</div>
                <div className="muted">{m.stats.pending ? `${fmtNum(m.stats.pending)} pending` : ""}{m.stats.failed ? <> <span className="st-failed">{fmtNum(m.stats.failed)} failed</span></> : null}</div></div>
            </div>)) : <EmptyState icon="fingerprint" title="No machines yet" text="Add your first biometric machine." />}</div>
        </div>
        <div className="card">
          <div className="card-head"><h3><Icon name="chart" /> Punches today by hour</h3><Link className="btn btn-sm btn-ghost" to="/stats">Statistics</Link></div>
          <div className="card-body">
            <ChartBox small deps={[hourly]} make={() => ({
              type: "bar",
              data: { labels: hourly.map((h: any) => String(h.hour).padStart(2, "0")), datasets: [{ label: "Punches", data: hourly.map((h: any) => h.count), backgroundColor: cssVar("--primary"), borderRadius: 4, maxBarThickness: 22 }] },
              options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } },
            })} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3><Icon name="history" /> Recent syncs</h3><Link className="btn btn-sm btn-ghost" to="/stats/history">View all</Link></div>
        <div className="card-body tight table-wrap">
          {runs.length ? <table className="table"><thead><tr><th>Run</th><th>Started</th><th>Machine</th><th>Trigger</th><th>Result</th><th>Read</th><th>New</th><th>Check-ins</th><th>Unmatched</th><th>Duration</th></tr></thead><tbody>
            {runs.map((r: any) => (
              <tr key={r.id} className="clickable" onClick={() => openRun(r.id)}>
                <td className="strong mono small">{r.id.replace("BIO-SYNC-", "#")}</td><td className="nowrap">{fmtDate(r.started_at)}</td><td>{r.device_name}</td><td>{triggerLabel(r.trigger)}</td>
                <td><StatusBadge status={r.status} /></td><td>{fmtNum(r.fetched)}</td><td>{fmtNum(r.new_punches)}</td><td>{fmtNum(r.pushed)}</td>
                <td className={r.unmatched ? "st-failed" : ""}>{r.unmatched ? fmtNum(r.unmatched) : "—"}</td><td>{r.finished_at ? fmtDuration(r.duration) : "…"}</td>
              </tr>))}
          </tbody></table> : <EmptyState icon="history" title="No syncs yet" text="Click Sync Now at the top right to run the first one." />}
        </div>
      </div>
    </div>
  );
}
