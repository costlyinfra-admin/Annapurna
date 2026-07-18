/**
 * Annapurna metering hook (Node).
 *
 * Thin, fail-safe wrapper that reports per-call LLM usage to Annapurna for
 * per-feature cost attribution. Mirrors the Python SDK. Cost is computed server
 * side from Annapurna's pricing tables — the SDK never sees prices.
 *
 *   - Never throws into the caller (errors are swallowed).
 *   - No third-party dependencies (Node builtins only: global fetch + crypto, Node >= 18).
 *   - A no-op when no ingest URL/token is configured, so the same code runs
 *     whether or not the hook is enabled.
 *
 * Config (constructor opts or env): ANNAPURNA_INGEST_URL, ANNAPURNA_INGEST_TOKEN.
 */
import { createHash } from "node:crypto";

export class Meter {
  constructor(featureId = null, opts = {}) {
    this.featureId = featureId;
    this.ingestUrl = opts.ingestUrl ?? process.env.ANNAPURNA_INGEST_URL ?? null;
    this.token = opts.token ?? process.env.ANNAPURNA_INGEST_TOKEN ?? null;
    // Default tags applied to every event (e.g. environment); per-call metadata
    // is merged on top. Optional — omit for the simplest setup.
    this.metadata = opts.metadata ?? {};
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    // Optimize mode (opt spec §4): measure traffic SHAPE — salted-hash
    // fingerprints and counts, never prompt text — to find duplicate calls and
    // uncached repeated prefixes. Off by default; work is off the call path,
    // bounded, and fail-safe.
    this.salt = opts.salt ?? null;
    this._saltPromise = null;
    this._optimizer = opts.optimize
      ? new Optimizer({ prefixChars: opts.prefixChars, flushInterval: opts.flushInterval })
      : null;
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
    if (!this.enabled || !events.length) return Promise.resolve(false);
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

  _saltUrl() {
    if (!this.ingestUrl) return null;
    return this.ingestUrl.endsWith("/events")
      ? this.ingestUrl.slice(0, -"/events".length) + "/salt"
      : this.ingestUrl.replace(/\/+$/, "") + "/salt";
  }

  /** Fetch (once) the per-tenant fingerprint salt. Resolves to a salt or null. */
  _ensureSalt() {
    if (this._saltPromise) return this._saltPromise;
    if (this.salt != null) {
      this._saltPromise = Promise.resolve(this.salt);
      return this._saltPromise;
    }
    this._saltPromise = Promise.resolve()
      .then(() => this.fetchImpl(this._saltUrl(), { method: "GET", headers: { Authorization: `Bearer ${this.token}` } }))
      .then((r) => r.json())
      .then((d) => (this.salt = d && d.salt ? d.salt : null))
      .catch(() => (this.salt = null));
    return this._saltPromise;
  }

  /**
   * Record an auto-instrumented (wrap()) call. Token extraction, optimize-mode
   * hashing and the POST all run after the caller's call has returned/resolved,
   * so the request path never pays for them.
   */
  _recordWrapped(provider, request, response, latencyMs) {
    if (!this.enabled) return Promise.resolve(false);
    const build = (salt) => {
      const { model, tokensIn, tokensOut, cacheRead } = extractUsage(provider, response);
      const event = {
        provider,
        model,
        tokens_in: tokensIn | 0,
        tokens_out: tokensOut | 0,
        feature_id: this.featureId,
        latency_ms: latencyMs | 0,
      };
      if (Object.keys(this.metadata).length) event.metadata = { ...this.metadata };
      const extra = [];
      if (this._optimizer) {
        const signal = this._optimizer.onCall(salt, provider, model, request, tokensIn, tokensOut, cacheRead);
        if (signal) event.signal = signal;
        extra.push(...this._optimizer.dueSummaries(this.featureId));
      }
      return this._send([event, ...extra]);
    };
    return this._optimizer ? this._ensureSalt().then(build) : build(null);
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

/** Pull { model, tokensIn, tokensOut, cacheRead } from a provider response. */
function extractUsage(provider, resp) {
  const u = (resp && resp.usage) || {};
  if (provider === "anthropic") {
    return {
      model: (resp && resp.model) || "",
      tokensIn: u.input_tokens ?? 0,
      tokensOut: u.output_tokens ?? 0,
      cacheRead: (u.cache_read_input_tokens ?? 0) > 0,
    };
  }
  // openai and OpenAI-compatible hosts
  const details = u.prompt_tokens_details || {};
  return {
    model: (resp && resp.model) || "",
    tokensIn: u.prompt_tokens ?? 0,
    tokensOut: u.completion_tokens ?? 0,
    cacheRead: (details.cached_tokens ?? 0) > 0,
  };
}

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
          // args[0] carries the request (messages/system/tools) optimize mode
          // fingerprints; recording runs after the call so the path never pays.
          if (hasUsage(resp)) meter._recordWrapped(provider, args[0] || {}, resp, Date.now() - start);
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

// ---------------------------------------------------------------------------
// Optimize mode — measured optimization signals (opt spec §4). Traffic SHAPE
// only: salted-hash fingerprints and counts, never prompt or response text.
// ---------------------------------------------------------------------------
const sha = (...parts) => createHash("sha256").update(parts.join("\x1f")).digest("hex");

// Deterministic JSON with object keys sorted at every level (array order kept).
function stableStringify(value) {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v,
  );
}

function normalize(request) {
  if (!request || typeof request !== "object") return "";
  const payload = request.messages ?? request.input ?? request.contents ?? null;
  try {
    return stableStringify(payload);
  } catch {
    return String(payload);
  }
}

function staticPrefix(request, prefixChars) {
  let str = "";
  if (request && typeof request === "object" && (request.system != null || request.tools != null)) {
    str = stableStringify([request.system ?? null, request.tools ?? null]);
  }
  if (!str) str = normalize(request).slice(0, prefixChars);
  return { str, prefixTokens: Math.max(0, Math.floor(str.length / 4)) };
}

/**
 * Client-side, bounded signal collector (opt spec §4.1). Node is single-threaded,
 * so no locking is needed. A duplicate LRU emits one-off 'duplicate' signals; a
 * prefix counter map flushes 'prefix' summaries on a timer or at capacity.
 */
class Optimizer {
  constructor({ prefixChars = 2000, flushInterval = 60000, dupCapacity = 5000, prefixCapacity = 512 } = {}) {
    this.prefixChars = prefixChars;
    this.flushInterval = flushInterval; // milliseconds
    this.dupCapacity = dupCapacity;
    this.prefixCapacity = prefixCapacity;
    this.seen = new Map(); // request_fp -> true (insertion-ordered => LRU)
    this.prefixes = new Map(); // prefix_fp -> counts
    this.lastFlush = Date.now();
  }

  onCall(salt, provider, model, request, tokensIn, tokensOut, cacheRead) {
    if (!salt) return null; // no salt -> no signals (never emit unsalted hashes)
    const reqFp = sha(salt, provider, model, normalize(request));
    const { str, prefixTokens } = staticPrefix(request, this.prefixChars);
    const prefixFp = sha(salt, provider, model, str);

    const duplicate = this.seen.has(reqFp);
    if (duplicate) {
      this.seen.delete(reqFp);
      this.seen.set(reqFp, true);
    } else {
      this.seen.set(reqFp, true);
      while (this.seen.size > this.dupCapacity) this.seen.delete(this.seen.keys().next().value);
    }

    const e = this.prefixes.get(prefixFp) || {
      provider,
      model,
      count: 0,
      prefixTokens,
      cached: 0,
      tin: 0,
      tout: 0,
    };
    e.count += 1;
    e.tin += tokensIn | 0;
    e.tout += tokensOut | 0;
    e.prefixTokens = Math.max(e.prefixTokens, prefixTokens);
    if (cacheRead) e.cached += 1;
    this.prefixes.set(prefixFp, e);

    return duplicate ? { kind: "duplicate", fingerprint: reqFp, count: 1 } : null;
  }

  dueSummaries(featureId) {
    const now = Date.now();
    if (now - this.lastFlush < this.flushInterval && this.prefixes.size < this.prefixCapacity) return [];
    this.lastFlush = now;
    const items = this.prefixes;
    this.prefixes = new Map();
    const out = [];
    for (const [fingerprint, e] of items) {
      out.push({
        provider: e.provider,
        model: e.model,
        feature_id: featureId,
        signal: {
          kind: "prefix",
          fingerprint,
          count: e.count,
          prefix_tokens: e.prefixTokens,
          cached_count: e.cached,
          tokens_in: e.tin,
          tokens_out: e.tout,
        },
      });
    }
    return out;
  }
}
