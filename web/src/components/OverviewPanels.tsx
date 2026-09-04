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
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import type { Dashboard, Insight, OpenAction, ProviderTotal, TrendMonth } from "../api";
import { GRID_LEVELS, niceCeil } from "./chartAxis";
import { ConnectorMark } from "./ConnectorMark";
import { compact, money, wholeMoney } from "../format";

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
// Token efficiency
// ---------------------------------------------------------------------------
/**
 * What the money bought, which is a different question from what it cost.
 *
 * Three bars per month on one shared scale, so input, cached and output are
 * comparable across the row as well as down it. Cached input is a SUBSET of
 * input, not a fourth quantity — the provider counts a cached read as input and
 * bills it at a fraction — so it is drawn against the same scale rather than
 * stacked onto it.
 */
export function TokenEfficiency({ trend }: { trend: TrendMonth[] }) {
  const max = Math.max(...trend.flatMap((m) => [m.tokens_in, m.tokens_out]), 0);
  if (max <= 0) {
    return (
      <section className="panel tokens-panel" aria-label="Token efficiency">
        <div className="panel-head">
          <h2>Token efficiency</h2>
        </div>
        <p className="muted">No token counts for this period.</p>
      </section>
    );
  }

  const rows = [
    { key: "tokens_in" as const, label: "Input", className: "in" },
    { key: "cached_tokens_in" as const, label: "Cached", className: "cached" },
    { key: "tokens_out" as const, label: "Output", className: "out" },
  ];

  // The rate is stated once for the period rather than once per month: twelve
  // columns leave about fifteen pixels each, which is narrower than "0.0%".
  // Per-month rates are on the Cached bars, where the pointer can reach them.
  const totalIn = trend.reduce((sum, m) => sum + m.tokens_in, 0);
  const totalCached = trend.reduce((sum, m) => sum + m.cached_tokens_in, 0);
  const periodRate = totalIn > 0 ? (totalCached / totalIn) * 100 : null;

  return (
    <section className="panel tokens-panel" aria-label="Token efficiency">
      <div className="panel-head">
        <h2>Token efficiency</h2>
        <span className="muted panel-note">Cached input is part of input</span>
      </div>
      <div
        className="token-grid"
        style={{ gridTemplateColumns: `auto repeat(${trend.length}, minmax(0, 1fr))` }}
      >
        <span />
        {trend.map((month) => (
          <span key={month.period} className="token-month">
            {monthLabel(month.period)}
          </span>
        ))}

        {rows.map((row) => (
          <Fragment key={row.key}>
            <span className="token-label">{row.label}</span>
            {trend.map((month) => (
              <span
                key={month.period}
                className="token-bar"
                title={
                  `${row.label} ${monthLabel(month.period)}: ${compact(month[row.key])}` +
                  (row.key === "cached_tokens_in" && month.tokens_in > 0
                    ? ` (${month.cache_rate.toFixed(1)}% of input)`
                    : "")
                }
              >
                <span
                  className={`token-fill ${row.className}`}
                  style={{ width: `${(month[row.key] / max) * 100}%` }}
                />
              </span>
            ))}
          </Fragment>
        ))}
      </div>
      <p className="muted token-foot">
        {periodRate === null
          ? "No input tokens in this period."
          : `Cache rate ${periodRate.toFixed(1)}% — that share of input tokens was read` +
            " from cache, and billed at a fraction of the standard rate."}
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
                className="provider-toggle"
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
