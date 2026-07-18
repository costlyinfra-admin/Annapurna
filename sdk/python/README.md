# annapurna-meter

The optional metering hook for [Annapurna](https://github.com/costlyinfra-admin/Annapurna) —
a thin, fail-safe wrapper that reports per-call LLM usage so spend can be
attributed **per feature**. Stdlib-only, no dependencies. Cost is computed
server-side from Annapurna's pricing tables — the SDK never sees prices, and it
never sends prompt or response content, only token counts and a `feature_id`.

It is **fail-safe**: reporting is fire-and-forget on a background thread and can
never raise into your request path. With no ingest URL/token configured, every
call is a no-op.

## Install

```bash
pip install annapurna-meter
```

## Use

**Recommended — wrap the client once (no per-call code):**

```python
from annapurna_meter import wrap

client = wrap(anthropic_client, feature_id="feature-threat-triage")  # reads ENV

resp = client.messages.create(model="claude-sonnet-4-6", ...)   # metered automatically
```

Provider is auto-detected; each call is recorded with its latency. Pass an
optional `metadata={…}` (e.g. `environment`, `customer_id`) for extra
attribution. Streaming/async calls use the explicit form below.

**Explicit — one line per call:**

```python
from annapurna_meter import Meter

meter = Meter(feature_id="feature-threat-triage")
resp = anthropic_client.messages.create(model="claude-sonnet-4-6", ...)
meter.record_anthropic(resp)   # <- the whole hook
```

Helpers: `record_anthropic`, `record_openai`, `record_gemini`,
`record_openai_compatible`, or the generic `record(provider=…, model=…,
tokens_in=…, tokens_out=…, feature_id=…)`.

## Config

| Env var                  | What it is                                            |
|--------------------------|-------------------------------------------------------|
| `ANNAPURNA_INGEST_URL`   | e.g. `https://app.example.com/api/hook/events`        |
| `ANNAPURNA_INGEST_TOKEN` | the per-workspace ingest token from the dashboard     |

## License

Apache-2.0. (The Annapurna server is AGPL-3.0; this client SDK is permissive so
you can embed it in a proprietary app.)
