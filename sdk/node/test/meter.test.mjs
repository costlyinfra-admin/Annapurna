import assert from "node:assert";
import test from "node:test";
import { Meter, wrap } from "../index.mjs";

function meterWithCapture(calls) {
  return new Meter("default-feature", {
    ingestUrl: "https://app.test/api/hook/events",
    token: "tok",
    fetchImpl: (url, opts) => {
      calls.push({ url, opts });
      return Promise.resolve({ ok: true });
    },
  });
}

test("record builds an event and authenticates", async () => {
  const calls = [];
  const ok = await meterWithCapture(calls).record({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    tokensIn: 1200,
    tokensOut: 300,
    featureId: "f1",
  });
  assert.equal(ok, true);
  assert.equal(calls[0].opts.headers.Authorization, "Bearer tok");
  const event = JSON.parse(calls[0].opts.body).events[0];
  assert.equal(event.tokens_in, 1200);
  assert.equal(event.feature_id, "f1");
});

test("recordAnthropic maps usage fields", async () => {
  const calls = [];
  await meterWithCapture(calls).recordAnthropic(
    { model: "claude-haiku-4-5", usage: { input_tokens: 50, output_tokens: 7 } },
    { featureId: "f2" },
  );
  const event = JSON.parse(calls[0].opts.body).events[0];
  assert.equal(event.provider, "anthropic");
  assert.equal(event.tokens_in, 50);
  assert.equal(event.tokens_out, 7);
  assert.equal(event.feature_id, "f2");
});

test("unconfigured meter is a no-op", async () => {
  const m = new Meter();
  assert.equal(m.enabled, false);
  assert.equal(await m.record({ provider: "openai", model: "gpt-4o", tokensIn: 1, tokensOut: 1 }), false);
});

// --- wrap() auto-instrumentation ------------------------------------------

// A fake OpenAI-shaped client whose create() resolves like the real SDK.
class OpenAI {
  constructor(resp) {
    this.apiKey = "sk-real";
    this.chat = {
      completions: {
        create: async (args) => {
          this.lastArgs = args;
          return resp;
        },
      },
    };
  }
}

test("wrap records the completion with latency and passes through", async () => {
  const calls = [];
  const meter = new Meter("f1", {
    ingestUrl: "https://app.test/api/hook/events",
    token: "tok",
    metadata: { environment: "prod" },
    fetchImpl: (url, opts) => {
      calls.push({ url, opts });
      return Promise.resolve({ ok: true });
    },
  });
  const resp = { model: "gpt-4o", usage: { prompt_tokens: 80, completion_tokens: 20 } };
  const client = new OpenAI(resp);
  const wrapped = wrap(client, { meter });

  const out = await wrapped.chat.completions.create({ model: "gpt-4o", messages: [] });
  assert.equal(out, resp); // returns the real response, unchanged
  assert.equal(wrapped.apiKey, "sk-real"); // non-instrumented attribute passes through

  await new Promise((r) => setTimeout(r, 10)); // recording fires after resolution
  const event = JSON.parse(calls[0].opts.body).events[0];
  assert.equal(event.provider, "openai");
  assert.equal(event.feature_id, "f1");
  assert.equal(event.tokens_in, 80);
  assert.equal(typeof event.latency_ms, "number");
  assert.deepEqual(event.metadata, { environment: "prod" });
});

test("wrap skips a streaming response (no usage)", async () => {
  const calls = [];
  const meter = new Meter("f1", {
    ingestUrl: "https://app.test/api/hook/events",
    token: "tok",
    fetchImpl: (url, opts) => {
      calls.push({ url, opts });
      return Promise.resolve({ ok: true });
    },
  });
  const stream = (async function* () {})(); // async iterator, no usage
  const wrapped = wrap(new OpenAI(stream), { meter });
  const out = await wrapped.chat.completions.create({ stream: true });
  assert.equal(out, stream);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 0); // nothing recorded
});

test("wrap detects the provider from the client class", () => {
  const wrapped = wrap(new OpenAI({ usage: {} }), {
    meter: new Meter(null, { ingestUrl: "u", token: "t", fetchImpl: () => Promise.resolve({}) }),
  });
  assert.equal(typeof wrapped.chat.completions.create, "function");
});
