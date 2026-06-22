/**
 * Features dashboard — the money screen (design §9.1).
 *
 * Build cost and inference cost live in SEPARATE columns and are never blended.
 * Each cost number links to the feature's drill-down, where its evidence trail
 * lives. An Unattributed row carries spend not yet mapped to a feature.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type Dashboard as DashboardData, type DashboardRow } from "../api";
import { ConfidenceBadge, WorthBadge } from "../components/badges";
import { OnboardingChecklist } from "../components/OnboardingChecklist";
import { ProviderBreakdown } from "../components/ProviderBreakdown";
import { compact, money, num } from "../format";

type OverviewTab = "features" | "providers";

export function Dashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<OverviewTab>("features");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.dashboard());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the dashboard.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hasFeatures = !!data && data.features.length > 0;
  const hasBuild = !!data && data.totals.build_cost > 0;
  const hasInference = !!data && data.totals.inference_cost > 0;
  const setupComplete = hasFeatures && hasBuild && hasInference;

  return (
    <div className="content">
      <div className="dash-head">
        <h1>Overview</h1>
        {data && <span className="muted">Period {data.period}</span>}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
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
            <span className="muted">one-time-ish</span>
          </div>
          <div className="total-card">
            <span className="total-label">Inference cost</span>
            <span className="total-value">{money(data.totals.inference_cost)}</span>
            <span className="muted">monthly</span>
          </div>
        </div>
      )}

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
            By feature
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "providers"}
            className={tab === "providers" ? "tab active" : "tab"}
            onClick={() => setTab("providers")}
          >
            By provider
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
              <th className="num">Build cost</th>
              <th className="num">Inference / mo</th>
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

      {data && tab === "providers" && <ProviderBreakdown />}
    </div>
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
