/**
 * Install SDK — the optional metering hook (design §9.2). A precision tier, not
 * a requirement: connectors already give per-feature cost. The SDK adds exact,
 * per-call inference numbers. Generate a tenant ingest token and drop the
 * snippet into your app.
 */
import { useState } from "react";
import { api } from "../api";

export function InstallSdkPage() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    try {
      setToken((await api.createHookToken()).token);
    } catch {
      setError("Could not generate an ingest token. Try again.");
    }
  }

  return (
    <div className="content">
      <div className="dash-head">
        <h1>Install SDK</h1>
      </div>

      <p className="muted">
        Optional precision upgrade. Your connectors already give you per-feature cost — this is
        never required to go live. For exact, per-call inference numbers, drop the metering SDK into
        your app and it reports usage as each call happens. Hook-metered cost is reconciled against
        your provider bill, so it only sharpens the picture; it never replaces the authoritative
        dollars.
      </p>

      <section className="source-section">
        <h2>1. Generate your ingest token</h2>
        <p className="muted">
          One token per workspace. It authorizes the SDK to send usage to Annapurna — keep it secret
          and store it as the <code>ANNAPURNA_INGEST_TOKEN</code> environment variable.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
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
      </section>

      <section className="source-section">
        <h2>2. Install and record calls</h2>
        <p className="muted">
          <code>wrap()</code> your LLM client once with the <code>feature_id</code> it belongs to —
          every call is then metered automatically, with latency (anything unmapped lands in
          Unattributed). The SDK is Apache-2.0, dependency-free, reports on a background thread, and
          is a no-op until the token above is set — it can't break your request path. Streaming or
          async calls use the explicit <code>record_*</code> form instead.
        </p>
        <span className="chart-title">Python</span>
        <pre className="snippet">{`# use pip3 / python3 -m pip on macOS
pip install annapurna-meter

from annapurna_meter import wrap
client = wrap(anthropic_client, feature_id="<feature-id>")
resp = client.messages.create(model="claude-sonnet-4-6", ...)  # metered automatically`}</pre>
        <span className="chart-title">Node</span>
        <pre className="snippet">{`npm install annapurna-meter

import { wrap } from "annapurna-meter";
const client = wrap(openai, { featureId: "<feature-id>" });
const resp = await client.chat.completions.create({ model: "gpt-4o", ... });  // metered`}</pre>
      </section>
    </div>
  );
}
