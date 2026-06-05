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
import { useAuth } from "../auth/AuthContext";
import { ConfidenceBadge, WorthBadge } from "../components/badges";
import { money, num } from "../format";

export function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
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

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">Annapurna</span>
        <span className="muted">{user?.email}</span>
        <button className="link" onClick={() => logout().then(() => navigate("/login"))}>
          Sign out
        </button>
      </header>

      <main>
        <div className="dash-head">
          <h1>Features</h1>
          {data && <span className="muted">Period {data.period}</span>}
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {data && <ExecutiveSummary data={data} />}

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

        <DataActions period={data?.period} onChanged={load} />

        {data &&
          data.features.length > 0 &&
          data.totals.build_cost === 0 &&
          data.totals.inference_cost === 0 && (
            <p className="hint" role="status">
              Your features are confirmed, but no cost is synced yet. Use <strong>Add cost data</strong>{" "}
              above to sync inference and import build cost.
            </p>
          )}

        {data === null && !error ? (
          <p className="muted">Loading…</p>
        ) : data && data.features.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">No features yet</p>
            <p className="muted">Confirm features in onboarding, then sync your cost sources.</p>
            <button onClick={() => navigate("/onboarding")}>Go to onboarding</button>
          </div>
        ) : data ? (
          <table className="features-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th className="num">Build cost</th>
                <th className="num">Inference / mo</th>
                <th className="num">Active users</th>
                <th className="num">Cost / user</th>
                <th>Worth it?</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {data.features.map((f) => (
                <tr key={f.feature_id} className="feature-row" onClick={() => navigate(`/features/${f.feature_id}`)}>
                  <td>
                    <Link to={`/features/${f.feature_id}`} onClick={(e) => e.stopPropagation()}>
                      {f.name}
                    </Link>
                  </td>
                  <td className="num">{money(f.build_cost)}</td>
                  <td className="num">{money(f.inference_cost)}</td>
                  <td className="num">{num(f.active_users)}</td>
                  <td className="num">{money(f.cost_per_user)}</td>
                  <td><WorthBadge value={f.worth_it} /></td>
                  <td><ConfidenceBadge level={f.confidence} /></td>
                </tr>
              ))}
              <tr className="unattributed-row">
                <td>Unattributed</td>
                <td className="num">{money(data.unattributed.build_cost)}</td>
                <td className="num">{money(data.unattributed.inference_cost)}</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td colSpan={2} className="muted">spend not yet mapped to a feature</td>
              </tr>
            </tbody>
          </table>
        ) : null}

        <p className="muted legend">
          "Worth it?" is directional (cost per active user), not a revenue-based ROI.
        </p>
      </main>
    </div>
  );
}

/** Executive summary — the headline takeaways a CTO/CFO scans first. */
function ExecutiveSummary({ data }: { data: DashboardData }) {
  const { most_expensive, optimization, highest_cost_per_user } = data.highlights;
  const unattributedTotal = data.unattributed.build_cost + data.unattributed.inference_cost;

  return (
    <section className="exec-summary">
      <ExecCard label="Most expensive feature">
        {most_expensive ? (
          <>
            <FeatureLink feature={most_expensive} />
            {/* build and inference stay separate — never one blended number */}
            <p className="exec-metric">
              {money(most_expensive.build_cost)} build · {money(most_expensive.inference_cost)}/mo
            </p>
            <span className="exec-sub muted">by total spend</span>
          </>
        ) : (
          <EmptyExec note="No cost yet" />
        )}
      </ExecCard>

      <ExecCard label="Largest optimization opportunity">
        {optimization ? (
          <>
            <FeatureLink feature={optimization} />
            <p className="exec-metric">
              {money(optimization.inference_cost)}/mo · {money(optimization.cost_per_user)}/user
            </p>
            <span className="exec-sub muted">high cost per user — worth a look</span>
          </>
        ) : (
          <EmptyExec note="Nothing flagged" />
        )}
      </ExecCard>

      <ExecCard label="Highest cost / user">
        {highest_cost_per_user ? (
          <>
            <FeatureLink feature={highest_cost_per_user} />
            <p className="exec-metric big">{money(highest_cost_per_user.cost_per_user)}</p>
            <span className="exec-sub muted">
              {num(highest_cost_per_user.active_users)} active users
            </span>
          </>
        ) : (
          <EmptyExec note="No usage data yet" />
        )}
      </ExecCard>

      <ExecCard label="Unattributed spend">
        <p className="exec-metric big">{money(unattributedTotal)}</p>
        <span className="exec-sub muted">
          {money(data.unattributed.inference_cost)} inference · {money(data.unattributed.build_cost)}{" "}
          build
        </span>
      </ExecCard>
    </section>
  );
}

function ExecCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="exec-card">
      <span className="exec-label">{label}</span>
      {children}
    </div>
  );
}

function FeatureLink({ feature }: { feature: DashboardRow }) {
  return (
    <Link to={`/features/${feature.feature_id}`} className="exec-feature">
      {feature.name}
    </Link>
  );
}

function EmptyExec({ note }: { note: string }) {
  return (
    <>
      <p className="exec-metric muted">—</p>
      <span className="exec-sub muted">{note}</span>
    </>
  );
}

function DataActions({ period, onChanged }: { period?: string; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [tool, setTool] = useState("cursor");
  const [provider, setProvider] = useState("anthropic");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const monthParam = period?.slice(0, 7);

  async function importBuild() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.importBuildCost(csv, tool, monthParam);
      setCsv("");
      setNote(`Imported build cost (total ${r.total}).`);
      await onChanged();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function syncInference() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.ingestInference(provider, monthParam);
      setNote(`Synced ${provider} inference (total ${r.total}).`);
      await onChanged();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="secondary add-data-toggle" onClick={() => setOpen(true)}>
        Add cost data
      </button>
    );
  }

  return (
    <div className="data-actions">
      <div className="data-action">
        <label>Sync inference</label>
        <span className="inline">
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
          <button onClick={syncInference} disabled={busy}>
            Sync
          </button>
        </span>
      </div>
      <div className="data-action">
        <label>Import build cost (CSV: developer,tool,amount)</label>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={3} />
        <span className="inline">
          <select value={tool} onChange={(e) => setTool(e.target.value)}>
            <option value="cursor">Cursor</option>
            <option value="claude_code">Claude Code</option>
            <option value="copilot">Copilot</option>
            <option value="codex">Codex</option>
          </select>
          <button onClick={importBuild} disabled={busy || !csv.trim()}>
            Import
          </button>
        </span>
      </div>
      {note && <p className="muted">{note}</p>}
      <button className="link" onClick={() => setOpen(false)}>
        Close
      </button>
    </div>
  );
}
