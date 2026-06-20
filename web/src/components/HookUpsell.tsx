/** Optional precision upgrade — the metering SDK token + snippet (design §9.2). */
import { useState } from "react";
import { api } from "../api";

export function HookUpsell() {
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
