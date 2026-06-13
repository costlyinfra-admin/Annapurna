/**
 * Review auto-discovered features (part of the "Identify features" step).
 *
 * Runs discovery against a GitHub org, then lets the user curate the proposals:
 * rename, delete, split (one proposal is really two), merge (two are one), and
 * add a feature manually. Each proposal shows its PR/branch evidence and a
 * discovery-confidence badge.
 */
import { useEffect, useState } from "react";
import { api, ApiError, type Feature } from "../../api";

function ConfidenceBadge({ level }: { level: string | null }) {
  const l = level ?? "low";
  return <span className={`badge conf-${l}`}>{l} confidence</span>;
}

export function ReviewStep() {
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [owner, setOwner] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const reload = async () => setFeatures(await api.listFeatures("proposed"));

  useEffect(() => {
    reload().catch(() => setFeatures([]));
  }, []);

  async function runDiscovery() {
    setBusy(true);
    setError(null);
    try {
      const s = await api.runDiscovery(owner.trim());
      const who = owner.trim();
      if (s.repos_scanned === 0) {
        setSummary(
          `No repositories accessible for "${who}". Check the token has repo access ` +
            `(private repos need a classic PAT with the "repo" scope) and that "${who}" is ` +
            `the org/user login.`,
        );
      } else if (s.prs === 0) {
        const n = s.repos_scanned;
        setSummary(
          `Found ${n} repositor${n === 1 ? "y" : "ies"} for "${who}", but no merged PRs in the ` +
            `last 90 days — discovery needs merged pull requests.`,
        );
      } else {
        setSummary(
          `Analyzed ${s.prs} merged PRs across ${s.repos.length} repositories → ` +
            `${s.proposals} proposed features.`,
        );
      }
      setSelected(new Set());
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Discovery failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function mergeSelected() {
    await api.mergeFeatures([...selected]);
    setSelected(new Set());
    await reload();
  }

  return (
    <div>
      <h2>Review auto-discovered features</h2>
      <p className="muted">
        Annapurna analyzes your last 90 days of merged pull requests and proposes features. Curate
        them below, then confirm.
      </p>

      <div className="discovery-bar">
        <input
          placeholder="GitHub organization (e.g. acme)"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          aria-label="GitHub organization"
        />
        <button onClick={runDiscovery} disabled={busy || !owner.trim()}>
          {busy ? "Analyzing…" : "Analyze last 90 days"}
        </button>
      </div>
      <p className="muted hint-inline">
        No token needed for <strong>public</strong> organizations. Connect GitHub above for private
        repos and higher rate limits.
      </p>
      {summary && <p className="summary">{summary}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {features === null ? (
        <p className="muted">Loading…</p>
      ) : features.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No features discovered yet</p>
          <p className="muted">
            Enter a GitHub organization above and run analysis. Public orgs work without a token;
            connect GitHub above for private repos. Proposals appear here with their PR evidence and
            a confidence badge.
          </p>
        </div>
      ) : (
        <>
          <div className="review-toolbar">
            <AddFeature onAdded={reload} />
            {selected.size >= 2 && (
              <button onClick={mergeSelected}>Merge selected ({selected.size})</button>
            )}
          </div>
          <ul className="feature-list">
            {features.map((f) => (
              <FeatureCard
                key={f.id}
                feature={f}
                selected={selected.has(f.id)}
                onToggleSelect={() => toggleSelect(f.id)}
                onChanged={reload}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function AddFeature({ onAdded }: { onAdded: () => Promise<void> }) {
  const [name, setName] = useState("");
  async function add() {
    if (!name.trim()) return;
    await api.addFeature(name.trim());
    setName("");
    await onAdded();
  }
  return (
    <span className="add-feature">
      <input
        placeholder="Add a feature manually"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="New feature name"
      />
      <button className="secondary" onClick={add} disabled={!name.trim()}>
        Add
      </button>
    </span>
  );
}

function FeatureCard({
  feature,
  selected,
  onToggleSelect,
  onChanged,
}: {
  feature: Feature;
  selected: boolean;
  onToggleSelect: () => void;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(feature.name);
  const [splitting, setSplitting] = useState(false);

  const prSignals = feature.signals.filter((s) => s.signal_type === "pr");
  const branchSignal = feature.signals.find((s) => s.signal_type === "branch");

  async function saveName() {
    await api.renameFeature(feature.id, { name: name.trim() || feature.name });
    setEditing(false);
    await onChanged();
  }

  return (
    <li className="feature-card">
      <div className="feature-head">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${feature.name}`}
        />
        {editing ? (
          <span className="rename-row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Feature name"
            />
            <button onClick={saveName}>Save</button>
            <button className="secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <>
            <span className="feature-name">{feature.name}</span>
            <ConfidenceBadge level={feature.discovery_confidence} />
            <span className="feature-actions">
              <button className="link" onClick={() => setEditing(true)}>
                Rename
              </button>
              {prSignals.length > 1 && (
                <button className="link" onClick={() => setSplitting((v) => !v)}>
                  Split
                </button>
              )}
              <button
                className="link danger"
                onClick={async () => {
                  await api.deleteFeature(feature.id);
                  await onChanged();
                }}
              >
                Delete
              </button>
            </span>
          </>
        )}
      </div>

      {branchSignal && <p className="branch-pattern">branch: {branchSignal.external_ref}</p>}
      <ul className="pr-chips">
        {prSignals.map((s) => (
          <li key={s.id} className="pr-chip">
            {s.external_ref}
          </li>
        ))}
      </ul>

      {splitting && (
        <SplitForm
          feature={feature}
          onDone={async () => {
            setSplitting(false);
            await onChanged();
          }}
        />
      )}
    </li>
  );
}

function SplitForm({ feature, onDone }: { feature: Feature; onDone: () => Promise<void> }) {
  const prSignals = feature.signals.filter((s) => s.signal_type === "pr");
  const [moved, setMoved] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");

  function toggle(id: string) {
    setMoved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    const movedIds = [...moved];
    const restIds = prSignals.filter((s) => !moved.has(s.id)).map((s) => s.id);
    if (movedIds.length === 0 || restIds.length === 0 || !newName.trim()) return;
    await api.splitFeature(feature.id, [
      { name: newName.trim(), signal_ids: movedIds },
      { name: `${feature.name} (rest)`, signal_ids: restIds },
    ]);
    await onDone();
  }

  return (
    <div className="split-form">
      <p className="muted">Pick the PRs to peel into a new feature:</p>
      <ul className="split-prs">
        {prSignals.map((s) => (
          <li key={s.id}>
            <label>
              <input type="checkbox" checked={moved.has(s.id)} onChange={() => toggle(s.id)} />
              {s.external_ref}
            </label>
          </li>
        ))}
      </ul>
      <span className="split-apply">
        <input
          placeholder="New feature name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          aria-label="Split feature name"
        />
        <button onClick={apply} disabled={!newName.trim() || moved.size === 0}>
          Split
        </button>
      </span>
    </div>
  );
}
