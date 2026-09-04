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
import { Link } from "react-router-dom";
import type { Dashboard, Insight, OpenAction, ProviderTotal, TrendMonth } from "../api";
import { ConnectorMark } from "./ConnectorMark";
import { money } from "../format";

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
  concentration: "info",
};

export function KeyInsights({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <section className="panel insights-panel" aria-label="Key insights">
      <div className="panel-head">
        <h2>Key insights</h2>
      </div>
      <ul className="insight-list">
        {insights.map((insight, i) => (
          <li key={i} className={`insight-item tone-${INSIGHT_TONE[insight.kind] ?? "info"}`}>
            <span className="insight-dot" aria-hidden />
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
export function SpendTrend({ trend }: { trend: TrendMonth[] }) {
  const max = Math.max(...trend.map((m) => m.build_cost + m.inference_cost), 0);
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
        <div className="trend-cols">
          {trend.map((month) => {
            const total = month.build_cost + month.inference_cost;
            return (
              <div
                key={month.period}
                className="trend-col"
                title={`${monthLabel(month.period)}: ${money(month.build_cost)} build · ${money(month.inference_cost)} inference`}
              >
                <div className="trend-stack" style={{ height: `${(total / max) * 100}%` }}>
                  {/* Stacked for shape only. The two are never one number. */}
                  <span className="trend-seg run" style={{ flexGrow: month.inference_cost || 0 }} />
                  <span className="trend-seg build" style={{ flexGrow: month.build_cost || 0 }} />
                </div>
                <span className="trend-col-label">{monthLabel(month.period)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Provider spend
// ---------------------------------------------------------------------------
export function ProviderSpendPanel({ providers }: { providers: ProviderTotal[] }) {
  const shown = providers.slice(0, 4);
  const rest = providers.slice(4);
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
        <ul className="provider-list">
          {shown.map((provider) => (
            <li key={provider.provider}>
              <ConnectorMark type={provider.provider} name={provider.provider} />
              <span className="provider-name">{providerLabel(provider.provider)}</span>
              <span className="provider-amount">{money(provider.amount)}</span>
              <span className="muted provider-share">{Math.round(provider.share)}%</span>
              <span className="provider-bar" aria-hidden>
                <span style={{ width: `${provider.share}%` }} />
              </span>
            </li>
          ))}
          {rest.length > 0 && (
            <li>
              <span className="connector-mark">+{rest.length}</span>
              <span className="provider-name muted">Others</span>
              <span className="provider-amount">{money(restTotal)}</span>
              <span className="muted provider-share">{Math.round(restShare)}%</span>
              <span className="provider-bar" aria-hidden>
                <span style={{ width: `${restShare}%` }} />
              </span>
            </li>
          )}
        </ul>
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
