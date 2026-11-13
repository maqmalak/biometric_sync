/* "Sync attendance": read machines now (optionally a date range), or only reprocess waiting punches. */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { get, post } from "../lib/api";
import { fmtNum } from "../lib/format";
import { useStore } from "../lib/store";
import { PULL, type Device } from "../lib/types";
import { Icon, Loading, Modal, StatusBadge, toast, toastError } from "../lib/ui";

export type SyncPreset = { deviceIds?: string[]; resync?: boolean; from?: string; to?: string };

export function SyncDialog({ preset = {}, onClose }: { preset?: SyncPreset; onClose: () => void }) {
  const nav = useNavigate();
  const { refreshActive } = useStore();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [mode, setMode] = useState<"full" | "push">("full");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState(preset.from || "");
  const [to, setTo] = useState(preset.to || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<Device[]>("devices").then((d) => {
      const pull = d.filter((x) => PULL.includes(x.protocol));
      setDevices(pull);
      setSel(new Set(preset.deviceIds || pull.filter((x) => x.enabled).map((x) => x.id)));
    }).catch(toastError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = (devices || []).reduce((a, d) => a + d.stats.pending + d.stats.failed, 0);
  const go = async () => {
    if (mode === "full" && !sel.size) return toast("Select at least one machine.", "warning");
    setBusy(true);
    try {
      if (mode === "push") {
        const r = await post("start_sync", { push_only: 1 });
        toast(`${fmtNum(r.reprocess?.count || 0)} waiting punch(es) are being processed.`, "success");
      } else {
        const r = await post("start_sync", { devices: [...sel], from_date: from ? `${from} 00:00:00` : null, to_date: to ? `${to} 23:59:59` : null });
        toast(r.busy?.length ? `Started. Already running: ${r.busy.join(", ")}` : "The sync has started.", "success");
      }
      onClose();
      await refreshActive();
      nav("/progress");
    } catch (e) { toastError(e, "Could not start the sync"); setBusy(false); }
  };

  return (
    <Modal title="Sync attendance" icon="refresh" size="wide" onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={go}>{busy ? <><Icon name="loader" className="spin" /> Starting…</> : <><Icon name="refresh" /> Start sync</>}</button></>}>
      {!devices ? <Loading /> : !devices.length ? (
        <div className="alert info"><Icon name="info" /><div>Add a biometric machine first (Machines → Add machine).</div></div>
      ) : <>
        <div className="field mb-3"><label>What to do</label>
          <div className="radio-cards">
            <label className={`radio-card ${mode === "full" ? "active" : ""}`}><input type="radio" checked={mode === "full"} onChange={() => setMode("full")} />
              <div><div className="t"><Icon name="download" /> Read machines &amp; create check-ins</div><div className="d">Reads new punches from the selected machines, stores them as Biometric Logs and creates the Employee Checkins.</div></div></label>
            <label className={`radio-card ${mode === "push" ? "active" : ""}`}><input type="radio" checked={mode === "push"} onChange={() => setMode("push")} />
              <div><div className="t"><Icon name="send" /> Only process waiting punches</div><div className="d">Does not contact the machines. Matches the {fmtNum(pending)} waiting or failed punch(es) to employees again.</div></div></label>
          </div>
        </div>
        {mode === "full" && <>
          <div className="row mb-1"><span className="label">Machines</span><span className="spacer" />
            <button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set(devices.map((d) => d.id)))}>Select all</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>Select none</button></div>
          <div className="tree">{devices.map((d) => (
            <label key={d.id} className="tree-row srv" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={sel.has(d.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(d.id) : n.delete(d.id); setSel(n); }} />
              <span className="n truncate"><Icon name="fingerprint" /> {d.name} <span className="muted small">{d.ip}</span> {!d.enabled && <span className="badge outline">disabled</span>}</span>
              <span className="small"><StatusBadge status={d.status} />{d.stats.pending ? <> <span className="badge info">{fmtNum(d.stats.pending)} pending</span></> : null}</span>
            </label>))}
          </div>
          <details className="mt-3" open={preset.resync}>
            <summary className="strong small" style={{ cursor: "pointer" }}><Icon name="history" /> Read a date range again (advanced)</summary>
            <div className="hint mt-1">Reads the punches of this period from the machines again, e.g. after check-ins were deleted. Punches already stored are recognised as duplicates, so nothing is created twice. Empty = since the last sync.</div>
            <div className="form-grid mt-2">
              <div className="field"><label>From</label><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="field"><label>To</label><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          </details>
        </>}
      </>}
    </Modal>
  );
}
