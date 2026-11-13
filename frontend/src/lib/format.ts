/* Formatting helpers (same output as the standalone tool). */

export const fmtNum = (n: any) => Number(n || 0).toLocaleString();

export function fmtDuration(s: number | null | undefined) {
  if (s == null || isNaN(s)) return "—";
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return `${m}m ${String(sec).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

export const parseTs = (ts?: string | null) => (ts ? new Date(String(ts).replace(" ", "T")) : null);

export function fmtDate(ts?: string | null, withSeconds = false) {
  const d = parseTs(ts);
  if (!d || isNaN(+d)) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) });
}
export function fmtTime(ts?: string | null) {
  const d = parseTs(ts);
  return d && !isNaN(+d) ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
}
export function fmtDay(ts?: string | null) {
  const d = parseTs(ts);
  return d && !isNaN(+d) ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—";
}
export function fmtRelative(ts?: string | null) {
  const d = parseTs(ts);
  if (!d || isNaN(+d)) return "never";
  const diff = (Date.now() - d.getTime()) / 1000, fut = diff < 0, a = Math.abs(diff);
  let out: string;
  if (a < 45) return "just now";
  else if (a < 3600) out = `${Math.round(a / 60)} min`;
  else if (a < 86400) out = `${Math.round(a / 3600)} h`;
  else out = `${Math.round(a / 86400)} d`;
  return fut ? `in ${out}` : `${out} ago`;
}
export function todayStr(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const triggerLabel = (t: string) => ({ manual: "Manual", scheduled: "Scheduled", schedule: "Scheduled" } as Record<string, string>)[t] || t;

export const REASONS: Record<string, string> = {
  duplicate: "Already in ERPNext",
  unknown_employee: "No employee with this ID",
  skipped: "Skipped",
  erp_error: "Could not create the check-in",
};
export const reasonLabel = (r?: string | null) => (r ? REASONS[r] || r : "");

export const MODE_LABEL: Record<string, string> = {
  "Device Punch State": "From the machine's punch key",
  "Always IN": "Always IN",
  "Always OUT": "Always OUT",
  "Alternate IN/OUT": "Alternate IN / OUT",
  "Leave Blank": "Not set (ERPNext decides)",
};

export const throttle = <A extends any[]>(fn: (...a: A) => void, ms: number) => {
  let t = 0;
  return (...a: A) => { const now = Date.now(); if (now - t >= ms) { t = now; fn(...a); } };
};
