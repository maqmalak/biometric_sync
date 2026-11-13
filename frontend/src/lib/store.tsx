/* App-wide state: boot info, active syncs (polled), failed-punch badge, theme. */
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { get } from "./api";
import { useInterval } from "./ui";

export type Boot = { locked?: boolean; user: string; full_name: string; can_write: boolean; version: string; site: string; scheduler: boolean };
export type Run = {
  id: string; device: string; device_name: string; trigger: string; status: string; started_at: string; finished_at: string | null;
  duration: number | null; fetched: number; new_punches: number; duplicates: number; pushed: number; unmatched: number; skipped: number;
  double_punches: number; failed: number; summary: string | null;
};
export type Active = { running: Run[]; queued: { device: string; device_name: string }[]; recent: Run[] };

type Ctx = {
  boot: Boot;
  active: Active;
  failed: number;
  refreshActive: () => Promise<void>;
  refreshFailed: () => Promise<void>;
  /** bumps after a sync finishes, so pages can reload */
  tick: number;
  theme: string;
  toggleTheme: () => void;
};

const StoreCtx = createContext<Ctx | null>(null);
export const useStore = () => useContext(StoreCtx)!;

export function StoreProvider({ boot, children }: { boot: Boot; children: ReactNode }) {
  const [active, setActive] = useState<Active>({ running: [], queued: [], recent: [] });
  const [failed, setFailed] = useState(0);
  const [tick, setTick] = useState(0);
  const [theme, setTheme] = useState(document.documentElement.getAttribute("data-theme") || "light");

  const refreshActive = useCallback(async () => {
    try {
      const a = await get<Active>("active");
      setActive((prev) => {
        const wasBusy = prev.running.length + prev.queued.length;
        if (wasBusy && !(a.running.length + a.queued.length)) setTick((t) => t + 1);
        return a;
      });
    } catch { /* offline: keep the last state */ }
  }, []);
  const refreshFailed = useCallback(async () => {
    try { const r = await get("punches", { limit: 1, status: "failed" }); setFailed(r.counts.failed || 0); } catch { /* ignore */ }
  }, []);

  useEffect(() => { refreshActive(); refreshFailed(); }, [refreshActive, refreshFailed]);
  useEffect(() => { refreshFailed(); }, [tick, refreshFailed]);
  const busy = active.running.length + active.queued.length > 0;
  useInterval(refreshActive, busy ? 2500 : 15000);

  const toggleTheme = () => {
    const t = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("bas-theme", t); } catch { /* ignore */ }
    setTheme(t);
    window.dispatchEvent(new Event("bs-theme"));
  };

  return (
    <StoreCtx.Provider value={{ boot, active, failed, refreshActive, refreshFailed, tick, theme, toggleTheme }}>
      {children}
    </StoreCtx.Provider>
  );
}
