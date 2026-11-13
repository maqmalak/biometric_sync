/* Chart.js wrapper styled like the standalone tool. */
import { useEffect, useRef } from "react";
import { Chart, registerables, type ChartConfiguration } from "chart.js";

Chart.register(...registerables);

export const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function defaults() {
  Chart.defaults.font.family = cssVar("--font");
  Chart.defaults.font.size = 12;
  Chart.defaults.color = cssVar("--muted");
  Chart.defaults.borderColor = cssVar("--border");
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.boxHeight = 12;
  Chart.defaults.plugins.tooltip.backgroundColor = cssVar("--sidebar");
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
}

/** Renders a chart; `make` builds the config (called again whenever `deps` or the theme change). */
export function ChartBox({ make, deps, small }: { make: () => ChartConfiguration; deps: any[]; small?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    defaults();
    const c = new Chart(ref.current, make());
    const onTheme = () => { c.destroy(); };
    window.addEventListener("bs-theme", onTheme);
    return () => { window.removeEventListener("bs-theme", onTheme); c.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, document.documentElement.getAttribute("data-theme")]);
  return <div className={`chart-box ${small ? "sm" : ""}`}><canvas ref={ref} /></div>;
}
