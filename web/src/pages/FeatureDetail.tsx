/**
 * Feature drill-down (design §9.3), organized into two clear sections:
 *   - Developer cost: total build spend, contributors, and per-developer breakdown.
 *   - Inference cost: a trend chart + an interactive by-model donut, with a
 *     month / quarter / year window filter.
 * Plus the evidence trail — the actual signals behind every number.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  ApiError,
  type FeatureDetail as Detail,
  type FeatureInference,
  type FeatureOpportunities,
  type MeasuredOpportunity,
  type OptimizationAction,
} from "../api";
import { ConfidenceBadge } from "../components/badges";
import { TrendChart } from "../components/TrendChart";
import { compact, money, num } from "../format";

const LEVER_LABELS: Record<string, string> = {
  duplicate_calls: "Duplicate calls",
  prompt_caching: "Prompt caching",
  provider_switch: "Cheaper provider",
};

const MODEL_COLORS = ["#4f46e5", "#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

export function FeatureDetail() {
  const { id = "" } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api.featureDetail(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this feature.");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const sources = detail?.inference_sources ?? [];
  const inferenceLabel = sources.includes("self_host")
    ? "self-hosted (allocated)"
    : sources.includes("hook")
      ? "hook-metered"
      : "connector-derived";

  return (
    <div className="content">
      <Link to="/" className="link breadcrumb">
        ← All features
      </Link>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {detail === null && !error ? (
        <p className="muted">Loading…</p>
      ) : detail ? (
        <div>
          <h1>{detail.name}</h1>
          {detail.description && <p className="muted">{detail.description}</p>}
          <p className="detail-meta">
            <span className="badge">{detail.status}</span>
            {detail.headline.active_users != null && (
              <span className="muted">
                {num(detail.headline.active_users)} active users this period
              </span>
            )}
            {detail.headline.avg_latency_ms != null && (
              <span className="muted" title="Average latency of metered (SDK) calls">
                {num(detail.headline.avg_latency_ms)} ms avg latency
              </span>
            )}
          </p>

          {/* ---- Developer cost ---- */}
          <section className="detail-section">
            <div className="section-head">
              <h2>Developer cost</h2>
              <div className="section-stats">
                <span>
                  <strong>{money(detail.build_total)}</strong> total
                </span>
                <span>
                  <strong>{num(detail.build_contributors)}</strong> contributor
                  {detail.build_contributors === 1 ? "" : "s"}
                </span>
              </div>
            </div>
            {detail.build_by_developer.length === 0 ? (
              <p className="muted">No build cost imported yet.</p>
            ) : (
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Developer</th>
                    <th>Tool</th>
                    <th className="num">Amount</th>
                    <th className="num">Commits</th>
                    <th className="num">PRs</th>
                    <th className="num">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.build_by_developer.map((d, i) => (
                    <tr key={i}>
                      <td>{d.developer_id}</td>
                      <td>{d.tool.replace("_", " ")}</td>
                      <td className="num">{money(d.amount)}</td>
                      <td className="num">{num(d.commits)}</td>
                      <td className="num">{num(d.prs)}</td>
                      <td className="num">{num(d.files_changed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ---- Inference cost ---- */}
          <InferenceSection
            featureId={detail.feature_id}
            monthlyInference={detail.headline.inference_cost}
            sourceLabel={inferenceLabel}
          />

          {/* ---- Optimization opportunities ---- */}
          <OptimizationSection featureId={detail.feature_id} />

          {/* ---- Evidence trail ---- */}
          <section className="evidence-trail">
            <h2>Evidence trail</h2>
            <p className="muted">Every number above traces back to these signals.</p>
            {detail.evidence.length === 0 ? (
              <p className="muted">No signals recorded.</p>
            ) : (
              <ul className="evidence-list">
                {detail.evidence.map((s, i) => (
                  <li key={i} className="evidence-item">
                    <span className="evidence-type">{s.signal_type}</span>
                    <span className="evidence-ref">{s.external_ref}</span>
                    {s.actor && <span className="muted">by {s.actor}</span>}
                    {s.confidence && <ConfidenceBadge level={s.confidence} />}
                    {s.source && <span className="muted">via {s.source}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleString("en-US", { month: "short", year: "numeric" });
}

function OptimizationSection({ featureId }: { featureId: string }) {
  const [data, setData] = useState<FeatureOpportunities | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.featureOpportunities(featureId));
    } catch {
      setFailed(true);
    }
  }, [featureId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="detail-section">
      <div className="section-head">
        <div>
          <h2>Optimization opportunities</h2>
          <span className="section-sub muted">
            Measured findings from metered calls, plus directional estimates from usage.
          </span>
        </div>
      </div>

      {failed ? (
        <p className="muted">Could not load optimization opportunities.</p>
      ) : data === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <MeasuredGroup
            featureId={featureId}
            measured={data.measured}
            cacheUtilization={data.cache_utilization}
            actions={data.actions}
            onChange={load}
          />
          <EstimatedGroup estimated={data.estimated} />
        </>
      )}
    </section>
  );
}

function MeasuredGroup({
  featureId,
  measured,
  cacheUtilization,
  actions,
  onChange,
}: {
  featureId: string;
  measured: FeatureOpportunities["measured"];
  cacheUtilization: number | null;
  actions: OptimizationAction[];
  onChange: () => Promise<void>;
}) {
  const { opportunities, monthly_savings, annual_savings } = measured;
  const actionByLever = new Map(actions.map((a) => [a.lever, a]));
  return (
    <div className="opt-group">
      <div className="opt-group-head">
        <div>
          <h3 className="opt-group-title">
            Measured <span className="opt-tag opt-tag-measured">grounded in measured usage</span>
          </h3>
          {cacheUtilization != null && (
            <span className="section-sub muted">
              {Math.round(cacheUtilization * 100)}% of input is already cached.
            </span>
          )}
        </div>
        {monthly_savings > 0 && (
          <div className="savings-headline">
            <span className="savings-label">Measured savings</span>
            <span className="savings-month">{money(monthly_savings)}/mo</span>
            <span className="savings-year muted">{money(annual_savings)}/yr</span>
          </div>
        )}
      </div>

      {opportunities.length === 0 ? (
        <div className="opt-nudge">
          <p>
            No measured opportunities yet. Install the metering SDK with <code>optimize=True</code>{" "}
            to turn the estimates below into measured, per-call findings.
          </p>
          <Link to="/install-sdk" className="link">
            Install SDK →
          </Link>
        </div>
      ) : (
        <ul className="opt-list">
          {opportunities.map((o) => (
            <MeasuredRow
              key={o.lever}
              opp={o}
              featureId={featureId}
              action={actionByLever.get(o.lever) ?? null}
              onChange={onChange}
            />
          ))}
        </ul>
      )}

      <AppliedActions actions={actions} />
    </div>
  );
}

function MeasuredRow({
  opp,
  featureId,
  action,
  onChange,
}: {
  opp: MeasuredOpportunity;
  featureId: string;
  action: OptimizationAction | null;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const applied = action != null;

  async function toggle() {
    setBusy(true);
    try {
      if (applied) await api.unapplyOpportunity(featureId, opp.lever);
      else await api.applyOpportunity(featureId, opp.lever, opp.savings);
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="opt-item">
      <div className="opt-item-main">
        <div className="opt-item-lever">
          <strong>{LEVER_LABELS[opp.lever] ?? opp.lever}</strong>
          <ConfidenceBadge level={opp.confidence} />
          {applied && (
            <span className="opt-applied-chip">✓ Applied {monthLabel(action.applied_on)}</span>
          )}
        </div>
        <div className="opt-item-actions">
          <span className="opt-item-savings">{money(opp.savings)}/mo</span>
          <button className="opt-apply-btn" onClick={toggle} disabled={busy}>
            {applied ? "Undo" : "Mark as applied"}
          </button>
        </div>
      </div>
      <p className="opt-item-evidence">{opp.evidence}</p>
      <p className="opt-item-fix muted">{opp.fix}</p>
      {opp.trail.length > 0 && (
        <details className="opt-trail">
          <summary>Evidence trail ({opp.trail.length})</summary>
          <ul className="evidence-list">
            {opp.trail.map((t, i) => (
              <li key={i} className="evidence-item">
                <span className="evidence-type">{t.model}</span>
                {t.fingerprint && <span className="evidence-ref">{t.fingerprint}…</span>}
                {t.note && <span className="muted">{t.note}</span>}
                {t.call_count != null && <span className="muted">{num(t.call_count)} repeats</span>}
                {t.prefix_tokens != null && (
                  <span className="muted">
                    {num(t.prefix_tokens)}-tok prefix · {num(t.calls ?? 0)} calls
                    {t.cached != null && ` · ${num(t.cached)} cached`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function AppliedActions({ actions }: { actions: OptimizationAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="opt-applied">
      <h4 className="opt-applied-title">Applied optimizations</h4>
      <span className="section-sub muted">
        Projected savings frozen at apply time, reconciled against the measured drop since.
      </span>
      <table className="mini-table">
        <thead>
          <tr>
            <th>Optimization</th>
            <th>Applied</th>
            <th className="num">Projected</th>
            <th className="num">Realized</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => (
            <tr key={a.lever}>
              <td>{LEVER_LABELS[a.lever] ?? a.lever}</td>
              <td>{monthLabel(a.applied_on)}</td>
              <td className="num">{money(a.projected_monthly)}/mo</td>
              <td className="num">
                {a.status === "measured" ? (
                  <strong className="opt-realized">{money(a.realized_monthly ?? 0)}/mo</strong>
                ) : (
                  <span className="muted">awaiting next period</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EstimatedGroup({ estimated }: { estimated: FeatureOpportunities["estimated"] }) {
  const { opportunities, monthly_savings, annual_savings } = estimated;
  return (
    <div className="opt-group opt-group-estimated">
      <div className="opt-group-head">
        <div>
          <h3 className="opt-group-title">
            Estimated <span className="opt-tag">directional estimate</span>
          </h3>
          <span className="section-sub muted">
            Rules of thumb from this feature&apos;s usage — not guaranteed savings.
          </span>
        </div>
        {monthly_savings > 0 && (
          <div className="savings-headline">
            <span className="savings-label">Estimated savings</span>
            <span className="savings-month">{money(monthly_savings)}/mo</span>
            <span className="savings-year muted">{money(annual_savings)}/yr</span>
          </div>
        )}
      </div>
      {opportunities.length === 0 ? (
        <p className="muted">No estimated opportunities for this period.</p>
      ) : (
        <table className="mini-table">
          <thead>
            <tr>
              <th>Opportunity</th>
              <th className="num">Potential savings</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((o) => (
              <tr key={o.opportunity}>
                <td title={o.rationale}>{o.opportunity}</td>
                <td className="num">{money(o.savings)}/mo</td>
                <td>
                  <ConfidenceBadge level={o.confidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const WINDOWS = ["month", "quarter", "year"] as const;
type Window = (typeof WINDOWS)[number];

function InferenceSection({
  featureId,
  monthlyInference,
  sourceLabel,
}: {
  featureId: string;
  monthlyInference: number;
  sourceLabel: string;
}) {
  const [window, setWindow] = useState<Window>("month");
  const [data, setData] = useState<FeatureInference | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    api
      .featureInference(featureId, window)
      .then((d) => active && setData(d))
      .catch(() => active && setData({ window, total: 0, by_model: [], trend: [] }));
    return () => {
      active = false;
    };
  }, [featureId, window]);

  return (
    <section className="detail-section">
      <div className="section-head">
        <div>
          <h2>Inference cost</h2>
          <span className="section-sub muted">
            {money(monthlyInference)}/mo · {sourceLabel}
          </span>
        </div>
        <div className="window-filter" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w}
              className={w === window ? "active" : ""}
              onClick={() => {
                setHover(null);
                setWindow(w);
              }}
            >
              {w[0].toUpperCase() + w.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {data === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="inference-body">
          <div className="inference-col">
            <span className="chart-title">Trend</span>
            <TrendChart trend={data.trend} />
          </div>
          <div className="inference-col">
            <span className="chart-title">By model</span>
            {data.by_model.length === 0 ? (
              <p className="muted">No inference cost in this window.</p>
            ) : (
              <div className="pie-wrap">
                <DonutPie models={data.by_model} hover={hover} setHover={setHover} />
                <PieCaption models={data.by_model} index={hover ?? 0} />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function DonutPie({
  models,
  hover,
  setHover,
}: {
  models: FeatureInference["by_model"];
  hover: number | null;
  setHover: (i: number | null) => void;
}) {
  let filled = 0;
  return (
    <svg viewBox="0 0 36 36" className="donut" role="img" aria-label="Inference cost by model">
      {models.map((m, i) => {
        const offset = 25 - filled; // start at 12 o'clock, then continue clockwise
        filled += m.pct;
        return (
          <circle
            key={m.model}
            cx="18"
            cy="18"
            r="15.9155"
            fill="none"
            stroke={MODEL_COLORS[i % MODEL_COLORS.length]}
            strokeWidth={hover === i ? 5 : 3.5}
            strokeDasharray={`${m.pct} ${100 - m.pct}`}
            strokeDashoffset={offset}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "pointer", transition: "stroke-width 0.1s" }}
          />
        );
      })}
    </svg>
  );
}

function PieCaption({ models, index }: { models: FeatureInference["by_model"]; index: number }) {
  const m = models[Math.min(index, models.length - 1)];
  if (!m) return null;
  const color = MODEL_COLORS[Math.min(index, models.length - 1) % MODEL_COLORS.length];
  return (
    <div className="pie-caption">
      <span className="pie-cap-model">
        <span className="swatch" style={{ background: color }} />
        {m.model}
      </span>
      <span className="pie-cap-cost">
        {money(m.amount)} · {Math.round(m.pct)}%
      </span>
      <span className="muted">{compact(m.requests)} requests</span>
    </div>
  );
}
