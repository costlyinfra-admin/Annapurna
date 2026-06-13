/**
 * Inference-cost data actions: sync a provider's bill (the authoritative cost
 * API) and manage self-hosted GPU pools (registered cost allocated by usage).
 * Shared by the dashboard's "Add cost data" panel and the onboarding
 * "Inference cost sources" step.
 */
import { useEffect, useState } from "react";
import { api, ApiError, type ComputePool } from "../api";
import { money } from "../format";

export function InferenceActions({
  period,
  onChanged,
}: {
  period?: string;
  onChanged: () => Promise<void>;
}) {
  const [provider, setProvider] = useState("anthropic");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [poolName, setPoolName] = useState("");
  const [poolLabel, setPoolLabel] = useState("self_hosted");
  const [poolCost, setPoolCost] = useState("");
  const [pools, setPools] = useState<ComputePool[]>([]);
  const monthParam = period?.slice(0, 7);

  useEffect(() => {
    api
      .listComputePools()
      .then(setPools)
      .catch(() => undefined);
  }, []);

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

  return (
    <>
      <div className="data-action">
        <label>Sync inference</label>
        <span className="inline">
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="google">Google Gemini</option>
            <option value="openrouter">OpenRouter</option>
            <option value="together">Together AI</option>
            <option value="fireworks">Fireworks AI</option>
            <option value="bedrock">Amazon Bedrock</option>
          </select>
          <button onClick={syncInference} disabled={busy}>
            Sync
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
      {note && <p className="muted">{note}</p>}
    </>
  );
}
