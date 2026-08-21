/**
 * Inference-spend trend, segmented by classification (Production / Development-Test
 * / Internal / Unclassified). Renders either a STACKED BAR chart or a TOTAL LINE
 * chart — the viewer toggles between them. Segments/points sum to each period's
 * active inference total (Ignore is excluded upstream). Values are whole dollars.
 *
 * `granularity` controls the x-axis: "month" labels each bar by month; "day" labels
 * by day-of-month and shows the month once in a caption beneath.
 *
 * Classification (what kind of spend) is a different dimension from the By-provider
 * section below (where spend comes from) — this chart only answers "what kind".
 */
import { useState } from "react";
import { type ClassificationTrendPoint } from "../api";
import { money, wholeMoney } from "../format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Bottom-to-top stacking order + labels. Keys match the API buckets.
const BUCKETS = [
  { key: "production", label: "Production" },
  { key: "development", label: "Dev / Test" },
  { key: "internal", label: "Internal" },
  { key: "unclassified", label: "Unclassified" },
] as const;

type Granularity = "month" | "day";

function monthLabel(period: string): string {
  return `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
}

/** X-axis tick: the day number for daily data, the month for monthly. */
function tick(period: string, g: Granularity): string {
  return g === "day" ? String(Number(period.slice(8, 10))) : MONTHS[Number(period.slice(5, 7)) - 1];
}

/** "August 2026", or "Aug – Sep 2026" when a daily range spans two months. */
function spanCaption(trend: ClassificationTrendPoint[]): string {
  const first = trend[0].period;
  const last = trend[trend.length - 1].period;
  const fm = Number(first.slice(5, 7)) - 1;
  const lm = Number(last.slice(5, 7)) - 1;
  const year = last.slice(0, 4);
  if (fm === lm && first.slice(0, 4) === year) {
    return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][fm]} ${year}`;
  }
  return `${MONTHS[fm]} – ${MONTHS[lm]} ${year}`;
}

function tooltip(t: ClassificationTrendPoint, g: Granularity): string {
  const lines = [g === "day" ? t.period : monthLabel(t.period)];
  for (const b of BUCKETS) {
    if (t[b.key] > 0) lines.push(`${b.label} — ${money(t[b.key])}`);
  }
  lines.push(`Total — ${money(t.total)}`);
  return lines.join("\n");
}

export function ClassificationTrendChart({
  trend,
  granularity = "month",
}: {
  trend: ClassificationTrendPoint[];
  granularity?: Granularity;
}) {
  const [mode, setMode] = useState<"bar" | "line">("bar");
  if (trend.length === 0) return <p className="muted">No data yet.</p>;
  const max = Math.max(...trend.map((t) => t.total), 1);

  return (
    <div>
      <div className="trend-toggle" role="group" aria-label="Chart type">
        <button
          type="button"
          className={mode === "bar" ? "active" : ""}
          aria-pressed={mode === "bar"}
          onClick={() => setMode("bar")}
        >
          Bar
        </button>
        <button
          type="button"
          className={mode === "line" ? "active" : ""}
          aria-pressed={mode === "line"}
          onClick={() => setMode("line")}
        >
          Line
        </button>
      </div>

      {mode === "bar" ? (
        <div className="trend-chart">
          {trend.map((t) => (
            <div className="trend-bar-wrap" key={t.period} title={tooltip(t, granularity)}>
              <span className="trend-value">{wholeMoney(t.total)}</span>
              <div
                className="trend-bar trend-bar-stacked"
                style={{ height: `${Math.max(3, (t.total / max) * 100)}%` }}
              >
                {/* Top-to-bottom in DOM = Unclassified … Production, so Production
                    sits at the bottom of the stack. */}
                {[...BUCKETS]
                  .reverse()
                  .map((b) =>
                    t[b.key] > 0 ? (
                      <div
                        key={b.key}
                        className={`trend-seg trend-seg-${b.key}`}
                        style={{ height: `${(t[b.key] / t.total) * 100}%` }}
                      />
                    ) : null,
                  )}
              </div>
              <span className="trend-label">{tick(t.period, granularity)}</span>
            </div>
          ))}
        </div>
      ) : (
        <LineTrend trend={trend} max={max} granularity={granularity} />
      )}

      {granularity === "day" && <p className="trend-span muted">{spanCaption(trend)}</p>}

      {mode === "bar" && (
        <ul className="trend-legend" aria-label="Classification legend">
          {BUCKETS.map((b) => (
            <li key={b.key} className="trend-legend-item">
              <span className={`trend-legend-swatch trend-seg-${b.key}`} aria-hidden />
              {b.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Total-spend line chart (SVG). Hovering along the line highlights the nearest
 *  point and shows its amount. Self-contained so day labels stay aligned. */
function LineTrend({
  trend,
  max,
  granularity,
}: {
  trend: ClassificationTrendPoint[];
  max: number;
  granularity: Granularity;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const step = 34;
  const pad = 18;
  const W = pad * 2 + Math.max(1, trend.length - 1) * step;
  const H = 170;
  const top = 24; // headroom for the value label
  const base = 140; // baseline; day ticks sit below
  const x = (i: number) => pad + i * step;
  const y = (v: number) => base - (v / max) * (base - top);

  const points = trend.map((t, i) => ({ px: x(i), py: y(t.total), t }));
  const line = points.map((p) => `${p.px},${p.py}`).join(" ");
  const area = `${pad},${base} ${line} ${x(trend.length - 1)},${base}`;
  const peakIdx = points.reduce((a, p, i) => (p.t.total > points[a].t.total ? i : a), 0);
  const active = hover ?? peakIdx; // show the peak's value until the user hovers
  const ap = points[active];

  // Floating amount label, clamped so it never spills past the chart edges.
  const labelW = 52;
  const labelX = Math.min(Math.max(ap.px, pad + labelW / 2), W - pad - labelW / 2);
  const labelY = Math.max(ap.py - 22, 2);

  return (
    <svg
      className="trend-line-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Total inference cost trend"
      onMouseLeave={() => setHover(null)}
    >
      <polygon className="trend-line-area" points={area} />
      <polyline className="trend-line-path" points={line} fill="none" />

      {/* Vertical guide (only while hovering) + a dot at the highlighted point
          (the hovered day, or the peak when idle). */}
      {hover !== null && (
        <line className="trend-line-guide" x1={ap.px} y1={top - 6} x2={ap.px} y2={base} />
      )}
      <circle className="trend-line-dot" cx={ap.px} cy={ap.py} r={hover === null ? 3 : 5} />

      {points.map((p) => (
        <text
          key={p.t.period}
          className="trend-line-tick"
          x={p.px}
          y={base + 16}
          textAnchor="middle"
        >
          {tick(p.t.period, granularity)}
        </text>
      ))}

      {/* The amount, shown for the highlighted (hovered, else peak) point. */}
      <g transform={`translate(${labelX}, ${labelY})`}>
        <rect
          className="trend-line-label-bg"
          x={-labelW / 2}
          y={-13}
          width={labelW}
          height={17}
          rx={4}
        />
        <text className="trend-line-label" x={0} y={0} textAnchor="middle">
          {wholeMoney(ap.t.total)}
        </text>
      </g>

      {/* Invisible per-point hit bands make the whole line easy to hover. */}
      {points.map((p, i) => (
        <rect
          key={`hit-${p.t.period}`}
          x={p.px - step / 2}
          y={0}
          width={step}
          height={base}
          fill="transparent"
          onMouseEnter={() => setHover(i)}
        >
          <title>{tooltip(p.t, granularity)}</title>
        </rect>
      ))}
    </svg>
  );
}
