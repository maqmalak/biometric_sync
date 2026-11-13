import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./styles/app.css";
import "./styles/console.css";
import App from "./App";
import { get, login, logout, post } from "./lib/api";
import { StoreProvider, type Boot } from "./lib/store";
import { Icon } from "./lib/ui";

function Root() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [state, setState] = useState<"loading" | "login" | "error">("loading");
  const [err, setErr] = useState("");

  const load = async () => {
    setState("loading");
    try { const b = await get<Boot>("boot"); window.__bsLoggedIn = true; setBoot(b); }
    catch (e: any) {
      if (e.status === 401 || e.status === 403) {
        // on the site itself use Frappe's login page; on the dev server log in here
        if (location.port !== "5183") { location.href = "/login?redirect-to=" + encodeURIComponent("/biometric"); return; }
        setState("login");
      } else { setErr(e.message); setState("error"); }
    }
  };
  useEffect(() => { load(); }, []);

  if (boot?.locked) return <Unlock onDone={load} who={boot.full_name} />;
  if (boot) return <StoreProvider boot={boot}><App /></StoreProvider>;
  if (state === "login") return <Login onDone={load} />;
  if (state === "error") return (
    <div className="login-wrap"><div className="card login-card"><div className="alert danger"><Icon name="xCircle" />
      <div><div className="t">Biometric Sync is not reachable</div>{err}<div className="mt-2"><button className="btn btn-sm" onClick={load}><Icon name="refresh" /> Retry</button></div></div></div></div></div>
  );
  return <div className="login-wrap"><div className="muted"><Icon name="loader" className="spin" /> Loading…</div></div>;
}

function Unlock({ onDone, who }: { onDone: () => void; who: string }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-wrap"><div className="card login-card">
      <div className="brand"><div className="brand-logo"><Icon name="lock" /></div><div><div className="brand-name">Biometric Sync is locked</div><div className="brand-sub">Enter the console password to continue · {who}</div></div></div>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { await post("unlock", { password: pwd }); onDone(); } catch (x: any) { setErr(x.message); setBusy(false); } }}>
        <div className="field"><label>Console password</label><input className="input" type="password" autoComplete="current-password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus required /></div>
        {err && <div className="alert danger"><Icon name="xCircle" /><div>{err}</div></div>}
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy}><Icon name="lock" /> {busy ? "Checking…" : "Unlock"}</button>
        <button className="btn btn-ghost" type="button" onClick={async () => { await logout(); location.reload(); }}>Log in as another user</button>
      </form>
    </div></div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [usr, setUsr] = useState("");
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-wrap"><div className="card login-card">
      <div className="brand"><div className="brand-logo"><Icon name="fingerprint" /></div><div><div className="brand-name">Biometric Sync</div><div className="brand-sub">Log in with your ERPNext account</div></div></div>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { await login(usr, pwd); onDone(); } catch (x: any) { setErr(x.message); setBusy(false); } }}>
        <div className="field"><label>User</label><input className="input" value={usr} onChange={(e) => setUsr(e.target.value)} autoFocus required /></div>
        <div className="field"><label>Password</label><input className="input" type="password" autoComplete="current-password" value={pwd} onChange={(e) => setPwd(e.target.value)} required /></div>
        {err && <div className="alert danger"><Icon name="xCircle" /><div>{err}</div></div>}
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy}><Icon name="lock" /> {busy ? "Checking…" : "Log in"}</button>
      </form>
    </div></div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><HashRouter><Root /></HashRouter></StrictMode>);
