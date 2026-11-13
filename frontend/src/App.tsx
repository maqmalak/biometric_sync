/* App shell (sidebar, top bar, routes) — same layout as the standalone tool. */
import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SyncDialog, type SyncPreset } from "./components/SyncDialog";
import { RunDialog } from "./components/RunDialog";
import { DeviceEditor } from "./pages/Machines";
import { logout } from "./lib/api";
import { openSync } from "./lib/events";
import { useStore } from "./lib/store";
import { Dialogs, Icon, Toasts } from "./lib/ui";
import Dashboard from "./pages/Dashboard";
import Machines from "./pages/Machines";
import Progress from "./pages/Progress";
import Display from "./pages/Display";
import Punches from "./pages/Punches";
import Employees from "./pages/Employees";
import Logs from "./pages/Logs";
import Stats from "./pages/Stats";
import Settings from "./pages/Settings";
import Help from "./pages/Help";

const NAV: ({ id: string; label: string; icon: string } | { section: string })[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "devices", label: "Machines", icon: "fingerprint" },
  { id: "progress", label: "Live Progress", icon: "activity" },
  { id: "display", label: "Check-in Display", icon: "monitor" },
  { id: "punches", label: "Punches", icon: "list" },
  { id: "employees", label: "Employee Mapping", icon: "users" },
  { id: "logs", label: "Logs", icon: "logs" },
  { id: "stats", label: "Statistics", icon: "chart" },
  { section: "System" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "help", label: "Help & Guide", icon: "help" },
];
const TITLES: Record<string, string> = Object.fromEntries(NAV.filter((n): n is { id: string; label: string; icon: string } => "id" in n).map((n) => [n.id, n.label]));

export default function App() {
  const { boot, active, failed, theme, toggleTheme } = useStore();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const [sync, setSync] = useState<SyncPreset | null>(null);
  const [run, setRun] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ device: any; prefill: any } | null>(null);
  const page = loc.pathname.split("/")[1] || "dashboard";
  const title = TITLES[page] || "Dashboard";

  useEffect(() => { document.title = `${title} · Biometric Sync`; setMenu(false); window.scrollTo(0, 0); }, [title, loc.pathname]);
  useEffect(() => {
    const s = (e: Event) => setSync((e as CustomEvent).detail || {});
    const r = (e: Event) => setRun((e as CustomEvent).detail);
    const d = (e: Event) => setEditor((e as CustomEvent).detail);
    window.addEventListener("bs-sync", s); window.addEventListener("bs-run", r); window.addEventListener("bs-device", d);
    return () => { window.removeEventListener("bs-sync", s); window.removeEventListener("bs-run", r); window.removeEventListener("bs-device", d); };
  }, []);

  const busy = active.running.length + active.queued.length;
  const kiosk = page === "display" && loc.pathname.includes("kiosk");

  return (
    <>
      <div className={`app ${kiosk ? "kiosk-app" : ""}`}>
        <aside className={`sidebar ${menu ? "open" : ""}`}>
          <div className="brand">
            <div className="brand-logo"><Icon name="fingerprint" /></div>
            <div><div className="brand-name">Attendance Sync</div><div className="brand-sub">Biometric → ERPNext</div></div>
          </div>
          <nav className="nav">
            {NAV.map((n, i) => "section" in n ? <div key={i} className="nav-label">{n.section}</div> : (
              <NavLink key={n.id} to={`/${n.id}`} className={() => (page === n.id ? "active" : "")}>
                <Icon name={n.icon} /><span>{n.label}</span>
                {n.id === "progress" && busy > 0 && <span className="badge-dot" />}
                {n.id === "punches" && failed > 0 && <span className="nav-count" title={`${failed} punch(es) failed and need attention`}>{failed > 999 ? "999+" : failed}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-foot">
            <span className="ver">v{boot.version} · {boot.site}</span>
            <button className="icon-btn" title="Toggle dark mode" onClick={toggleTheme}><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
            <a className="icon-btn" title="Open ERPNext desk" href="/app/biometric-sync"><Icon name="external" /></a>
            <button className="icon-btn" title={`Log out ${boot.full_name}`} onClick={async () => { await logout(); location.reload(); }}><Icon name="logout" /></button>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="icon-btn menu-btn" aria-label="Menu" onClick={() => setMenu(!menu)}><Icon name="menu" /></button>
            <h1>{title}</h1>
            <NavLink to="/progress" className={`status-pill ${busy ? "running" : ""}`}>
              <span className="dot" /><span className="t">{busy ? `Syncing ${busy} machine${busy === 1 ? "" : "s"}…` : boot.scheduler ? "Idle" : "Scheduler off"}</span>
            </NavLink>
            {boot.can_write && <button className="btn btn-primary" onClick={() => openSync()}><Icon name="refresh" /> <span>Sync Now</span></button>}
          </header>
          <div className="view">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/devices" element={<Machines />} />
              <Route path="/progress" element={<Progress />} />
              <Route path="/display/*" element={<Display />} />
              <Route path="/punches/*" element={<Punches />} />
              <Route path="/employees" element={<Employees />} />
              <Route path="/logs/*" element={<Logs />} />
              <Route path="/stats/*" element={<Stats />} />
              <Route path="/settings/*" element={<Settings />} />
              <Route path="/help" element={<Help />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </div>
      </div>
      {sync && <SyncDialog preset={sync} onClose={() => setSync(null)} />}
      {run && <RunDialog id={run} onClose={() => setRun(null)} />}
      {editor && <DeviceEditor device={editor.device} prefill={editor.prefill} onClose={() => setEditor(null)} />}
      <Dialogs />
      <Toasts />
    </>
  );
}
