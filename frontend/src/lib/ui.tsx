/* Shared UI pieces, built on the standalone tool's CSS classes. */
import { ReactNode, useEffect, useRef, useState } from "react";
import { ICONS } from "./icons-data";
import { fmtNum } from "./format";

export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] || ICONS.info }} />
  );
}

const STATUS: Record<string, [string, string, string]> = {
  success: ["success", "checkCircle", "Success"], partial: ["warning", "alert", "Partial"], failed: ["danger", "xCircle", "Failed"],
  cancelled: ["", "stop", "Cancelled"], running: ["primary", "loader", "Running"], queued: ["", "clock", "Queued"],
  done: ["success", "checkCircle", "Done"],
  online: ["success", "wifi", "Online"], offline: ["danger", "wifiOff", "Offline"], error: ["danger", "xCircle", "Error"], unknown: ["", "help", "Not tested"],
  pending: ["info", "clock", "Pending"], synced: ["success", "checkCircle", "Synced"], skipped: ["", "skip", "Skipped"], retrying: ["warning", "refresh", "Retrying"],
};

export function StatusBadge({ status, text }: { status: string; text?: string }) {
  const [cls, ic, label] = STATUS[status] || ["", "info", status];
  return <span className={`badge ${cls}`}><Icon name={ic} className={ic === "loader" ? "spin" : ""} />{text || label}</span>;
}

export function PunchBadge({ p }: { p: any }) {
  if (p.sync_status === "synced" && p.reason === "duplicate") return <StatusBadge status="synced" text="Already there" />;
  return <StatusBadge status={p.sync_status} />;
}

export const LevelBadge = ({ level }: { level: string }) => <span className={`lv lv-${level}`}>{level}</span>;

export function EmptyState({ icon, title, text, children }: { icon: string; title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty"><Icon name={icon} /><div className="t">{title}</div>{text && <div>{text}</div>}{children && <div className="mt-2">{children}</div>}</div>
  );
}

export function Switch({ checked, onChange, label, sub, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; sub?: string; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label && <span className="txt"><span>{label}</span>{sub && <small>{sub}</small>}</span>}
    </label>
  );
}

export function Loading({ text = "Loading…" }: { text?: string }) {
  return <div className="muted"><Icon name="loader" className="spin" /> {text}</div>;
}

/** Button that shows a spinner while its async onClick runs. */
export function BusyButton({ onClick, busyText = "Working…", className = "btn", children, disabled, title }: {
  onClick: () => Promise<any> | void; busyText?: string; className?: string; children: ReactNode; disabled?: boolean; title?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button className={className} disabled={busy || disabled} title={title} type="button"
      onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}>
      {busy ? <><Icon name="loader" className="spin" /> {busyText}</> : children}
    </button>
  );
}

export function Stat({ icon, tone = "", label, value, meta }: { icon: string; tone?: string; label: string; value: ReactNode; meta?: ReactNode }) {
  return (
    <div className="card stat"><div className={`stat-icon ${tone}`}><Icon name={icon} /></div>
      <div><div className="label">{label}</div><div className="value">{value}</div>{meta && <div className="meta">{meta}</div>}</div></div>
  );
}

export const N = ({ v }: { v: any }) => <>{fmtNum(v)}</>;

/* ---------------------------------------------------------------- toasts */
type Toast = { id: number; message: string; type: string; title?: string };
let toastListeners: ((t: Toast[]) => void)[] = [];
let toasts: Toast[] = [];
let toastSeq = 0;
const emitToasts = () => toastListeners.forEach((f) => f([...toasts]));

export function toast(message: string, type: "info" | "success" | "warning" | "error" = "info", title = "", ms = 5000) {
  const t = { id: ++toastSeq, message, type, title };
  toasts.push(t);
  emitToasts();
  if (ms) setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); emitToasts(); }, type === "error" ? ms * 2 : ms);
}
export const toastError = (e: any, title = "Error") => toast(e?.message || String(e), "error", title);

export function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => { toastListeners.push(setList); return () => { toastListeners = toastListeners.filter((f) => f !== setList); }; }, []);
  const ic: Record<string, string> = { success: "checkCircle", error: "xCircle", warning: "alert", info: "info" };
  return (
    <div id="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <Icon name={ic[t.type] || "info"} />
          <div>{t.title && <div className="t">{t.title}</div>}<div>{t.message}</div></div>
          <button className="x" aria-label="Close" onClick={() => { toasts = toasts.filter((x) => x.id !== t.id); emitToasts(); }}>&times;</button>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- modals */
export function Modal({ title, icon, size = "", onClose, children, foot }: {
  title: ReactNode; icon?: string; size?: string; onClose: () => void; children: ReactNode; foot?: ReactNode;
}) {
  const down = useRef(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { down.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => { if (down.current && e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          {icon && <span className="stat-icon" style={{ width: 34, height: 34 }}><Icon name={icon} /></span>}
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

/* imperative confirm / prompt dialogs */
type Dialog = { id: number; kind: "confirm" | "prompt"; title: string; message?: ReactNode; label?: string; hint?: string; value?: string;
  type?: string; confirm?: string; danger?: boolean; resolve: (v: any) => void };
let dialogListener: ((d: Dialog | null) => void) | null = null;
let dialogSeq = 0;

export function confirmDialog(o: { title?: string; message?: ReactNode; confirm?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => dialogListener?.({ id: ++dialogSeq, kind: "confirm", title: o.title || "Are you sure?", ...o, resolve }));
}
export function promptDialog(o: { title: string; label: string; value?: string; type?: string; hint?: string; confirm?: string }): Promise<string | null> {
  return new Promise((resolve) => dialogListener?.({ id: ++dialogSeq, kind: "prompt", ...o, resolve }));
}

export function Dialogs() {
  const [d, setD] = useState<Dialog | null>(null);
  const [val, setVal] = useState("");
  useEffect(() => { dialogListener = (x) => { setD(x); setVal(x?.value || ""); }; return () => { dialogListener = null; }; }, []);
  if (!d) return null;
  const done = (v: any) => { d.resolve(v); setD(null); };
  return (
    <Modal title={d.title} icon={d.kind === "confirm" ? (d.danger ? "alert" : "help") : "edit"} onClose={() => done(d.kind === "confirm" ? false : null)}
      foot={<>
        <button className="btn" onClick={() => done(d.kind === "confirm" ? false : null)}>Cancel</button>
        <button className={`btn ${d.danger ? "btn-danger" : "btn-primary"}`} onClick={() => done(d.kind === "confirm" ? true : val)}>{d.confirm || "OK"}</button>
      </>}>
      {d.kind === "confirm" ? <div>{d.message}</div> : (
        <form onSubmit={(e) => { e.preventDefault(); done(val); }}>
          <div className="field"><label>{d.label}</label><input className="input" autoFocus type={d.type || "text"} value={val} onChange={(e) => setVal(e.target.value)} />
            {d.hint && <div className="hint">{d.hint}</div>}</div>
        </form>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- polling */
export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms == null) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}
