/**
 * Cost sources — connect and sync everything that feeds per-feature cost.
 * Inference (provider cost APIs + self-hosted pools) and build (coding-tool
 * spend) live here, reusing the same action panels as the rest of the app.
 */
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type ConnectorStatus } from "../api";
import { BuildCostActions, type FeatureOption } from "../components/BuildCostActions";
import { ConnectorRow } from "../components/ConnectorRow";
import { InferenceActions } from "../components/InferenceActions";

export function CostSourcesPage() {
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

      <section className="source-section">
        <h2>Inference cost</h2>
        <p className="muted">
          What your features cost to run. Connect each provider's cost API (the authoritative bill);
          spend attributes to features by API-key/project, and anything unmapped lands in
          Unattributed. Amazon Bedrock takes a JSON blob with AWS key/secret/region/tag.
        </p>
        {connectors && inference.length > 0 && (
          <ul className="connector-list">
            {inference.map((c) => (
              <ConnectorRow key={c.type} connector={c} onConnected={refreshConnectors} />
            ))}
          </ul>
        )}
        <div className="data-actions">
          <InferenceActions onChanged={refreshFeatures} />
        </div>
      </section>

      <section className="source-section">
        <h2>Build cost</h2>
        <p className="muted">
          What your features cost to build — per-developer AI coding-tool spend, allocated to
          features by who authored which PRs. Most precise first: Claude Code / Copilot / Cursor
          connectors, SSO seats, then CSV as a fallback.
        </p>
        <div className="data-actions">
          <BuildCostActions features={features} onChanged={refreshFeatures} />
        </div>
      </section>
    </div>
  );
}
