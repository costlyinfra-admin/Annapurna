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


def _worth_indicator(inference: float, users: Optional[int]) -> str:
    """Directional only (not ROI). healthy / watch / unknown."""
    if not users:
        return "unknown"
    cost_per_user = inference / users
    return "healthy" if cost_per_user <= 10.0 else "watch"


def dashboard(tenant_id: str, period: Optional[dt.date] = None) -> dict:
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        start = _resolve_period(conn, period)

        features = conn.execute(
            """
            SELECT id, name, status, discovery_confidence
            FROM feature WHERE status IN ('proposed', 'confirmed')
            ORDER BY created_at
            """
        ).fetchall()

        build = _rollup(conn, "build_cost", start)
        inference = _rollup(conn, "inference_cost", start)
        usage = {
            str(fid): users
            for fid, users in conn.execute(
                "SELECT feature_id, active_users FROM feature_usage WHERE period = %s", (start,)
            ).fetchall()
        }

    rows = []
    for fid, name, _status, _disc in features:
        fid = str(fid)
        b = build.get(fid, {"amount": 0.0, "confidence": None})
        i = inference.get(fid, {"amount": 0.0, "confidence": None})
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
                "worth_it": _worth_indicator(i["amount"], users),
                "confidence": _min_confidence(b["confidence"], i["confidence"]),
            }
        )

    unattributed = {
        "build_cost": build.get(None, {"amount": 0.0})["amount"],
        "inference_cost": inference.get(None, {"amount": 0.0})["amount"],
    }
    return {
        "period": start.isoformat(),
        "features": rows,
        "unattributed": unattributed,
        "totals": {
            "build_cost": sum(r["build_cost"] for r in rows) + unattributed["build_cost"],
            "inference_cost": sum(r["inference_cost"] for r in rows)
            + unattributed["inference_cost"],
        },
    }


def _rollup(conn, table: str, period: dt.date) -> dict:
    """feature_id (str or None) -> {amount, confidence(min)} for a cost table/period."""
    rows = conn.execute(
        f"SELECT feature_id, amount, confidence FROM {table} WHERE period = %s",  # noqa: S608
        (period,),
    ).fetchall()
    out: dict = {}
    for feature_id, amount, confidence in rows:
        key = str(feature_id) if feature_id is not None else None
        entry = out.setdefault(key, {"amount": 0.0, "confidence": None})
        entry["amount"] += float(amount)
        entry["confidence"] = _min_confidence(entry["confidence"], confidence)
    return out


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

        by_developer = [
            {"developer_id": dev, "tool": tool, "amount": float(amount), "confidence": conf}
            for dev, tool, amount, conf in conn.execute(
                """
                SELECT developer_id, tool, SUM(amount), MIN(confidence)
                FROM build_cost WHERE feature_id = %s
                GROUP BY developer_id, tool ORDER BY SUM(amount) DESC
                """,
                (feature_id,),
            ).fetchall()
        ]

        inference_trend = [
            {"period": p.isoformat(), "amount": float(amount), "source": source}
            for p, amount, source in conn.execute(
                """
                SELECT period, SUM(amount), MIN(source)
                FROM inference_cost WHERE feature_id = %s
                GROUP BY period ORDER BY period
                """,
                (feature_id,),
            ).fetchall()
        ]

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
        "build_by_developer": by_developer,
        "inference_trend": inference_trend,
        "evidence": evidence,
        "inference_sources": sources,  # ["cost_api"] now; "hook" arrives in M7
    }
