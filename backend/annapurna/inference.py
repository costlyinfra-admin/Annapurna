"""Inference cost ingest + attribution (connector path).

Pulls a month of authoritative provider spend (providers.py) and writes it to
`inference_cost` with source='cost_api'. Each record is attributed to a feature
via the tenant's key/project mappings (feature_signal rows), or — if nothing
matches — left in the **Unattributed bucket** (feature_id NULL). Either way the
full provider total is stored, so the sum always reconciles to the bill.

Confidence ladder (design §7.3):
  * dedicated per-feature API key  -> high
  * project/workspace mapping       -> med
  * unmapped (Unattributed)         -> low
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from . import credentials
from .db import admin_dsn, app_dsn, connect, tenant_tx
from .providers import CostRecord, make_cost_client, month_start


def _make_cost_client(provider: str, admin_key: str):
    # Indirection so tests can inject a fake provider client.
    return make_cost_client(provider, admin_key)


def _load_mappings(conn) -> tuple[dict, dict]:
    """Return (by_api_key, by_service) maps of external_ref -> feature_id."""
    rows = conn.execute(
        """
        SELECT feature_id, signal_type, external_ref
        FROM feature_signal
        WHERE signal_type IN ('api_key', 'service') AND external_ref IS NOT NULL
        """
    ).fetchall()
    by_api_key: dict[str, str] = {}
    by_service: dict[str, str] = {}
    for feature_id, signal_type, external_ref in rows:
        target = by_api_key if signal_type == "api_key" else by_service
        target[external_ref] = str(feature_id)
    return by_api_key, by_service


def _attribute(record: CostRecord, maps: tuple[dict, dict]) -> tuple[Optional[str], str]:
    by_api_key, by_service = maps
    if record.api_key_ref and record.api_key_ref in by_api_key:
        return by_api_key[record.api_key_ref], "high"
    if record.project and record.project in by_service:
        return by_service[record.project], "med"
    if record.project and record.project in by_api_key:
        return by_api_key[record.project], "high"
    return None, "low"  # Unattributed bucket


def run_inference_ingest(tenant_id: str, provider: str, period: dt.date, admin_key: str) -> dict:
    """Fetch a provider's monthly cost and ingest it. Returns a summary."""
    with _make_cost_client(provider, admin_key) as client:
        records = client.fetch_costs(period)
    return ingest_records(tenant_id, provider, period, records)


def ingest_records(
    tenant_id: str, provider: str, period: dt.date, records: list[CostRecord]
) -> dict:
    """Attribute and persist already-fetched cost records (idempotent per month)."""
    start = month_start(period)
    attributed = Decimal("0")
    unattributed = Decimal("0")

    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        maps = _load_mappings(conn)
        # Idempotent: replace this provider+period's connector rows.
        conn.execute(
            "DELETE FROM inference_cost "
            "WHERE provider = %s AND period = %s AND source = 'cost_api'",
            (provider, start),
        )
        for record in records:
            feature_id, confidence = _attribute(record, maps)
            conn.execute(
                """
                INSERT INTO inference_cost
                    (tenant_id, feature_id, provider, model, api_key_ref, amount, currency,
                     period, tokens_in, tokens_out, request_count, source, confidence)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'cost_api', %s)
                """,
                (
                    tenant_id,
                    feature_id,
                    record.provider,
                    record.model,
                    record.api_key_ref or record.project,
                    record.amount,
                    record.currency,
                    start,
                    record.tokens_in,
                    record.tokens_out,
                    record.request_count,
                    confidence,
                ),
            )
            if feature_id:
                attributed += record.amount
            else:
                unattributed += record.amount

    total = attributed + unattributed
    return {
        "provider": provider,
        "period": start.isoformat(),
        "rows": len(records),
        "total": float(total),
        "attributed": float(attributed),
        "unattributed": float(unattributed),
    }


def inference_summary(tenant_id: str, period: dt.date) -> dict:
    """Per-feature inference totals + the Unattributed bucket, for a month."""
    start = month_start(period)
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        rows = conn.execute(
            """
            SELECT ic.feature_id, f.name, ic.confidence, SUM(ic.amount)
            FROM inference_cost ic
            LEFT JOIN feature f ON f.id = ic.feature_id
            WHERE ic.period = %s AND ic.source = 'cost_api'
            GROUP BY ic.feature_id, f.name, ic.confidence
            ORDER BY SUM(ic.amount) DESC
            """,
            (start,),
        ).fetchall()
        provider_rows = conn.execute(
            """
            SELECT provider, SUM(amount) FROM inference_cost
            WHERE period = %s AND source = 'cost_api'
            GROUP BY provider
            """,
            (start,),
        ).fetchall()

    features = []
    unattributed = 0.0
    for feature_id, name, confidence, amount in rows:
        if feature_id is None:
            unattributed += float(amount)
        else:
            features.append(
                {
                    "feature_id": str(feature_id),
                    "name": name,
                    "amount": float(amount),
                    "confidence": confidence,
                }
            )
    by_provider = {p: float(a) for p, a in provider_rows}
    return {
        "period": start.isoformat(),
        "features": features,
        "unattributed": unattributed,
        "by_provider": by_provider,
        "total": float(sum(by_provider.values())),
    }


def run_scheduled_ingest(periods: Optional[list[dt.date]] = None) -> list[dict]:
    """Ingest every tenant's connected inference providers. Cron entry point."""
    periods = periods or [month_start(dt.date.today())]
    with connect(admin_dsn()) as conn:
        pairs = conn.execute(
            """
            SELECT DISTINCT tenant_id, connector_type FROM connector_credential
            WHERE connector_type IN ('anthropic', 'openai')
            """
        ).fetchall()

    from . import hook  # local import to avoid a module-load cycle

    results: list[dict] = []
    reconciled: set[tuple] = set()
    for tenant_id, provider in pairs:
        admin_key = credentials.get_secret(str(tenant_id), provider)
        if not admin_key:
            continue
        for period in periods:
            try:
                results.append(run_inference_ingest(str(tenant_id), provider, period, admin_key))
                # Keep hook numbers tied to the bill each cycle (no-op if no hook data).
                if (str(tenant_id), period) not in reconciled:
                    hook.reconcile(str(tenant_id), period)
                    reconciled.add((str(tenant_id), period))
            except Exception as exc:  # one tenant/provider failing must not stop the rest
                results.append(
                    {"tenant_id": str(tenant_id), "provider": provider, "error": str(exc)}
                )
    return results


if __name__ == "__main__":
    summary = run_scheduled_ingest()
    print(f"Ingested {len(summary)} tenant/provider runs.")
    for item in summary:
        print(" ", item)
