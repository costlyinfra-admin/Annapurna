/**
 * Wizard Step 2 — build cost sources: what each feature cost to CREATE.
 *
 * Per-developer AI coding-tool spend, allocated to features by PR authorship.
 * Embeds the same sync panels as the dashboard's "Add cost data" — connect and
 * pull data right here, or skip and do it later from the dashboard.
 */
import { useEffect, useState } from "react";
import { api } from "../../api";
import { BuildCostActions, type FeatureOption } from "../../components/BuildCostActions";

export function BuildStep() {
  const [features, setFeatures] = useState<FeatureOption[]>([]);

  const refresh = async () => {
    try {
      const list = await api.listFeatures();
      setFeatures(list.map((f) => ({ feature_id: f.id, name: f.name })));
    } catch {
      setFeatures([]);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div>
      <h2>Build cost sources</h2>
      <p className="muted">
        Build cost is what your developers' AI coding tools cost — allocated to features by who
        authored which PRs. Most precise first: Copilot seats (exact), Cursor admin API (actual
        usage dollars), SSO seats via Okta/Entra (seats × price), CSV as a universal fallback.
        Everything here is optional — you can also do it later from the dashboard.
      </p>
      <div className="data-actions">
        <BuildCostActions features={features} onChanged={refresh} />
      </div>
    </div>
  );
}
