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

## Use (one line per call)

```js
import { Meter } from "annapurna-meter";

const meter = new Meter("feature-threat-triage"); // reads ANNAPURNA_INGEST_URL / _TOKEN

const resp = await openai.chat.completions.create({ model: "gpt-4o", ... });
meter.recordOpenAI(resp);        // <- the whole hook
```

Helpers: `recordAnthropic`, `recordOpenAI`, plus the generic
`record({ provider, model, tokensIn, tokensOut, featureId })`.

## Config

| Env var                  | What it is                                        |
|--------------------------|---------------------------------------------------|
| `ANNAPURNA_INGEST_URL`   | e.g. `https://app.example.com/api/hook/events`    |
| `ANNAPURNA_INGEST_TOKEN` | the per-workspace ingest token from the dashboard |

## License

Apache-2.0. (The Annapurna server is AGPL-3.0; this client SDK is permissive so
you can embed it in a proprietary app.)
