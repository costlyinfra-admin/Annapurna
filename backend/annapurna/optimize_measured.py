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


def _cache_utilization(conn, feature_id, start, signal_rows) -> Optional[float]:
    """Share of input already served from the provider's prompt cache (opt spec §8).

    Prefers connector/hook cache token fields (Tier A — works WITHOUT the SDK):
    cached input tokens / total input tokens. Falls back to the SDK prefix signals'
    call-level ratio when no provider cache data is available. None when neither.
    """
    row = conn.execute(
        """
        SELECT COALESCE(SUM(cached_tokens_in), 0),
               COALESCE(SUM(tokens_in), 0),
               COUNT(cached_tokens_in)
        FROM inference_cost
        WHERE feature_id = %s AND period = %s
        """,
        (feature_id, start),
    ).fetchone()
    # If any row reported cache tokens, the ratio is over ALL input (a floor —
    # providers that don't report cache count as uncached, never overstated).
    if row and row[2] and row[1]:
        return round(int(row[0]) / int(row[1]), 4)

    # Fallback: SDK prefix signals (share of prefixed calls served from cache).
    total_calls = sum(int(r[4]) for r in signal_rows if r[0] == "prefix")
    total_cached = sum(int(r[8]) for r in signal_rows if r[0] == "prefix")
    return round(total_cached / total_calls, 4) if total_calls else None


def _arbitrage_opportunity(conn, feature_id, start) -> Optional[dict]:
    """Cross-provider price arbitrage (opt spec §16, M-opt-8).

    The same open weights are served by multiple hosts at different rates. For each
    of the feature's hosted-open-model rows, if a cheaper host serves the identical
    model, the saving is the exact rate delta at the feature's own token mix — no
    quality change. Connector data only; no SDK needed.
    """
    rows = conn.execute(
        """
        SELECT provider, model,
               SUM(COALESCE(tokens_in, 0)), SUM(COALESCE(tokens_out, 0))
        FROM inference_cost
        WHERE feature_id = %s AND period = %s AND provider IS NOT NULL AND model IS NOT NULL
        GROUP BY provider, model
        """,
        (feature_id, start),
    ).fetchall()

    total_savings = Decimal("0")
    trail = []
    top = None  # the single largest switch, for the headline sentence
    for provider, model, tin, tout in rows:
        alt = pricing.cheapest_equivalent(provider, model, int(tin or 0), int(tout or 0))
        if alt is None or alt["savings"] <= 0:
            continue
        total_savings += alt["savings"]
        pct = round(float(alt["savings"] / alt["current_cost"]) * 100)
        trail.append(
            {
                "model": alt["family_label"],
                "note": (
                    f"{alt['from_provider']} → {alt['to_provider']} · "
                    f"save {_usd(alt['savings'])}/mo ({pct}% less)"
                ),
            }
        )
        if top is None or alt["savings"] > top["savings"]:
            top = {**alt, "pct": pct}

    if top is None or float(total_savings) < _MIN_SAVINGS:
        return None
    return {
        "lever": "provider_switch",
        "savings": round(float(total_savings), 2),
        "confidence": "high",  # exact rate delta on identical weights
        "evidence": (
            f"{top['family_label']} runs on {top['from_provider']}; {top['to_provider']} "
            f"serves the same weights for ~{top['pct']}% less"
        ),
        "fix": (
            f"Route {top['family_label']} to {top['to_provider']} — identical open "
            f"weights, ~{top['pct']}% cheaper at list prices."
        ),
        "trail": trail[:_MAX_TRAIL],
    }


def _usd(value) -> str:
    return f"${float(value):,.2f}"


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
    for opp in (
        _duplicate_opportunity(dup_rows),
        _prefix_opportunity(pfx_rows),
        _arbitrage_opportunity(conn, feature_id, start),
    ):
        if opp is not None:
            opportunities.append(opp)
    opportunities.sort(key=lambda o: o["savings"], reverse=True)

    cache_utilization = _cache_utilization(conn, feature_id, start, rows)

    monthly = round(sum(o["savings"] for o in opportunities), 2)
    measured = {
        "opportunities": opportunities,
        "monthly_savings": monthly,
        "annual_savings": round(monthly * 12, 2),
    }
    return measured, cache_utilization


def _actions(conn, feature_id, start, measured_by_lever: dict) -> list:
    """Applied optimizations with projected-vs-realized savings (opt spec §11).

    realized = frozen projection − the lever's CURRENT avoidable spend, but only
    once we're past the period it was applied in (before that there's nothing to
    reconcile yet).
    """
    rows = conn.execute(
        """
        SELECT lever, applied_on, projected_monthly
        FROM optimization_action
        WHERE feature_id = %s
        ORDER BY applied_on
        """,
        (feature_id,),
    ).fetchall()
    out = []
    for lever, applied_on, projected in rows:
        projected = round(float(projected), 2)
        current = round(float(measured_by_lever.get(lever, 0.0)), 2)
        if start > applied_on:
            realized = round(projected - current, 2)
            status = "measured"
        else:
            realized = None  # applied this period — no later month to reconcile yet
            status = "pending"
        out.append(
            {
                "lever": lever,
                "applied_on": applied_on.isoformat(),
                "projected_monthly": projected,
                "current_avoidable": current,
                "realized_monthly": realized,
                "status": status,
            }
        )
    return out


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
        by_lever = {o["lever"]: o["savings"] for o in measured["opportunities"]}
        actions = _actions(conn, feature_id, start, by_lever)
    return {
        "period": start.isoformat(),
        "measured": measured,  # grounded in usage_signal, priced from the price book
        "estimated": estimated,  # the heuristic tier, labelled as a directional estimate
        "cache_utilization": cache_utilization,
        "actions": actions,  # applied optimizations: projected vs realized (opt spec §11)
    }


def mark_applied(
    tenant_id: str,
    feature_id: str,
    lever: str,
    projected_monthly: float,
    period: Optional[dt.date] = None,
) -> Optional[dict]:
    """Freeze a measured opportunity's projection as of a period (opt spec §11).

    Returns None if the feature doesn't exist. Idempotent per (feature, lever):
    re-applying updates the applied period and frozen projection.
    """
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        if conn.execute("SELECT 1 FROM feature WHERE id = %s", (feature_id,)).fetchone() is None:
            return None
        applied_on = dashboard._resolve_period(conn, period)
        conn.execute(
            """
            INSERT INTO optimization_action (tenant_id, feature_id, lever, applied_on,
                                             projected_monthly)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (tenant_id, feature_id, lever) DO UPDATE
            SET applied_on = EXCLUDED.applied_on,
                projected_monthly = EXCLUDED.projected_monthly
            """,
            (tenant_id, feature_id, lever, applied_on, projected_monthly),
        )
    return {"lever": lever, "applied_on": applied_on.isoformat()}


def unmark_applied(tenant_id: str, feature_id: str, lever: str) -> None:
    """Remove an applied optimization action (undo)."""
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        conn.execute(
            "DELETE FROM optimization_action WHERE feature_id = %s AND lever = %s",
            (feature_id, lever),
        )
