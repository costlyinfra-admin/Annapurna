"""Build-cost ingest + allocation (coding tools).

Takes per-developer coding-tool spend (a Cursor-for-Teams seat export or any CSV)
and allocates each developer's spend across features by the PRs they authored
(the `actor` on feature_signal 'pr' rows, recorded during discovery). Writes
build_cost rows per feature and per developer, broken down by tool.

Confidence (design §7.3, build side):
  * all of a developer's PRs map to one feature -> high (direct match)
  * spread across several features            -> med  (inferred overlap split)
  * developer has no attributable PRs          -> low  (-> Unattributed bucket)

Build cost is ALWAYS separate from inference cost (invariant 2).
"""

from __future__ import annotations

import csv
import datetime as dt
import io
from collections import defaultdict
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from .db import app_dsn, connect, tenant_tx
from .providers import month_start

VALID_TOOLS = {"claude_code", "cursor", "copilot", "codex"}
_CONFIDENCE_RANK = {"high": 3, "med": 2, "low": 1}


@dataclass
class DeveloperSpend:
    developer_id: str
    tool: str
    amount: Decimal
    period: Optional[dt.date] = None


class CsvImportError(Exception):
    """Raised when a coding-tool CSV cannot be parsed."""


def parse_csv(
    text: str, default_tool: Optional[str] = None, default_period: Optional[dt.date] = None
) -> list[DeveloperSpend]:
    """Parse a coding-tool export. Columns: developer, amount, [tool], [period].

    Header names are flexible (developer/developer_id/email/user; amount/cost/spend).
    """
    reader = csv.DictReader(io.StringIO(text.strip()))
    if reader.fieldnames is None:
        raise CsvImportError("CSV has no header row.")
    fields = {name.strip().lower(): name for name in reader.fieldnames}

    def pick(row, *names):
        for n in names:
            if n in fields and row[fields[n]] not in (None, ""):
                return row[fields[n]].strip()
        return None

    spends: list[DeveloperSpend] = []
    for i, row in enumerate(reader, start=2):  # row 1 is the header
        developer = pick(row, "developer", "developer_id", "email", "user", "login")
        amount_raw = pick(row, "amount", "cost", "spend")
        if developer is None or amount_raw is None:
            raise CsvImportError(f"Row {i}: missing developer or amount.")
        try:
            amount = Decimal(amount_raw.replace("$", "").replace(",", ""))
        except Exception as exc:
            raise CsvImportError(f"Row {i}: invalid amount '{amount_raw}'.") from exc
        tool = (pick(row, "tool") or default_tool or "").strip()
        if tool not in VALID_TOOLS:
            raise CsvImportError(
                f"Row {i}: tool must be one of {sorted(VALID_TOOLS)}, got '{tool}'."
            )
        spends.append(DeveloperSpend(developer, tool, amount, default_period))
    if not spends:
        raise CsvImportError("CSV contained no spend rows.")
    return spends


def _split_amount(total: Decimal, weights: dict[str, int]) -> dict[str, Decimal]:
    """Split ``total`` across keys proportional to integer weights, exactly."""
    weight_sum = sum(weights.values())
    ordered = sorted(weights.items(), key=lambda kv: (-kv[1], kv[0]))
    out: dict[str, Decimal] = {}
    allocated = Decimal("0")
    for key, weight in ordered:
        share = (total * weight / weight_sum).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        out[key] = share
        allocated += share
    # Put any rounding remainder on the largest share so the total is exact.
    out[ordered[0][0]] += total - allocated
    return out


def _developer_feature_distribution(conn) -> dict[str, dict[str, int]]:
    """actor -> {feature_id: number of authored PRs attributed to that feature}."""
    rows = conn.execute(
        """
        SELECT fs.actor, fs.feature_id
        FROM feature_signal fs
        JOIN feature f ON f.id = fs.feature_id
        WHERE fs.signal_type = 'pr' AND fs.actor IS NOT NULL
        """
    ).fetchall()
    dist: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for actor, feature_id in rows:
        dist[actor][str(feature_id)] += 1
    return dist


def allocate_and_store(tenant_id: str, spends: list[DeveloperSpend], period: dt.date) -> dict:
    """Allocate developer spend to features and persist build_cost rows."""
    start = month_start(period)
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        dist = _developer_feature_distribution(conn)
        tools = {s.tool for s in spends}
        # Idempotent: replace this period's rows for the tools being imported.
        conn.execute(
            "DELETE FROM build_cost WHERE period = %s AND tool = ANY(%s)",
            (start, list(tools)),
        )
        for spend in spends:
            feature_counts = dist.get(spend.developer_id, {})
            if not feature_counts:
                # No attributable PRs -> Unattributed bucket (feature_id NULL).
                _insert_build_cost(conn, tenant_id, None, spend, spend.amount, "low", start)
                continue
            confidence = "high" if len(feature_counts) == 1 else "med"
            for feature_id, amount in _split_amount(spend.amount, feature_counts).items():
                _insert_build_cost(conn, tenant_id, feature_id, spend, amount, confidence, start)
    return build_summary(tenant_id, period)


def _insert_build_cost(conn, tenant_id, feature_id, spend, amount, confidence, period):
    conn.execute(
        """
        INSERT INTO build_cost
            (tenant_id, feature_id, developer_id, tool, amount, period, confidence, source)
        VALUES (%s, %s, %s, %s, %s, %s, %s, 'coding_tool+github')
        """,
        (tenant_id, feature_id, spend.developer_id, spend.tool, amount, period, confidence),
    )


def record_training_cost(
    tenant_id: str,
    feature_id: str,
    amount,
    label: str,
    period: dt.date,
    run_ref: Optional[str] = None,
) -> dict:
    """Record a one-time fine-tuning / training run as BUILD cost on a feature.

    Fine-tuning an open-source model is part of what it cost to *build* the
    feature, so it lives on the build side (never blended with inference). It is
    directly attributed (the customer names the feature), so confidence is high.
    """
    start = month_start(period)
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        conn.execute(
            """
            INSERT INTO build_cost
                (tenant_id, feature_id, developer_id, tool, pr_ref, amount, period,
                 confidence, source)
            VALUES (%s, %s, %s, 'fine_tune', %s, %s, %s, 'high', 'fine_tune')
            """,
            (tenant_id, feature_id, label, run_ref, Decimal(str(amount)), start),
        )
    return build_summary(tenant_id, period)


def build_summary(tenant_id: str, period: dt.date) -> dict:
    """Build cost per feature and per developer, broken down by tool."""
    start = month_start(period)
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        rows = conn.execute(
            """
            SELECT bc.feature_id, f.name, bc.developer_id, bc.tool, bc.amount, bc.confidence
            FROM build_cost bc
            LEFT JOIN feature f ON f.id = bc.feature_id
            WHERE bc.period = %s
            """,
            (start,),
        ).fetchall()

    features: dict[str, dict] = {}
    developers: dict[str, dict] = {}
    unattributed = 0.0
    total = 0.0

    for feature_id, name, developer_id, tool, amount, confidence in rows:
        amt = float(amount)
        total += amt

        if feature_id is None:
            unattributed += amt
        else:
            fid = str(feature_id)
            feat = features.setdefault(
                fid,
                {
                    "feature_id": fid,
                    "name": name,
                    "amount": 0.0,
                    "by_tool": {},
                    "confidence": "low",
                },
            )
            feat["amount"] += amt
            feat["by_tool"][tool] = feat["by_tool"].get(tool, 0.0) + amt
            if _CONFIDENCE_RANK[confidence] > _CONFIDENCE_RANK[feat["confidence"]]:
                feat["confidence"] = confidence

        dev = developers.setdefault(
            developer_id, {"developer_id": developer_id, "amount": 0.0, "by_tool": {}}
        )
        dev["amount"] += amt
        dev["by_tool"][tool] = dev["by_tool"].get(tool, 0.0) + amt

    return {
        "period": start.isoformat(),
        "features": sorted(features.values(), key=lambda f: -f["amount"]),
        "developers": sorted(developers.values(), key=lambda d: -d["amount"]),
        "unattributed": unattributed,
        "total": total,
    }
