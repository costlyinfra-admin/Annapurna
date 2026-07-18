/**
 * Install SDK — the optional metering hook (design §9.2). A precision tier, not
 * a requirement: connectors already give per-feature cost. The SDK adds exact,
 * per-call inference numbers and is the way to split inference cost per feature
 * when you route calls through one shared API key. Detailed, follow-along setup.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export function InstallSdkPage() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The endpoint the SDK posts to — shown so setup is copy-paste for THIS install.
  const ingestUrl = `${window.location.origin}/api/hook/events`;

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
        Optional precision upgrade — connectors already give you per-feature cost, so this is never
        required to go live. Use the SDK when you want exact, per-call inference numbers, or when
        you route calls through <strong>one shared API key</strong> (a provider's cost API can't
        tell your features apart, but the SDK can). It reports only token counts and a{" "}
        <code>feature_id</code> — <strong>never your prompts or responses</strong> — on a background
        thread, and is a no-op until configured, so it can't break your request path. Metered cost
        is reconciled against your provider bill; it sharpens the picture, never replaces the bill.
      </p>

      <div className="hint">
        <strong>Before you start:</strong> discover your features first (
        <Link to="/features" className="link">
          Features
        </Link>
        ) — each metered call is tagged with a feature's id, and anything untagged lands in the
        honest <em>Unattributed</em> bucket.
      </div>

      <section className="source-section">
        <h2>1. Generate your ingest token</h2>
        <p className="muted">
          One token per workspace. It authorizes the SDK to send usage to Annapurna. Set these{" "}
          <strong>two</strong> environment variables where your app runs (your <code>.env</code>,
          secrets manager, or deploy config):
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {token ? (
          <>
            <pre className="snippet token">{`ANNAPURNA_INGEST_URL=${ingestUrl}
ANNAPURNA_INGEST_TOKEN=${token}`}</pre>
            <p className="muted">Copy the token now — it isn't shown again. Keep it secret.</p>
          </>
        ) : (
          <>
            <pre className="snippet">{`ANNAPURNA_INGEST_URL=${ingestUrl}
ANNAPURNA_INGEST_TOKEN=…    # click "Generate" to create yours`}</pre>
            <button className="secondary" onClick={generate}>
              Generate ingest token
            </button>
          </>
        )}
      </section>

      <section className="source-section">
        <h2>2. Install the SDK</h2>
        <p className="muted">
          Apache-2.0, zero dependencies. Install into the environment your app runs in (a virtualenv
          for Python).
        </p>
        <span className="chart-title">Python</span>
        <pre className="snippet">{`pip install annapurna-meter      # use pip3 / python3 -m pip on macOS`}</pre>
        <span className="chart-title">Node</span>
        <pre className="snippet">{`npm install annapurna-meter`}</pre>
      </section>

      <section className="source-section">
        <h2>3. Wrap your LLM client</h2>
        <p className="muted">
          Wrap the client you already use, once, with the feature the calls belong to (copy a
          feature's id from its page under{" "}
          <Link to="/features" className="link">
            Features
          </Link>
          ). Every call through it is then metered automatically, with latency — no per-call code.
          The provider is auto-detected.
        </p>
        <span className="chart-title">Python</span>
        <pre className="snippet">{`from anthropic import Anthropic
from annapurna_meter import wrap

client = wrap(Anthropic(), feature_id="<feature-id>")   # reads the env vars above

# unchanged — this call is metered automatically:
resp = client.messages.create(model="claude-sonnet-4-6", messages=[...])`}</pre>
        <span className="chart-title">Node</span>
        <pre className="snippet">{`import OpenAI from "openai";
import { wrap } from "annapurna-meter";

const client = wrap(new OpenAI(), { featureId: "<feature-id>" });

// unchanged — this call is metered automatically:
const resp = await client.chat.completions.create({ model: "gpt-4o", messages: [...] });`}</pre>
        <p className="muted">
          Optional: pass <code>metadata</code> (e.g. <code>{`{ customer_id, environment }`}</code>)
          to also see cost per customer. Streaming or async responses aren't auto-metered — record
          those explicitly with <code>meter.record_anthropic(resp)</code> /{" "}
          <code>meter.recordOpenAI(resp)</code>.
        </p>
      </section>

      <section className="source-section">
        <h2>4. Verify it's working</h2>
        <p className="muted">
          Run your app so it makes a real model call, then open that feature under{" "}
          <Link to="/features" className="link">
            Features
          </Link>{" "}
          — within a minute or two you'll see its inference cost update, with{" "}
          <em>metered (hook)</em> as the source and an average latency. If nothing appears: confirm
          both env vars are set in the running process, and that the <code>feature_id</code> matches
          a real feature. The SDK fails silently by design, so a missing token never errors — it
          simply doesn't report.
        </p>
      </section>
    </div>
  );
}
