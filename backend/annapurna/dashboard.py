"""Read-side aggregation for the three screens (M6).

Combines the M4 (inference) and M5 (build) data per feature for the dashboard,
and assembles a per-feature drill-down with the evidence trail.

INVARIANT: build cost and inference cost are returned as separate fields and are
never summed into one number here. "cost per user" uses the recurring *inference*
cost only (build is one-time-ish); it is labelled directional, not ROI.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from decimal import Decimal
from typing import Optional

from . import optimize, pricing
from .build import developer_label
from .db import app_dsn, connect, tenant_tx
from .providers import month_start, next_month

#: Token types spend is split across, in display order.
_TOKEN_TYPE_LABELS = {
    "input": "Input",
    "cache_write_5m": "Cache write (5m)",
    "cache_write_1h": "Cache write (1h)",
    "cache_write": "Cache write",
    "cache_read": "Cache read",
    "output": "Output",
    "unknown": "Unknown",
}


def token_buckets_add(
    dollars: dict,
    tokens: dict,
    *,
    provider: str,
    model: Optional[str],
    amount: float,
    tokens_in: int,
    tokens_out: int,
    cached: int,
    cache_write: int,
    write_5m: int = 0,
    write_1h: int = 0,
) -> None:
    """Split one (provider, model) group's billed dollars across its token types.

    IMPORTANT — this split is DERIVED, not reported: providers bill per line item,
    not per token type. We weight each type by what it should cost (the model's
    list rate x the type's multiplier — cache writes at a premium that varies by
    TTL, cache reads at a discount) and allocate the REAL billed dollars in those
    proportions, so the parts always sum back to the bill. Token COUNTS, by
    contrast, are reported by the provider and are exact.

    Unpriced models fall back to token counts; no token detail -> "unknown".
    """
    if amount <= 0:
        return
    # Split the cache-write total into its TTL buckets when the provider reports
    # them (they price differently); otherwise keep one undifferentiated bucket.
    if write_5m or write_1h:
        write_parts = {"cache_write_5m": write_5m, "cache_write_1h": write_1h}
    else:
        write_parts = {"cache_write": cache_write}
    # tokens_in is the TOTAL input; uncached is what's left after cache traffic.
    uncached = max(tokens_in - cached - cache_write, 0)
    counts = {"input": uncached, "cache_read": cached, "output": tokens_out, **write_parts}

    if sum(counts.values()) <= 0:
        dollars["unknown"] += amount
        tokens["unknown"] = tokens.get("unknown", 0)
        return

    r_in = pricing.rate_in(model or "", provider)
    r_out = pricing.rate_out(model or "", provider)
    if r_in > 0 or r_out > 0:
        read_mult = pricing.cache_read_mult(provider) or Decimal("1")
        rates = {
            "input": r_in,
            "cache_read": r_in * read_mult,
            "output": r_out,
            "cache_write": r_in * pricing.cache_write_mult(provider),
            "cache_write_5m": r_in * pricing.cache_write_mult(provider, "5m"),
            "cache_write_1h": r_in * pricing.cache_write_mult(provider, "1h"),
        }
        weights = {k: Decimal(v) * rates[k] for k, v in counts.items()}
    else:  # unpriced model -> weight by raw token counts (documented fallback)
        weights = {k: Decimal(v) for k, v in counts.items()}

    total_w = sum(weights.values())
    if total_w <= 0:
        dollars["unknown"] += amount
        return
    for key, w in weights.items():
        if counts[key] > 0:
            tokens[key] = tokens.get(key, 0) + counts[key]
        if w > 0:
            dollars[key] += amount * float(w / total_w)


_CONFIDENCE_RANK = {"high": 3, "med": 2, "low": 1}

# Spend the user marked "ignore" is excluded from normal reporting/optimization
# totals. NULL (legacy / unclassified snapshot) stays included.
_ACTIVE_ENV = "(environment IS NULL OR environment <> 'ignore')"

# The classification buckets shown in the inference trend (Ignore is excluded, and
# any unexpected value folds into unclassified).
_CLASSIFICATION_BUCKETS = ("production", "development", "internal", "unclassified")


def _min_confidence(current: Optional[str], candidate: Optional[str]) -> Optional[str]:
    """Most conservative (lowest) of two confidences."""
    if candidate is None:
        return current
    if current is None:
        return candidate
    return candidate if _CONFIDENCE_RANK[candidate] < _CONFIDENCE_RANK[current] else current


def _resolve_period(conn, period: Optional[dt.date]) -> dt.date:
    """Use the given month, or the latest month that has any cost/usage data.

    "This month" (the default) is the actual current calendar month once a working
    sync has ingested it — the latest-with-data fallback only matters before any
    data lands. We deliberately do NOT special-case one cost table over another: if
    the current month reads as empty, that is an honest signal to sync, surfaced by
    the per-month backfill errors, not something to paper over here.
    """
    if period is not None:
        return month_start(period)
    row = conn.execute(
        """
        SELECT max(p) FROM (
            SELECT max(period) p FROM build_cost
            UNION ALL SELECT max(period) FROM inference_cost
            UNION ALL SELECT max(period) FROM feature_usage
        ) periods
        """
    ).fetchone()
    return row[0] if row and row[0] else month_start(dt.date.today())


#: Named review periods, as (months_back_for_start, months_back_for_end) from the
#: latest month with data. Data is bucketed by month, so day-windows aren't exact.
_RANGE_SPECS = {
    "this_month": (0, 0),
    "last_month": (1, 1),
    "last_3_months": (2, 0),
    "last_6_months": (5, 0),
    "last_12_months": (11, 0),
}


def _resolve_range(
    conn,
    range_token: Optional[str],
    start: Optional[dt.date],
    end: Optional[dt.date],
) -> tuple[dt.date, dt.date]:
    """Resolve a review period to an inclusive (start_month, end_month).

    Explicit start/end (a custom range) win; otherwise a named range token is
    resolved relative to the latest month that has data. Both are first-of-month.
    """
    if start is not None:
        s = month_start(start)
        e = month_start(end) if end is not None else s
        return (s, e) if s <= e else (e, s)
    latest = _resolve_period(conn, None)
    back_start, back_end = _RANGE_SPECS.get(range_token or "this_month", (0, 0))
    return _months_back(latest, back_start), _months_back(latest, back_end)


def _month_count(start: dt.date, end: dt.date) -> int:
    return (end.year - start.year) * 12 + (end.month - start.month) + 1


def _worth_indicator(inference: float, users: Optional[int]) -> str:
    """Directional only (not ROI). healthy / watch / unknown."""
    if not users:
        return "unknown"
    cost_per_user = inference / users
    return "healthy" if cost_per_user <= 10.0 else "watch"


def dashboard(
    tenant_id: str,
    start: Optional[dt.date] = None,
    end: Optional[dt.date] = None,
    range_token: Optional[str] = None,
) -> dict:
    """Money screen over an inclusive month range (default: the latest month).

    Build and inference cost are summed over the range; active users are the
    range's latest month (a point-in-time count), and the deltas compare to the
    equal-length window immediately before.
    """
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        start, end = _resolve_range(conn, range_token, start, end)

        features = conn.execute(
            """
            SELECT id, name, status, discovery_confidence
            FROM feature WHERE status IN ('proposed', 'confirmed')
            ORDER BY created_at
            """
        ).fetchall()

        build = _rollup(conn, "build_cost", start, end)
        inference, inference_unattributed = _inference_rollup(conn, start, end)
        # Active users is a point-in-time count, not additive across months — use
        # the range's latest month.
        usage = {
            str(fid): users
            for fid, users in conn.execute(
                "SELECT feature_id, active_users FROM feature_usage WHERE period = %s", (end,)
            ).fetchall()
        }

        # Prior equal-length window (for the deltas) + the range's token split.
        n = _month_count(start, end)
        prev_end = _months_back(start, 1)
        prev_start = _months_back(prev_end, n - 1)
        prev_build = float(
            conn.execute(
                "SELECT COALESCE(SUM(amount), 0) FROM build_cost WHERE period BETWEEN %s AND %s",
                (prev_start, prev_end),
            ).fetchone()[0]
        )
        prev_inference = float(
            conn.execute(
                "SELECT COALESCE(SUM(amount), 0) FROM inference_cost "
                f"WHERE period BETWEEN %s AND %s AND {_ACTIVE_ENV}",  # noqa: S608
                (prev_start, prev_end),
            ).fetchone()[0]
        )
        # The estimated (not-yet-billed) portion already included in inference_cost
        # above — surfaced separately so the UI can label "incl ~$X estimated".
        estimated_inference = float(
            conn.execute(
                "SELECT COALESCE(SUM(amount), 0) FROM inference_cost "
                f"WHERE period BETWEEN %s AND %s AND source = 'cost_api_est' AND {_ACTIVE_ENV}",  # noqa: S608
                (start, end),
            ).fetchone()[0]
        )
        tok = conn.execute(
            "SELECT COALESCE(SUM(tokens_in), 0), COALESCE(SUM(tokens_out), 0) "
            f"FROM inference_cost WHERE period BETWEEN %s AND %s AND {_ACTIVE_ENV}",  # noqa: S608
            (start, end),
        ).fetchone()
        tokens_in, tokens_out = int(tok[0]), int(tok[1])

    rows = []
    for fid, name, _status, _disc in features:
        fid = str(fid)
        b = build.get(fid, {"amount": 0.0, "confidence": None})
        i = inference.get(fid, {"amount": 0.0, "confidence": None, "requests": None})
        users = usage.get(fid)
        cost_per_user = (i["amount"] / users) if users else None
        rows.append(
            {
                "feature_id": fid,
                "name": name,
                "build_cost": b["amount"],
                "inference_cost": i["amount"],  # kept separate from build
                "active_users": users,
                "cost_per_user": cost_per_user,
                # Number of AI model calls this feature made (None when unknown —
                # e.g. connector-only, no hook, since cost APIs don't report counts).
                "requests": i.get("requests"),
                "worth_it": _worth_indicator(i["amount"], users),
                "confidence": _min_confidence(b["confidence"], i["confidence"]),
            }
        )

    unattributed = {
        "build_cost": build.get(None, {"amount": 0.0})["amount"],
        "inference_cost": inference_unattributed,
    }
    totals = {
        "build_cost": sum(r["build_cost"] for r in rows) + unattributed["build_cost"],
        "inference_cost": sum(r["inference_cost"] for r in rows) + unattributed["inference_cost"],
        # Portion of inference_cost that is estimated (not yet billed), for labelling.
        "estimated_inference": estimated_inference,
        "prev_build_cost": prev_build,
        "prev_inference_cost": prev_inference,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }
    return {
        "period": end.isoformat(),  # the range's latest month (back-compat)
        "start": start.isoformat(),
        "end": end.isoformat(),
        "months": n,
        "features": rows,
        "unattributed": unattributed,
        "highlights": _highlights(rows),
        "insights": _insights(rows, unattributed, totals),
        "totals": totals,
    }


def _fmt_pct(p: float) -> str:
    """Whole percent when >= 10 (54%), one decimal when smaller (9.7%)."""
    return f"{round(p)}%" if p >= 10 else f"{p:.1f}%"


def _fmt_ratio(r: float) -> str:
    """1.98 -> '2x', 2.34 -> '2.3x'."""
    return f"{r:.1f}".rstrip("0").rstrip(".") + "x"


def _insights(rows: list, unattributed: dict, totals: dict) -> list:
    """Auto-generated, plain-language executive insights (deterministic).

    Every sentence is derived directly from the dashboard numbers — no model,
    no black box. Each insight names the feature(s) and basis behind it.
    """
    insights: list = []
    total_ai = totals["build_cost"] + totals["inference_cost"]
    if total_ai <= 0:
        return insights

    # 1. Concentration — the single largest slice of all AI spend.
    combos = [(r, r["build_cost"] + r["inference_cost"]) for r in rows]
    top = max(combos, key=lambda c: c[1], default=None)
    if top and top[1] > 0:
        insights.append(
            {
                "kind": "concentration",
                "text": f"{top[0]['name']} represents "
                f"{_fmt_pct(top[1] / total_ai * 100)} of all AI spend.",
            }
        )

    # 2. Efficiency — widest gap in cost per active user between two features.
    cpu = [r for r in rows if r["cost_per_user"]]
    if len(cpu) >= 2:
        high = max(cpu, key=lambda r: r["cost_per_user"])
        low = min(cpu, key=lambda r: r["cost_per_user"])
        ratio = high["cost_per_user"] / low["cost_per_user"]
        if ratio >= 1.5:
            insights.append(
                {
                    "kind": "efficiency",
                    "text": f"{high['name']} costs {_fmt_ratio(ratio)} more per user "
                    f"than {low['name']}.",
                }
            )

    # 3. Governance — how much spend isn't mapped to a feature yet.
    unatt = unattributed["build_cost"] + unattributed["inference_cost"]
    if unatt > 0:
        insights.append(
            {
                "kind": "governance",
                "text": f"Unattributed spend represents "
                f"{_fmt_pct(unatt / total_ai * 100)} of total AI costs.",
            }
        )

    # 4. Build-vs-run split (kept separate per invariant 2, shown as shares).
    if totals["build_cost"] > 0 and totals["inference_cost"] > 0:
        run = totals["inference_cost"] / total_ai * 100
        build = totals["build_cost"] / total_ai * 100
        insights.append(
            {
                "kind": "split",
                "text": f"Running these features is {_fmt_pct(run)} of AI spend; "
                f"building them is {_fmt_pct(build)}.",
            }
        )

    return insights


def _highlights(rows: list) -> dict:
    """Executive-summary picks. Each is a full feature row (or None).

    Build and inference stay separate on each card; ranking uses their sum only to
    *pick* the row, never to display a blended per-feature number (invariant 2).
    """
    most_expensive = max(rows, key=lambda r: r["build_cost"] + r["inference_cost"], default=None)
    if most_expensive and (most_expensive["build_cost"] + most_expensive["inference_cost"]) == 0:
        most_expensive = None

    cost_per_user_rows = [r for r in rows if r["cost_per_user"] is not None]
    highest_cost_per_user = max(cost_per_user_rows, key=lambda r: r["cost_per_user"], default=None)

    # The biggest lever to optimize: the costliest feature flagged as "watch"
    # (high cost per active user).
    watch_rows = [r for r in rows if r["worth_it"] == "watch"]
    optimization = max(watch_rows, key=lambda r: r["inference_cost"], default=None)

    return {
        "most_expensive": most_expensive,
        "optimization": optimization,
        "highest_cost_per_user": highest_cost_per_user,
    }


def _rollup(conn, table: str, start: dt.date, end: Optional[dt.date] = None) -> dict:
    """feature_id (str or None) -> {amount, confidence(min)} for a cost table/range."""
    end = end or start
    rows = conn.execute(
        f"SELECT feature_id, amount, confidence FROM {table} "  # noqa: S608
        "WHERE period BETWEEN %s AND %s",
        (start, end),
    ).fetchall()
    out: dict = {}
    for feature_id, amount, confidence in rows:
        key = str(feature_id) if feature_id is not None else None
        entry = out.setdefault(key, {"amount": 0.0, "confidence": None})
        entry["amount"] += float(amount)
        entry["confidence"] = _min_confidence(entry["confidence"], confidence)
    return out


def _accum(
    features: dict, key: str, amount: float, confidence: Optional[str], requests=None
) -> None:
    entry = features.setdefault(key, {"amount": 0.0, "confidence": None, "requests": None})
    entry["amount"] += amount
    entry["confidence"] = _min_confidence(entry["confidence"], confidence)
    if requests is not None:
        entry["requests"] = (entry["requests"] or 0) + int(requests)


def _inference_rollup(conn, start: dt.date, end: Optional[dt.date] = None) -> tuple[dict, float]:
    """Hook-aware inference per feature + Unattributed amount, over a month range.

    Where the hook is active for a provider, hook rows give the per-feature truth
    and the connector (cost_api) total is the bill; the gap (bill - hook) flows to
    Unattributed. Providers without a hook attribute via their connector rows as
    before. This prevents double-counting the same spend. Reconciliation is over
    the whole range (bill and hook totals are summed across months first).
    """
    end = end or start
    rows = conn.execute(
        "SELECT feature_id, amount, confidence, source, provider, request_count "
        f"FROM inference_cost WHERE period BETWEEN %s AND %s AND {_ACTIVE_ENV}",  # noqa: S608
        (start, end),
    ).fetchall()
    hook_providers = {provider for (_f, _a, _c, src, provider, _r) in rows if src == "hook"}

    features: dict = {}
    unattributed = 0.0
    billed: dict = {}
    hooked: dict = {}
    for feature_id, amount, confidence, source, provider, requests in rows:
        amt = float(amount)
        if source == "hook":
            hooked[provider] = hooked.get(provider, 0.0) + amt
            if feature_id is None:
                unattributed += amt
            else:
                _accum(features, str(feature_id), amt, confidence, requests)
        else:  # cost_api
            billed[provider] = billed.get(provider, 0.0) + amt
            if provider in hook_providers:
                continue  # hook supersedes per-feature display; bill drives reconciliation
            if feature_id is None:
                unattributed += amt
            else:
                _accum(features, str(feature_id), amt, confidence, requests)

    for provider in hook_providers:
        gap = billed.get(provider, 0.0) - hooked.get(provider, 0.0)
        if gap > 0:
            unattributed += gap  # untagged calls / mispriced models land in Unattributed
    return features, unattributed


def heuristic_optimization(conn, feature_id: str, start: dt.date) -> dict:
    """The heuristic (estimated) optimization tier for one feature/month.

    Directional rules of thumb over the month's inference usage — spend, model
    mix, and the input/output token split. Labelled as an estimate in the UI; the
    *measured* tier (optimize_measured) sits above it when the SDK is installed.
    """
    opt_rows = conn.execute(
        """
        SELECT model,
               SUM(amount),
               SUM(COALESCE(tokens_in, 0)),
               SUM(COALESCE(tokens_out, 0)),
               SUM(COALESCE(request_count, 0))
        FROM inference_cost
        WHERE feature_id = %s AND period = %s
        GROUP BY model
        """,
        (feature_id, start),
    ).fetchall()

    opt_total = sum(float(a) for _m, a, _ti, _to, _r in opt_rows)
    in_tokens = sum(int(ti) for _m, _a, ti, _to, _r in opt_rows)
    out_tokens = sum(int(to) for _m, _a, _ti, to, _r in opt_rows)
    requests = sum(int(r) for _m, _a, _ti, _to, r in opt_rows)
    # Split spend into input/output by token share (fallback 70/30 when tokens
    # are unknown, e.g. connector-only rows that don't report token counts).
    token_sum = in_tokens + out_tokens
    input_share = (in_tokens / token_sum) if token_sum else 0.7
    input_cost = opt_total * input_share
    output_cost = opt_total - input_cost
    return optimize.estimate(opt_total, input_cost, output_cost, requests)


def feature_detail(
    tenant_id: str,
    feature_id: str,
    start: Optional[dt.date] = None,
    end: Optional[dt.date] = None,
    range_token: Optional[str] = None,
) -> Optional[dict]:
    """One feature over a review period (default: the latest month with data).

    Cost — build, inference, and the optimization anchor — is scoped to the same
    inclusive month range the Overview uses, so the totals here reconcile with the
    Overview's feature row. Engineering activity (PRs / commits / files) and the
    evidence trail are deliberately ALL-TIME, and labelled as such in the UI.
    """
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        start, end = _resolve_range(conn, range_token, start, end)

        feature = conn.execute(
            "SELECT id, name, description, status, discovery_confidence FROM feature WHERE id = %s",
            (feature_id,),
        ).fetchone()
        if feature is None:
            return None

        # Cost headlines are summed over the selected range (matching the Overview).
        build_total = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM build_cost "
            "WHERE feature_id = %s AND period BETWEEN %s AND %s",
            (feature_id, start, end),
        ).fetchone()[0]
        inference_range = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM inference_cost "
            f"WHERE feature_id = %s AND period BETWEEN %s AND %s AND {_ACTIVE_ENV}",  # noqa: S608
            (feature_id, start, end),
        ).fetchone()[0]
        # Active users is a point-in-time count -> the range's latest month.
        active_users = conn.execute(
            "SELECT active_users FROM feature_usage WHERE feature_id = %s AND period = %s",
            (feature_id, end),
        ).fetchone()

        # Avg call latency (ms) from metered (hook) rows over the range: sum / calls.
        # None when the SDK hasn't reported latency for this feature/range.
        lat_row = conn.execute(
            "SELECT SUM(latency_ms_sum), SUM(request_count) FROM inference_cost "
            "WHERE feature_id = %s AND period BETWEEN %s AND %s AND source = 'hook' "
            "AND latency_ms_sum IS NOT NULL",
            (feature_id, start, end),
        ).fetchone()
        avg_latency_ms = (
            round(float(lat_row[0]) / float(lat_row[1]))
            if lat_row and lat_row[0] is not None and lat_row[1]
            else None
        )

        # PRs / commits / files each developer authored for this feature. This is
        # ALL-TIME engineering activity (not scoped to the cost range).
        pr_stats = {
            actor: {"prs": prs, "commits": commits, "files_changed": files}
            for actor, prs, commits, files in conn.execute(
                """
                SELECT actor,
                       COUNT(DISTINCT external_ref),
                       SUM(commits),
                       SUM(files_changed)
                FROM feature_signal
                WHERE feature_id = %s AND signal_type = 'pr' AND actor IS NOT NULL
                GROUP BY actor
                """,
                (feature_id,),
            ).fetchall()
        }

        # Per-developer build spend IS scoped to the range (reconciles with build_total).
        by_developer = [
            {
                "developer_id": dev,
                "tool": tool,
                "amount": float(amount),
                "confidence": conf,
                # None when unknown (no matched PR authorship / stats not collected).
                "prs": pr_stats.get(dev, {}).get("prs"),
                "commits": pr_stats.get(dev, {}).get("commits"),
                "files_changed": pr_stats.get(dev, {}).get("files_changed"),
            }
            for dev, tool, amount, conf in conn.execute(
                """
                SELECT developer_id, tool, SUM(amount), MIN(confidence)
                FROM build_cost WHERE feature_id = %s AND period BETWEEN %s AND %s
                GROUP BY developer_id, tool ORDER BY SUM(amount) DESC
                """,
                (feature_id, start, end),
            ).fetchall()
        ]
        build_contributors = conn.execute(
            "SELECT COUNT(DISTINCT developer_id) FROM build_cost "
            "WHERE feature_id = %s AND period BETWEEN %s AND %s",
            (feature_id, start, end),
        ).fetchone()[0]

        # Evidence trail: ALL-TIME signals behind the feature (not range-scoped).
        evidence = [
            {
                "signal_type": st,
                "external_ref": ref,
                "confidence": conf,
                "actor": actor,
                "source": src,
            }
            for st, ref, conf, actor, src in conn.execute(
                """
                SELECT signal_type, external_ref, confidence, actor, source
                FROM feature_signal WHERE feature_id = %s
                ORDER BY signal_type, external_ref
                """,
                (feature_id,),
            ).fetchall()
        ]

        sources = sorted(
            {
                s
                for (s,) in conn.execute(
                    "SELECT DISTINCT source FROM inference_cost WHERE feature_id = %s",
                    (feature_id,),
                ).fetchall()
            }
        )

        # Cost-optimization estimate (heuristic): anchored at the range's latest
        # month, so it reflects the period being viewed.
        optimization = heuristic_optimization(conn, feature_id, end)

    return {
        "feature_id": str(feature[0]),
        "name": feature[1],
        "description": feature[2],
        "status": feature[3],
        "discovery_confidence": feature[4],
        "period": end.isoformat(),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "headline": {
            "build_cost": float(build_total),
            "inference_cost": float(inference_range),  # separate from build
            "active_users": active_users[0] if active_users else None,
            "avg_latency_ms": avg_latency_ms,  # from metered calls; None if unknown
        },
        "build_total": float(build_total),  # AI build spend for this feature in-range
        "build_contributors": build_contributors,
        "build_by_developer": by_developer,
        "evidence": evidence,
        "inference_sources": sources,  # ["cost_api"] now; "hook" arrives in M7
        "optimization": optimization,  # heuristic estimate (clearly labelled in UI)
    }


def _months_back(day: dt.date, n: int) -> dt.date:
    """First-of-month n months before ``day`` (month-aligned)."""
    month = day.month - n
    year = day.year
    while month <= 0:
        month += 12
        year -= 1
    return dt.date(year, month, 1)


def feature_inference(
    tenant_id: str,
    feature_id: str,
    start: Optional[dt.date] = None,
    end: Optional[dt.date] = None,
    range_token: Optional[str] = None,
) -> dict:
    """Inference cost for a feature over the review period: per-model + monthly trend.

    Scoped to the same month range as the rest of the detail page (and the
    Overview), so per-model amounts sum to the in-range total (used for the % share
    + pie), and the trend has one point per month in the range.
    """
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        start, end = _resolve_range(conn, range_token, start, end)

        model_rows = conn.execute(
            f"""
            SELECT model, SUM(amount), SUM(request_count)
            FROM inference_cost
            WHERE feature_id = %s AND period BETWEEN %s AND %s AND {_ACTIVE_ENV}
            GROUP BY model ORDER BY SUM(amount) DESC
            """,  # noqa: S608
            (feature_id, start, end),
        ).fetchall()
        total = sum(float(amount) for _model, amount, _req in model_rows) or 0.0
        by_model = [
            {
                "model": model or "unknown",
                "amount": float(amount),
                "pct": (float(amount) / total * 100.0) if total else 0.0,
                "requests": int(req) if req is not None else None,
            }
            for model, amount, req in model_rows
        ]
        trend = [
            {"period": p.isoformat(), "amount": float(amount)}
            for p, amount in conn.execute(
                f"""
                SELECT period, SUM(amount)
                FROM inference_cost
                WHERE feature_id = %s AND period BETWEEN %s AND %s AND {_ACTIVE_ENV}
                GROUP BY period ORDER BY period
                """,  # noqa: S608
                (feature_id, start, end),
            ).fetchall()
        ]

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "total": total,
        "by_model": by_model,
        "trend": trend,
    }


def spend_by_provider(
    tenant_id: str,
    start: Optional[dt.date] = None,
    end: Optional[dt.date] = None,
    range_token: Optional[str] = None,
) -> dict:
    """Tenant-wide spend by source over a month range, with trends.

    Two parallel, never-blended views (invariant 2):
      - inference (run) cost grouped by provider — self-hosted pools appear
        under their provider label;
      - build cost grouped by coding tool.
    Each carries its own total and per-month trend across the range.
    """
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        start, end = _resolve_range(conn, range_token, start, end)

        # ---- Inference: by provider + trend ----
        provider_rows = conn.execute(
            f"""
            SELECT provider, SUM(amount), SUM(request_count)
            FROM inference_cost
            WHERE period BETWEEN %s AND %s AND {_ACTIVE_ENV}
            GROUP BY provider ORDER BY SUM(amount) DESC
            """,  # noqa: S608
            (start, end),
        ).fetchall()
        total = sum(float(amount) for _p, amount, _req in provider_rows) or 0.0

        # Per-provider model split (so each provider's total breaks down by model).
        model_rows = conn.execute(
            f"""
            SELECT provider, model, SUM(amount)
            FROM inference_cost
            WHERE period BETWEEN %s AND %s AND {_ACTIVE_ENV}
            GROUP BY provider, model ORDER BY SUM(amount) DESC
            """,  # noqa: S608
            (start, end),
        ).fetchall()
        models_by_provider: dict[str, list] = {}
        for provider, model, amount in model_rows:
            models_by_provider.setdefault(provider, []).append((model, float(amount)))

        by_provider = [
            {
                "provider": provider,
                "amount": float(amount),
                "pct": (float(amount) / total * 100.0) if total else 0.0,
                "requests": int(req) if req is not None else None,
                "by_model": [
                    {
                        "model": model or "unknown",
                        "amount": amt,
                        # Share of THIS provider's spend (models under a provider sum to ~100%).
                        "pct": (amt / float(amount) * 100.0) if amount else 0.0,
                    }
                    for model, amt in models_by_provider.get(provider, [])
                ],
            }
            for provider, amount, req in provider_rows
        ]
        # Inference trend, segmented by classification per month (a stacked bar).
        # NULL environment (legacy / never-classified) counts as unclassified;
        # 'ignore' is excluded (via _ACTIVE_ENV), so the four buckets sum to the
        # month's active inference total.
        trend_rows = conn.execute(
            f"""
            SELECT period, COALESCE(environment, 'unclassified') AS env, SUM(amount)
            FROM inference_cost
            WHERE period BETWEEN %s AND %s AND {_ACTIVE_ENV}
            GROUP BY period, env ORDER BY period
            """,  # noqa: S608
            (start, end),
        ).fetchall()
        trend_by_period: dict[str, dict] = {}
        for p, env, amount in trend_rows:
            key = p.isoformat()
            entry = trend_by_period.setdefault(
                key,
                {
                    "period": key,
                    "total": 0.0,
                    "production": 0.0,
                    "development": 0.0,
                    "internal": 0.0,
                    "unclassified": 0.0,
                },
            )
            amt = float(amount)
            entry["total"] += amt
            bucket = env if env in _CLASSIFICATION_BUCKETS else "unclassified"
            entry[bucket] += amt
        trend = sorted(trend_by_period.values(), key=lambda t: t["period"])

        # ---- Inference: DAILY trend (from the day-resolution table) ----
        # Same classification-bucketed shape as the monthly trend, one point per day
        # over the range. The UI uses this for short ranges (a month or two) and the
        # monthly trend for long ones.
        daily_rows = conn.execute(
            f"""
            SELECT day, COALESCE(environment, 'unclassified') AS env, SUM(amount)
            FROM inference_cost_daily
            WHERE day >= %s AND day < %s AND {_ACTIVE_ENV}
            GROUP BY day, env ORDER BY day
            """,  # noqa: S608
            (start, next_month(end)),
        ).fetchall()
        daily_by_day: dict[str, dict] = {}
        for d, env, amount in daily_rows:
            key = d.isoformat()
            entry = daily_by_day.setdefault(
                key,
                {
                    "period": key,
                    "total": 0.0,
                    "production": 0.0,
                    "development": 0.0,
                    "internal": 0.0,
                    "unclassified": 0.0,
                },
            )
            amt = float(amount)
            entry["total"] += amt
            bucket = env if env in _CLASSIFICATION_BUCKETS else "unclassified"
            entry[bucket] += amt

        # Per-day workspace split, attached to each point so the chart's hover can
        # show WHERE a day's spend came from alongside what kind it was.
        for d, ws, amount in conn.execute(
            f"""
            SELECT day, COALESCE(workspace_name, workspace_id) AS ws, SUM(amount)
            FROM inference_cost_daily
            WHERE day >= %s AND day < %s AND {_ACTIVE_ENV}
              AND (workspace_id IS NOT NULL OR workspace_name IS NOT NULL)
            GROUP BY day, ws ORDER BY day, SUM(amount) DESC
            """,  # noqa: S608
            (start, next_month(end)),
        ).fetchall():
            entry = daily_by_day.get(d.isoformat())
            if entry is not None:
                entry.setdefault("workspaces", []).append(
                    {"workspace": ws, "amount": float(amount)}
                )
        daily_trend = sorted(daily_by_day.values(), key=lambda t: t["period"])

        # Same workspace split for the MONTHLY trend points.
        for p, ws, amount in conn.execute(
            f"""
            SELECT period, COALESCE(workspace_name, workspace_id) AS ws, SUM(amount)
            FROM inference_cost
            WHERE period BETWEEN %s AND %s AND {_ACTIVE_ENV}
              AND (workspace_id IS NOT NULL OR workspace_name IS NOT NULL)
            GROUP BY period, ws ORDER BY period, SUM(amount) DESC
            """,  # noqa: S608
            (start, end),
        ).fetchall():
            entry = trend_by_period.get(p.isoformat())
            if entry is not None:
                entry.setdefault("workspaces", []).append(
                    {"workspace": ws, "amount": float(amount)}
                )

        # ---- Build: by coding tool + trend (kept separate from inference) ----
        tool_rows = conn.execute(
            """
            SELECT tool, SUM(amount)
            FROM build_cost
            WHERE period BETWEEN %s AND %s
            GROUP BY tool ORDER BY SUM(amount) DESC
            """,
            (start, end),
        ).fetchall()
        build_total = sum(float(amount) for _t, amount in tool_rows) or 0.0
        build_by_tool = [
            {
                "tool": tool,
                "amount": float(amount),
                "pct": (float(amount) / build_total * 100.0) if build_total else 0.0,
            }
            for tool, amount in tool_rows
        ]
        build_trend = [
            {"period": p.isoformat(), "amount": float(amount)}
            for p, amount in conn.execute(
                """
                SELECT period, SUM(amount)
                FROM build_cost
                WHERE period BETWEEN %s AND %s
                GROUP BY period ORDER BY period
                """,
                (start, end),
            ).fetchall()
        ]

        # ---- Build: by developer, each broken down by tool ----
        # Build cost is the only cost attributable to a person (who ran which
        # coding tool). Rows with no developer (e.g. fine-tuning, seat pools) fall
        # into an Unattributed bucket so developers + Unattributed reconcile to the
        # build total.
        # `label` combines the display name and GitHub handle ("Name (handle)"),
        # falling back to whichever is present — this is the only view that shows
        # the combined identity.
        dev_rows = conn.execute(
            """
            SELECT developer_id, developer_name, github_handle, tool, SUM(amount)
            FROM build_cost
            WHERE period BETWEEN %s AND %s
            GROUP BY developer_id, developer_name, github_handle, tool
            ORDER BY SUM(amount) DESC
            """,
            (start, end),
        ).fetchall()
        developers: dict[str, dict] = {}
        for developer_id, dev_name, handle, tool, amount in dev_rows:
            dev = developer_id or "Unattributed"
            entry = developers.setdefault(
                dev,
                {"developer_id": dev, "name": None, "handle": None, "amount": 0.0, "by_tool": []},
            )
            # name/handle are consistent within a developer_id; keep the first seen.
            entry["name"] = entry["name"] or dev_name
            entry["handle"] = entry["handle"] or handle
            entry["amount"] += float(amount)
            entry["by_tool"].append((tool, float(amount)))
        build_by_developer = [
            {
                "developer_id": d["developer_id"],
                "label": developer_label(d["name"], d["handle"], fallback=d["developer_id"]),
                "amount": d["amount"],
                "pct": (d["amount"] / build_total * 100.0) if build_total else 0.0,
                "by_tool": [
                    {
                        "tool": tool,
                        "amount": amt,
                        # Share of THIS developer's build spend (tools sum to ~100%).
                        "pct": (amt / d["amount"] * 100.0) if d["amount"] else 0.0,
                    }
                    for tool, amt in sorted(d["by_tool"], key=lambda t: -t[1])
                ],
            }
            for d in sorted(developers.values(), key=lambda d: -d["amount"])
        ]

        # ---- Per-customer metered spend (from SDK metadata.customer_id) ----
        customer_rows = conn.execute(
            """
            SELECT customer_id, SUM(amount), SUM(request_count)
            FROM customer_cost
            WHERE period BETWEEN %s AND %s
            GROUP BY customer_id ORDER BY SUM(amount) DESC
            """,
            (start, end),
        ).fetchall()
        customer_total = sum(float(a) for _c, a, _r in customer_rows) or 0.0
        by_customer = [
            {
                "customer_id": cid,
                "amount": float(a),
                "pct": (float(a) / customer_total * 100.0) if customer_total else 0.0,
                "requests": int(r) if r is not None else None,
            }
            for cid, a, r in customer_rows
        ]

        # ---- Inference: by TOKEN TYPE (input / cache write / cache read / output) ----
        # Providers bill dollars per line item, not per token type, so we split each
        # (provider, model) group's AUTHORITATIVE dollars across its token types by
        # priced weight — list rates x the type's multiplier (cache writes cost a
        # premium, cache reads a discount). The parts therefore always sum back to
        # the billed total; unpriced models fall back to raw token counts, and rows
        # with no token detail land in "Unknown" rather than being guessed.
        token_rows = conn.execute(
            f"""
            SELECT provider, model,
                   SUM(amount), SUM(tokens_in), SUM(tokens_out),
                   SUM(cached_tokens_in), SUM(cache_write_tokens),
                   SUM(cache_write_5m_tokens), SUM(cache_write_1h_tokens)
            FROM inference_cost
            WHERE period BETWEEN %s AND %s AND {_ACTIVE_ENV}
            GROUP BY provider, model
            """,  # noqa: S608
            (start, end),
        ).fetchall()
        token_dollars: dict[str, float] = defaultdict(float)
        token_counts: dict[str, int] = {}
        for prov, model, amount, t_in, t_out, t_cached, t_write, t_5m, t_1h in token_rows:
            token_buckets_add(
                token_dollars,
                token_counts,
                provider=prov,
                model=model,
                amount=float(amount or 0),
                tokens_in=int(t_in or 0),
                tokens_out=int(t_out or 0),
                cached=int(t_cached or 0),
                cache_write=int(t_write or 0),
                write_5m=int(t_5m or 0),
                write_1h=int(t_1h or 0),
            )
        token_total = sum(token_dollars.values()) or 0.0
        by_token_type = [
            {
                "token_type": key,
                "label": _TOKEN_TYPE_LABELS[key],
                "amount": amt,
                "pct": (amt / token_total * 100.0) if token_total else 0.0,
                # Provider-reported and exact (unlike the derived dollar split).
                "tokens": token_counts.get(key, 0),
            }
            for key, amt in sorted(token_dollars.items(), key=lambda kv: -kv[1])
            if amt > 0
        ]

        # ---- Inference: by workspace, each broken down by API key ----
        # Provider-resource identity (today only Anthropic populates it): the same
        # workspace/key detail the Cost Sources page classifies, rolled up over the
        # review range so it reconciles with the inference total above. Rows without
        # any workspace/key identity (other providers) are simply omitted here.
        ws_rows = conn.execute(
            f"""
            SELECT COALESCE(workspace_name, workspace_id) AS ws,
                   COALESCE(api_key_name, api_key_id) AS api_key,
                   SUM(amount)
            FROM inference_cost
            WHERE period BETWEEN %s AND %s AND {_ACTIVE_ENV}
              AND (workspace_id IS NOT NULL OR api_key_id IS NOT NULL)
            GROUP BY ws, api_key ORDER BY SUM(amount) DESC
            """,  # noqa: S608
            (start, end),
        ).fetchall()
        ws_grouped: dict[str, dict] = {}
        for ws, api_key, amount in ws_rows:
            entry = ws_grouped.setdefault(ws or "—", {"amount": 0.0, "keys": []})
            entry["amount"] += float(amount)
            entry["keys"].append((api_key, float(amount)))
        workspace_total = sum(e["amount"] for e in ws_grouped.values()) or 0.0
        by_workspace = [
            {
                "workspace": ws,
                "amount": e["amount"],
                "pct": (e["amount"] / workspace_total * 100.0) if workspace_total else 0.0,
                "by_key": [
                    {
                        "api_key": api_key or "—",
                        "amount": amt,
                        # Share of THIS workspace's spend (keys sum to ~100%).
                        "pct": (amt / e["amount"] * 100.0) if e["amount"] else 0.0,
                    }
                    for api_key, amt in sorted(e["keys"], key=lambda k: -k[1])
                ],
            }
            for ws, e in sorted(ws_grouped.items(), key=lambda kv: -kv[1]["amount"])
        ]

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "total": total,
        "by_provider": by_provider,
        "trend": trend,
        "daily_trend": daily_trend,
        "build_total": build_total,
        "build_by_tool": build_by_tool,
        "build_by_developer": build_by_developer,
        "build_trend": build_trend,
        "customer_total": customer_total,
        "by_customer": by_customer,
        "workspace_total": workspace_total,
        "by_workspace": by_workspace,
        "token_total": token_total,
        "by_token_type": by_token_type,
    }
