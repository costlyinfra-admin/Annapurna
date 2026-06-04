/**
 * Onboarding wizard shell — three steps: Connect → Review → Confirm.
 *
 * M2 ships the shell with empty states. Real feature discovery (Review) arrives
 * with the GitHub connector in M3; provider cost ingest in M4. The "Connect"
 * step is wired to the encrypted credential store so the flow is real today.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type ConnectorStatus } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ConfirmStep } from "./onboarding/ConfirmStep";
import { ReviewStep } from "./onboarding/ReviewStep";

const STEPS = ["Connect sources", "Review features", "Confirm & go live"];

export function Onboarding() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const { logout } = useAuth();

  return (
    <div className="wizard">
      <header className="wizard-header">
        <span className="brand">Annapurna</span>
        <button className="link" onClick={() => logout().then(() => navigate("/login"))}>
          Sign out
        </button>
      </header>

      <ol className="stepper">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? "active" : i < step ? "done" : ""} aria-current={i === step}>
            <span className="step-num">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <section className="wizard-body">
        {step === 0 && <ConnectStep />}
        {step === 1 && <ReviewStep />}
        {step === 2 && <ConfirmStep onFinish={() => navigate("/dashboard")} />}
      </section>

      <footer className="wizard-nav">
        <button className="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>Next</button>
        ) : null}
      </footer>
    </div>
  );
}

function ConnectStep() {
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

  return (
    <div>
      <h2>Connect your sources</h2>
      <p className="muted">
        Connect GitHub and at least one AI provider to get started. Everything is read-only and
        stored encrypted. You can add more later.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {connectors === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="connector-list">
          {connectors.map((c) => (
            <ConnectorRow key={c.type} connector={c} onConnected={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectorRow({
  connector,
  onConnected,
}: {
  connector: ConnectorStatus;
  onConnected: () => void;
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
        <span className="connector-category">{connector.category.replace("_", " ")}</span>
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

