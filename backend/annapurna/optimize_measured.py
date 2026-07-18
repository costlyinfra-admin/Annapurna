"""Measured optimization opportunities (opt spec §7).

Unlike the heuristic estimator ([optimize.py](optimize.py)), every number here is
*measured*: it is computed from the SDK's `usage_signal` rows (counts of real
duplicate calls and repeated uncached prefixes) and priced from the price book
([pricing.py](pricing.py)) — never a flat percentage. The heuristic tier remains
below this as the zero-instrumentation fallback.

Two detectors in this slice:
  * **Duplicate calls** — the (N-1) repeats of a request are avoidable; savings
    is their real priced cost.
  * **Cacheable prompt prefix** — a large static prefix repeated across many
    uncached calls; savings is the repeated prefix tokens priced at
    (input rate − cached-read rate) from the price book.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from . import dashboard, pricing
from .db import app_dsn, connect, tenant_tx

# Detection thresholds (opt spec §7). Kept deliberately conservative so a surfaced
# opportunity is always worth acting on.
_MIN_PREFIX_TOKENS = 1000  # a prefix worth caching is large
_MIN_CACHEABLE_CALLS = 100  # ...and repeated enough to matter
_MIN_SAVINGS = 1.0  # ignore sub-dollar noise, like the heuristic tier
_MAX_TRAIL = 25  # cap the evidence trail payload


def _fp(fingerprint: str) -> str:
    """A short, opaque handle for a salted hash (never any prompt content)."""
    return fingerprint[:12]


def _duplicate_opportunity(rows: list) -> Optional[dict]:
    """Rows: (provider, model, fingerprint, call_count, tokens_in, tokens_out)."""
    if not rows:
        return None
    repeats = sum(int(r[3]) for r in rows)
    # price() is linear in tokens, so summing each row's priced tokens gives the
    # exact cost of all the avoidable repeats — no averaging error.
    savings = sum((pricing.price(r[1], int(r[4]), int(r[5]), r[0]) for r in rows), Decimal("0"))
    if repeats <= 0 or float(savings) < _MIN_SAVINGS:
        return None
    trail = [
        {
            "fingerprint": _fp(r[2]),
            "provider": r[0],
            "model": r[1],
            "call_count": int(r[3]),
        }
        for r in sorted(rows, key=lambda r: int(r[3]), reverse=True)[:_MAX_TRAIL]
    ]
    return {
        "lever": "duplicate_calls",
        "savings": round(float(savings), 2),
        "confidence": "high",  # measured exactly; framed as a ceiling
        "evidence": (
            f"{repeats:,} duplicate calls across {len(rows):,} distinct requests this month"
        ),
        "fix": "Add response caching for identical requests (e.g. keyed on the request hash).",
        "trail": trail,
    }


def _prefix_opportunity(rows: list) -> Optional[dict]:
    """Rows: (provider, model, fingerprint, call_count, prefix_tokens, cached_count)."""
    total_savings = Decimal("0")
    total_uncached = 0
    max_prefix = 0
    trail = []
    for provider, model, fingerprint, call_count, prefix_tokens, cached_count in rows:
        mult = pricing.cache_read_mult(provider)
        if mult is None:  # provider has no priced cache discount -> don't claim one
            continue
        cacheable = int(call_count) - int(cached_count)
        p_tokens = int(prefix_tokens or 0)
        if cacheable < _MIN_CACHEABLE_CALLS or p_tokens < _MIN_PREFIX_TOKENS:
            continue
        input_rate = pricing.rate_in(model, provider)
        saving = Decimal(cacheable) * Decimal(p_tokens) * input_rate * (Decimal("1") - mult)
        total_savings += saving
        total_uncached += cacheable
        max_prefix = max(max_prefix, p_tokens)
        trail.append(
            {
                "fingerprint": _fp(fingerprint),
                "provider": provider,
                "model": model,
                "calls": int(call_count),
                "prefix_tokens": p_tokens,
                "cached": int(cached_count),
            }
        )
    if float(total_savings) < _MIN_SAVINGS:
        return None
    return {
        "lever": "prompt_caching",
        "savings": round(float(total_savings), 2),
        "confidence": "high",
        "evidence": (
            f"a {max_prefix:,}-token static prefix repeated across "
            f"{total_uncached:,} uncached calls"
        ),
        "fix": "Enable prompt caching (set cache_control on the static system block).",
        "trail": trail[:_MAX_TRAIL],
    }


def _measured(conn, feature_id: str, start: dt.date) -> tuple[dict, Optional[float]]:
    rows = conn.execute(
        """
        SELECT signal_kind, provider, model, fingerprint,
               call_count, prefix_tokens, tokens_in, tokens_out, cached_count
        FROM usage_signal
        WHERE feature_id = %s AND period = %s
        """,
        (feature_id, start),
    ).fetchall()

    dup_rows = [(r[1], r[2], r[3], r[4], r[6], r[7]) for r in rows if r[0] == "duplicate"]
    pfx_rows = [(r[1], r[2], r[3], r[4], r[5], r[8]) for r in rows if r[0] == "prefix"]

    opportunities = []
    for opp in (_duplicate_opportunity(dup_rows), _prefix_opportunity(pfx_rows)):
        if opp is not None:
            opportunities.append(opp)
    opportunities.sort(key=lambda o: o["savings"], reverse=True)

    # Current cache utilization from the prefix signals: share of prefixed calls
    # already served from cache. None when the SDK has reported no prefix rows.
    total_calls = sum(int(r[4]) for r in rows if r[0] == "prefix")
    total_cached = sum(int(r[8]) for r in rows if r[0] == "prefix")
    cache_utilization = round(total_cached / total_calls, 4) if total_calls else None

    monthly = round(sum(o["savings"] for o in opportunities), 2)
    measured = {
        "opportunities": opportunities,
        "monthly_savings": monthly,
        "annual_savings": round(monthly * 12, 2),
    }
    return measured, cache_utilization


def opportunities(
    tenant_id: str, feature_id: str, period: Optional[dt.date] = None
) -> Optional[dict]:
    """Measured + estimated optimization opportunities for one feature/month.

    Returns None if the feature doesn't exist (the API turns that into a 404).
    """
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        start = dashboard._resolve_period(conn, period)
        if conn.execute("SELECT 1 FROM feature WHERE id = %s", (feature_id,)).fetchone() is None:
            return None
        measured, cache_utilization = _measured(conn, feature_id, start)
        estimated = dashboard.heuristic_optimization(conn, feature_id, start)
    return {
        "period": start.isoformat(),
        "measured": measured,  # grounded in usage_signal, priced from the price book
        "estimated": estimated,  # the heuristic tier, labelled as a directional estimate
        "cache_utilization": cache_utilization,
    }
