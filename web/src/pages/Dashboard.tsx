/**
 * Features dashboard — the money screen (design §9.1).
 *
 * Build cost and inference cost live in SEPARATE columns and are never blended.
 * Each cost number links to the feature's drill-down, where its evidence trail
 * lives. An Unattributed row carries spend not yet mapped to a feature.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  ApiError,
  type ComputePool,
  type Dashboard as DashboardData,
  type DashboardRow,
} from "../api";
import { useAuth } from "../auth/AuthContext";
import { ConfidenceBadge, WorthBadge } from "../components/badges";
import { compact, money, num } from "../format";

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

        <DataActions period={data?.period} features={data?.features ?? []} onChanged={load} />

        {data &&
          data.features.length > 0 &&
          data.totals.build_cost === 0 &&
          data.totals.inference_cost === 0 && (
            <p className="hint" role="status">
              Your features are confirmed, but no cost is synced yet. Use{" "}
              <strong>Add cost data</strong> above to sync inference and import build cost.
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

        <p className="muted legend">
          "Worth it?" is directional (cost per active user), not a revenue-based ROI.
        </p>
      </main>
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

function DataActions({
  period,
  features,
  onChanged,
}: {
  period?: string;
  features: DashboardRow[];
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [tool, setTool] = useState("cursor");
  const [provider, setProvider] = useState("anthropic");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [poolName, setPoolName] = useState("");
  const [poolLabel, setPoolLabel] = useState("self_hosted");
  const [poolCost, setPoolCost] = useState("");
  const [pools, setPools] = useState<ComputePool[]>([]);
  const [ftFeature, setFtFeature] = useState("");
  const [ftAmount, setFtAmount] = useState("");
  const [ftLabel, setFtLabel] = useState("");
  const monthParam = period?.slice(0, 7);

  async function recordTraining() {
    const amount = parseFloat(ftAmount);
    if (!ftFeature || !ftLabel.trim() || Number.isNaN(amount)) {
      setNote("Pick a feature, and enter a run label and amount.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await api.recordTrainingCost(ftFeature, amount, ftLabel.trim(), monthParam);
      setFtAmount("");
      setFtLabel("");
      setNote("Recorded fine-tuning run as build cost.");
      await onChanged();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not record training cost.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (open)
      api
        .listComputePools()
        .then(setPools)
        .catch(() => undefined);
  }, [open]);

  async function savePool() {
    const cost = parseFloat(poolCost);
    if (!poolName.trim() || !poolLabel.trim() || Number.isNaN(cost)) {
      setNote("Enter a pool name, its provider label, and a monthly cost.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await api.createComputePool(poolName.trim(), poolLabel.trim(), cost);
      setPoolName("");
      setPoolCost("");
      setPools(await api.listComputePools());
      setNote("Saved pool. Use Allocate once the SDK has reported usage.");
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not save pool.");
    } finally {
      setBusy(false);
    }
  }

  async function allocate() {
    setBusy(true);
    setNote(null);
    try {
      const res = await api.allocateCompute(monthParam);
      const total = res.reduce((sum, r) => sum + r.allocated, 0);
      setNote(
        res.length
          ? `Allocated ${money(total)} of self-hosted cost across features.`
          : "No pools to allocate yet.",
      );
      await onChanged();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Allocation failed.");
    } finally {
      setBusy(false);
    }
  }

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
      <div className="data-action">
        <label>Self-hosted models (open-source GPU pool)</label>
        <span className="inline">
          <input
            placeholder="Pool name (e.g. Llama-3.1-70B)"
            value={poolName}
            onChange={(e) => setPoolName(e.target.value)}
          />
          <input
            placeholder="provider label"
            value={poolLabel}
            onChange={(e) => setPoolLabel(e.target.value)}
          />
          <input
            placeholder="$ / month"
            inputMode="decimal"
            value={poolCost}
            onChange={(e) => setPoolCost(e.target.value)}
          />
          <button onClick={savePool} disabled={busy}>
            Save pool
          </button>
        </span>
        {pools.length > 0 && (
          <span className="inline pools-line">
            <span className="muted">
              {pools.map((p) => `${p.name} · ${money(p.monthly_cost)}/mo`).join("  ")}
            </span>
            <button onClick={allocate} disabled={busy}>
              Allocate cost
            </button>
          </span>
        )}
      </div>
      <div className="data-action">
        <label>Fine-tune / training cost (one-time, counts as build)</label>
        <span className="inline">
          <select value={ftFeature} onChange={(e) => setFtFeature(e.target.value)}>
            <option value="">Select feature…</option>
            {features.map((f) => (
              <option key={f.feature_id} value={f.feature_id}>
                {f.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Run label (e.g. Llama-3.1-70B tuning)"
            value={ftLabel}
            onChange={(e) => setFtLabel(e.target.value)}
          />
          <input
            placeholder="$ amount"
            inputMode="decimal"
            value={ftAmount}
            onChange={(e) => setFtAmount(e.target.value)}
          />
          <button onClick={recordTraining} disabled={busy}>
            Add training cost
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
