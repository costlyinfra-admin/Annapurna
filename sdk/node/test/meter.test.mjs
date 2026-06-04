import assert from "node:assert";
import test from "node:test";
import { Meter } from "../index.mjs";

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
