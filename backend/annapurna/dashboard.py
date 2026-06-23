"""Read-side aggregation for the three screens (M6).

Combines the M4 (inference) and M5 (build) data per feature for the dashboard,
and assembles a per-feature drill-down with the evidence trail.

INVARIANT: build cost and inference cost are returned as separate fields and are
never summed into one number here. "cost per user" uses the recurring *inference*
cost only (build is one-time-ish); it is labelled directional, not ROI.
"""

from __future__ import annotations

import datetime as dt
from typing import Optional

from . import optimize
from .db import app_dsn, connect, tenant_tx
from .providers import month_start

_CONFIDENCE_RANK = {"high": 3, "med": 2, "low": 1}


def _min_confidence(current: Optional[str], candidate: Optional[str]) -> Optional[str]:
    """Most conservative (lowest) of two confidences."""
    if candidate is None:
        return current
    if current is None:
        return candidate
    return candidate if _CONFIDENCE_RANK[candidate] < _CONFIDENCE_RANK[current] else current


def _resolve_period(conn, period: Optional[dt.date]) -> dt.date:
    """Use the given month, or the latest month that has any cost/usage data."""
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
                "WHERE period BETWEEN %s AND %s",
                (prev_start, prev_end),
            ).fetchone()[0]
        )
        tok = conn.execute(
            "SELECT COALESCE(SUM(tokens_in), 0), COALESCE(SUM(tokens_out), 0) "
            "FROM inference_cost WHERE period BETWEEN %s AND %s",
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
        "FROM inference_cost WHERE period BETWEEN %s AND %s",
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


def feature_detail(
    tenant_id: str, feature_id: str, period: Optional[dt.date] = None
) -> Optional[dict]:
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        start = _resolve_period(conn, period)

        feature = conn.execute(
            "SELECT id, name, description, status, discovery_confidence FROM feature WHERE id = %s",
            (feature_id,),
        ).fetchone()
        if feature is None:
            return None

        # Headlines: build is cumulative (one-time-ish); inference + users are the month's.
        build_total = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM build_cost WHERE feature_id = %s", (feature_id,)
        ).fetchone()[0]
        inference_month = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM inference_cost "
            "WHERE feature_id = %s AND period = %s",
            (feature_id, start),
        ).fetchone()[0]
        active_users = conn.execute(
            "SELECT active_users FROM feature_usage WHERE feature_id = %s AND period = %s",
            (feature_id, start),
        ).fetchone()

        # PRs / commits / files each developer authored for this feature (evidence trail).
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
                FROM build_cost WHERE feature_id = %s
                GROUP BY developer_id, tool ORDER BY SUM(amount) DESC
                """,
                (feature_id,),
            ).fetchall()
        ]
        build_contributors = conn.execute(
            "SELECT COUNT(DISTINCT developer_id) FROM build_cost WHERE feature_id = %s",
            (feature_id,),
        ).fetchone()[0]

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

        # Cost-optimization estimate (heuristic): derived from this month's
        # inference usage — spend, model mix, and the input/output token split.
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
    premium_cost = sum(float(a) for m, a, _ti, _to, _r in opt_rows if m in optimize.PREMIUM_MODELS)
    # Split spend into input/output by token share (fallback 70/30 when tokens
    # are unknown, e.g. connector-only rows that don't report token counts).
    token_sum = in_tokens + out_tokens
    input_share = (in_tokens / token_sum) if token_sum else 0.7
    input_cost = opt_total * input_share
    output_cost = opt_total - input_cost
    optimization = optimize.estimate(opt_total, input_cost, output_cost, premium_cost, requests)

    return {
        "feature_id": str(feature[0]),
        "name": feature[1],
        "description": feature[2],
        "status": feature[3],
        "discovery_confidence": feature[4],
        "period": start.isoformat(),
        "headline": {
            "build_cost": float(build_total),
            "inference_cost": float(inference_month),  # separate from build
            "active_users": active_users[0] if active_users else None,
        },
        "build_total": float(build_total),  # total AI build spend for this feature
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


_WINDOW_MONTHS = {"month": 1, "quarter": 3, "year": 12}


def feature_inference(tenant_id: str, feature_id: str, window: str = "month") -> dict:
    """Inference cost for a feature over a window: per-model breakdown + monthly trend.

    ``window`` is month (the latest month), quarter (last 3 months), or year (12).
    Per-model amounts sum to the windowed total (used for the % share + pie).
    """
    months = _WINDOW_MONTHS.get(window, 1)
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        latest = _resolve_period(conn, None)
        start = _months_back(latest, months - 1)

        model_rows = conn.execute(
            """
            SELECT model, SUM(amount), SUM(request_count)
            FROM inference_cost
            WHERE feature_id = %s AND period BETWEEN %s AND %s
            GROUP BY model ORDER BY SUM(amount) DESC
            """,
            (feature_id, start, latest),
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
                """
                SELECT period, SUM(amount)
                FROM inference_cost
                WHERE feature_id = %s AND period BETWEEN %s AND %s
                GROUP BY period ORDER BY period
                """,
                (feature_id, start, latest),
            ).fetchall()
        ]

    return {"window": window, "total": total, "by_model": by_model, "trend": trend}


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
            """
            SELECT provider, SUM(amount), SUM(request_count)
            FROM inference_cost
            WHERE period BETWEEN %s AND %s
            GROUP BY provider ORDER BY SUM(amount) DESC
            """,
            (start, end),
        ).fetchall()
        total = sum(float(amount) for _p, amount, _req in provider_rows) or 0.0
        by_provider = [
            {
                "provider": provider,
                "amount": float(amount),
                "pct": (float(amount) / total * 100.0) if total else 0.0,
                "requests": int(req) if req is not None else None,
            }
            for provider, amount, req in provider_rows
        ]
        trend = [
            {"period": p.isoformat(), "amount": float(amount)}
            for p, amount in conn.execute(
                """
                SELECT period, SUM(amount)
                FROM inference_cost
                WHERE period BETWEEN %s AND %s
                GROUP BY period ORDER BY period
                """,
                (start, end),
            ).fetchall()
        ]

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

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "total": total,
        "by_provider": by_provider,
        "trend": trend,
        "build_total": build_total,
        "build_by_tool": build_by_tool,
        "build_trend": build_trend,
    }
