/* Statistics and sync history. */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { download, get, post } from "../lib/api";
import { ChartBox, cssVar } from "../lib/charts";
import { openRun } from "../lib/events";
import { fmtDate, fmtDuration, fmtNum, fmtRelative, todayStr, triggerLabel } from "../lib/format";
import { useStore } from "../lib/store";
import { EmptyState, Icon, Loading, Modal, promptDialog, Stat, StatusBadge, toast, toastError } from "../lib/ui";

export default function Stats() {
  const nav = useNavigate();
  const tab = useLocation().pathname.includes("history") ? "history" : "overview";
  const [days, setDays] = useState(30);
  const [exp, setExp] = useState(false);
  return (
    <>
      <div className="row mb-3">
        <div className="segmented">
          <button className={tab === "overview" ? "active" : ""} onClick={() => nav("/stats")}><Icon name="chart" /> Overview</button>
          <button className={tab === "history" ? "active" : ""} onClick={() => nav("/stats/history")}><Icon name="history" /> Sync history</button>
        </div>
        <span className="spacer" />
        <select className="input" style={{ width: "auto" }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 365 days</option></select>
        <button className="btn" onClick={() => setExp(true)}><Icon name="download" /> Export CSV</button>
      </div>
      {tab === "history" ? <History /> : <Overview days={days} />}
      {exp && <Modal title="Export to CSV" icon="download" onClose={() => setExp(false)}>
        <div className="stack">
          <button className="btn" onClick={() => { download("punches_export", { date_from: todayStr(-days + 1) }); setExp(false); }}><Icon name="list" /> Punches (selected period)</button>
          <button className="btn" onClick={() => { download("runs_export", { days }); setExp(false); }}><Icon name="history" /> Sync history (selected period)</button>
          <button className="btn" onClick={() => { download("logs_export"); setExp(false); }}><Icon name="logs" /> All sync logs</button>
        </div></Modal>}
    </>
  );
}

function Overview({ days }: { days: number }) {
  const nav = useNavigate();
  const { tick, theme } = useStore();
  const [d, setD] = useState<any>(null);
  const [hrDay, setHrDay] = useState(todayStr());
  const [hourly, setHourly] = useState<any[]>([]);
  useEffect(() => {
    setD(null);
    Promise.all([get("stats_summary", { days }), get("stats_daily", { days: Math.min(days, 90) }), get("stats_devices", { days })])
      .then(([sum, daily, devs]) => setD({ sum, daily, devs })).catch(toastError);
  }, [days, tick]);
  useEffect(() => { get("stats_hourly", { day: hrDay }).then(setHourly).catch(() => {}); }, [hrDay, tick]);
  if (!d) return <Loading />;
  const { sum, daily, devs } = d;
  const c = sum.counts || {};
  const labels = daily.map((x: any) => new Date(x.day + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  const bar = (label: string, key: string, color: string) => ({ label, data: daily.map((x: any) => x[key]), backgroundColor: color, borderRadius: 3, maxBarThickness: 26 });
  return (
    <>
      <div className="grid grid-4 mb-3">
        <Stat icon="activity" label="Sync runs" value={fmtNum(sum.runs)} meta={<><span className="st-success">{sum.runs_ok} ok</span> · {sum.runs_partial} partial · <span className="st-failed">{sum.runs_failed} failed</span></>} />
        <Stat icon="fingerprint" tone={sum.read_success_rate == null ? "" : sum.read_success_rate >= 95 ? "success" : sum.read_success_rate >= 70 ? "warning" : "danger"} label="Machine reads OK"
          value={sum.read_success_rate == null ? "—" : sum.read_success_rate + "%"} meta={`${fmtNum(sum.device_reads_ok)} of ${fmtNum(sum.device_reads)} reads`} />
        <Stat icon="cloud" tone="success" label="Check-ins created" value={fmtNum(sum.period_synced)} meta={`${fmtNum(sum.period_fetched)} new punches read in the period`} />
        <Stat icon={c.failed ? "alert" : "shield"} tone={c.failed ? "danger" : "success"} label="Punches stored" value={fmtNum(sum.punches_total)}
          meta={<>{fmtNum(c.pending || 0)} pending · <span className={c.failed ? "st-failed" : ""}>{fmtNum(c.failed || 0)} failed</span> · {fmtNum(c.skipped || 0)} skipped</>} />
      </div>
      <div className="grid grid-2 mb-3">
        <div className="card"><div className="card-head"><h3>Punches per day (by status)</h3></div><div className="card-body">
          <ChartBox deps={[daily, theme]} make={() => ({ type: "bar", data: { labels, datasets: [bar("Synced", "synced", cssVar("--success")), bar("Pending", "pending", cssVar("--info")), bar("Skipped", "skipped", cssVar("--muted")), bar("Failed", "failed", cssVar("--danger"))] },
            options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: "bottom" } } } })} /></div></div>
        <div className="card"><div className="card-head"><h3>Employees punching per day</h3></div><div className="card-body">
          <ChartBox deps={[daily, theme]} make={() => ({ type: "line", data: { labels, datasets: [{ label: "Employees", data: daily.map((x: any) => x.employees), borderColor: cssVar("--primary"), backgroundColor: cssVar("--primary") + "22", fill: true, tension: 0.35, pointRadius: 2 }] },
            options: { maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { display: false } } } })} /></div></div>
      </div>
      <div className="card mb-3">
        <div className="card-head"><h3>Per-machine status</h3></div>
        <div className="card-body tight table-wrap"><table className="table"><thead><tr><th>Machine</th><th>Status</th><th>Last read</th><th>Reads OK</th><th>Avg read time</th><th>Today</th><th>Pending</th><th>Failed</th><th>Stored</th></tr></thead><tbody>
          {devs.length ? devs.map((x: any) => (
            <tr key={x.id} className="clickable" onClick={() => nav(`/punches/device/${encodeURIComponent(x.id)}`)}>
              <td><div className="strong">{x.name} {!x.enabled && <span className="badge outline">disabled</span>}</div><div className="tiny muted mono">{x.ip} · {x.device_id}</div></td>
              <td><StatusBadge status={x.status} /></td>
              <td className="small nowrap">{x.last_success_at ? <>{fmtRelative(x.last_success_at)}<div className="tiny muted">{fmtDate(x.last_success_at)}</div></> : <span className="muted">never</span>}</td>
              <td className="small">{x.reads ? <>{x.reads_ok}/{x.reads} <span className="muted">({Math.round((100 * x.reads_ok) / x.reads)}%)</span></> : "—"}</td>
              <td className="small">{x.avg_fetch != null ? fmtDuration(x.avg_fetch) : "—"}</td>
              <td className="small">{fmtNum(x.stats.today)}</td><td className="small">{fmtNum(x.stats.pending)}</td>
              <td className={`small ${x.stats.failed ? "st-failed strong" : ""}`}>{fmtNum(x.stats.failed)}</td><td className="small">{fmtNum(x.stats.total)}</td></tr>))
            : <tr><td colSpan={9}><EmptyState icon="fingerprint" title="No machines" /></td></tr>}
        </tbody></table></div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Punches by hour</h3><input type="date" className="input" style={{ maxWidth: 180 }} value={hrDay} onChange={(e) => setHrDay(e.target.value)} /></div>
        <div className="card-body"><ChartBox small deps={[hourly, theme]} make={() => ({ type: "bar",
          data: { labels: hourly.map((r) => String(r.hour).padStart(2, "0") + ":00"), datasets: [{ label: "Punches", data: hourly.map((r) => r.count), backgroundColor: cssVar("--warning"), borderRadius: 4, maxBarThickness: 24 }] },
          options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } } })} /></div>
      </div>
    </>
  );
}

function History() {
  const { boot, tick } = useStore();
  const LIMIT = 25;
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [trigger, setTrigger] = useState("");
  const [r, setR] = useState<any>(null);
  const load = () => get("runs", { limit: LIMIT, offset, status, trigger }).then(setR).catch(toastError);
  useEffect(() => { load(); }, [offset, status, trigger, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="card">
      <div className="filters">
        <select className="input" style={{ maxWidth: 200 }} value={trigger} onChange={(e) => { setTrigger(e.target.value); setOffset(0); }}><option value="">Any trigger</option><option value="scheduled">Scheduled</option><option value="manual">Manual</option></select>
        <select className="input" style={{ maxWidth: 180 }} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}><option value="">Any result</option><option value="success">Success</option><option value="partial">Partial</option><option value="failed">Failed</option><option value="running">Running</option></select>
        <span className="spacer" />
        {boot.can_write && <button className="btn btn-sm btn-soft-danger" onClick={async () => {
          const v = await promptDialog({ title: "Clear sync history", label: "Delete runs older than (days)", value: "90", type: "number", hint: "Enter 0 to delete all history. Punches and check-ins are not touched.", confirm: "Delete" });
          if (v === null) return;
          try { const x = await post("clear_history", { before_days: Number(v) || 0 }); toast(`${x.deleted} run(s) deleted.`, "success"); setOffset(0); load(); } catch (e) { toastError(e); }
        }}><Icon name="trash" /> Clear history…</button>}
      </div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Run</th><th>Started</th><th>Machine</th><th>Trigger</th><th>Result</th><th>Read</th><th>New</th><th>Check-ins</th><th>Duplicates</th><th>Unmatched</th><th>Duration</th></tr></thead><tbody>
        {!r ? <tr><td colSpan={11}><Loading /></td></tr> : r.rows.length ? r.rows.map((x: any) => (
          <tr key={x.id} className="clickable" onClick={() => openRun(x.id)}>
            <td className="strong mono small">{x.id.replace("BIO-SYNC-", "#")}</td><td className="nowrap small">{fmtDate(x.started_at)}</td><td>{x.device_name}</td><td>{triggerLabel(x.trigger)}</td>
            <td><StatusBadge status={x.status} /></td><td>{fmtNum(x.fetched)}</td><td>{fmtNum(x.new_punches)}</td><td className="strong">{fmtNum(x.pushed)}</td><td>{fmtNum(x.duplicates)}</td>
            <td className={x.unmatched ? "st-failed" : ""}>{x.unmatched ? fmtNum(x.unmatched) : "—"}</td><td>{x.finished_at ? fmtDuration(x.duration) : "…"}</td></tr>))
          : <tr><td colSpan={11}><EmptyState icon="history" title="No runs found" /></td></tr>}
      </tbody></table></div>
      <div className="row" style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
        <span className="muted small">{r?.total ? `${offset + 1}–${Math.min(offset + LIMIT, r.total)} of ${r.total}` : ""}</span><span className="spacer" />
        <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>‹ Newer</button>
        <button className="btn btn-sm" disabled={!r || offset + LIMIT >= r.total} onClick={() => setOffset(offset + LIMIT)}>Older ›</button></div>
    </div>
  );
}
