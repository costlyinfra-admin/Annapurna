# annapurna-meter (Node)

The optional metering hook for [Annapurna](https://github.com/costlyinfra-admin/Annapurna) —
a thin, fail-safe wrapper that reports per-call LLM usage so spend can be
attributed **per feature**. No dependencies (Node ≥ 18). Cost is computed
server-side from Annapurna's pricing tables — the SDK never sees prices, and it
never sends prompt or response content, only token counts and a `featureId`.

It is **fail-safe**: reporting is fire-and-forget and can never throw into your
request path. With no ingest URL/token configured, every call is a no-op.

## Install

```bash
npm install annapurna-meter
```

## Use

**Recommended — wrap the client once (no per-call code):**

```js
import { wrap } from "annapurna-meter";

const client = wrap(openai, { featureId: "feature-threat-triage" }); // reads ENV

const resp = await client.chat.completions.create({ model: "gpt-4o", ... }); // metered
```

Provider is auto-detected; each call is recorded with its latency. Pass an
optional `metadata` (e.g. `{ environment, customer_id }`) for extra attribution.
Streaming responses use the explicit form below.

**Explicit — one line per call:**

```js
import { Meter } from "annapurna-meter";

const meter = new Meter("feature-threat-triage");
const resp = await openai.chat.completions.create({ model: "gpt-4o", ... });
meter.recordOpenAI(resp);        // <- the whole hook
```

Helpers: `recordAnthropic`, `recordOpenAI`, plus the generic
`record({ provider, model, tokensIn, tokensOut, featureId })`.

Every request is bounded by a timeout (5s by default, `{ timeoutMs }` to change
it), so an unreachable or sleeping ingest endpoint can never leave requests
pending in your process.

### Optimize mode (opt-in)

`new Meter(featureId, { optimize: true })` additionally emits **privacy-safe**
signals — salted hashes and counts, never prompt text — so Annapurna can surface
*measured* optimization opportunities (duplicate calls, uncached repeated
prefixes). Off by default; work is off the call path, memory-bounded, and
fail-safe. The SDK fetches a per-tenant salt once (`GET /api/hook/salt`, same
ingest token).

## Config

| Env var                  | What it is                                        |
|--------------------------|---------------------------------------------------|
| `ANNAPURNA_INGEST_URL`   | e.g. `https://app.example.com/api/hook/events`    |
| `ANNAPURNA_INGEST_TOKEN` | the per-workspace ingest token from the dashboard |

## License

Apache-2.0. (The Annapurna server is AGPL-3.0; this client SDK is permissive so
you can embed it in a proprietary app.)
