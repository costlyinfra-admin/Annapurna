"""Pricing table sanity."""

from __future__ import annotations

from decimal import Decimal

from annapurna import pricing


def test_known_model_costs_tokens():
    # sonnet: $3 / 1M input, $15 / 1M output
    assert pricing.price("claude-sonnet-4-6", 1_000_000, 0) == Decimal("3.0000")
    assert pricing.price("claude-sonnet-4-6", 0, 1_000_000) == Decimal("15.0000")
    assert pricing.price("claude-sonnet-4-6", 100_000_000, 0) == Decimal("300.0000")


def test_unknown_model_is_zero():
    assert pricing.price("mystery-model", 1_000_000, 1_000_000) == Decimal("0")
    assert not pricing.is_priced("mystery-model")
