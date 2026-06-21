/**
 * One connector in a connect list. The header shows its name/category and a
 * Connected badge or a Connect toggle. Pressing Connect expands a panel
 * *underneath* the row with source-specific setup instructions plus the
 * credential form (saved encrypted server-side). Instructions come from
 * CONNECTOR_GUIDES, keyed by connector type; connectors without a guide get
 * the generic paste-token form.
 */
import { useState } from "react";
import { api, type ConnectorStatus } from "../api";
import { CONNECTOR_GUIDES } from "../connectorGuides";

export function ConnectorRow({
  connector,
  onConnected,
  hint,
  onSync,
}: {
  connector: ConnectorStatus;
  onConnected: () => void;
  hint?: string;
  /** When set, a connected row shows a "Sync now" button that pulls the latest
   *  data on demand and returns a short result message to display inline. */
  onSync?: () => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const guide = CONNECTOR_GUIDES[connector.type];

  async function save() {
    if (!secret.trim()) return;
    setSaving(true);
    try {
      await api.saveCredential(connector.type, secret.trim());
      setSecret("");
      setOpen(false);
      onConnected();
    } finally {
      setSaving(false);
    }
  }

  async function runSync() {
    if (!onSync) return;
    setSyncing(true);
    setSyncNote(null);
    try {
      setSyncNote(await onSync());
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <li className="connector-row">
      <div className="connector-head">
        <div className="connector-info">
          <span className="connector-name">{connector.name}</span>
          <span className="connector-category">{hint ?? connector.category.replace("_", " ")}</span>
        </div>
        {connector.connected ? (
          <span className="connector-actions">
            <span className="badge connected">Connected</span>
            {onSync && (
              <button className="secondary" onClick={runSync} disabled={syncing}>
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            )}
          </span>
        ) : (
          <button className="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Cancel" : "Connect"}
          </button>
        )}
      </div>

      {syncNote && <p className="muted connector-sync-note">{syncNote}</p>}

      {open && !connector.connected && (
        <div className="connector-panel">
          {guide && (
            <div className="connector-guide">
              <p className="muted connector-guide-blurb">{guide.blurb}</p>
              <ol className="connector-steps">
                {guide.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              {guide.docUrl && (
                <a
                  className="link connector-doc-link"
                  href={guide.docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open provider setup page ↗
                </a>
              )}
            </div>
          )}
          <div className="connector-form">
            {guide?.multiline ? (
              <textarea
                placeholder={guide.placeholder}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                aria-label={`${connector.name} credentials`}
                rows={3}
              />
            ) : (
              <input
                type="password"
                placeholder={guide?.placeholder ?? "Paste access token"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                aria-label={`${connector.name} token`}
              />
            )}
            <button onClick={save} disabled={saving || !secret.trim()}>
              {saving ? "…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
