# sdk/ — Metering hook (placeholder until M7)

This directory will hold the **metering SDK** — the optional precision tier from
design doc §7.2 and build-plan **M7**.

- **Python first, then Node** — a *thin* wrapper around the customer's LLM client
  calls that emits per-call metered events: `tokens_in`, `tokens_out`, `model`,
  and a `feature_id`.
- Events are reported to the hook-ingest endpoint; cost is computed from internal
  versioned pricing tables and stored as `inference_cost` rows with `source = hook`.
- Reconciled every period against the provider cost API (the authoritative dollar
  total); any delta routes to the **Unattributed** bucket.

**Invariant:** the hook is a precision upgrade, never a requirement. Onboarding
and first value must work with connectors alone. Nothing is built here before M7.
