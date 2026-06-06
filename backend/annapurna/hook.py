"""Metering hook: ingest token, per-call event ingest, and bill reconciliation.

The hook is the precision tier (design §7.2). Metered events are costed from the
internal pricing tables and written to inference_cost with source='hook' at HIGH
confidence. Reconciliation compares the hook total to the provider's authoritative
cost-API total per period and records the gap in bill_reconciliation; the gap is
surfaced as Unattributed by the dashboard (it is never silently dropped).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import secrets
from decimal import Decimal
from typing import Optional

from .db import admin_dsn, app_dsn, connect, tenant_tx
from .pricing import PRICED_PROVIDERS, price
from .providers import month_start

_DEFAULT_TOLERANCE = Decimal("0.50")


# --------------------------------------------------------------------------
# Ingest token (per tenant)
# --------------------------------------------------------------------------
def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def generate_token(tenant_id: str) -> str:
    """Create (or replace) a tenant's ingest token. The raw token is shown once."""
    token = secrets.token_urlsafe(32)
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        conn.execute("DELETE FROM hook_token WHERE tenant_id = %s", (tenant_id,))
        conn.execute(
            "INSERT INTO hook_token (tenant_id, token_hash) VALUES (%s, %s)",
            (tenant_id, _hash(token)),
        )
    return token


def resolve_tenant(token: str) -> Optional[str]:
    """Resolve an ingest token to a tenant id (admin path; bypasses RLS, like login)."""
    with connect(admin_dsn()) as conn:
        row = conn.execute(
            "SELECT tenant_id FROM hook_token WHERE token_hash = %s", (_hash(token),)
        ).fetchone()
    return str(row[0]) if row else None


# --------------------------------------------------------------------------
# Event ingest
# --------------------------------------------------------------------------
def _period_of(occurred_at: Optional[str]) -> dt.date:
    if not occurred_at:
        return month_start(dt.date.today())
    text = occurred_at.replace("Z", "+00:00")
    try:
        return month_start(dt.datetime.fromisoformat(text).date())
    except ValueError:
        return month_start(dt.date.fromisoformat(text[:10]))


def ingest_events(tenant_id: str, events: list[dict]) -> dict:
    """Cost and persist metered events into monthly hook rows. Returns a summary."""
    total = Decimal("0")
    accepted = 0
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        valid_features = {str(r[0]) for r in conn.execute("SELECT id FROM feature").fetchall()}
        accumulator: dict[tuple, dict] = {}
        for event in events:
            provider = event.get("provider")
            if provider not in PRICED_PROVIDERS:
                continue  # unknown/unpriced provider -> skip (kept out of accepted count)
            model = event.get("model") or ""
            tokens_in = int(event.get("tokens_in") or 0)
            tokens_out = int(event.get("tokens_out") or 0)
            feature_id = event.get("feature_id")
            if feature_id is not None and str(feature_id) not in valid_features:
                feature_id = None  # unknown/foreign feature -> Unattributed
            period = _period_of(event.get("occurred_at"))
            cost = price(model, tokens_in, tokens_out, provider)

            key = (feature_id, provider, model, period)
            entry = accumulator.setdefault(
                key, {"amount": Decimal("0"), "tin": 0, "tout": 0, "count": 0}
            )
            entry["amount"] += cost
            entry["tin"] += tokens_in
            entry["tout"] += tokens_out
            entry["count"] += 1
            accepted += 1

        for (feature_id, provider, model, period), entry in accumulator.items():
            _upsert_hook_row(conn, tenant_id, feature_id, provider, model, period, entry)
            total += entry["amount"]

    return {"accepted": accepted, "cost": float(total)}


def _upsert_hook_row(conn, tenant_id, feature_id, provider, model, period, entry) -> None:
    existing = conn.execute(
        """
        SELECT id FROM inference_cost
        WHERE source = 'hook' AND period = %s AND provider = %s
          AND feature_id IS NOT DISTINCT FROM %s
          AND model IS NOT DISTINCT FROM %s
        LIMIT 1
        """,
        (period, provider, feature_id, model),
    ).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE inference_cost
            SET amount = amount + %s, tokens_in = COALESCE(tokens_in, 0) + %s,
                tokens_out = COALESCE(tokens_out, 0) + %s,
                request_count = COALESCE(request_count, 0) + %s
            WHERE id = %s
            """,
            (entry["amount"], entry["tin"], entry["tout"], entry["count"], existing[0]),
        )
    else:
        conn.execute(
            """
            INSERT INTO inference_cost
                (tenant_id, feature_id, provider, model, amount, period,
                 tokens_in, tokens_out, request_count, source, confidence)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'hook', 'high')
            """,
            (
                tenant_id,
                feature_id,
                provider,
                model,
                entry["amount"],
                period,
                entry["tin"],
                entry["tout"],
                entry["count"],
            ),
        )


# --------------------------------------------------------------------------
# Reconciliation
# --------------------------------------------------------------------------
def reconcile(
    tenant_id: str, period: dt.date, tolerance: Decimal = _DEFAULT_TOLERANCE
) -> list[dict]:
    """Compare hook totals to the provider bill per provider; record the gap."""
    start = month_start(period)
    results: list[dict] = []
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        providers = [
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT provider FROM inference_cost WHERE period = %s", (start,)
            ).fetchall()
        ]
        for provider in providers:
            billed = conn.execute(
                "SELECT COALESCE(SUM(amount), 0) FROM inference_cost "
                "WHERE provider = %s AND period = %s AND source = 'cost_api'",
                (provider, start),
            ).fetchone()[0]
            attributed = conn.execute(
                "SELECT COALESCE(SUM(amount), 0) FROM inference_cost "
                "WHERE provider = %s AND period = %s AND source = 'hook'",
                (provider, start),
            ).fetchone()[0]
            status = "balanced" if abs(billed - attributed) <= tolerance else "delta"
            conn.execute(
                "DELETE FROM bill_reconciliation WHERE provider = %s AND period = %s",
                (provider, start),
            )
            conn.execute(
                """
                INSERT INTO bill_reconciliation
                    (tenant_id, provider, period, billed_total, attributed_total, status)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (tenant_id, provider, start, billed, attributed, status),
            )
            results.append(
                {
                    "provider": provider,
                    "period": start.isoformat(),
                    "billed": float(billed),
                    "attributed": float(attributed),
                    "delta": float(billed - attributed),
                    "status": status,
                }
            )
    return results
