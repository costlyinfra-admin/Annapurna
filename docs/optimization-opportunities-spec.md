# Spec — Measured optimization opportunities

**Status:** Draft for review (not yet scheduled into the build plan)
**Scope of this doc:** the first *real* (measured, not heuristic) cost-optimization
slice, plus the architecture the later tiers plug into.
**Relationship to existing work:** replaces nothing. The current heuristic
estimator in [`optimize.py`](../backend/annapurna/optimize.py) stays as the
zero-instrumentation fallback; this adds a **measured** tier above it.

---

## 1. Why

Today's "Optimization opportunities" are fixed percentages applied to a feature's
monthly usage totals (see `optimize.py`: 10% of premium spend, 12% of input cost,
etc.). They point at the right *levers* but the dollar figures are rules of thumb,
not evidence. Goal: turn "features shaped like this usually have room" into
"**this feature made 1,240 duplicate calls last month costing $312 — here's the
fix**," where every number is measured and every dollar is computed from the
price book, never guessed.

## 2. Principles (inherit the product's invariants)

1. **Grounded, not guessed.** Every opportunity is backed by a measured signal
   (a count, a token total) and priced with `pricing.py` — never a flat %.
   Same bar as the rest of Annapurna: *no black-box numbers* (invariant 3).
2. **Metadata only, never content.** We capture *shapes* of calls (hashes,
   counts, token sizes), never prompt or response text. Hashes are salted
   per-tenant so they can't be dictionary-attacked or cross-referenced.
3. **Reconcile, don't trust** (invariant 5). A projected saving becomes a
   *realized* saving only after the user applies it and we measure the actual
   month-over-month delta. Projections are labelled as projections until then.
4. **Never break the caller.** The SDK's existing contract holds — all new work
   is off the request path, bounded memory, fail-safe.
5. **Connector-only still gets value.** Customers who won't install the SDK get
   a weaker-but-real tier from fields the provider bill already reports.

## 3. What this first slice detects

Two detectors, chosen because they are **exactly measurable** and **privacy-safe**:

| Detector | What it proves | Why it's real (not a %) |
|---|---|---|
| **Duplicate calls** | The same request was sent N times in a period | The (N−1) repeats are avoidable; savings = repeats × the call's real priced cost |
| **Cacheable prompt prefix** | Many calls share a large identical prefix that isn't cached | Savings = repeated prefix tokens × (input rate − cached-read rate), from the price book |

Explicitly **out of scope for this slice** (future tiers, §12): model-downgrade
recommendations backed by evals, code/call-site analysis, semantic (near-dup)
caching, LLM-written recommendations.

## 4. Data captured (SDK, metadata-only)

The metering SDK ([`sdk/python/annapurna_meter`](../sdk/python/annapurna_meter))
gains an **optional** optimization mode (`Meter(..., optimize=True)`, default
off). When on, for each recorded call the SDK computes locally:

| Field | Meaning | How derived |
|---|---|---|
| `request_fp` | fingerprint of the full normalized request | `sha256(tenant_salt + model + normalized(messages))`, hex |
| `prefix_fp` | fingerprint of the cacheable static prefix | `sha256(tenant_salt + system_prompt + tool_defs)` when present; else hash of the first `prefix_chars` (default 2 000) |
| `prefix_tokens` | representative size of that prefix | provider-reported prompt tokens for the static part, else `len(prefix)/4` estimate |
| `cache_read` | were input tokens served from cache? | from the provider response usage (`cache_read_input_tokens` > 0) |
| `was_retry` | is this a retry of a failed call? | caller passes it, or SDK wraps a retry helper (later) |

**Only the hashes and counts leave the process.** Never the prompt. `tenant_salt`
is a per-tenant secret fetched once with the ingest token, so hashes are useless
to anyone without it.

### 4.1 The SDK aggregates client-side (keeps volume + storage bounded)

To avoid shipping millions of per-call events and storing every unique request:

- The SDK keeps a small **bounded LRU** (`request_fp → last_seen`, cap ~5 000).
  On a *repeat* within the window it emits a **duplicate signal** — so only
  confirmed duplicates are ever sent. Non-repeats cost nothing and are never
  stored.
- It keeps a tiny **counter map** (`prefix_fp → {count, prefix_tokens,
  cached_count}`) and flushes summaries on a timer (default 60 s) or at cap.
  Distinct static prefixes per feature are few (a handful of system prompts), so
  this is naturally small.

Result: the server only ever stores *duplicates* and *prefix summaries* — both
inherently bounded — not raw traffic.

## 5. Data model

New table (migration **0019** — 0018 was taken by the latency/customer-cost work),
tenant-isolated with RLS like every other table:

```sql
CREATE TABLE usage_signal (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  feature_id    uuid REFERENCES feature(id) ON DELETE SET NULL,   -- NULL => Unattributed
  provider      text NOT NULL,
  model         text,
  period        date NOT NULL,                                    -- monthly bucket (rest of the system)
  signal_kind   text NOT NULL CHECK (signal_kind IN ('duplicate','prefix')),
  fingerprint   text NOT NULL,                                    -- request_fp or prefix_fp (salted hash)
  call_count    bigint NOT NULL DEFAULT 0,                        -- duplicates: repeats; prefix: total calls sharing it
  prefix_tokens bigint,                                           -- prefix kind only
  tokens_in     bigint NOT NULL DEFAULT 0,                        -- sums, to price a representative call
  tokens_out    bigint NOT NULL DEFAULT 0,
  cached_count  bigint NOT NULL DEFAULT 0,                        -- calls already served from cache
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature_id, provider, model, period, signal_kind, fingerprint)
);
```

Upsert-on-ingest (increment `call_count`, add token sums). Monthly `period`
keeps it consistent with the review-period model. This table holds **signals**,
never cost — cost is always derived at read time from `pricing.py`, so a price
change reprices old opportunities automatically.

## 6. Ingest path

Extend `hook.ingest_events` ([`hook.py`](../backend/annapurna/hook.py)). Events
may now carry an optional `signal` block:

```json
{ "provider":"anthropic","model":"claude-sonnet-4-6","feature_id":"…",
  "tokens_in":4200,"tokens_out":180,
  "signal": { "kind":"duplicate", "fingerprint":"…", "count":1 } }
{ "provider":"anthropic","model":"claude-sonnet-4-6","feature_id":"…",
  "signal": { "kind":"prefix", "fingerprint":"…", "count":320,
              "prefix_tokens":4100, "cached_count":0, "tokens_in":…, "tokens_out":… } }
```

- Cost accounting is unchanged — a duplicate signal is *also* a normal metered
  call and still lands in the monthly `inference_cost` row (we never
  double-count; the signal is separate bookkeeping).
- Signal blocks upsert into `usage_signal`. Unknown/foreign `feature_id` →
  Unattributed, same rule as today.
- Everything stays best-effort and non-fatal.

## 7. Detectors (the grounded math)

A read-time module `optimize_measured.py` computes opportunities for a feature +
period from `usage_signal` rows, pricing each with `pricing.py`.

**Duplicate calls**
```
repeats      = Σ call_count over ('duplicate') rows for (feature, period)
cost/call    = price(model, avg_tokens_in, avg_tokens_out, provider)   # per model
savings      = Σ_model repeats_model × cost/call_model
```
Evidence: "N duplicate calls across M distinct requests." Confidence **high**
(exact). Framed as "response caching / dedup could avoid these," because some
duplicates are legitimate (idempotent retries, different users asking the same
thing) — we surface the ceiling and let the user judge.

**Cacheable prompt prefix**
```
for each ('prefix') row with call_count C, prefix_tokens P, cached_count K:
  cacheable_calls   = C − K                       # not already cached
  if cacheable_calls ≥ threshold (default 100) and P ≥ 1 000:
    input_rate      = price_in(model, provider)   # $ / token
    cached_rate     = input_rate × CACHE_READ_MULT # e.g. 0.10 for Anthropic
    savings        += cacheable_calls × P × (input_rate − cached_rate)
```
Evidence: "a P-token static prefix repeated across C calls, currently uncached."
Confidence **high** when P and C are large.

Both numbers are computed from measured counts × price-book rates. No fixed
percentages anywhere.

### 7.1 Pricing additions

`pricing.py` gains a small, transparent cache/batch model (versioned like the
rest): per-provider `CACHE_READ_MULT` (Anthropic ≈ 0.10, OpenAI ≈ 0.50 — list
values, kept current; drift shows up as a reconciliation gap, never a silent
wrong number) and a `BATCH_MULT` (≈ 0.50) reserved for the batch-eligibility
detector in a later tier.

## 8. Connector-only complement (Tier A, no SDK)

The provider cost APIs report cache usage the connectors currently discard.
Extend the Anthropic/OpenAI clients ([`providers.py`](../backend/annapurna/providers.py))
to read `cache_read_input_tokens` / `cache_creation_input_tokens` (Anthropic) and
`cached_tokens` (OpenAI) and store them on the inference row. This gives, without
any instrumentation:

- **Current cache utilization** per feature ("8% of input is cached") — shown as
  context on the opportunity, and
- a floor for the caching recommendation (don't recommend caching what's already
  cached).

It can't *prove* repetition (that needs the SDK), so connector-only caching stays
a **medium-confidence hint**; the SDK upgrades it to a measured number.

## 9. API

```
GET /api/features/{id}/opportunities?range=…    ->
{
  "measured": [
    { "lever":"duplicate_calls", "savings":312.40, "confidence":"high",
      "evidence":"1,240 duplicate calls across 90 distinct requests this month",
      "fix":"Add response caching for identical requests (e.g. keyed on the request hash).",
      "trail":[ {feature_signal-style rows backing it} ] },
    { "lever":"prompt_caching", "savings":880.00, "confidence":"high",
      "evidence":"4,100-token static system prompt repeated across 26,000 uncached calls",
      "fix":"Enable prompt caching (set cache_control on the static system block)." }
  ],
  "estimated": [ …the existing heuristic opportunities, clearly labelled… ],
  "cache_utilization": 0.08
}
```

Follows the review-period range model already built.

## 10. UI (feature drill-down)

On the feature page, split the optimization section into two clearly-labelled
groups:

- **Measured opportunities** (new, on top): each row shows the **lever**, the
  **measured evidence** sentence, the **grounded $/mo** (and /yr), a **confidence
  badge**, and the **specific fix** (one line; later, a file/line when
  code-analysis lands). An expandable evidence trail mirrors the cost evidence
  trail already used elsewhere.
- **Estimated opportunities** (the current heuristic), kept but demoted and
  labelled "directional estimate" so the two are never confused.

Empty state when the SDK isn't installed: a nudge — "Install the metering SDK
with `optimize=True` to turn these estimates into measured, per-call findings."
(Great pull-through for SDK adoption; the SDK stops being just a cost-accuracy
tool and starts *finding money*.)

## 11. Reconciliation loop (projected → realized)

New table `optimization_action(tenant_id, feature_id, lever, applied_on,
projected_monthly)`. When a user marks an opportunity **applied**:

- the projection is frozen with the applied date;
- next period, we compute the feature's actual cost delta for that lever's signal
  (e.g., duplicate count dropped from 1,240 → 40) and show **projected vs
  realized**;
- this both proves ROI to the CFO and tunes future projections.

This is the same "reconcile against reality" ethos as bill reconciliation.

## 12. Later tiers (not in this slice, but the architecture supports them)

- **Batch-API eligibility** — flag async/non-latency-sensitive features → ~50% off.
- **Semantic (near-duplicate) caching** — embed request fingerprints; needs an
  embedding step and a similarity threshold (privacy: embeddings of hashes/short
  normalized forms, opt-in).
- **Code / call-site analysis** — from the existing GitHub connection, read the
  actual `client.messages.create(...)` sites and produce file/line-specific fixes
  ("`triage.py:88` uses Opus with a 4k static prompt and no `cache_control`").
- **Eval-backed model downgrade** — replay a sample of real prompts against a
  cheaper model and judge quality. Highest trust, heaviest lift; requires prompt
  capture → **explicit opt-in** and careful handling.
- **LLM-as-analyst** — hand a model the assembled *measured* evidence + call-site
  facts to write the prioritized recommendation. Guardrail: it may only cite
  numbers we computed; dollars come from `pricing.py`, not the model.

## 13. Milestones & acceptance criteria

- **M-opt-1 — Schema + ingest.** ✅ Done. Migration 0019 (`usage_signal` + RLS);
  extended `hook.ingest_events` to accept `signal` blocks and upsert (duplicate
  rides on the metered call; prefix is a summary that never re-costs). `HookEvent`
  gained a typed `signal` field so the model never strips it. *Accept:* signals
  persist per-tenant; cost accounting unchanged; tenant isolation test passes.
- **M-opt-2 — SDK optimize mode.** ✅ Done (SDK v0.3.0, Python + Node).
  `optimize=True` adds a client-side duplicate LRU + prefix counters + salted
  hashing + timer/cap flush; a per-tenant salt endpoint (`GET /api/hook/salt`,
  migration 0020). All fingerprinting/hashing runs off the call path (background
  thread in Python, deferred in Node); off by default; memory capped; no signals
  emitted without a salt. *Accept:* off by default, zero added latency on the
  call path, memory capped, duplicates and prefix summaries emitted; unit tests
  with a fake transport (Python + Node) pass.
- **M-opt-3 — Detectors + API.** ✅ Done. `optimize_measured.py` (duplicate + prefix
  detectors) + pricing cache model (`CACHE_READ_MULT`, `BATCH_MULT`, `rate_in`,
  `cache_read_mult`) + `GET /api/features/{id}/opportunities`. The heuristic block
  was extracted to `dashboard.heuristic_optimization` and reused as the estimated
  tier. *Accept:* duplicate and prefix savings computed from seeded signals match a
  hand-calc from the price book (tests: 2M dup input @ $3/M = $6.00; 1,000×4,000-tok
  uncached prefix @ $3/M × 0.90 = $10.80).
  - *Deviations from this draft (deliberate):* the endpoint takes `?period=YYYY-MM`
    (monthly, matching the feature drill-down) rather than `?range=`; the response is
    symmetric — `{period, measured:{opportunities,monthly_savings,annual_savings},
    estimated:{…same shape…}, cache_utilization}` — rather than bare lists; prefix
    caching is only claimed for providers with a priced cache discount (Anthropic/
    OpenAI/Google), never OSS hosts we can't price; `cache_utilization` is derived
    from SDK prefix signals for now and will be strengthened by connector cache
    fields in M-opt-5.
- **M-opt-4 — UI.** ✅ Done. The feature page's Optimization section now fetches
  `/opportunities` and renders a **Measured** group (grounded-in-metered-calls tag,
  cache-utilization note, per-lever cards with the evidence sentence, the specific
  fix, a confidence badge, and an expandable evidence trail) above a demoted
  **Estimated** group ("directional estimate"). Empty measured state shows an SDK
  nudge linking to Install SDK. Demo seed adds `usage_signal` rows for AI threat
  triage (3 duplicate fingerprints + a 4,100-token uncached prefix, ~8% cached).
  *Accept:* measured opportunities render with evidence, $ and confidence; demo
  seed includes signal rows; browser-verified.
- **M-opt-5 — Connector cache fields (Tier A).** Read provider cache tokens; show
  utilization. *Accept:* utilization surfaces without the SDK.
- **M-opt-6 — Reconciliation loop.** `optimization_action` + projected-vs-realized.
  *Accept:* marking applied and advancing a period shows the realized delta.

## 14. Risks & open questions

- **Duplicates aren't always waste** (idempotent retries, distinct users). → Frame
  as a ceiling; require confirmation before counting as realized savings.
- **Hash privacy.** Salting defeats casual dictionary attacks; document the
  threat model. Prompts themselves are never sent.
- **SDK footprint grows** (LRU + timer + salt fetch). Keep it optional, bounded,
  stdlib-only; publish the memory ceiling.
- **Provider cache-field availability varies** and shapes evolve — parse
  tolerantly, same offline-spec caveat as the cost connectors.
- **Volume at very high call rates** — client-side summarization is the mitigation;
  add sampling if a tenant's prefix cardinality is unexpectedly high.
- **Scope vs the build plan.** This is a new workstream beyond the current v1
  milestones (design doc §11 lists trends/anomaly work as later slices). Proposed
  to slot *after* core ship, SDK adoption permitting.
