/* Check-in Display: the live gate board (served by the site at /checkin-display; same screen as the standalone tool),
   with the live capture service's controls on top: punches reach the board within seconds while it runs. */
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { call } from "../lib/api";
import { BusyButton, confirmDialog, Icon, toast, toastError, useInterval } from "../lib/ui";

type LiveMachine = { name: string; label: string; live_capture: number; status: string; since?: string; error?: string; punches?: number };
type LiveService = { running: boolean; pid?: number; started?: string; stopping?: boolean; machines: LiveMachine[] };

const MACHINE_TEXT: Record<string, [string, string]> = {
  listening: ["success", "Listening"], paused: ["warning", "Paused (being read)"], error: ["danger", "Cannot connect"],
  off: ["", "Live capture off"],
};

function LiveCapture() {
  const [s, setS] = useState<LiveService | null>(null);
  const [waiting, setWaiting] = useState<"start" | "stop" | null>(null);
  const load = useCallback(() => call<LiveService>("live_service").then((r) => {
    setS(r);
    if ((waiting === "start" && r.running) || (waiting === "stop" && !r.running)) setWaiting(null);
  }).catch(() => {}), [waiting]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useInterval(load, waiting ? 2000 : 10000);

  const live = s?.machines.filter((m) => m.live_capture) || [];
  const offMachines = (s?.machines.length || 0) - live.length;

  const start = async () => {
    let enableAll = 0;
    if (!live.length) {
      if (!(await confirmDialog({ title: "Turn on live capture?", message: "No machine has Live Capture on. Turn it on for all machines and start?", confirm: "Turn on and start" }))) return;
      enableAll = 1;
    }
    try {
      const r = await call<LiveService>("live_service_start", { enable_all: enableAll }, true);
      setS(r);
      if (!r.running) setWaiting("start");
      toast("Live capture is starting. Punches will appear within seconds.", "success", "Live capture");
    } catch (e) { toastError(e, "Cannot start live capture"); }
  };
  const stop = async () => {
    if (!(await confirmDialog({ title: "Stop live capture?", message: "Punches will only arrive with the scheduled pull (every 15 minutes) until you start it again.", confirm: "Stop", danger: true }))) return;
    try {
      setS(await call<LiveService>("live_service_stop", {}, true));
      setWaiting("stop");
    } catch (e) { toastError(e, "Cannot stop live capture"); }
  };

  const running = !!s?.running && waiting !== "stop";
  const state = waiting === "start" ? ["primary", "Starting…"] : waiting === "stop" ? ["warning", "Stopping…"]
    : running ? ["success", "Live capture running"] : ["danger", "Live capture stopped"];

  return (
    <div className="card" style={{ padding: "12px 16px" }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <span className={`badge ${state[0]}`} style={{ fontSize: 14 }}>
          <Icon name={waiting ? "loader" : running ? "activity" : "wifiOff"} className={waiting ? "spin" : ""} /> {state[1]}
        </span>
        <div className="muted" style={{ flex: 1, minWidth: 220 }}>
          {running
            ? <>Punches reach the board within seconds{s?.started ? <> · since {s.started.slice(11, 16)}</> : null}.</>
            : <>Punches arrive only with the scheduled pull (every 15 minutes). Start live capture to see them at once.</>}
        </div>
        {running
          ? <BusyButton className="btn" onClick={stop} busyText="Stopping…" disabled={!!waiting}><Icon name="stop" /> Stop live capture</BusyButton>
          : <BusyButton className="btn btn-primary" onClick={start} busyText="Starting…" disabled={!!waiting || !s}><Icon name="play" /> Start live capture</BusyButton>}
      </div>
      {running && live.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {live.map((m) => {
            const [tone, text] = MACHINE_TEXT[m.status] || ["", m.status === "not running" ? "Connecting…" : m.status];
            return (
              <span key={m.name} className={`badge ${tone}`} title={m.error || ""}>
                <Icon name={m.status === "listening" ? "wifi" : "wifiOff"} /> {m.label}: {text}{m.status === "listening" && m.punches ? ` · ${m.punches} punches` : ""}
              </span>
            );
          })}
          {offMachines > 0 && <span className="muted">{offMachines} machine(s) without live capture (turn it on in Machines)</span>}
        </div>
      )}
    </div>
  );
}

export default function Display() {
  const kiosk = useLocation().pathname.includes("kiosk");
  const src = `/checkin-display${kiosk ? "?kiosk=1" : ""}`;
  return (
    <div className="stack">
      <LiveCapture />
      <div className="row">
        <div className="muted" style={{ flex: 1 }}>The live board of today's check-ins and check-outs. Open it full screen on the gate TV.</div>
        <a className="btn" href={src} target="_blank" rel="noreferrer"><Icon name="external" /> Open in new tab</a>
        <a className="btn btn-primary" href="/checkin-display?kiosk=1" target="_blank" rel="noreferrer"><Icon name="maximize" /> Kiosk (full screen)</a>
      </div>
      <iframe title="Check-in Display" src={src} allow="fullscreen" className="display-frame" />
    </div>
  );
}
