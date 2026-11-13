/* Check-in Display: the live gate board (served by the site at /checkin-display; same screen as the standalone tool). */
import { useLocation } from "react-router-dom";
import { Icon } from "../lib/ui";

export default function Display() {
  const kiosk = useLocation().pathname.includes("kiosk");
  const src = `/checkin-display${kiosk ? "?kiosk=1" : ""}`;
  return (
    <div className="stack">
      <div className="row">
        <div className="muted" style={{ flex: 1 }}>The live board of today's check-ins and check-outs. Open it full screen on the gate TV.</div>
        <a className="btn" href={src} target="_blank" rel="noreferrer"><Icon name="external" /> Open in new tab</a>
        <a className="btn btn-primary" href="/checkin-display?kiosk=1" target="_blank" rel="noreferrer"><Icon name="maximize" /> Kiosk (full screen)</a>
      </div>
      <iframe title="Check-in Display" src={src} allow="fullscreen" className="display-frame" />
    </div>
  );
}
