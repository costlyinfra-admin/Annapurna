"""Versioned per-model pricing for hook-metered tokens.

The hook reports tokens; cost is computed here from internal price tables. These
MUST be kept current as model prices change — drift surfaces immediately as a
bill-reconciliation delta (design §12). Prices are USD per 1M tokens (input, output).
Unknown models cost 0, which shows up as a reconciliation gap rather than a wrong
per-feature number.
"""

from __future__ import annotations

from decimal import Decimal

PRICING_VERSION = "2026-06-01"

# model -> (input_per_million, output_per_million) in USD
_PRICES: dict[str, tuple[str, str]] = {
    # Anthropic
    "claude-opus-4-8": ("15", "75"),
    "claude-sonnet-4-6": ("3", "15"),
    "claude-haiku-4-5": ("0.80", "4"),
    # OpenAI
    "gpt-4o": ("2.5", "10"),
    "gpt-4o-mini": ("0.15", "0.60"),
}

_MILLION = Decimal("1000000")


def is_priced(model: str) -> bool:
    return model in _PRICES


def price(model: str, tokens_in: int, tokens_out: int) -> Decimal:
    """Cost of a call in USD, or 0 for an unknown model."""
    rates = _PRICES.get(model)
    if rates is None:
        return Decimal("0")
    rate_in, rate_out = rates
    cost = (Decimal(tokens_in) / _MILLION) * Decimal(rate_in) + (
        Decimal(tokens_out) / _MILLION
    ) * Decimal(rate_out)
    return cost.quantize(Decimal("0.0001"))
