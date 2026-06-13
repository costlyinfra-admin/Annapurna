/**
 * Wizard Step 3 — inference cost sources: what each feature costs to RUN.
 *
 * Provider cost APIs are authoritative on dollars; spend attributes to features
 * via api-key/project mappings (or, later, the per-call metering SDK). Connect
 * providers here, then run a first sync — or skip and do it from the dashboard.
 */
import { useEffect, useState } from "react";
import { api, ApiError, type ConnectorStatus } from "../../api";
import { ConnectorRow } from "../../components/ConnectorRow";
import { InferenceActions } from "../../components/InferenceActions";

export function InferenceStep() {
  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setConnectors(await api.connectors());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load connectors.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const inferenceSources = (connectors ?? []).filter((c) => c.category === "inference");

  return (
    <div>
      <h2>Inference cost sources</h2>
      <p className="muted">
        Inference cost is what your features cost to run, pulled from each provider's cost API — the
        authoritative bill. Spend lands on features via API-key/project mappings; anything unmapped
        goes to the honest Unattributed bucket. Connect what you use, sync below, or skip for now.
        (Amazon Bedrock takes a JSON blob with AWS key/secret/region/tag.)
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {connectors === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="connector-list">
          {inferenceSources.map((c) => (
            <ConnectorRow key={c.type} connector={c} onConnected={refresh} />
          ))}
        </ul>
      )}
      <div className="data-actions">
        <InferenceActions onChanged={refresh} />
      </div>
    </div>
  );
}
