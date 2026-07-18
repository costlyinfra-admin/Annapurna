# sdk/ — Metering hook (M7)

The optional precision tier (design doc §7.2). A *thin* wrapper around the
customer's LLM calls that emits per-call metered events (`tokens_in`,
`tokens_out`, `model`, `feature_id`) to Annapurna's hook-ingest endpoint. Cost is
computed **server side** from Annapurna's pricing tables — the SDK never sees prices.

**Invariant:** the hook is a precision upgrade, never a requirement. Onboarding
and first value work with connectors alone; with no ingest URL/token configured,
every SDK call is a no-op.

- [`python/`](python) — `annapurna_meter` (stdlib only). `Meter.record(...)`,
  `record_anthropic(resp)`, `record_openai(resp)`.
- [`node/`](node) — `annapurna-meter` (no deps, Node ≥ 18). Same surface:
  `record(...)`, `recordAnthropic(resp)`, `recordOpenAI(resp)`.

Both are **fail-safe**: reporting is fire-and-forget and never raises into the
caller, so a metering outage can't break the customer's app.

## Wiring it in

**Recommended — `wrap()` the client once, no per-call code.** Every completion
call is then metered automatically (with latency); your call sites don't change.

Python:

```python
from annapurna_meter import wrap
client = wrap(anthropic_client, feature_id="feature-threat-triage")  # reads ENV

resp = client.messages.create(model="claude-sonnet-4-6", ...)   # metered automatically
```

Node:

```js
import { wrap } from "annapurna-meter";
const client = wrap(openai, { featureId: "feature-threat-triage" });

const resp = await client.chat.completions.create({ model: "gpt-4o", ... }); // metered
```

Provider is auto-detected. Pass an optional `metadata` (e.g. `{ environment,
customer_id }`) for extra attribution.

**Explicit — one line per call.** Use this for streaming/async responses, or
when you'd rather not wrap:

```python
from annapurna_meter import Meter
meter = Meter(feature_id="feature-threat-triage")
resp = anthropic_client.messages.create(model="claude-sonnet-4-6", ...)
meter.record_anthropic(resp)   # <-- the whole hook
```

```js
import { Meter } from "annapurna-meter";
const meter = new Meter("feature-threat-triage");
const resp = await openai.chat.completions.create({ model: "gpt-4o", ... });
meter.recordOpenAI(resp);      // <-- the whole hook
```

## Config

| Env var                  | What it is                                            |
|--------------------------|-------------------------------------------------------|
| `ANNAPURNA_INGEST_URL`   | e.g. `https://app.annapurna.example/api/hook/events`  |
| `ANNAPURNA_INGEST_TOKEN` | the per-tenant ingest token (POST `/api/hook/token`)  |

## Tests

```bash
make test-sdk    # python (pytest) + node (node --test)
```
