/* Details of one sync run (Biometric Sync Log). */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { get } from "../lib/api";
import { fmtDate, fmtDuration, fmtNum, triggerLabel } from "../lib/format";
import { Icon, Loading, Modal, StatusBadge, toastError } from "../lib/ui";

export function RunDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  useEffect(() => { get("run", { name: id }).then(setD).catch((e) => { toastError(e); onClose(); }); }, [id, onClose]);
  const r = d?.run;
  return (
    <Modal title={`Sync run ${id}`} icon="history" size="xwide" onClose={onClose}
      foot={<>
        <a className="btn" href={`/app/biometric-sync-log/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer"><Icon name="external" /> Open in desk</a>
        <button className="btn" onClick={() => { onClose(); nav(`/punches/run/${encodeURIComponent(id)}`); }}><Icon name="list" /> Punches of this run</button>
        <button className="btn btn-primary" onClick={onClose}>Close</button></>}>
      {!r ? <Loading /> : <>
        <div className="row mb-3" style={{ gap: 18 }}>
          <StatusBadge status={r.status} />
          <span className="small"><Icon name="clock" /> {fmtDate(r.started_at, true)} → {r.finished_at ? fmtDate(r.finished_at, true) : "running"}</span>
          <span className="small">{triggerLabel(r.trigger)}</span>
          <span className="small"><b>{r.device_name}</b></span>
        </div>
        <div className="grid grid-4 mb-3">
          {[["Read from machine", r.fetched], ["New punches", r.new_punches], ["Check-ins created", r.pushed], ["Duplicates", r.duplicates],
            ["Unmatched (no employee)", r.unmatched], ["Double punches", r.double_punches], ["Skipped / out of range", r.skipped], ["Failed", r.failed]].map(([l, v]) => (
            <div key={l as string} className="card" style={{ padding: "12px 16px" }}><div className="label muted small">{l}</div><div style={{ fontSize: 22, fontWeight: 700 }} className={l === "Failed" && v ? "st-failed" : ""}>{fmtNum(v)}</div></div>
          ))}
        </div>
        <div className="kv mb-3">
          <div>Duration</div><div>{fmtDuration(r.duration)}</div>
          <div>Window read</div><div>{r.from_date ? fmtDate(r.from_date) : "—"} → {r.to_date ? fmtDate(r.to_date) : "now"}</div>
          <div>Punch status now</div><div>{Object.entries(d.breakdown || {}).map(([k, v]) => `${k}: ${fmtNum(v)}`).join(" · ") || "—"}</div>
        </div>
        {r.summary && <><h3 className="mb-1">Message</h3><pre className="live-log" style={{ maxHeight: 280, borderRadius: 10, whiteSpace: "pre-wrap" }}>{r.summary}</pre></>}
      </>}
    </Modal>
  );
}
