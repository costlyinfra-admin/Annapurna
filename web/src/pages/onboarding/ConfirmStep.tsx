/** Wizard Step 3 — confirm the feature list and go live. */
import { useEffect, useState } from "react";
import { api, ApiError } from "../../api";

export function ConfirmStep({ onFinish }: { onFinish: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listFeatures("proposed")
      .then((f) => setCount(f.length))
      .catch(() => setCount(0));
  }, []);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.confirmOnboarding();
      onFinish();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not confirm. Try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Confirm &amp; go live</h2>
      <div className="empty-state">
        <p className="empty-title">
          {count === null ? "…" : `${count} feature${count === 1 ? "" : "s"} ready to confirm`}
        </p>
        <p className="muted">
          Confirming creates your feature list. Build cost and inference cost will appear per
          feature — always separately, each with a confidence level and an evidence trail.
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button onClick={confirm} disabled={busy || count === 0}>
        {busy ? "Confirming…" : "Confirm & go live"}
      </button>

      <HookUpsell />
    </div>
  );
}

/** Optional precision upgrade — never blocks going live (design §9.2). */
function HookUpsell() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  async function generate() {
    try {
      setToken((await api.createHookToken()).token);
    } catch {
      setToken(null);
    }
  }

  return (
    <div className="hook-upsell">
      <button className="link" onClick={() => setOpen((v) => !v)}>
        Optional: install the metering SDK for per-call precision →
      </button>
      {open && (
        <div className="hook-upsell-body">
          <p className="muted">
            Connectors already give you per-feature cost. For exact, per-call inference numbers,
            drop the SDK into your app — it's optional and never required to go live.
          </p>
          <pre className="snippet">{`# Python\npip install annapurna-meter\n\nfrom annapurna_meter import Meter\nmeter = Meter(feature_id="<feature-id>")\nresp = client.messages.create(model="claude-sonnet-4-6", ...)\nmeter.record_anthropic(resp)`}</pre>
          {token ? (
            <p className="snippet token">
              ANNAPURNA_INGEST_TOKEN={token}
              <br />
              <span className="muted">Copy this now — it isn't shown again.</span>
            </p>
          ) : (
            <button className="secondary" onClick={generate}>
              Generate ingest token
            </button>
          )}
        </div>
      )}
    </div>
  );
}
