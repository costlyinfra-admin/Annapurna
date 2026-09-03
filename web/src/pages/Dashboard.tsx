/**
 * Features dashboard — the money screen (design §9.1).
 *
 * Build cost and inference cost live in SEPARATE columns and are never blended.
 * Each cost number links to the feature's drill-down, where its evidence trail
 * lives. An Unattributed row carries spend not yet mapped to a feature.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  ApiError,
  type Dashboard as DashboardData,
  type DashboardRow,
  type RangeKind,
  type ReviewRange,
} from "../api";
import { CategoryBadge, ConfidenceBadge, WorthBadge } from "../components/badges";
import { CustomerBreakdown } from "../components/CustomerBreakdown";
import { DeveloperBreakdown } from "../components/DeveloperBreakdown";
import { OnboardingChecklist } from "../components/OnboardingChecklist";
import { PeriodSelector } from "../components/PeriodSelector";
import { ProviderBreakdown } from "../components/ProviderBreakdown";
import { compact, money, num } from "../format";

type OverviewTab = "features" | "providers" | "developers" | "customers";

/** Notify the app shell (which owns the alerts badge) to re-poll alert state. */
export const REFRESH_ALERTS_EVENT = "annapurna:refresh-alerts";

/** What the month-over-month delta is compared against, per selected range. */
const DELTA_LABEL: Record<RangeKind, string> = {
  this_month: "vs last month",
  last_month: "vs the month before",
  last_3_months: "vs prev 3 months",
  last_6_months: "vs prev 6 months",
  last_12_months: "vs prev 12 months",
  custom: "vs prior period",
};

/** "2026-05-01" + "2026-05-01" -> "May 2026"; spans -> "Mar – May 2026". */
function fmtRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleString("en-US", {
      month: "short",
      year: "numeric",
    });
  return startIso === endIso ? fmt(startIso) : `${fmt(startIso)} – ${fmt(endIso)}`;
}

/** "Aug 22, 4:07 PM" — short, local, no seconds. */
function shortStamp(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Per-source detail for the freshness tooltip. */
function freshnessDetail(inferenceAt: string | null, buildAt: string | null): string {
  const one = (label: string, iso: string | null) =>
    `${label}: ${iso ? shortStamp(new Date(iso)) : "never synced"}`;
  return `When cost was last ingested — ${one("Inference", inferenceAt)} · ${one("Build", buildAt)}`;
}

export function Dashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<OverviewTab>("features");
  const [range, setRange] = useState<ReviewRange>({ kind: "this_month" });
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    api
      .dashboard(range)
      .then((d) => active && setData(d))
      .catch(
        (err) =>
          active &&
          setError(err instanceof ApiError ? err.message : "Could not load the dashboard."),
      );
    return () => {
      active = false;
    };
  }, [range, refreshKey]);

  // Refresh = pull fresh cost from every connected inference provider (current
  // month), then re-read everything the Overview shows plus the alerts badge
  // (owned by the app shell, signalled via a window event). A provider that fails
  // is reported rather than silently leaving stale numbers on screen.
  const refreshAll = async () => {
    setRefreshing(true);
    setRefreshNote(null);
    try {
      const r = await api.refreshInference();
      if (r.errors.length > 0) {
        setRefreshNote(
          `Could not refresh ${r.errors.map((e) => `${e.provider} (${e.error})`).join("; ")}`,
        );
      }
    } catch (err) {
      setRefreshNote(
        err instanceof ApiError ? err.message : "Could not pull fresh cost from providers.",
      );
    } finally {
      setRefreshing(false);
      setRefreshKey((k) => k + 1); // re-read regardless, so alerts/stored cost update
      window.dispatchEvent(new Event(REFRESH_ALERTS_EVENT));
    }
  };

  const hasFeatures = !!data && data.features.length > 0;
  const hasBuild = !!data && data.totals.build_cost > 0;
  const hasInference = !!data && data.totals.inference_cost > 0;
  const setupComplete = hasFeatures && hasBuild && hasInference;
  const deltaLabel = DELTA_LABEL[range.kind];

  return (
    <div className="content">
      <div className="dash-head">
        <h1>Overview</h1>
        <div className="last-updated">
          {data?.data_updated_at && (
            <span
              className="muted last-updated-text"
              title={freshnessDetail(data.inference_updated_at, data.build_updated_at)}
            >
              Updated {shortStamp(new Date(data.data_updated_at))}
            </span>
          )}
          <button
            type="button"
            className={refreshing ? "icon-button spinning" : "icon-button"}
            onClick={refreshAll}
            disabled={data === null || refreshing}
            aria-label="Refresh data and alerts"
            title="Pull fresh cost from connected providers, then reload"
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {refreshNote && (
        <p className="error" role="alert">
          {refreshNote}
        </p>
      )}

      {data && !setupComplete && (
        <OnboardingChecklist
          hasFeatures={hasFeatures}
          hasBuild={hasBuild}
          hasInference={hasInference}
        />
      )}

      {data === null && !error && <p className="muted">Loading…</p>}

      {data && <ExecutiveSummary data={data} />}

      {data && <KeyInsights insights={data.insights} />}

      {data && (
        <div className="totals-strip">
          <div className="total-card">
            <span className="total-label">Build cost</span>
            <span className="total-value">{money(data.totals.build_cost)}</span>
            <MonthDelta
              current={data.totals.build_cost}
              prev={data.totals.prev_build_cost}
              label={deltaLabel}
            />
          </div>
          <div className="total-card">
            <span className="total-label">Inference cost</span>
            <span className="total-value">{money(data.totals.inference_cost)}</span>
            {data.totals.estimated_inference > 0 && (
              <span className="muted" title="Recent usage not yet on the provider's bill">
                incl. ~{money(data.totals.estimated_inference)} estimated
              </span>
            )}
            <MonthDelta
              current={data.totals.inference_cost}
              prev={data.totals.prev_inference_cost}
              label={deltaLabel}
            />
          </div>
          <div className="total-card">
            <span className="total-label">Total tokens</span>
            <span className="total-value">
              {compact(data.totals.tokens_in + data.totals.tokens_out)}
            </span>
            <span className="muted">
              {compact(data.totals.tokens_in)} in · {compact(data.totals.tokens_out)} out
            </span>
          </div>
        </div>
      )}

      {/* Review-period selector, right-justified beneath the cost/token tiles.
          Always rendered so it doesn't flicker away while a range change reloads. */}
      <div className="period-controls period-controls-below">
        {data && <span className="muted period-label">{fmtRange(data.start, data.end)}</span>}
        <PeriodSelector value={range} onChange={setRange} />
      </div>

      {/* Tabs switch only the detailed breakdown below; the summary, insights,
          and totals above stay put no matter which tab is active. */}
      {data && (
        <div className="tabs" role="tablist" aria-label="Cost breakdown">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "features"}
            className={tab === "features" ? "tab active" : "tab"}
            onClick={() => setTab("features")}
          >
            By Feature
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "providers"}
            className={tab === "providers" ? "tab active" : "tab"}
            onClick={() => setTab("providers")}
          >
            By Provider
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "developers"}
            className={tab === "developers" ? "tab active" : "tab"}
            onClick={() => setTab("developers")}
          >
            By Developer
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "customers"}
            className={tab === "customers" ? "tab active" : "tab"}
            onClick={() => setTab("customers")}
          >
            By Customer
          </button>
        </div>
      )}

      {data && tab === "features" && data.features.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No features yet</p>
          <p className="muted">
            Your dashboard fills in as you finish setup above — start by discovering features.
          </p>
        </div>
      ) : data && tab === "features" ? (
        <table className="features-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th title="Which part of the product this feature belongs to">Type</th>
              <th className="num">Build cost</th>
              <th className="num">{data.months > 1 ? "Inference" : "Inference / mo"}</th>
              <th className="num">Active users</th>
              <th className="num">Cost / user</th>
              <th className="num">Requests</th>
              <th>Worth it?</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {data.features.map((f) => (
              <tr
                key={f.feature_id}
                className="feature-row"
                onClick={() => navigate(`/features/${f.feature_id}`)}
              >
                <td>
                  <Link to={`/features/${f.feature_id}`} onClick={(e) => e.stopPropagation()}>
                    {f.name}
                  </Link>
                </td>
                <td>
                  <CategoryBadge category={f.category} source={f.category_source} />
                </td>
                <td className="num">{money(f.build_cost)}</td>
                <td className="num">{money(f.inference_cost)}</td>
                <td className="num">{num(f.active_users)}</td>
                <td className="num">{money(f.cost_per_user)}</td>
                <td className="num" title="AI model calls this feature made">
                  {compact(f.requests)}
                </td>
                <td>
                  <WorthBadge value={f.worth_it} />
                </td>
                <td>
                  <ConfidenceBadge level={f.confidence} />
                </td>
              </tr>
            ))}
            <tr className="unattributed-row">
              <td>Unattributed</td>
              <td className="muted">—</td>
              <td className="num">{money(data.unattributed.build_cost)}</td>
              <td className="num">{money(data.unattributed.inference_cost)}</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td colSpan={2} className="muted">
                spend not yet mapped to a feature
              </td>
            </tr>
          </tbody>
        </table>
      ) : null}

      {data && tab === "features" && (
        <p className="muted legend">
          "Worth it?" is directional (cost per active user), not a revenue-based ROI.
        </p>
      )}

      {data && tab === "providers" && <ProviderBreakdown range={range} refreshKey={refreshKey} />}

      {data && tab === "developers" && <DeveloperBreakdown range={range} refreshKey={refreshKey} />}

      {data && tab === "customers" && <CustomerBreakdown range={range} refreshKey={refreshKey} />}
    </div>
  );
}

/** Circular-arrow refresh glyph. */
function RefreshIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}

/** Change vs the prior equal-length window. Up = more spend (shown as a
 *  caution), down = less (good). No prior data -> a neutral note. */
function MonthDelta({ current, prev, label }: { current: number; prev: number; label: string }) {
  if (prev <= 0) {
    return <span className="muted">no prior period</span>;
  }
  const pct = ((current - prev) / prev) * 100;
  const up = current >= prev;
  return (
    <span className={`delta ${up ? "delta-up" : "delta-down"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% {label}
    </span>
  );
}

/** Executive summary — one compact card; the headlines a CTO/CFO scans first. */
function ExecutiveSummary({ data }: { data: DashboardData }) {
  const { most_expensive, optimization, highest_cost_per_user } = data.highlights;
  const unattributedTotal = data.unattributed.build_cost + data.unattributed.inference_cost;

  return (
    <section className="exec-summary" aria-label="Executive summary">
      <ExecItem label="Most expensive" tone="neutral">
        {most_expensive ? (
          <>
            <FeatureValue feature={most_expensive} />
            {/* build and inference stay separate — never one blended number */}
            <span className="exec-sub">
              {money(most_expensive.build_cost)} build · {money(most_expensive.inference_cost)}/mo
            </span>
          </>
        ) : (
          <ExecEmpty note="No cost yet" />
        )}
      </ExecItem>

      <ExecItem label="Optimization" tone={optimization ? "warn" : "good"}>
        {optimization ? (
          <>
            <FeatureValue feature={optimization} />
            <span className="exec-sub">
              {money(optimization.inference_cost)}/mo · {money(optimization.cost_per_user)}/user
            </span>
          </>
        ) : (
          <ExecEmpty note="Nothing flagged" />
        )}
      </ExecItem>

      <ExecItem label="Highest cost / user" tone={highest_cost_per_user ? "warn" : "neutral"}>
        {highest_cost_per_user ? (
          <>
            <FeatureValue feature={highest_cost_per_user} />
            <span className="exec-sub">
              {money(highest_cost_per_user.cost_per_user)}/user ·{" "}
              {num(highest_cost_per_user.active_users)} users
            </span>
          </>
        ) : (
          <ExecEmpty note="No usage data" />
        )}
      </ExecItem>

      <ExecItem label="Unattributed spend" tone={unattributedTotal > 0 ? "warn" : "good"}>
        <span className="exec-value num">{money(unattributedTotal)}</span>
        <span className="exec-sub">
          {money(data.unattributed.inference_cost)} inf · {money(data.unattributed.build_cost)}{" "}
          build
        </span>
      </ExecItem>
    </section>
  );
}

/** Auto-generated plain-language insights — the story behind the numbers. */
function KeyInsights({ insights }: { insights: DashboardData["insights"] }) {
  if (insights.length === 0) return null;
  return (
    <section className="insights" aria-label="Key insights">
      <span className="insights-title">Key insights</span>
      <ul className="insight-list">
        {insights.map((ins, i) => (
          <li key={i} className={`insight-item insight--${ins.kind}`}>
            {ins.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExecItem({
  label,
  tone = "neutral",
  children,
}: {
  label: string;
  tone?: "neutral" | "warn" | "good";
  children: ReactNode;
}) {
  return (
    <div className={`exec-item exec-item--${tone}`}>
      <span className="exec-label">{label}</span>
      {children}
    </div>
  );
}

function FeatureValue({ feature }: { feature: DashboardRow }) {
  return (
    <Link to={`/features/${feature.feature_id}`} className="exec-value" title={feature.name}>
      {feature.name}
    </Link>
  );
}

function ExecEmpty({ note }: { note: string }) {
  return (
    <>
      <span className="exec-value muted">—</span>
      <span className="exec-sub">{note}</span>
    </>
  );
}
