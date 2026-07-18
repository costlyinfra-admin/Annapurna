"""Measured optimization opportunities: savings computed from seeded signals
must match a hand-calc from the price book (opt spec M-opt-3)."""

from __future__ import annotations

import datetime as dt

from annapurna import features, hook, optimize_measured

PERIOD = dt.date(2026, 6, 1)


def _dup_event(feature_id, fingerprint, tokens_in):
    return {
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "tokens_in": tokens_in,
        "tokens_out": 0,
        "feature_id": feature_id,
        "occurred_at": "2026-06-15T10:00:00Z",
        "signal": {"kind": "duplicate", "fingerprint": fingerprint, "count": 1},
    }


def _prefix_event(feature_id, fingerprint, count, prefix_tokens, cached_count, tokens_in):
    return {
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "feature_id": feature_id,
        "occurred_at": "2026-06-16T10:00:00Z",
        "signal": {
            "kind": "prefix",
            "fingerprint": fingerprint,
            "count": count,
            "prefix_tokens": prefix_tokens,
            "cached_count": cached_count,
            "tokens_in": tokens_in,
            "tokens_out": 0,
        },
    }


def test_duplicate_savings_match_the_price_book(tenant_id):
    triage = features.add_feature(tenant_id, "AI threat triage")
    # Two repeats of the same request, 1M input tokens each -> 2M avoidable input.
    hook.ingest_events(
        tenant_id,
        [
            _dup_event(triage["id"], "fp-a", 1_000_000),
            _dup_event(triage["id"], "fp-a", 1_000_000),
        ],
    )

    result = optimize_measured.opportunities(tenant_id, triage["id"], PERIOD)
    measured = result["measured"]["opportunities"]
    dup = next(o for o in measured if o["lever"] == "duplicate_calls")

    # 2M input tokens @ $3/M (claude-sonnet-4-6) = $6.00, exactly.
    assert dup["savings"] == 6.0
    assert dup["confidence"] == "high"
    assert "2 duplicate calls across 1 distinct requests" in dup["evidence"]
    assert dup["trail"][0]["call_count"] == 2
    # Fingerprints in the trail are short salted-hash handles, never prompt text.
    assert dup["trail"][0]["fingerprint"] == "fp-a"[:12]


def test_prefix_caching_savings_match_the_price_book(tenant_id):
    triage = features.add_feature(tenant_id, "AI threat triage")
    # A 4,000-token static prefix across 1,000 uncached calls.
    hook.ingest_events(
        tenant_id,
        [_prefix_event(triage["id"], "fp-p", 1000, 4000, 0, 4_000_000)],
    )

    result = optimize_measured.opportunities(tenant_id, triage["id"], PERIOD)
    measured = result["measured"]["opportunities"]
    prefix = next(o for o in measured if o["lever"] == "prompt_caching")

    # 1,000 calls * 4,000 tokens * $3/M * (1 - 0.10 cache-read) = $10.80.
    assert prefix["savings"] == 10.8
    assert prefix["confidence"] == "high"
    assert "4,000-token static prefix" in prefix["evidence"]
    assert "1,000 uncached calls" in prefix["evidence"]
    # No calls were cached yet.
    assert result["cache_utilization"] == 0.0


def test_prefix_below_threshold_is_not_flagged(tenant_id):
    triage = features.add_feature(tenant_id, "AI threat triage")
    # Small prefix (900 tokens) and few calls (50): below both thresholds.
    hook.ingest_events(
        tenant_id,
        [_prefix_event(triage["id"], "fp-small", 50, 900, 0, 45_000)],
    )
    result = optimize_measured.opportunities(tenant_id, triage["id"], PERIOD)
    levers = {o["lever"] for o in result["measured"]["opportunities"]}
    assert "prompt_caching" not in levers


def test_combines_measured_and_estimated_tiers(tenant_id):
    triage = features.add_feature(tenant_id, "AI threat triage")
    hook.ingest_events(
        tenant_id,
        [
            _dup_event(triage["id"], "fp-a", 1_000_000),
            _dup_event(triage["id"], "fp-a", 1_000_000),
            _prefix_event(triage["id"], "fp-p", 1000, 4000, 0, 4_000_000),
        ],
    )
    result = optimize_measured.opportunities(tenant_id, triage["id"], PERIOD)

    # Measured monthly = duplicate $6 + prompt caching $10.80 = $16.80.
    assert result["measured"]["monthly_savings"] == 16.8
    assert result["measured"]["annual_savings"] == round(16.8 * 12, 2)
    # Highest-savings lever sorts first.
    assert result["measured"]["opportunities"][0]["lever"] == "prompt_caching"
    # The heuristic (estimated) tier is present and clearly separate.
    assert "opportunities" in result["estimated"]
    assert "monthly_savings" in result["estimated"]


def test_no_signals_yields_empty_measured_but_keeps_estimated(tenant_id):
    triage = features.add_feature(tenant_id, "AI threat triage")
    result = optimize_measured.opportunities(tenant_id, triage["id"], PERIOD)
    assert result["measured"]["opportunities"] == []
    assert result["measured"]["monthly_savings"] == 0.0
    assert result["cache_utilization"] is None
    assert "estimated" in result


def test_unknown_feature_returns_none(tenant_id):
    assert (
        optimize_measured.opportunities(tenant_id, "00000000-0000-0000-0000-000000000000", PERIOD)
        is None
    )
