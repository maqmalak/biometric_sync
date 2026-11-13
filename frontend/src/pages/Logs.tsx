/* Logs: every sync run (Biometric Sync Log) and errors raised by biometric_sync jobs. */
import { Fragment, useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { download, get } from "../lib/api";
import { openRun } from "../lib/events";
import { fmtDate, fmtNum } from "../lib/format";
import { useStore } from "../lib/store";
import type { Device } from "../lib/types";
import { EmptyState, Icon, LevelBadge, Loading, toast, toastError, useInterval } from "../lib/ui";

const LEVELS = ["ERROR", "WARNING", "SUCCESS", "INFO"];

export default function Logs() {
  const { tick } = useStore();
  const args = useLocation().pathname.split("/").slice(2).map(decodeURIComponent);
  const [levels, setLevels] = useState<Set<string>>(new Set(args[0] === "errors" ? ["ERROR", "WARNING"] : LEVELS));
  const [device, setDevice] = useState(args[0] === "device" ? args[1] || "" : "");
  const [runId, setRunId] = useState(args[0] === "run" ? args[1] || "" : "");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [devices, setDevices] = useState<Device[]>([]);
  useEffect(() => { get<Device[]>("devices").then(setDevices).catch(() => {}); }, []);

  const params = () => ({ level: [...levels].join(","), device, q, run_id: runId });
  const load = useCallback(async (more = false) => {
    try {
      const r = await get("logs", { ...params(), limit: 200, offset: more ? rows?.length || 0 : 0 });
      setTotal(r.total);
      setRows((prev) => (more ? [...(prev || []), ...r.rows] : r.rows));
    } catch (e) { toastError(e); }
  }, [levels, device, q, runId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(null); const t = setTimeout(() => load(), q ? 300 : 0); return () => clearTimeout(t); }, [load, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useInterval(() => load(), 30000);

  return (
    <div className="card">
      <div className="filters">
        <div className="level-chips">{LEVELS.map((l) => (
          <button key={l} className={`${l} ${levels.has(l) ? "active" : ""}`} onClick={() => { const n = new Set(levels); n.has(l) ? n.delete(l) : n.add(l); if (!n.size) n.add(l); setLevels(n); }}>{l}</button>))}</div>
        <select className="input" style={{ maxWidth: 220 }} value={device} onChange={(e) => setDevice(e.target.value)}><option value="">All machines</option>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <input className="input" placeholder="Run (BIO-SYNC-…)" style={{ maxWidth: 200 }} value={runId} onChange={(e) => setRunId(e.target.value)} />
        <div className="input-group" style={{ flex: 1, minWidth: 200 }}><input className="input" placeholder="Search messages…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => download("logs_export")}><Icon name="download" /> Export CSV</button>
      </div>
      <div className="table-wrap"><table className="table"><thead><tr><th style={{ width: 170 }}>Time</th><th style={{ width: 90 }}>Level</th><th style={{ width: 200 }}>Machine</th><th>Message</th><th style={{ width: 150 }}>Run</th></tr></thead><tbody>
        {!rows ? <tr><td colSpan={5}><Loading /></td></tr> : !rows.length ? <tr><td colSpan={5}><EmptyState icon="logs" title="No log entries" text="Nothing matches these filters." /></td></tr>
          : rows.map((l) => (
            <Fragment key={l.id}>
              <tr className={l.detail ? "clickable" : ""} onClick={() => { if (!l.detail) return; const n = new Set(open); n.has(l.id) ? n.delete(l.id) : n.add(l.id); setOpen(n); }}>
                <td className="nowrap small">{fmtDate(l.ts, true)}</td><td><LevelBadge level={l.level} /></td><td className="small">{l.device}</td>
                <td className="log-msg">{l.message} {l.detail && <span className="muted tiny"><Icon name="chevronDown" />details</span>}</td>
                <td className="small">{l.run_id && <a href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openRun(l.run_id); }}>{l.run_id.replace("BIO-SYNC-", "#")}</a>}</td>
              </tr>
              {open.has(l.id) && <tr className="detail-row"><td colSpan={5}><pre>{l.detail}</pre>
                <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(`${l.message}\n\n${l.detail}`).then(() => toast("Copied", "success", "", 1500))}><Icon name="copy" /> Copy</button></td></tr>}
            </Fragment>))}
      </tbody></table></div>
      <div className="row" style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
        <span className="muted small">{rows ? `Showing ${fmtNum(rows.length)} of ${fmtNum(total)}` : ""}</span><span className="spacer" />
        {rows && rows.length < total && <button className="btn btn-sm" onClick={() => load(true)}>Load more</button>}
      </div>
    </div>
  );
}
