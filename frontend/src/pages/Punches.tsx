/* Punches: every punch read from the machines (Biometric Log) and whether it became an Employee Checkin. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { download, get, post } from "../lib/api";
import { fmtDay, fmtNum, fmtRelative, reasonLabel } from "../lib/format";
import { useStore } from "../lib/store";
import type { Device } from "../lib/types";
import { confirmDialog, EmptyState, Icon, Loading, PunchBadge, toast, toastError } from "../lib/ui";

const LIMIT = 100;

export default function Punches() {
  const { boot, tick, refreshFailed } = useStore();
  const args = useLocation().pathname.split("/").slice(2).map(decodeURIComponent);
  const initial = useMemo(() => ({
    status: ["pending", "synced", "skipped", "failed"].includes(args[0]) ? args[0] : "",
    device: args[0] === "device" ? args[1] || "" : "", user_id: args[0] === "user" ? args[1] || "" : "",
    run: args[0] === "run" ? args[1] || "" : "", q: "", date_from: "", date_to: "", reason: "",
  }), [args.join("/")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(initial);
  useEffect(() => { setF(initial); setOffset(0); }, [initial]);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<any>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [qInput, setQInput] = useState("");
  useEffect(() => { get<Device[]>("devices").then(setDevices).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => { setF((x) => ({ ...x, q: qInput, user_id: qInput ? "" : x.user_id })); setOffset(0); }, 300); return () => clearTimeout(t); }, [qInput]);

  const filters = () => ({ status: f.status, device: f.device, q: f.q, date_from: f.date_from, date_to: f.date_to, reason: f.reason, user_id: f.user_id, run: f.run });
  const load = useCallback(async () => {
    try { setData(await get("punches", { ...filters(), limit: LIMIT, offset })); } catch (e) { toastError(e); }
  }, [f, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); load(); }, [load, tick]);
  const upd = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setOffset(0); };

  const act = async (method: string, payload: any, label: string) => {
    try { const r = await post(method, payload); toast(`${fmtNum(r.count)} punch(es) ${label}.`, "success"); setSel(new Set()); load(); refreshFailed(); } catch (e) { toastError(e); }
  };
  const counts = data?.counts || {};
  const total = Object.values(counts).reduce((a: number, v: any) => a + v, 0);
  const chips: [string, string, string, number][] = [["", "list", "All", total], ["pending", "clock", "Pending", counts.pending || 0], ["synced", "checkCircle", "Synced", counts.synced || 0],
    ["skipped", "skip", "Skipped", counts.skipped || 0], ["failed", "xCircle", "Failed", counts.failed || 0]];
  const rows: any[] = data?.rows || [];

  return (
    <div className="stack">
      <div className="status-chips">{chips.map(([v, ic, l, n]) => (
        <button key={v} className={f.status === v ? "active" : ""} onClick={() => upd("status", v)}><Icon name={ic} /> {l} <span className={`n ${v === "failed" && n ? "st-failed" : ""}`}>{fmtNum(n)}</span></button>))}
      </div>
      {(f.run || f.user_id) && <div className="alert info"><Icon name="filter" /><div style={{ flex: 1 }}>Showing only {f.run ? <>punches of sync run <b className="mono">{f.run}</b></> : <>machine user <b className="mono">{f.user_id}</b></>}.</div>
        <button className="btn btn-sm" onClick={() => { upd("run", ""); upd("user_id", ""); }}>Show all</button></div>}
      <div className="card">
        <div className="filters">
          <select className="input" style={{ maxWidth: 220 }} value={f.device} onChange={(e) => upd("device", e.target.value)}><option value="">All machines</option>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <input className="input" type="date" style={{ maxWidth: 160 }} title="From date" value={f.date_from} onChange={(e) => upd("date_from", e.target.value)} />
          <input className="input" type="date" style={{ maxWidth: 160 }} title="To date" value={f.date_to} onChange={(e) => upd("date_to", e.target.value)} />
          <select className="input" style={{ maxWidth: 230 }} value={f.reason} onChange={(e) => upd("reason", e.target.value)}><option value="">Any reason</option>
            {(data?.reasons || []).map((r: any) => <option key={r.reason} value={r.reason}>{reasonLabel(r.reason)} ({fmtNum(r.n)})</option>)}</select>
          <div className="input-group" style={{ flex: 1, minWidth: 200 }}><input className="input" placeholder="Search user ID, employee, check-in, error…" value={qInput} onChange={(e) => setQInput(e.target.value)} /></div>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => download("punches_export", filters())}><Icon name="download" /> Export CSV</button>
        </div>
        {sel.size > 0 && boot.can_write && (
          <div className="row" style={{ padding: "10px 20px", background: "var(--primary-soft)", borderBottom: "1px solid var(--border)" }}>
            <span className="strong small">{sel.size} punch(es) selected</span><span className="spacer" />
            <button className="btn btn-sm" onClick={() => act("reprocess", { ids: [...sel] }, "queued again")}><Icon name="refresh" /> Retry selected</button>
            <button className="btn btn-sm" onClick={async () => { if (await confirmDialog({ title: "Skip these punches?", message: `${sel.size} punch(es) will not become check-ins. You can retry them later.`, confirm: "Skip" })) act("skip", { ids: [...sel] }, "skipped"); }}><Icon name="skip" /> Skip selected</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>Clear selection</button>
          </div>
        )}
        <div className="table-wrap"><table className="table">
          <thead><tr><th className="cb"><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && rows.every((r) => sel.has(r.id))}
            onChange={(e) => { const n = new Set(sel); rows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); setSel(n); }} /></th>
            <th>Punch time</th><th>User ID</th><th>Employee</th><th>Machine</th><th>Type</th><th>Status</th><th>Details</th><th>ERPNext check-in</th></tr></thead>
          <tbody>
            {!data ? <tr><td colSpan={9}><Loading /></td></tr> : rows.length ? rows.map((p) => (
              <tr key={p.id}>
                <td className="cb"><input type="checkbox" checked={sel.has(p.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(p.id) : n.delete(p.id); setSel(n); }} /></td>
                <td className="nowrap"><div className="strong">{p.ts.slice(11, 19)}</div><div className="tiny muted">{fmtDay(p.ts)}</div></td>
                <td className="mono strong"><a href="#" title="Show only this user" onClick={(e) => { e.preventDefault(); setQInput(""); upd("user_id", p.user_id); }}>{p.user_id}</a></td>
                <td className="small">{p.employee_id ? <>{p.employee_name}<div className="tiny muted">{p.employee_id}</div></> : <span className="muted">—</span>}</td>
                <td className="small">{p.device_name}</td>
                <td>{p.log_type ? <span className={`badge ${p.log_type === "IN" ? "success" : "info"}`}>{p.log_type}</span> : <span className="muted tiny">key {p.punch ?? ""}</span>}</td>
                <td><PunchBadge p={p} /></td>
                <td className="small" style={{ maxWidth: 300 }}>{p.reason && <div className={p.sync_status === "failed" ? "st-failed" : ""}>{reasonLabel(p.reason)}</div>}
                  {p.last_error && p.reason !== "duplicate" && <div className="tiny muted truncate" title={p.last_error}>{p.last_error}</div>}</td>
                <td className="small mono">{p.erp_name ? <a href={`/app/employee-checkin/${p.erp_name}`} target="_blank" rel="noreferrer">{p.erp_name}</a> : ""}
                  {p.synced_at && p.sync_status === "synced" && <div className="tiny muted">{fmtRelative(p.synced_at)}</div>}</td>
              </tr>)) : <tr><td colSpan={9}><EmptyState icon="list" title="No punches" text="Nothing matches these filters. Punches appear here after the machines have been read." /></td></tr>}
          </tbody></table></div>
        <div className="pager"><span className="muted small">{data?.total ? `${fmtNum(offset + 1)}–${fmtNum(Math.min(offset + LIMIT, data.total))} of ${fmtNum(data.total)}` : ""}</span><span className="spacer" />
          {boot.can_write && (["failed", "skipped", "pending"].includes(f.status) || f.reason) && <button className="btn btn-sm" title="Queue every matching punch that is not synced"
            onClick={async () => { if (await confirmDialog({ title: "Retry all matching punches?", message: `All ${fmtNum(data?.total)} matching punch(es) that are not synced will be matched to employees again.`, confirm: "Retry all" })) act("reprocess", filters(), "queued again"); }}>
            <Icon name="refresh" /> Retry all matching</button>}
          <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>‹ Newer</button>
          <button className="btn btn-sm" disabled={!data || offset + LIMIT >= data.total} onClick={() => setOffset(offset + LIMIT)}>Older ›</button></div>
      </div>
    </div>
  );
}
