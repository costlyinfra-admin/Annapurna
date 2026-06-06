"""Tests for the Python metering SDK (no network — a transport captures posts)."""

from __future__ import annotations

import json

from annapurna_meter import Meter


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
