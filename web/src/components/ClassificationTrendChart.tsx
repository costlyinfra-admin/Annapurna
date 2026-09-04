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
import { useId, useState } from "react";
import { type ClassificationTrendPoint } from "../api";
import { money, wholeMoney } from "../format";
import { smoothArea, smoothLine } from "../chartCurve";
import { GRID_LEVELS, niceCeil } from "./chartAxis";

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
        <BarTrend trend={trend} max={max} granularity={granularity} />
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

/** Above this many bars, per-bar value labels collide — so only the peak and the
 *  hovered bar are labelled, and the exact figure comes from the hover card. */
const DENSE_BAR_COUNT = 14;

// Fixed viewBox: a stable aspect ratio regardless of how many points there are,
// so the chart scales cleanly and percentage-positioned overlays stay aligned.
const VB_W = 1000;
const VB_H = 200;
const AXIS_W = 54; // gutter for the y-axis dollar labels
const PLOT_TOP = 26; // headroom so the peak's label is never clipped
const PLOT_BOTTOM = 158; // baseline; x-axis ticks sit below it
const PAD_RIGHT = 14;
const PLOT_W = VB_W - AXIS_W - PAD_RIGHT;

/** Dollars to a y coordinate, against a ceiling. */
function scale(ceil: number) {
  return (v: number) => PLOT_BOTTOM - (v / ceil) * (PLOT_BOTTOM - PLOT_TOP);
}

/** The y-axis: dotted gridlines at quarters of the ceiling, dollar labels down
 *  the left gutter. Both views draw the same frame off the same ceiling, so
 *  toggling between them moves the data and nothing else. */
function AxisFrame({ ceil, y }: { ceil: number; y: (v: number) => number }) {
  return (
    <>
      {GRID_LEVELS.map((f) => (
        <g key={f}>
          <line
            className="trend-grid-line"
            x1={AXIS_W}
            y1={y(f * ceil)}
            x2={VB_W - PAD_RIGHT}
            y2={y(f * ceil)}
          />
          <text className="trend-axis-label" x={AXIS_W - 8} y={y(f * ceil) + 4} textAnchor="end">
            {wholeMoney(f * ceil)}
          </text>
        </g>
      ))}
    </>
  );
}

/** Days in the month a period falls in. */
function daysInMonth(period: string): number {
  return new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate();
}

/**
 * How many bar slots the plot is divided into.
 *
 * A month that is two days old should LOOK two days old — two bars at the left,
 * the same width they will have on the 30th — rather than two bars stretched
 * across the whole card, which reads as a complete picture of the month and
 * isn't. So the plot always holds a whole period's worth of slots; a range
 * longer than one period simply gets more of them.
 */
function slotCount(trend: ClassificationTrendPoint[], g: Granularity): number {
  const whole = g === "day" ? daysInMonth(trend[trend.length - 1].period) : 12;
  return Math.max(trend.length, whole);
}

/** Stacked classification bars, drawn on the same axis as the line view.
 *  Hovering highlights a bar and opens the same breakdown card. */
function BarTrend({
  trend,
  max,
  granularity,
}: {
  trend: ClassificationTrendPoint[];
  max: number;
  granularity: Granularity;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();
  const peakIdx = trend.reduce((a, t, i) => (t.total > trend[a].total ? i : a), 0);
  const dense = trend.length > DENSE_BAR_COUNT;

  const ceil = niceCeil(max);
  const y = scale(ceil);
  const slots = slotCount(trend, granularity);
  const slotW = PLOT_W / slots;
  // Bars keep a constant share of their slot, so their width depends on the
  // length of the period, never on how much of it has happened yet. The cap
  // stops a one- or two-month range drawing a pair of billboards.
  const barW = Math.min(slotW * 0.62, 40);

  const bars = trend.map((t, i) => {
    const cx = AXIS_W + i * slotW + slotW / 2;
    // A day with real but tiny spend still has to be visible, so the bar has a
    // floor; segments then divide whatever height it ended up with.
    const height = t.total > 0 ? Math.max(2, PLOT_BOTTOM - y(t.total)) : 0;
    return { t, i, cx, x: cx - barW / 2, height, top: PLOT_BOTTOM - height };
  });

  return (
    <div className="trend-line-wrap" onMouseLeave={() => setHover(null)}>
      <svg
        className="trend-line-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        aria-label="Inference cost by classification"
      >
        <defs>
          {bars.map((b) => (
            <clipPath key={b.t.period} id={`${clipId}-${b.i}`}>
              {/* Rounded top, square feet — the segments are clipped to it. */}
              <path
                d={`M${b.x} ${PLOT_BOTTOM} V${b.top + 4} a4 4 0 0 1 4 -4 h${barW - 8} a4 4 0 0 1 4 4 V${PLOT_BOTTOM} Z`}
              />
            </clipPath>
          ))}
        </defs>

        <AxisFrame ceil={ceil} y={y} />

        {bars.map((b) => {
          let stacked = 0; // height consumed from the baseline upwards
          return (
            <g
              key={b.t.period}
              className={
                hover === null || hover === b.i ? "trend-bar-group" : "trend-bar-group dim"
              }
            >
              <g clipPath={`url(#${clipId}-${b.i})`}>
                {BUCKETS.map((bucket) => {
                  const value = b.t[bucket.key];
                  if (value <= 0 || b.t.total <= 0) return null;
                  const h = (value / b.t.total) * b.height;
                  const rectY = PLOT_BOTTOM - stacked - h;
                  stacked += h;
                  return (
                    <rect
                      key={bucket.key}
                      className={`trend-seg-fill trend-seg-${bucket.key}`}
                      x={b.x}
                      y={rectY}
                      width={barW}
                      height={h}
                    />
                  );
                })}
              </g>
              {(!dense || b.i === peakIdx || b.i === hover) && (
                <text className="trend-bar-value" x={b.cx} y={b.top - 7} textAnchor="middle">
                  {wholeMoney(b.t.total)}
                </text>
              )}
            </g>
          );
        })}

        {bars.map((b) => (
          <text
            key={`tick-${b.t.period}`}
            className="trend-line-tick"
            x={b.cx}
            y={PLOT_BOTTOM + 18}
            textAnchor="middle"
          >
            {tick(b.t.period, granularity)}
          </text>
        ))}

        {/* One invisible band per bar makes the whole slot hoverable, so a short
            bar is as easy to hit as a tall one. */}
        {bars.map((b) => (
          <rect
            key={`hit-${b.t.period}`}
            x={b.cx - slotW / 2}
            y={0}
            width={slotW}
            height={PLOT_BOTTOM}
            fill="transparent"
            onMouseEnter={() => setHover(b.i)}
          />
        ))}
      </svg>

      {hover !== null && (
        <HoverCard
          point={trend[hover]}
          pct={(bars[hover].cx / VB_W) * 100}
          granularity={granularity}
        />
      )}
    </div>
  );
}

/** Long-form date for the hover card: "Aug 20, 2026" (daily) / "August 2026". */
function pointLabel(period: string, g: Granularity): string {
  if (g !== "day") return monthLabel(period);
  return `${MONTHS[Number(period.slice(5, 7)) - 1]} ${Number(period.slice(8, 10))}, ${period.slice(0, 4)}`;
}

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
  const n = trend.length;
  const x = (i: number) => AXIS_W + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = scale(ceil);

  const points = trend.map((t, i) => ({ px: x(i), py: y(t.total), t }));
  // Monotone cubic: smooth, but it can never bow above a peak or below a
  // trough, so the curve never draws spend that did not happen.
  const line = smoothLine(points);
  const area = smoothArea(points, PLOT_BOTTOM);
  const peakIdx = points.reduce((a, p, i) => (p.t.total > points[a].t.total ? i : a), 0);
  const active = hover ?? peakIdx; // the peak stays labelled until the user hovers
  const ap = points[active];

  const band = PLOT_W / Math.max(1, n - 1); // hover band width, in viewBox units

  return (
    <div className="trend-line-wrap" onMouseLeave={() => setHover(null)}>
      <svg
        className="trend-line-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        aria-label="Total inference cost trend"
      >
        <AxisFrame ceil={ceil} y={y} />

        <path className="trend-line-area" d={area} />
        <path className="trend-line-path" d={line} fill="none" />

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

      {hover !== null && (
        <HoverCard point={ap.t} pct={(ap.px / VB_W) * 100} granularity={granularity} />
      )}
    </div>
  );
}

/** Breakdown card that follows the highlighted point. */
function HoverCard({
  point,
  pct,
  granularity,
}: {
  point: ClassificationTrendPoint;
  /** Horizontal position of the highlighted point, as a % of the chart width. */
  pct: number;
  granularity: Granularity;
}) {
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
