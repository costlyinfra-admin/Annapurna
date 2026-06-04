/**
 * Annapurna metering hook (Node).
 *
 * Thin, fail-safe wrapper that reports per-call LLM usage to Annapurna for
 * per-feature cost attribution. Mirrors the Python SDK. Cost is computed server
 * side from Annapurna's pricing tables — the SDK never sees prices.
 *
 *   - Never throws into the caller (errors are swallowed).
 *   - No dependencies (uses global fetch, Node >= 18).
 *   - A no-op when no ingest URL/token is configured, so the same code runs
 *     whether or not the hook is enabled.
 *
 * Config (constructor opts or env): ANNAPURNA_INGEST_URL, ANNAPURNA_INGEST_TOKEN.
 */
export class Meter {
  constructor(featureId = null, opts = {}) {
    this.featureId = featureId;
    this.ingestUrl = opts.ingestUrl ?? process.env.ANNAPURNA_INGEST_URL ?? null;
    this.token = opts.token ?? process.env.ANNAPURNA_INGEST_TOKEN ?? null;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  get enabled() {
    return Boolean(this.ingestUrl && this.token && this.fetchImpl);
  }

  record({ provider, model = "", tokensIn = 0, tokensOut = 0, featureId = null, occurredAt = null }) {
    const event = {
      provider,
      model,
      tokens_in: tokensIn | 0,
      tokens_out: tokensOut | 0,
      feature_id: featureId ?? this.featureId,
    };
    if (occurredAt) event.occurred_at = occurredAt;
    return this._send([event]);
  }

  recordAnthropic(response, { featureId = null, model = null } = {}) {
    const u = (response && response.usage) || {};
    return this.record({
      provider: "anthropic",
      model: model ?? (response && response.model) ?? "",
      tokensIn: u.input_tokens ?? 0,
      tokensOut: u.output_tokens ?? 0,
      featureId,
    });
  }

  recordOpenAI(response, { featureId = null, model = null } = {}) {
    const u = (response && response.usage) || {};
    return this.record({
      provider: "openai",
      model: model ?? (response && response.model) ?? "",
      tokensIn: u.prompt_tokens ?? 0,
      tokensOut: u.completion_tokens ?? 0,
      featureId,
    });
  }

  /** Fire-and-forget. Resolves true/false; never rejects. */
  _send(events) {
    if (!this.enabled) return Promise.resolve(false);
    return Promise.resolve()
      .then(() =>
        this.fetchImpl(this.ingestUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ events }),
        }),
      )
      .then(() => true)
      .catch(() => false);
  }
}
