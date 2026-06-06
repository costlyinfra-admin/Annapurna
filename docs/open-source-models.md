# Open-source & self-hosted models

Annapurna attributes inference cost for open-source models the same way it does
for Anthropic/OpenAI — onto the `feature_id` spine, separate from build cost,
with a confidence on every number. What changes is **where the dollars come
from**, because open-source splits into two very different cost models.

## The two modes

| Mode | Who meters the $ | Examples | How Annapurna costs it |
|---|---|---|---|
| **Priced (hosted)** | The host bills per token | Together, Fireworks, Groq, Bedrock, OpenRouter, DeepInfra | The SDK reports tokens; we price them against **that host's** rates. Same pipeline as OpenAI/Anthropic. |
| **Pooled (self-hosted)** | Nobody — it's a GPU/infra bill | vLLM, Ollama, TGI on your own GPUs or on-prem | You register the serving deployment + its **monthly infra cost**; we split that pool across features by usage share. |

## Priced (hosted) — just works

The same open weights cost different amounts depending on who serves them
(Llama-3.1-70B is ~$0.88/M on Together but ~$0.59/M on Groq), so prices are keyed
by **(provider, model)**. Wrap your calls with the SDK:

```python
resp = client.chat.completions.create(model="meta-llama-3.1-70b-instruct", ...)
meter.record_openai_compatible(resp, provider="together", feature_id="triage")
```

An unpriced (provider, model) costs $0 and shows up as a reconciliation gap —
never a silently-wrong number. Add rates in `backend/annapurna/pricing.py`.

## Pooled (self-hosted) — register a pool, allocate the bill

Self-hosted serving has **no per-token price**. The cost is the GPU/infra bill,
which is *shared* across every feature the cluster serves. So:

1. **Register a pool** (dashboard → *Add cost data* → *Self-hosted models*, or
   `POST /api/compute/pools`): a name, the `provider` label its SDK calls carry,
   and its **monthly cost** (manual entry today; a cloud-cost connector that
   reads tagged AWS/GCP GPU spend is a planned fast-follow).
2. **Meter usage**: self-hosted calls flow through the hook into `pool_usage`
   (per-feature token/request counts) — **without pricing**, because there's no
   price.
3. **Allocate** (`POST /api/compute/allocate`): the pool's monthly cost is split
   across features **by usage share**, written as `inference_cost` rows with
   `source='self_host'` at **medium** confidence (it's an allocation, not a
   metered price). Usage with no `feature_id` → **Unattributed**.

The allocated parts always sum to the pool bill, so it **reconciles by
construction**. A pool you're paying for but haven't instrumented shows its whole
cost as Unattributed — never hidden, never faked.

### Worked example

A $6,500/mo GPU pool serving one feature with 580M tagged tokens and 70M
untagged → **$5,800** on the feature, **$700** Unattributed. (This is exactly the
"Log triage (self-hosted)" feature in the demo seed.)

## Fine-tuning is a build cost

Fine-tuning an open model is a one-time GPU cost to *create* a feature's model,
so it lands on the **build** side (never blended with inference). Record it via
the dashboard's *Fine-tune / training cost* action or `POST /api/build/training`;
it appears as a `tool='fine_tune'` row at **high** confidence (directly
attributed to the feature you name).

## Privacy

The metering hook is **metadata-only** — provider, model, token counts, and
`feature_id`. It never sees prompts or responses, so it's compatible with the
data-privacy posture that usually motivates self-hosting in the first place.
(Fully air-gapped deployments would need a self-hosted collector / batch export
rather than calling the hosted ingest endpoint — a future option.)
