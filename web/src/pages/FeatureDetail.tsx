/**
 * Feature drill-down (design §9.3), organized into two clear sections:
 *   - Developer cost: total build spend, contributors, and per-developer breakdown.
 *   - Inference cost: a trend chart + an interactive by-model donut, with a
 *     month / quarter / year window filter.
 * Plus the evidence trail — the actual signals behind every number.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type FeatureDetail as Detail, type FeatureInference } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ConfidenceBadge } from "../components/badges";
import { compact, money, num } from "../format";

const MODEL_COLORS = ["#4f46e5", "#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function FeatureDetail() {
  const { id = "" } = useParams();
  const { logout } = useAuth();
  const navigate = useNavigate();
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

  const hookMetered = detail?.inference_sources.includes("hook") ?? false;

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">Annapurna</span>
        <Link to="/dashboard" className="link">
          ← All features
        </Link>
        <button className="link signout" onClick={() => logout().then(() => navigate("/login"))}>
          Sign out
        </button>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {detail === null && !error ? (
        <p className="muted">Loading…</p>
      ) : detail ? (
        <main>
          <h1>{detail.name}</h1>
          {detail.description && <p className="muted">{detail.description}</p>}
          <p className="detail-meta">
            <span className="badge">{detail.status}</span>
            {detail.headline.active_users != null && (
              <span className="muted">{num(detail.headline.active_users)} active users this period</span>
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
                  <strong>{num(detail.build_contributors)}</strong>{" "}
                  contributor{detail.build_contributors === 1 ? "" : "s"}
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
            hookMetered={hookMetered}
          />

          {/* ---- Optimization opportunities ---- */}
          <OptimizationSection optimization={detail.optimization} />

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
        </main>
      ) : null}
    </div>
  );
}

function OptimizationSection({ optimization }: { optimization: Detail["optimization"] }) {
  const { opportunities, monthly_savings, annual_savings } = optimization;
  return (
    <section className="detail-section">
      <div className="section-head">
        <div>
          <h2>Optimization opportunities</h2>
          <span className="section-sub muted">
            Directional estimates from this feature&apos;s usage — not guaranteed savings.
          </span>
        </div>
        {monthly_savings > 0 && (
          <div className="savings-headline">
            <span className="savings-label">Potential savings</span>
            <span className="savings-month">{money(monthly_savings)}/mo</span>
            <span className="savings-year muted">{money(annual_savings)}/yr</span>
          </div>
        )}
      </div>
      {opportunities.length === 0 ? (
        <p className="muted">No optimization opportunities identified for this period.</p>
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
    </section>
  );
}

const WINDOWS = ["month", "quarter", "year"] as const;
type Window = (typeof WINDOWS)[number];

function InferenceSection({
  featureId,
  monthlyInference,
  hookMetered,
}: {
  featureId: string;
  monthlyInference: number;
  hookMetered: boolean;
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
            {money(monthlyInference)}/mo · {hookMetered ? "hook-metered" : "connector-derived"}
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

function TrendChart({ trend }: { trend: FeatureInference["trend"] }) {
  if (trend.length === 0) return <p className="muted">No inference cost yet.</p>;
  const max = Math.max(...trend.map((t) => t.amount), 1);
  return (
    <div className="trend-chart">
      {trend.map((t) => {
        const month = Number(t.period.slice(5, 7)) - 1;
        return (
          <div className="trend-bar-wrap" key={t.period} title={`${MONTHS[month]} · ${money(t.amount)}`}>
            <div className="trend-bar" style={{ height: `${Math.max(3, (t.amount / max) * 100)}%` }} />
            <span className="trend-label">{MONTHS[month]}</span>
          </div>
        );
      })}
    </div>
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
