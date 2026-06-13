/**
 * One connector in a connect list: shows its name/category, a Connected badge,
 * or a paste-token form that saves the credential (encrypted server-side).
 * Shared by the onboarding steps; extracted from the original Connect step.
 */
import { useState } from "react";
import { api, type ConnectorStatus } from "../api";

export function ConnectorRow({
  connector,
  onConnected,
  hint,
}: {
  connector: ConnectorStatus;
  onConnected: () => void;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!secret) return;
    setSaving(true);
    try {
      await api.saveCredential(connector.type, secret);
      setSecret("");
      setOpen(false);
      onConnected();
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="connector-row">
      <div className="connector-info">
        <span className="connector-name">{connector.name}</span>
        <span className="connector-category">{hint ?? connector.category.replace("_", " ")}</span>
      </div>
      {connector.connected ? (
        <span className="badge connected">Connected</span>
      ) : open ? (
        <span className="connector-form">
          <input
            type="password"
            placeholder="Paste access token"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            aria-label={`${connector.name} token`}
          />
          <button onClick={save} disabled={saving || !secret}>
            {saving ? "…" : "Save"}
          </button>
        </span>
      ) : (
        <button className="secondary" onClick={() => setOpen(true)}>
          Connect
        </button>
      )}
    </li>
  );
}
