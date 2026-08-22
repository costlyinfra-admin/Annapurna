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

/** A "nice" axis ceiling at or above `v` — 1/2/2.5/5/10 x a power of ten. */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

/** Long-form date for the hover card: "Aug 20, 2026" (daily) / "August 2026". */
function pointLabel(period: string, g: Granularity): string {
  if (g !== "day") return monthLabel(period);
  return `${MONTHS[Number(period.slice(5, 7)) - 1]} ${Number(period.slice(8, 10))}, ${period.slice(0, 4)}`;
}

// Fixed viewBox: a stable aspect ratio regardless of how many points there are,
// so the chart scales cleanly and percentage-positioned overlays stay aligned.
const VB_W = 1000;
const VB_H = 200;
const AXIS_W = 54; // gutter for the y-axis dollar labels
const PLOT_TOP = 26; // headroom so the peak's label is never clipped
const PLOT_BOTTOM = 158; // baseline; x-axis ticks sit below it
const PAD_RIGHT = 14;

/** Total-spend line chart (SVG): a light line over a dollar y-axis with dotted
 *  gridlines. Hovering anywhere along it highlights the nearest point and shows a
 *  breakdown card (by classification and, where known, by workspace). */
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

  const ceil = niceCeil(max);
  const plotW = VB_W - AXIS_W - PAD_RIGHT;
  const n = trend.length;
  const x = (i: number) => AXIS_W + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PLOT_BOTTOM - (v / ceil) * (PLOT_BOTTOM - PLOT_TOP);

  const points = trend.map((t, i) => ({ px: x(i), py: y(t.total), t }));
  const line = points.map((p) => `${p.px},${p.py}`).join(" ");
  const area = `${x(0)},${PLOT_BOTTOM} ${line} ${x(n - 1)},${PLOT_BOTTOM}`;
  const peakIdx = points.reduce((a, p, i) => (p.t.total > points[a].t.total ? i : a), 0);
  const active = hover ?? peakIdx; // the peak stays labelled until the user hovers
  const ap = points[active];

  // Four gridlines (0 .. ceil) with dollar labels down the left gutter.
  const levels = [0, 0.25, 0.5, 0.75, 1].map((f) => f * ceil);
  const band = plotW / Math.max(1, n - 1); // hover band width, in viewBox units

  return (
    <div className="trend-line-wrap" onMouseLeave={() => setHover(null)}>
      <svg
        className="trend-line-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        aria-label="Total inference cost trend"
      >
        {levels.map((v) => (
          <g key={v}>
            <line
              className="trend-grid-line"
              x1={AXIS_W}
              y1={y(v)}
              x2={VB_W - PAD_RIGHT}
              y2={y(v)}
            />
            <text className="trend-axis-label" x={AXIS_W - 8} y={y(v) + 4} textAnchor="end">
              {wholeMoney(v)}
            </text>
          </g>
        ))}

        <polygon className="trend-line-area" points={area} />
        <polyline className="trend-line-path" points={line} fill="none" />

        {/* Vertical guide while hovering + a dot on the highlighted point. */}
        {hover !== null && (
          <line
            className="trend-line-guide"
            x1={ap.px}
            y1={PLOT_TOP - 8}
            x2={ap.px}
            y2={PLOT_BOTTOM}
          />
        )}
        <circle className="trend-line-dot" cx={ap.px} cy={ap.py} r={hover === null ? 3.5 : 5} />

        {points.map((p) => (
          <text
            key={p.t.period}
            className="trend-line-tick"
            x={p.px}
            y={PLOT_BOTTOM + 18}
            textAnchor="middle"
          >
            {tick(p.t.period, granularity)}
          </text>
        ))}

        {/* The peak's amount, shown until the user hovers (the card takes over then). */}
        {hover === null && (
          <text
            className="trend-line-label"
            x={Math.min(Math.max(ap.px, AXIS_W + 20), VB_W - PAD_RIGHT - 20)}
            y={Math.max(ap.py - 10, 12)}
            textAnchor="middle"
          >
            {wholeMoney(ap.t.total)}
          </text>
        )}

        {/* Contiguous invisible bands make the whole line hoverable. */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.t.period}`}
            x={p.px - band / 2}
            y={0}
            width={band}
            height={PLOT_BOTTOM}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {hover !== null && <HoverCard point={ap.t} px={ap.px} granularity={granularity} />}
    </div>
  );
}

/** Breakdown card that follows the highlighted point. */
function HoverCard({
  point,
  px,
  granularity,
}: {
  point: ClassificationTrendPoint;
  px: number;
  granularity: Granularity;
}) {
  const pct = (px / VB_W) * 100;
  const flip = pct > 60; // near the right edge -> open leftwards
  const workspaces = (point.workspaces ?? []).slice(0, 4);
  const rest = (point.workspaces ?? []).slice(4);
  const restTotal = rest.reduce((s, w) => s + w.amount, 0);

  return (
    <div
      className={`trend-hover-card${flip ? " flip" : ""}`}
      style={{ left: `${pct}%` }}
      role="status"
    >
      <div className="trend-hover-head">
        <span className="trend-hover-date">{pointLabel(point.period, granularity)}</span>
        <span className="trend-hover-total">{money(point.total)}</span>
      </div>
      <ul className="trend-hover-list">
        {BUCKETS.filter((b) => point[b.key] > 0).map((b) => (
          <li key={b.key}>
            <span className={`trend-legend-swatch trend-seg-${b.key}`} aria-hidden />
            <span className="trend-hover-name">{b.label}</span>
            <span className="trend-hover-amt">{money(point[b.key])}</span>
          </li>
        ))}
      </ul>
      {workspaces.length > 0 && (
        <>
          <span className="trend-hover-sub">By workspace</span>
          <ul className="trend-hover-list">
            {workspaces.map((w) => (
              <li key={w.workspace}>
                <span className="trend-hover-name">{w.workspace}</span>
                <span className="trend-hover-amt">{money(w.amount)}</span>
              </li>
            ))}
            {rest.length > 0 && (
              <li>
                <span className="trend-hover-name muted">+{rest.length} more</span>
                <span className="trend-hover-amt">{money(restTotal)}</span>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
