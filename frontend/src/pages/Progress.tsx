/* Live progress: syncs running now (Biometric Sync Log "In Progress"), queued machines, recent runs, live log. */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../lib/api";
import { openRun, openSync } from "../lib/events";
import { fmtDuration, fmtNum, fmtTime, parseTs, triggerLabel } from "../lib/format";
import { useStore } from "../lib/store";
import { EmptyState, Icon, LevelBadge, StatusBadge, useInterval } from "../lib/ui";

export default function Progress() {
  const { active, boot, refreshActive, tick } = useStore();
  const [log, setLog] = useState<any[]>([]);
  const [, setNow] = useState(0);
  const loadLog = useCallback(async () => { try { setLog((await get("logs", { limit: 60 })).rows); } catch { /* ignore */ } }, []);
  useEffect(() => { refreshActive(); loadLog(); }, [refreshActive, loadLog, tick]);
  const busy = active.running.length + active.queued.length > 0;
  useInterval(() => { refreshActive(); loadLog(); }, busy ? 3000 : 15000);
  useInterval(() => setNow(Date.now()), busy ? 1000 : null);

  return (
    <div className="stack">
      {!busy ? (
        <div className="card"><EmptyState icon="activity" title="No sync is running"
          text="Each machine shows here while it is read: connecting, reading its punches, creating the Employee Checkins.">
          {boot.can_write && <button className="btn btn-primary btn-lg" onClick={() => openSync()}><Icon name="refresh" /> Sync Now</button>}</EmptyState></div>
      ) : (
        <div className="card run-card">
          <div className="run-head">
            <div className="stat-icon"><Icon name="activity" /></div>
            <div className="title"><h2>Syncing now</h2><div className="muted small">{active.running.length} machine(s) being read · {active.queued.length} queued</div></div>
          </div>
          <div className="run-overall">
            <div className="bar bar-lg striped"><span style={{ width: `${Math.max(8, 100 * active.running.length / (active.running.length + active.queued.length))}%` }} /></div>
          </div>
          {active.running.map((r) => (
            <div key={r.id} className="task dev">
              <div className="site"><div className="n st-running"><Icon name="loader" className="spin" /><span className="truncate" style={{ color: "var(--text)" }}>{r.device_name}</span></div>
                <div className="b">{triggerLabel(r.trigger)} · started {fmtTime(r.started_at)} · {fmtDuration((Date.now() - (parseTs(r.started_at)?.getTime() || Date.now())) / 1000)}</div></div>
              <div className="stage"><div className="label"><span><Icon name="download" /> Reading machine</span><span className="r">{r.fetched ? `${fmtNum(r.fetched)} read` : "reading…"}</span></div><div className="bar indeterminate"><span /></div></div>
              <div className="stage"><div className="label"><span><Icon name="cloud" /> Creating check-ins</span><span className="r">{r.pushed ? `${fmtNum(r.pushed)} created` : "waiting"}</span></div><div className="bar striped"><span style={{ width: r.pushed ? "60%" : "0%" }} /></div></div>
              <div className="task-actions"><StatusBadge status="running" /></div>
            </div>
          ))}
          {active.queued.map((q) => (
            <div key={q.device} className="task dev">
              <div className="site"><div className="n"><Icon name="clock" /><span className="truncate" style={{ color: "var(--text)" }}>{q.device_name}</span></div><div className="b">waiting for a worker</div></div>
              <div className="stage"><div className="label"><span><Icon name="download" /> Reading machine</span><span className="r">queued</span></div><div className="bar"><span style={{ width: 0 }} /></div></div>
              <div className="stage"><div className="label"><span><Icon name="cloud" /> Creating check-ins</span><span className="r">waiting</span></div><div className="bar"><span style={{ width: 0 }} /></div></div>
              <div className="task-actions"><StatusBadge status="queued" /></div>
            </div>
          ))}
        </div>
      )}

      {active.recent.length > 0 && (
        <div className="card">
          <div className="card-head"><h3><Icon name="history" /> Just finished</h3><Link className="btn btn-sm btn-ghost" to="/stats/history">Sync history</Link></div>
          {active.recent.slice(0, 6).map((r) => (
            <div key={r.id} className="task dev clickable" onClick={() => openRun(r.id)} style={{ cursor: "pointer" }}>
              <div className="site"><div className={`n st-${r.status}`}><Icon name={r.status === "success" ? "checkCircle" : r.status === "failed" ? "xCircle" : "alert"} /><span className="truncate" style={{ color: "var(--text)" }}>{r.device_name}</span></div>
                <div className="b">{triggerLabel(r.trigger)} · {fmtTime(r.started_at)} · {fmtDuration(r.duration)}</div></div>
              <div className="stage"><div className="label"><span><Icon name="download" /> Reading machine</span><span className="r">{r.status === "failed" && !r.fetched ? "machine not reachable" : `${fmtNum(r.fetched)} read · ${fmtNum(r.new_punches)} new`}</span></div>
                <div className={`bar ${r.status === "failed" && !r.fetched ? "failed" : "done"}`}><span style={{ width: "100%" }} /></div></div>
              <div className="stage"><div className="label"><span><Icon name="cloud" /> Creating check-ins</span><span className="r">{fmtNum(r.pushed)} created{r.duplicates ? ` · ${fmtNum(r.duplicates)} duplicates` : ""}{r.unmatched ? ` · ${fmtNum(r.unmatched)} unmatched` : ""}</span></div>
                <div className={`bar ${r.failed ? "" : "done"}`}><span style={{ width: "100%" }} /></div></div>
              <div className="task-actions"><StatusBadge status={r.status} /></div>
              {r.status === "failed" && r.summary && <div className="msg err"><Icon name="alert" /> {r.summary.split("\n")[0]}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head"><h3><Icon name="terminal" /> Live activity log</h3><Link className="btn btn-sm btn-ghost" to="/logs">Open full logs</Link></div>
        <div className="live-log">
          {log.length ? log.slice().reverse().map((l) => (
            <div key={l.id} className="l"><span className="ts">{fmtTime(l.ts)}</span><LevelBadge level={l.level} /><span>{l.device && <b>{l.device} </b>}{l.message}</span></div>
          )) : <div className="muted">Waiting for activity…</div>}
        </div>
      </div>
    </div>
  );
}
