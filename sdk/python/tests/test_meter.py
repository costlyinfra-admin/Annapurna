"""Tests for the Python metering SDK (no network — a transport captures posts)."""

from __future__ import annotations

import json
import time

from annapurna_meter import (
    Meter,
    _detect_provider,  # noqa: PLC2701  (tested on purpose)
    wrap,
)


class _Capture:
    def __init__(self):
        self.calls = []

    def __call__(self, url, headers, body):
        self.calls.append({"url": url, "headers": headers, "events": json.loads(body)["events"]})


def _meter(capture):
    return Meter(ingest_url="https://app.test/api/hook/events", token="tok", transport=capture)


def test_record_builds_event_and_authenticates():
    cap = _Capture()
    m = _meter(cap)
    m.record(
        provider="anthropic",
        model="claude-sonnet-4-6",
        tokens_in=1200,
        tokens_out=300,
        feature_id="f1",
    ).join()

    assert cap.calls[0]["headers"]["Authorization"] == "Bearer tok"
    event = cap.calls[0]["events"][0]
    assert event["provider"] == "anthropic"
    assert event["tokens_in"] == 1200
    assert event["feature_id"] == "f1"


def test_record_anthropic_maps_usage():
    cap = _Capture()
    m = _meter(cap)
    resp = type(
        "R", (), {"model": "claude-haiku-4-5", "usage": {"input_tokens": 50, "output_tokens": 7}}
    )()
    m.record_anthropic(resp, feature_id="f2").join()
    event = cap.calls[0]["events"][0]
    assert event == {
        "provider": "anthropic",
        "model": "claude-haiku-4-5",
        "tokens_in": 50,
        "tokens_out": 7,
        "feature_id": "f2",
    }


def test_record_openai_maps_usage():
    cap = _Capture()
    m = _meter(cap)
    resp = {"model": "gpt-4o", "usage": {"prompt_tokens": 80, "completion_tokens": 20}}
    m.record_openai(resp, feature_id="f3").join()
    event = cap.calls[0]["events"][0]
    assert event["provider"] == "openai"
    assert event["tokens_in"] == 80
    assert event["tokens_out"] == 20


def test_record_gemini_maps_usage_metadata():
    cap = _Capture()
    m = _meter(cap)
    resp = type(
        "R",
        (),
        {
            "model_version": "gemini-2.5-flash",
            "usage_metadata": {"prompt_token_count": 800, "candidates_token_count": 120},
        },
    )()
    m.record_gemini(resp, feature_id="f7").join()
    event = cap.calls[0]["events"][0]
    assert event == {
        "provider": "google",
        "model": "gemini-2.5-flash",
        "tokens_in": 800,
        "tokens_out": 120,
        "feature_id": "f7",
    }


def test_record_openai_compatible_tags_hosted_oss_provider():
    cap = _Capture()
    m = _meter(cap)
    # A Together response uses the OpenAI usage shape; provider drives pricing.
    resp = {
        "model": "meta-llama-3.1-70b-instruct",
        "usage": {"prompt_tokens": 1200, "completion_tokens": 300},
    }
    m.record_openai_compatible(resp, provider="together", feature_id="f9").join()
    event = cap.calls[0]["events"][0]
    assert event == {
        "provider": "together",
        "model": "meta-llama-3.1-70b-instruct",
        "tokens_in": 1200,
        "tokens_out": 300,
        "feature_id": "f9",
    }


def test_unconfigured_meter_is_a_noop():
    cap = _Capture()
    m = Meter(transport=cap)  # no url/token
    assert m.enabled is False
    assert m.record(provider="openai", model="gpt-4o", tokens_in=1, tokens_out=1) is None
    assert cap.calls == []


# --- wrap() auto-instrumentation, latency, metadata ------------------------


def _wait(cap, n=1, timeout=2.0):
    """Recording posts on a background thread; wait for it to land."""
    end = time.time() + timeout
    while time.time() < end and len(cap.calls) < n:
        time.sleep(0.01)


class _FakeMessages:
    def __init__(self, resp):
        self.resp = resp
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.resp


class _FakeAnthropic:
    def __init__(self, resp):
        self.messages = _FakeMessages(resp)
        self.api_key = "sk-real"


def _anthropic_resp():
    return type(
        "R", (), {"model": "claude-sonnet-4-6", "usage": {"input_tokens": 10, "output_tokens": 2}}
    )()


def test_wrap_records_completion_and_passes_through():
    cap = _Capture()
    resp = _anthropic_resp()
    client = _FakeAnthropic(resp)
    m = Meter(
        ingest_url="https://app.test/api/hook/events",
        token="tok",
        feature_id="f1",
        transport=cap,
    )
    wrapped = wrap(client, provider="anthropic", meter=m)

    out = wrapped.messages.create(model="claude-sonnet-4-6", messages=[])
    assert out is resp  # returns the real response, unchanged
    assert wrapped.api_key == "sk-real"  # non-instrumented attribute passes through
    assert client.messages.calls  # the underlying call actually ran

    _wait(cap)
    ev = cap.calls[0]["events"][0]
    assert ev["provider"] == "anthropic"
    assert ev["feature_id"] == "f1"
    assert ev["tokens_in"] == 10 and ev["tokens_out"] == 2
    assert isinstance(ev["latency_ms"], int) and ev["latency_ms"] >= 0


def test_wrap_merges_default_metadata():
    cap = _Capture()
    m = Meter(
        ingest_url="https://app.test/api/hook/events",
        token="tok",
        metadata={"environment": "prod"},
        transport=cap,
    )
    wrapped = wrap(_FakeAnthropic(_anthropic_resp()), provider="anthropic", meter=m)
    wrapped.messages.create()
    _wait(cap)
    assert cap.calls[0]["events"][0]["metadata"] == {"environment": "prod"}


def test_wrap_skips_streaming_or_async_responses():
    cap = _Capture()
    stream = iter([])  # no usage attribute -> looks like a stream
    wrapped = wrap(_FakeAnthropic(stream), provider="anthropic", meter=_meter(cap))
    out = wrapped.messages.create(stream=True)
    assert out is stream
    _wait(cap, timeout=0.3)
    assert cap.calls == []  # nothing recorded for a non-usage response


def test_detect_provider_from_client_module():
    for module, expected in [
        ("anthropic.resources.messages", "anthropic"),
        ("openai._client", "openai"),
        ("google.genai", "google"),
    ]:
        cls = type("Client", (), {})
        cls.__module__ = module
        assert _detect_provider(cls()) == expected
