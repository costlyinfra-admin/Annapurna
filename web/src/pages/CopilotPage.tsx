/**
 * Optimization Copilot — the tenant-wide Overview (opt spec §21). Answers "where's
 * the money and what do I fix first" across every feature. Measured, modeled and
 * verified savings are three distinct figures — never combined into one number.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type BillingOpportunity, type CopilotOverview } from "../api";
import { ConfidenceBadge } from "../components/badges";
import { money } from "../format";

/** Plain labels for billing-only findings — never the word "savings". */
const BILLING_LABELS: Record<string, string> = {
  unclassified_spend: "Spend to review",
  non_production_spend: "Spend to review",
  unattributed_spend: "Visibility opportunity",
  cost_concentration: "Cost concentration",
  cost_growth: "Cost growth",
  missing_cost_control: "Missing cost control",
};

const EFFORT_LABELS: Record<string, string> = {
  very_low: "Very low",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export function CopilotPage() {
  const [data, setData] = useState<CopilotOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.copilotOverview());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the Copilot Overview.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="content">
      <div className="dash-head">
        <h1>Optimization Copilot</h1>
      </div>
      <p className="muted">
        Where AI money is being wasted, and what to fix first — measured across every feature.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data === null && !error ? (
        <p className="muted">Loading…</p>
      ) : data ? (
        <>
          {/* Three distinct savings figures — never one blended number. */}
          <div className="copilot-kpis">
            <Kpi
              label="Measured savings"
              value={`${money(data.totals.measured)}/mo`}
              sub="Guaranteed, given your traffic"
              tone="measured"
            />
            <Kpi
              label="Modeled ceiling"
              value={`up to ${money(data.totals.modeled_ceiling)}/mo`}
              sub="Quality-gated — realize with care"
              tone="ceiling"
            />
            <Kpi
              label="Verified savings"
              value={`${money(data.verified_annual_savings)}/yr`}
              sub={`${money(data.verified_monthly_savings)}/mo proven & held`}
              tone="verified"
            />
          </div>

          {data.billing_opportunities.length > 0 && (
            <section className="detail-section">
              <div className="section-head">
                <div>
                  <h2>What you can optimize from billing data</h2>
                  <span className="section-sub muted">
                    These recommendations use provider billing and resource metadata. They do not
                    infer prompt, model, caching, quality, user, or feature-level optimizations.
                  </span>
                </div>
              </div>
              <ul className="billing-opps">
                {data.billing_opportunities.map((o) => (
                  <BillingCard key={o.id} opp={o} />
                ))}
              </ul>
              {!data.has_sdk_telemetry && (
                <p className="muted billing-sdk-note">
                  Request-, user- and feature-level optimizations (duplicate calls, cacheable
                  prefixes, model right-sizing) need request telemetry.{" "}
                  <Link to="/install-sdk" className="link">
                    Install the SDK
                  </Link>{" "}
                  to unlock them.
                </p>
              )}
            </section>
          )}

          <section className="detail-section">
            <div className="section-head">
              <h2>Top recommendations</h2>
              <span className="section-sub muted">Ranked by savings × confidence × effort.</span>
            </div>
            {data.top_recommendations.length === 0 ? (
              <p className="muted">
                {data.has_billing_data
                  ? "No measured opportunities yet — these need request telemetry from the SDK."
                  : "No measured opportunities yet across your features."}
              </p>
            ) : (
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Opportunity</th>
                    <th>Feature</th>
                    <th className="num">Savings</th>
                    <th>Confidence</th>
                    <th>Effort</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_recommendations.map((o) => (
                    <tr key={`${o.feature_id}-${o.lever}`}>
                      <td title={o.evidence}>{o.title}</td>
                      <td>
                        <Link to={`/features/${o.feature_id}`} className="link">
                          {o.feature_name}
                        </Link>
                      </td>
                      <td className="num">
                        {o.savings_type === "modeled_ceiling" && (
                          <span className="opt-ceiling">up to </span>
                        )}
                        {money(o.projected_monthly_savings)}/mo
                      </td>
                      <td>
                        <ConfidenceBadge level={o.confidence} />
                      </td>
                      <td>{EFFORT_LABELS[o.engineering_effort] ?? o.engineering_effort}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="copilot-cols">
            <section className="detail-section">
              <div className="section-head">
                <h2>By feature</h2>
                <span className="section-sub muted">Where the money is.</span>
              </div>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th className="num">Measured</th>
                    <th className="num">Modeled</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_feature
                    .filter((f) => f.measured > 0 || f.modeled_ceiling > 0)
                    .map((f) => (
                      <tr key={f.feature_id}>
                        <td>
                          <Link to={`/features/${f.feature_id}`} className="link">
                            {f.name}
                          </Link>
                        </td>
                        <td className="num">{money(f.measured)}/mo</td>
                        <td className="num muted">
                          {f.modeled_ceiling > 0 ? `up to ${money(f.modeled_ceiling)}/mo` : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>

            <section className="detail-section">
              <div className="section-head">
                <h2>By lever</h2>
                <span className="section-sub muted">Where the leverage is.</span>
              </div>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Lever</th>
                    <th className="num">Features</th>
                    <th className="num">Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_lever.map((l) => (
                    <tr key={l.lever}>
                      <td>{l.title}</td>
                      <td className="num">{l.count}</td>
                      <td className="num">
                        {l.savings_type === "modeled_ceiling" && (
                          <span className="opt-ceiling">up to </span>
                        )}
                        {money(l.monthly)}/mo
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          {data.applied.length > 0 && (
            <section className="detail-section">
              <div className="section-head">
                <h2>Applied &amp; verified</h2>
                <span className="section-sub muted">
                  Projected savings reconciled against the measured drop since.
                </span>
              </div>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Optimization</th>
                    <th>Feature</th>
                    <th className="num">Projected</th>
                    <th className="num">Realized</th>
                  </tr>
                </thead>
                <tbody>
                  {data.applied.map((a) => (
                    <tr key={`${a.feature_id}-${a.lever}`}>
                      <td>{a.lever.replace(/_/g, " ")}</td>
                      <td>
                        <Link to={`/features/${a.feature_id}`} className="link">
                          {a.feature_name}
                        </Link>
                      </td>
                      <td className="num">{money(a.projected_monthly)}/mo</td>
                      <td className="num">
                        {a.status === "pending" ? (
                          <span className="muted">awaiting next period</span>
                        ) : (
                          <>
                            <strong className="opt-realized">
                              {money(a.realized_monthly ?? 0)}/mo
                            </strong>
                            {a.status === "verified" && (
                              <span className="opt-verified">✓ Verified</span>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}

/** One billing-only finding, with its full evidence trail on display. */
function BillingCard({ opp }: { opp: BillingOpportunity }) {
  const ev = opp.evidence;
  return (
    <li className="billing-opp">
      <div className="billing-opp-head">
        <span className={`billing-tag billing-tag-${opp.type}`}>
          {BILLING_LABELS[opp.type] ?? "Finding"}
        </span>
        <strong className="billing-opp-title">{opp.title}</strong>
        {ev.observed_cost != null && (
          <span className="billing-opp-amt">{money(ev.observed_cost)}</span>
        )}
      </div>
      <p className="billing-opp-desc">{opp.description}</p>

      <dl className="billing-evidence">
        <div>
          <dt>Savings</dt>
          <dd>
            {opp.savings.kind === "not_quantified"
              ? "Not quantified"
              : `${money(opp.savings.amount)} (${opp.savings.kind})`}
            <span className="muted"> — {opp.savings.explanation}</span>
          </dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>
            {ev.source} · {ev.period_start} → {ev.period_end}
          </dd>
        </div>
        <div>
          <dt>Calculation</dt>
          <dd className="mono">{ev.calculation}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>
            <ConfidenceBadge level={opp.confidence === "medium" ? "med" : "high"} />
            {opp.limitations.map((l) => (
              <span key={l} className="muted billing-limitation">
                {l}
              </span>
            ))}
          </dd>
        </div>
      </dl>

      <Link to={opp.action.href} className="link">
        {opp.action.label} →
      </Link>
    </li>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "measured" | "ceiling" | "verified";
}) {
  return (
    <div className={`copilot-kpi kpi-${tone}`}>
      <span className="copilot-kpi-label">{label}</span>
      <span className="copilot-kpi-value">{value}</span>
      <span className="copilot-kpi-sub muted">{sub}</span>
    </div>
  );
}
