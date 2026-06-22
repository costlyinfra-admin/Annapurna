/**
 * Cost sources — connect and sync everything that feeds per-feature cost.
 * Inference (provider cost APIs + self-hosted pools) and build (coding-tool
 * spend) live here, reusing the same action panels as the rest of the app.
 */
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type ConnectorStatus } from "../api";
import { BuildCostActions, type FeatureOption } from "../components/BuildCostActions";
import { ConnectorRow } from "../components/ConnectorRow";
import { SelfHostedPools } from "../components/SelfHostedPools";
import { money } from "../format";

const TABS = [
  { id: "inference", label: "Inference cost" },
  { id: "self-hosted", label: "Self-hosted models" },
  { id: "build", label: "Build cost" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function CostSourcesPage() {
  const [tab, setTab] = useState<TabId>("inference");
  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);
  const [features, setFeatures] = useState<FeatureOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshConnectors = useCallback(async () => {
    try {
      setConnectors(await api.connectors());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load connectors.");
    }
  }, []);

  const refreshFeatures = useCallback(async () => {
    try {
      const list = await api.listFeatures();
      setFeatures(list.map((f) => ({ feature_id: f.id, name: f.name })));
    } catch {
      setFeatures([]);
    }
  }, []);

  useEffect(() => {
    refreshConnectors();
    refreshFeatures();
  }, [refreshConnectors, refreshFeatures]);

  const inference = (connectors ?? []).filter((c) => c.category === "inference");

  return (
    <div className="content">
      <div className="dash-head">
        <h1>Cost sources</h1>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="tabs" role="tablist" aria-label="Cost source types">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "inference" && (
        <section className="source-section" role="tabpanel">
          <p className="muted">
            What your features cost to run. Connect each provider's cost API — the authoritative
            bill — and spend attributes to features by API key or project; anything unmapped lands
            in Unattributed. Once connected, costs refresh automatically each night, or hit Sync now
            to pull immediately. Each row has setup instructions.
          </p>
          {connectors && inference.length > 0 && (
            <ul className="connector-list">
              {inference.map((c) => (
                <ConnectorRow
                  key={c.type}
                  connector={c}
                  onConnected={refreshConnectors}
                  onSync={async () => {
                    const r = await api.ingestInference(c.type);
                    await refreshFeatures();
                    return `Pulled ${money(r.total)} of ${c.name} spend for this month.`;
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "self-hosted" && (
        <section className="source-section" role="tabpanel">
          <div className="data-actions">
            <SelfHostedPools onChanged={refreshFeatures} />
          </div>
        </section>
      )}

      {tab === "build" && (
        <section className="source-section" role="tabpanel">
          <p className="muted">
            What your features cost to build — per-developer AI coding-tool spend, allocated to
            features by who authored which PRs. Pick whichever methods match your tools; each is
            self-contained, and anything you skip simply lands in Unattributed.
          </p>
          <div className="data-actions">
            <BuildCostActions features={features} onChanged={refreshFeatures} />
          </div>
        </section>
      )}
    </div>
  );
}
