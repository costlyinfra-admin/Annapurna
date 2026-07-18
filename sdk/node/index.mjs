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
    // Default tags applied to every event (e.g. environment); per-call metadata
    // is merged on top. Optional — omit for the simplest setup.
    this.metadata = opts.metadata ?? {};
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  get enabled() {
    return Boolean(this.ingestUrl && this.token && this.fetchImpl);
  }

  record({
    provider,
    model = "",
    tokensIn = 0,
    tokensOut = 0,
    featureId = null,
    occurredAt = null,
    latencyMs = null,
    metadata = null,
  }) {
    const event = {
      provider,
      model,
      tokens_in: tokensIn | 0,
      tokens_out: tokensOut | 0,
      feature_id: featureId ?? this.featureId,
    };
    if (occurredAt) event.occurred_at = occurredAt;
    if (latencyMs != null) event.latency_ms = latencyMs | 0;
    const merged = { ...this.metadata, ...(metadata ?? {}) };
    if (Object.keys(merged).length) event.metadata = merged;
    return this._send([event]);
  }

  recordAnthropic(response, { featureId = null, model = null, latencyMs = null, metadata = null } = {}) {
    const u = (response && response.usage) || {};
    return this.record({
      provider: "anthropic",
      model: model ?? (response && response.model) ?? "",
      tokensIn: u.input_tokens ?? 0,
      tokensOut: u.output_tokens ?? 0,
      featureId,
      latencyMs,
      metadata,
    });
  }

  recordOpenAI(response, { featureId = null, model = null, latencyMs = null, metadata = null } = {}) {
    const u = (response && response.usage) || {};
    return this.record({
      provider: "openai",
      model: model ?? (response && response.model) ?? "",
      tokensIn: u.prompt_tokens ?? 0,
      tokensOut: u.completion_tokens ?? 0,
      featureId,
      latencyMs,
      metadata,
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

// ---------------------------------------------------------------------------
// wrap() — auto-instrument a provider client (zero code at the call sites)
// ---------------------------------------------------------------------------
const COMPLETION_PATHS = {
  anthropic: [["messages", "create"]],
  openai: [
    ["chat", "completions", "create"],
    ["responses", "create"],
  ],
};
const RECORDERS = {
  anthropic: (m, r, lat) => m.recordAnthropic(r, { latencyMs: lat }),
  openai: (m, r, lat) => m.recordOpenAI(r, { latencyMs: lat }),
};

function detectProvider(client) {
  const name = ((client && client.constructor && client.constructor.name) || "").toLowerCase();
  if (name.includes("anthropic")) return "anthropic";
  if (name.includes("openai")) return "openai";
  throw new Error("Could not detect the LLM provider; pass { provider } to wrap().");
}

const hasUsage = (r) => Boolean(r && (r.usage || r.usage_metadata));
const isPrefix = (path, full) => path.length <= full.length && path.every((s, i) => s === full[i]);
const onPathPrefix = (provider, path) =>
  (COMPLETION_PATHS[provider] || []).some((full) => isPrefix(path, full));
const isCompletion = (provider, path) =>
  (COMPLETION_PATHS[provider] || []).some((full) => full.length === path.length && isPrefix(path, full));

function makeProxy(target, meter, provider, path = []) {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (typeof prop !== "string") return Reflect.get(target, prop);
      const real = target[prop];
      const nextPath = [...path, prop];
      if (onPathPrefix(provider, nextPath)) {
        const bound = typeof real === "function" ? real.bind(target) : real;
        return makeProxy(bound, meter, provider, nextPath);
      }
      return typeof real === "function" ? real.bind(target) : real;
    },
    apply(_t, _thisArg, args) {
      if (!isCompletion(provider, path)) return target(...args);
      const start = Date.now();
      const out = target(...args);
      const rec = (resp) => {
        try {
          if (hasUsage(resp)) RECORDERS[provider](meter, resp, Date.now() - start);
        } catch {
          /* metering must never throw into the caller */
        }
      };
      if (out && typeof out.then === "function") {
        out.then(rec).catch(() => {}); // record after the promise resolves; return original
        return out;
      }
      rec(out);
      return out;
    },
  });
}

/**
 * Wrap an LLM client so every completion call is metered automatically.
 * Your existing calls are unchanged; each is recorded with its latency after it
 * resolves. Non-completion attributes pass through; streaming responses (no
 * usage) are skipped. Provider is auto-detected; pass { provider } to override.
 * If you pass { meter }, it is used as-is (set featureId/metadata on it).
 */
export function wrap(
  client,
  { featureId = null, provider = null, metadata = null, ingestUrl = null, token = null, meter = null } = {},
) {
  const m = meter ?? new Meter(featureId, { ingestUrl, token, metadata });
  return makeProxy(client, m, provider ?? detectProvider(client));
}
