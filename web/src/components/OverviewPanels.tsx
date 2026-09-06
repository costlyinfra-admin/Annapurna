/**
 * The Overview's summary panels: the KPI row, and the three cards beneath it.
 *
 * They live here rather than in Dashboard.tsx because each is a small, self
 * contained reading of data the page already has — keeping them together makes
 * the page component about layout and loading, which is enough for one file.
 *
 * Two rules run through all of them. Build and inference cost are only ever
 * summed to answer "how much in total" or "who do we pay"; every card that
 * shows a feature or a trend keeps them apart. And nothing is drawn that the
 * data does not support: a card with no history shows no sparkline rather than
 * a flat line implying one.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Dashboard, Insight, OpenAction, ProviderTotal, TrendMonth } from "../api";
import { FINE_STEPS, GRID_LEVELS, niceCeil } from "./chartAxis";
import { ConnectorMark } from "./ConnectorMark";
import { budgetForecast, type BudgetForecast, type ForecastPoint } from "../budget";
import { compact, compactMoney, money, wholeMoney } from "../format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(period: string): string {
  return MONTHS[Number(period.slice(5, 7)) - 1];
}

/** "self_hosted" -> "Self hosted". These are identifiers in the database, and
 *  a vendor list is somewhere a person reads, not somewhere a key belongs. */
function providerLabel(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A percentage, or an em dash when the base makes one meaningless. */
function share(part: number, whole: number): string {
  if (!whole) return "—";
  const pct = (part / whole) * 100;
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

/** A bar per month, scaled to the tallest. Purely a shape — the numbers are
 *  beside it, and this only says whether they have been climbing. */
function Sparkline({ months }: { months: TrendMonth[] }) {
  const values = months.map((m) => m.build_cost + m.inference_cost);
  const max = Math.max(...values, 0);
  if (months.length < 2 || max <= 0) return null;
  return (
    <span className="kpi-spark" aria-hidden>
      {values.map((value, i) => (
        <span key={i} style={{ height: `${Math.max(8, (value / max) * 100)}%` }} />
      ))}
    </span>
  );
}

function Delta({ current, prev, label }: { current: number; prev: number; label: string }) {
  if (prev <= 0) return <span className="muted kpi-note">No prior period to compare</span>;
  const change = ((current - prev) / prev) * 100;
  const up = change >= 0;
  return (
    <span className={`kpi-delta ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"}{" "}
      {Math.abs(change) >= 10 ? Math.round(Math.abs(change)) : Math.abs(change).toFixed(1)}%
      <span className="muted kpi-note">
        {" "}
        vs {label} ({money(prev)})
      </span>
    </span>
  );
}

export interface SavingsSummary {
  potentialMonthly: number;
  realizedMonthly: number;
  realizedAnnual: number;
}

export function KpiRow({
  data,
  savings,
  savingsFailed,
  deltaLabel,
}: {
  data: Dashboard;
  /** Loaded separately, so a slow Optimize calculation never holds up the page. */
  savings: SavingsSummary | null;
  savingsFailed: boolean;
  deltaLabel: string;
}) {
  const totalSpend = data.totals.build_cost + data.totals.inference_cost;
  const prevSpend = data.totals.prev_build_cost + data.totals.prev_inference_cost;
  const unattributed = data.unattributed.build_cost + data.unattributed.inference_cost;
  const coverage = totalSpend > 0 ? ((totalSpend - unattributed) / totalSpend) * 100 : 0;

  return (
    <section className="kpi-row" aria-label="Headline figures">
      <article className="kpi-card">
        <h2 className="kpi-label">Total AI spend</h2>
        <div className="kpi-main">
          <span className="kpi-value">{money(totalSpend)}</span>
          <Sparkline months={data.trend} />
        </div>
        <Delta current={totalSpend} prev={prevSpend} label={deltaLabel} />
        {/* Build and inference are added here only to answer "how much in
            total"; the split is right beneath, and never blended below. */}
        <span className="muted kpi-note">
          {money(data.totals.build_cost)} build · {money(data.totals.inference_cost)} run
        </span>
        {data.totals.estimated_inference > 0 && (
          <span className="muted kpi-note" title="Recent usage the provider has not billed yet">
            incl. ~{money(data.totals.estimated_inference)} estimated
          </span>
        )}
      </article>

      <article className="kpi-card">
        <h2 className="kpi-label">Potential savings</h2>
        {savings ? (
          <>
            <div className="kpi-main">
              <span className="kpi-value">
                {money(savings.potentialMonthly)}
                <span className="kpi-unit"> / mo</span>
              </span>
            </div>
            <span className="muted kpi-note">
              {share(savings.potentialMonthly, totalSpend)} of total spend
            </span>
          </>
        ) : (
          <Pending failed={savingsFailed} />
        )}
        <Link className="kpi-link" to="/optimize">
          View opportunities →
        </Link>
      </article>

      <article className="kpi-card">
        <h2 className="kpi-label">Savings realized</h2>
        {savings ? (
          <>
            <div className="kpi-main">
              <span className="kpi-value">
                {money(savings.realizedMonthly)}
                <span className="kpi-unit"> / mo</span>
              </span>
            </div>
            <span className="muted kpi-note">
              {money(savings.realizedAnnual)} annualized — verified, not projected
            </span>
          </>
        ) : (
          <Pending failed={savingsFailed} />
        )}
        <Link className="kpi-link" to="/optimize">
          View savings →
        </Link>
      </article>

      <article className="kpi-card">
        <h2 className="kpi-label">Total tokens</h2>
        <div className="kpi-main">
          <span className="kpi-value">
            {compact(data.totals.tokens_in + data.totals.tokens_out)}
          </span>
        </div>
        <span className="muted kpi-note">
          {compact(data.totals.tokens_in)} in · {compact(data.totals.tokens_out)} out
        </span>
      </article>

      <article className="kpi-card">
        <h2 className="kpi-label">Attribution coverage</h2>
        <div className="kpi-main">
          <span className="kpi-value">{totalSpend > 0 ? `${coverage.toFixed(1)}%` : "—"}</span>
        </div>
        <span className="kpi-bar" aria-hidden>
          <span style={{ width: `${Math.max(0, Math.min(100, coverage))}%` }} />
        </span>
        <span className="muted kpi-note">
          {unattributed > 0
            ? `${money(unattributed)} unattributed (${share(unattributed, totalSpend)})`
            : "Every dollar is tied to a feature"}
        </span>
        {unattributed > 0 && (
          <Link className="kpi-link" to="/cost-sources">
            Resolve unattributed →
          </Link>
        )}
      </article>
    </section>
  );
}

/** The savings cards before their own request lands, or after it fails. Never a
 *  zero — an unknown figure and a figure of nothing are different answers. */
function Pending({ failed }: { failed: boolean }) {
  return (
    <div className="kpi-main">
      <span className="kpi-value muted">—</span>
      <span className="muted kpi-note">{failed ? "Unavailable" : "Calculating…"}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key insights
// ---------------------------------------------------------------------------
const INSIGHT_TONE: Record<string, string> = {
  spike: "warn",
  trend: "warn",
  "trend-down": "good",
  pace: "warn",
  "pace-down": "good",
  waste: "warn",
  governance: "warn",
  coverage: "warn",
  resource: "warn",
  concentration: "info",
  efficiency: "info",
  split: "info",
  cache: "info",
};

/** A mark per kind of finding, so the list can be read by shape before it is
 *  read by word. Same family as the navigation icons: one 20x20 grid, one
 *  stroke weight, currentColor — the tone comes from the row. */
const INSIGHT_PATHS: Record<string, string> = {
  // A jagged peak: one day far above the rest.
  spike: "M2.5 13.5 6 8l3 3.5L12.5 4l5 9.5",
  // Arrows for direction of travel.
  trend: "M2.5 14 8 8.5l3 3 6.5-6.5 M13 5h4.5v4.5",
  "trend-down": "M2.5 6 8 11.5l3-3 6.5 6.5 M13 15h4.5v-4.5",
  // A clock: a projection, which is about time not size.
  pace: "M10 4.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z M10 7v3.2l2.2 1.3",
  "pace-down": "M10 4.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z M10 7v3.2l2.2 1.3",
  // A warning: spend to look at.
  waste: "M10 3.6 17.5 16.4H2.5L10 3.6Z M10 8.3v3.1 M10 13.6h.01",
  // A tag with no string: spend not tied to a feature.
  governance: "M9.4 3.5H16v6.6L10.6 16.5 3.5 9.4 9.4 3.5Z M12.9 6.9h.01",
  coverage: "M9.4 3.5H16v6.6L10.6 16.5 3.5 9.4 9.4 3.5Z M12.9 6.9h.01",
  // A key: this is about API keys and workspaces.
  resource: "M12.8 4.5a3.2 3.2 0 1 1-2.9 4.5L4 15v2.5h2.5v-2h2v-2h2l1.4-1.4a3.2 3.2 0 0 1 .9-7.6Z",
  // Bars, one taller: one feature dominating.
  concentration: "M4 16.5v-4 M8 16.5v-9 M12 16.5v-6 M16 16.5v-11",
  // Two people: cost per active user.
  efficiency:
    "M7.5 9.5a2.4 2.4 0 1 1 0-4.8 2.4 2.4 0 0 1 0 4.8Z M3 16.2c0-2.2 2-3.6 4.5-3.6" +
    "s4.5 1.4 4.5 3.6 M13.5 5.1a2.4 2.4 0 0 1 0 4.4 M14.5 12.9c1.6.5 2.5 1.7 2.5 3.3",
  // A circle with a wedge: two shares of one whole.
  split: "M10 3.5a6.5 6.5 0 1 0 6.5 6.5H10V3.5Z",
  // Stacked discs: cached reads.
  cache:
    "M10 3.5c3.6 0 6.5 1 6.5 2.2S13.6 8 10 8 3.5 6.9 3.5 5.7 6.4 3.5 10 3.5Z" +
    " M3.5 5.7v8.6c0 1.2 2.9 2.2 6.5 2.2s6.5-1 6.5-2.2V5.7 M3.5 10c0 1.2 2.9 2.2 6.5 2.2" +
    "s6.5-1 6.5-2.2",
};

const FALLBACK_PATH = "M10 4.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z M10 7.2v3.4 M10 13h.01";

function InsightIcon({ kind }: { kind: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden
      className="insight-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={INSIGHT_PATHS[kind] ?? FALLBACK_PATH} />
    </svg>
  );
}

export function KeyInsights({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <section className="panel insights-panel" aria-label="Key insights">
      <div className="panel-head">
        <h2>Key insights</h2>
      </div>
      {/* Four is where spreading the rows down the panel reads as a roomy list
          rather than as two items adrift in a tall box. */}
      <ul className={`insight-list ${insights.length >= 4 ? "spread" : ""}`}>
        {insights.map((insight, i) => (
          <li key={i} className={`insight-item tone-${INSIGHT_TONE[insight.kind] ?? "info"}`}>
            <InsightIcon kind={insight.kind} />
            <span className="insight-body">
              <span className="insight-text">{insight.text}</span>
              {insight.detail && <span className="muted insight-detail">{insight.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Spend trend
// ---------------------------------------------------------------------------
// A fixed viewBox: the panel is fluid, so drawing to a constant grid keeps the
// bars and the axis in step at any width.
const VB_W = 320;
const VB_H = 172;
const AXIS_W = 40; // room for the dollar labels
const PLOT_TOP = 8;
const PLOT_BOTTOM = 150; // baseline; month labels sit below it

export function SpendTrend({ trend }: { trend: TrendMonth[] }) {
  const max = Math.max(...trend.map((m) => m.build_cost + m.inference_cost), 0);
  const ceiling = niceCeil(max);
  const y = (value: number) => PLOT_BOTTOM - (value / ceiling) * (PLOT_BOTTOM - PLOT_TOP);

  const plotW = VB_W - AXIS_W - 6;
  const slot = plotW / Math.max(trend.length, 1);
  const barW = Math.min(slot * 0.55, 28);

  return (
    <section className="panel trend-panel" aria-label="Spend trend">
      <div className="panel-head">
        <h2>Spend trend</h2>
        <span className="trend-key">
          <span className="trend-key-item">
            <span className="trend-key-swatch build" aria-hidden /> Build
          </span>
          <span className="trend-key-item">
            <span className="trend-key-swatch run" aria-hidden /> Inference
          </span>
        </span>
      </div>
      {max <= 0 ? (
        <p className="muted">No spend in this period.</p>
      ) : (
        <svg
          className="trend-svg"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          role="img"
          aria-label="Build and inference cost per month"
        >
          {GRID_LEVELS.map((level) => (
            <g key={level}>
              <line
                className="trend-grid-line"
                x1={AXIS_W}
                y1={y(level * ceiling)}
                x2={VB_W - 6}
                y2={y(level * ceiling)}
              />
              <text
                className="trend-axis-label"
                x={AXIS_W - 6}
                y={y(level * ceiling) + 3}
                textAnchor="end"
              >
                {wholeMoney(level * ceiling)}
              </text>
            </g>
          ))}

          {trend.map((month, i) => {
            const total = month.build_cost + month.inference_cost;
            const x = AXIS_W + i * slot + (slot - barW) / 2;
            // Inference sits on top of build, so the two are read as parts of
            // the month rather than as one blended number.
            const buildH = (month.build_cost / ceiling) * (PLOT_BOTTOM - PLOT_TOP);
            const runH = (month.inference_cost / ceiling) * (PLOT_BOTTOM - PLOT_TOP);
            return (
              <g key={month.period}>
                <title>{`${monthLabel(month.period)}: ${money(month.build_cost)} build · ${money(month.inference_cost)} inference`}</title>
                {total > 0 && (
                  <>
                    <rect
                      className="trend-bar-run"
                      x={x}
                      y={y(total)}
                      width={barW}
                      height={Math.max(runH, month.inference_cost > 0 ? 1 : 0)}
                      rx={2}
                    />
                    <rect
                      className="trend-bar-build"
                      x={x}
                      y={PLOT_BOTTOM - buildH}
                      width={barW}
                      height={Math.max(buildH, month.build_cost > 0 ? 1 : 0)}
                    />
                  </>
                )}
                <text
                  className="trend-axis-label"
                  x={x + barW / 2}
                  y={PLOT_BOTTOM + 14}
                  textAnchor="middle"
                >
                  {monthLabel(month.period)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Budget & forecast
// ---------------------------------------------------------------------------
// Same 320-unit width as the spend trend above it, so the two charts in this
// column are drawn to one grid — but half the height. This one carries a single
// line and a reference level, and the card below it has figures to fit in.
const BF_VB_W = 320;
const BF_VB_H = 104;
const BF_AXIS_W = 44;
const BF_PLOT_TOP = 12;
const BF_PLOT_BOTTOM = 78;
/** Three levels, not the trend chart's five: at this height five would crowd. */
const BF_GRID_LEVELS = [0, 0.5, 1] as const;

/** Cumulative spend against the budget: solid where it happened, dashed where
 *  it is a projection. Two dashed tails when Optimize has an answer — what the
 *  window comes to if nothing changes, and what it comes to if it does. */
function BudgetChart({ plan }: { plan: BudgetForecast }) {
  const ceiling = niceCeil(Math.max(plan.forecast, plan.budget), FINE_STEPS);
  const px = (x: number) => BF_AXIS_W + (x / plan.months) * (BF_VB_W - BF_AXIS_W - 8);
  const py = (y: number) => BF_PLOT_BOTTOM - (y / ceiling) * (BF_PLOT_BOTTOM - BF_PLOT_TOP);
  const path = (points: ForecastPoint[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x)} ${py(p.y)}`).join(" ");

  const last = plan.actual[plan.actual.length - 1];
  const end = plan.projected[plan.projected.length - 1];
  const optimizedEnd = plan.optimizedTail?.[plan.optimizedTail.length - 1] ?? null;

  return (
    <svg
      className="trend-svg budget-svg"
      viewBox={`0 0 ${BF_VB_W} ${BF_VB_H}`}
      role="img"
      aria-label={
        `Cumulative spend against a ${money(plan.budget)} budget. ` +
        `${money(plan.spent)} spent so far, forecast ${money(plan.forecast)} — ` +
        `${Math.abs(Math.round(plan.overBy))}% ${plan.overBudget ? "over" : "under"} budget.` +
        (optimizedEnd ? ` With identified savings, ${money(optimizedEnd.y)}.` : "")
      }
    >
      {BF_GRID_LEVELS.map((level) => (
        <g key={level}>
          <line
            className="trend-grid-line"
            x1={BF_AXIS_W}
            y1={py(level * ceiling)}
            x2={BF_VB_W - 8}
            y2={py(level * ceiling)}
          />
          <text
            className="trend-axis-label"
            x={BF_AXIS_W - 6}
            y={py(level * ceiling) + 3}
            textAnchor="end"
          >
            {wholeMoney(level * ceiling)}
          </text>
        </g>
      ))}

      {/* The budget, drawn across the whole plot so it reads as a ceiling
          rather than as another series. */}
      <g>
        <title>{`Budget for this period: ${money(plan.budget)}`}</title>
        <line
          className="budget-line"
          x1={BF_AXIS_W}
          y1={py(plan.budget)}
          x2={BF_VB_W - 8}
          y2={py(plan.budget)}
        />
        <text className="budget-line-label" x={BF_AXIS_W + 4} y={py(plan.budget) - 5}>
          Budget {compactMoney(plan.budget)}
        </text>
      </g>

      <g>
        <title>{`Spent so far: ${money(plan.spent)}`}</title>
        <path className="budget-actual" d={path(plan.actual)} />
      </g>

      {plan.optimizedTail && optimizedEnd && (
        <g>
          <title>{`With identified savings: ${money(optimizedEnd.y)}`}</title>
          <path className="budget-optimized" d={path(plan.optimizedTail)} />
          <circle className="budget-dot optimized" cx={px(optimizedEnd.x)} cy={py(optimizedEnd.y)} r={3} />
        </g>
      )}

      <g>
        <title>{`Forecast if nothing changes: ${money(plan.forecast)}`}</title>
        <path
          className={`budget-projected ${plan.overBudget ? "over" : "under"}`}
          d={path(plan.projected)}
        />
        <circle
          className={`budget-dot ${plan.overBudget ? "over" : "under"}`}
          cx={px(end.x)}
          cy={py(end.y)}
          r={3}
        />
      </g>

      {/* Where the actuals stop and the guessing starts. */}
      <circle className="budget-dot actual" cx={px(last.x)} cy={py(last.y)} r={3} />

      {plan.actual.slice(1).map((point, i) => (
        <text
          className="trend-axis-label"
          key={point.label}
          x={px(i + 0.5)}
          y={BF_PLOT_BOTTOM + 13}
          textAnchor="middle"
        >
          {point.label.replace(/^End of |^| so far$/g, "").slice(0, 3)}
        </text>
      ))}
    </svg>
  );
}

/**
 * Where the period lands against the budget, and whether the savings the
 * Optimize engine has already found would be enough to change that.
 *
 * The forecast is always named as a forecast: the figure of what was spent sits
 * beside it, and the two are never added or blended.
 */
export function BudgetForecastPanel({
  trend,
  /** Monthly potential savings; null until the Optimize call lands. */
  potentialMonthly,
}: {
  trend: TrendMonth[];
  potentialMonthly: number | null;
}) {
  const plan = budgetForecast(trend, potentialMonthly);

  if (!plan) {
    return (
      <section className="panel budget-panel" aria-label="Budget and forecast">
        <div className="panel-head">
          <h2>Budget &amp; forecast</h2>
        </div>
        <p className="muted">No spend in this period to forecast from.</p>
      </section>
    );
  }

  const overBy = Math.abs(Math.round(plan.overBy));

  return (
    <section className="panel budget-panel" aria-label="Budget and forecast">
      <div className="panel-head">
        <h2>Budget &amp; forecast</h2>
        <span className={`budget-status ${plan.overBudget ? "over" : "under"}`}>
          {overBy}% {plan.overBudget ? "over" : "under"} budget
        </span>
      </div>

      <p className="budget-headline">
        Forecast: <strong>{compactMoney(plan.forecast)}</strong>
      </p>

      <BudgetChart plan={plan} />

      <dl className="budget-stats">
        <div>
          <dt>Budget</dt>
          <dd title={money(plan.budget)}>{compactMoney(plan.budget)}</dd>
        </div>
        <div>
          <dt>Spent so far</dt>
          <dd title={money(plan.spent)}>{compactMoney(plan.spent)}</dd>
        </div>
        <div>
          <dt>With savings</dt>
          <dd title={plan.optimized === null ? "Calculating…" : money(plan.optimized)}>
            {plan.optimized === null ? "—" : compactMoney(plan.optimized)}
          </dd>
        </div>
      </dl>

      <p className="muted budget-foot">
        {plan.optimized === null
          ? "Checking what the identified savings would do to this forecast…"
          : plan.savingsCloseTheGap
            ? "Applying identified savings would bring forecasted spend within budget."
            : plan.overBudget
              ? "Identified savings would not be enough to bring this period within budget."
              : "This period is forecast to land within budget."}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Provider spend
// ---------------------------------------------------------------------------
/** How many vendors the panel shows before it asks to be opened. Three answers
 *  "who are we mostly paying"; the rest is a follow-up question. */
const PROVIDERS_SHOWN = 3;

function ProviderRow({ provider }: { provider: ProviderTotal }) {
  return (
    <li>
      <ConnectorMark type={provider.provider} name={provider.provider} />
      <span className="provider-name">{providerLabel(provider.provider)}</span>
      <span className="provider-amount">{money(provider.amount)}</span>
      <span className="muted provider-share">{Math.round(provider.share)}%</span>
      <span className="provider-bar" aria-hidden>
        <span style={{ width: `${provider.share}%` }} />
      </span>
    </li>
  );
}

export function ProviderSpendPanel({ providers }: { providers: ProviderTotal[] }) {
  const [open, setOpen] = useState(false);
  const shown = providers.slice(0, PROVIDERS_SHOWN);
  const rest = providers.slice(PROVIDERS_SHOWN);
  const restTotal = rest.reduce((sum, p) => sum + p.amount, 0);
  const restShare = rest.reduce((sum, p) => sum + p.share, 0);

  return (
    <section className="panel provider-panel" aria-label="Provider spend">
      <div className="panel-head">
        <h2>Provider spend</h2>
        <Link className="panel-link" to="/cost-sources">
          View all →
        </Link>
      </div>
      {providers.length === 0 ? (
        <p className="muted">No provider spend in this period.</p>
      ) : (
        <>
          <ul className="provider-list">
            {shown.map((provider) => (
              <ProviderRow key={provider.provider} provider={provider} />
            ))}
          </ul>
          {rest.length > 0 && (
            <>
              {/* Rendered whether open or not, so the browser has something to
                  animate down and a page search still finds a vendor in it. */}
              <div className={`provider-more ${open ? "open" : ""}`}>
                <ul className="provider-list">
                  {rest.map((provider) => (
                    <ProviderRow key={provider.provider} provider={provider} />
                  ))}
                </ul>
              </div>
              <button
                type="button"
                className="link provider-toggle"
                aria-expanded={open}
                onClick={() => setOpen((was) => !was)}
              >
                <span className="provider-toggle-chevron" aria-hidden>
                  ›
                </span>
                {open
                  ? "Show fewer"
                  : `${rest.length} more · ${money(restTotal)} (${Math.round(restShare)}%)`}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Open actions
// ---------------------------------------------------------------------------
export function OpenActions({ actions }: { actions: OpenAction[] }) {
  return (
    <section className="panel actions-panel" aria-label="Open actions">
      <div className="panel-head">
        <h2>Open actions</h2>
      </div>
      {actions.length === 0 ? (
        // An empty list is a real answer here, not a blank state.
        <p className="muted">Nothing needs attention.</p>
      ) : (
        <ul className="action-list">
          {actions.map((action) => (
            <li key={action.kind}>
              <Link to={action.href} className={`action-item tone-${action.tone}`}>
                <span className="action-dot" aria-hidden />
                <span className="action-body">
                  <span className="action-title">{action.title}</span>
                  <span className="muted action-detail">{action.detail}</span>
                </span>
                <span className="action-chevron" aria-hidden>
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
