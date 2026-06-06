"""Versioned per-model pricing for hook-metered tokens.

The hook reports tokens; cost is computed here from internal price tables. These
MUST be kept current as model prices change — drift surfaces immediately as a
bill-reconciliation delta (design §12). Prices are USD per 1M tokens (input, output).
Unknown models cost 0, which shows up as a reconciliation gap rather than a wrong
per-feature number.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

PRICING_VERSION = "2026-06-01"

# Providers that bill (or whose tokens we price) PER TOKEN — closed-source plus
# hosted open-source aggregators. These flow through the priced/hook pipeline.
# Self-hosted GPU pools are NOT here: they have no per-token price and are costed
# by allocating an infra-cost pool (see compute.py), not by this table.
PRICED_PROVIDERS = {
    "anthropic",
    "openai",
    "google",
    "together",
    "fireworks",
    "groq",
    "openrouter",
    "deepinfra",
    "bedrock",
}

# Provider-agnostic model prices (single-vendor models).
# model -> (input_per_million, output_per_million) in USD.
_PRICES: dict[str, tuple[str, str]] = {
    # Anthropic
    "claude-opus-4-8": ("15", "75"),
    "claude-sonnet-4-6": ("3", "15"),
    "claude-haiku-4-5": ("0.80", "4"),
    # OpenAI
    "gpt-4o": ("2.5", "10"),
    "gpt-4o-mini": ("0.15", "0.60"),
    # Google Gemini (standard-context list prices)
    "gemini-2.5-pro": ("1.25", "10"),
    "gemini-2.5-flash": ("0.30", "2.50"),
    "gemini-2.5-flash-lite": ("0.10", "0.40"),
    "gemini-2.0-flash": ("0.10", "0.40"),
}

# Hosted open-source: the SAME open weights cost different amounts depending on
# who serves them, so these are keyed by (provider, model). Rates are public
# list prices per 1M tokens and approximate — drift surfaces as a reconciliation
# delta, never as a silently-wrong per-feature number.
_OSS_PRICES: dict[tuple[str, str], tuple[str, str]] = {
    # Together AI
    ("together", "meta-llama-3.1-70b-instruct"): ("0.88", "0.88"),
    ("together", "meta-llama-3.1-8b-instruct"): ("0.18", "0.18"),
    ("together", "mixtral-8x7b-instruct"): ("0.60", "0.60"),
    ("together", "qwen2.5-72b-instruct"): ("1.20", "1.20"),
    # Fireworks AI
    ("fireworks", "llama-v3p1-70b-instruct"): ("0.90", "0.90"),
    ("fireworks", "llama-v3p1-8b-instruct"): ("0.20", "0.20"),
    ("fireworks", "mixtral-8x7b-instruct"): ("0.50", "0.50"),
    # Groq
    ("groq", "llama-3.1-70b-versatile"): ("0.59", "0.79"),
    ("groq", "llama-3.1-8b-instant"): ("0.05", "0.08"),
    # AWS Bedrock (Llama)
    ("bedrock", "meta.llama3-1-70b-instruct-v1:0"): ("0.72", "0.72"),
    ("bedrock", "meta.llama3-1-8b-instruct-v1:0"): ("0.22", "0.22"),
    # DeepInfra
    ("deepinfra", "meta-llama-3.1-70b-instruct"): ("0.35", "0.40"),
    # OpenRouter (representative)
    ("openrouter", "meta-llama-3.1-70b-instruct"): ("0.59", "0.79"),
}

_MILLION = Decimal("1000000")


def _rates(model: str, provider: Optional[str]) -> Optional[tuple[str, str]]:
    """Provider-specific OSS price first, then the provider-agnostic table."""
    if provider is not None:
        oss = _OSS_PRICES.get((provider, model))
        if oss is not None:
            return oss
    return _PRICES.get(model)


def is_priced(model: str, provider: Optional[str] = None) -> bool:
    return _rates(model, provider) is not None


def price(model: str, tokens_in: int, tokens_out: int, provider: Optional[str] = None) -> Decimal:
    """Cost of a call in USD, or 0 for an unknown (provider, model)."""
    rates = _rates(model, provider)
    if rates is None:
        return Decimal("0")
    rate_in, rate_out = rates
    cost = (Decimal(tokens_in) / _MILLION) * Decimal(rate_in) + (
        Decimal(tokens_out) / _MILLION
    ) * Decimal(rate_out)
    return cost.quantize(Decimal("0.0001"))
