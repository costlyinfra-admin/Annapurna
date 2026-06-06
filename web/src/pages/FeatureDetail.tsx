/**
 * Feature drill-down (design §9.3): three headline numbers (build / inference /
 * users, kept separate), build cost by developer, inference trend over time, and
 * the evidence trail — the actual signals behind every number. An indicator
 * shows whether inference is connector-derived or hook-metered (M7).
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type FeatureDetail as Detail } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ConfidenceBadge } from "../components/badges";
import { compact, money, num } from "../format";

const MODEL_COLORS = ["#4f46e5", "#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

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

  const hookMetered = detail?.inference_sources.includes("hook");

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

          {/* Three headline numbers — build and inference always separate. */}
          <div className="headline-cards">
            <div className="headline-card">
              <span className="total-label">Build cost</span>
              <span className="total-value">{money(detail.headline.build_cost)}</span>
              <span className="muted">to build (cumulative)</span>
            </div>
            <div className="headline-card">
              <span className="total-label">Inference / mo</span>
              <span className="total-value">{money(detail.headline.inference_cost)}</span>
              <span className="muted">{hookMetered ? "hook-metered" : "connector-derived"}</span>
            </div>
            <div className="headline-card">
              <span className="total-label">Active users</span>
              <span className="total-value">{num(detail.headline.active_users)}</span>
              <span className="muted">this period</span>
            </div>
          </div>

          <div className="detail-cols">
            <section className="detail-col">
              <h2>Build cost by developer</h2>
              <div className="build-stats">
                <span>
                  <span className="build-stat-value">{money(detail.build_total)}</span>
                  <span className="build-stat-label">Total AI build spend</span>
                </span>
                <span>
                  <span className="build-stat-value">{num(detail.build_contributors)}</span>
                  <span className="build-stat-label">
                    Contributor{detail.build_contributors === 1 ? "" : "s"}
                  </span>
                </span>
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

            <section className="detail-col">
              <h2>Inference trend</h2>
              {detail.inference_trend.length === 0 ? (
                <p className="muted">No inference cost yet.</p>
              ) : (
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="num">Inference</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.inference_trend.map((t) => (
                      <tr key={t.period}>
                        <td>{t.period.slice(0, 7)}</td>
                        <td className="num">{money(t.amount)}</td>
                        <td>{t.source === "hook" ? "hook" : "connector"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {detail.inference_by_model.length > 0 && (
            <InferenceByModel models={detail.inference_by_model} />
          )}

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

/** Inference cost split by model, with a dependency-free CSS pie (conic-gradient). */
function InferenceByModel({ models }: { models: Detail["inference_by_model"] }) {
  let acc = 0;
  const stops = models.map((m, i) => {
    const start = acc;
    acc += m.pct;
    return `${MODEL_COLORS[i % MODEL_COLORS.length]} ${start}% ${acc}%`;
  });
  const pie = stops.length ? `conic-gradient(${stops.join(", ")})` : "var(--line)";

  return (
    <section className="model-breakdown">
      <h2>Inference by model</h2>
      <div className="breakdown-body">
        <div
          className="pie"
          style={{ background: pie }}
          role="img"
          aria-label="Inference cost by model"
        />
        <table className="mini-table breakdown-table">
          <thead>
            <tr>
              <th>Model</th>
              <th className="num">Monthly cost</th>
              <th className="num">%</th>
              <th className="num">Requests</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m, i) => (
              <tr key={m.model}>
                <td>
                  <span
                    className="swatch"
                    style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }}
                  />
                  {m.model}
                </td>
                <td className="num">{money(m.amount)}</td>
                <td className="num">{Math.round(m.pct)}%</td>
                <td className="num">{compact(m.requests)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
