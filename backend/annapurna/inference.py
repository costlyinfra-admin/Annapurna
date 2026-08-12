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
import logging
from collections import defaultdict
from decimal import Decimal
from typing import Optional

from . import classification, credentials, pricing
from .db import admin_dsn, app_dsn, connect, tenant_tx
from .providers import CostRecord, UsageRecord, make_cost_client, month_start


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
    """Fetch a provider's monthly cost and ingest it. Returns a summary.

    Anthropic uses the detailed path when the client exposes the Usage Report:
    authoritative Cost Report dollars are reconciled against per-workspace/per-key
    usage and labelled with an environment. Every other provider (and simpler
    clients, e.g. tests) uses the flat cost-report attribution path.
    """
    with _make_cost_client(provider, admin_key) as client:
        cost_records = client.fetch_costs(period)
        if provider == "anthropic" and hasattr(client, "fetch_usage"):
            usage = client.fetch_usage(period)
            workspaces = client.fetch_workspaces()
            api_keys = client.fetch_api_keys()
            return ingest_anthropic(tenant_id, period, cost_records, usage, workspaces, api_keys)
    return ingest_records(tenant_id, provider, period, cost_records)


def _months_back(day: dt.date, n: int) -> dt.date:
    """First-of-month ``n`` months before ``day`` (month-aligned)."""
    month = day.month - n
    year = day.year
    while month <= 0:
        month += 12
        year -= 1
    return dt.date(year, month, 1)


def run_inference_backfill(
    tenant_id: str,
    provider: str,
    admin_key: str,
    *,
    months: int = 12,
    anchor: Optional[dt.date] = None,
) -> dict:
    """Ingest the last ``months`` months (ending at ``anchor``, default this month).

    Reuses the per-month ingest so attribution, classification, and reconciliation
    are identical to a single-month sync — this just walks the window, oldest month
    first, and each month is idempotent (a re-sync replaces that month's rows).

    Resilient to a single bad month (a transient provider error is recorded and the
    walk continues), but if EVERY month fails the first error is raised so a real
    problem (e.g. a rejected admin key) still surfaces to the caller.
    """
    anchor_month = month_start(anchor or dt.date.today())
    periods = [_months_back(anchor_month, i) for i in range(months - 1, -1, -1)]
    by_month: list[dict] = []
    errors: list[dict] = []
    first_error: Optional[Exception] = None
    total = 0.0
    rows = 0
    for period in periods:
        try:
            summary = run_inference_ingest(tenant_id, provider, period, admin_key)
        except Exception as exc:  # noqa: BLE001 — record and continue; surfaced below if all fail
            first_error = first_error or exc
            errors.append({"period": period.isoformat(), "error": str(exc)[:200]})
            continue
        by_month.append(
            {"period": summary["period"], "total": summary["total"], "rows": summary.get("rows", 0)}
        )
        total += summary["total"]
        rows += summary.get("rows", 0)

    if not by_month and first_error is not None:
        raise first_error  # nothing landed — surface the real cause (bad key, etc.)

    return {
        "provider": provider,
        "months": months,
        "period": periods[-1].isoformat(),  # newest month (back-compat with single sync)
        "total": total,
        "rows": rows,
        "by_month": by_month,
        "errors": errors,
    }


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
                     period, tokens_in, tokens_out, request_count, cached_tokens_in,
                     source, confidence)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'cost_api', %s)
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
                    record.cached_tokens_in,
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


# ---------------------------------------------------------------------------
# Anthropic detailed path: workspace / API-key identity + environment.
# ---------------------------------------------------------------------------
def _usage_weight(row: UsageRecord) -> Decimal:
    """Proportional weight for splitting a workspace's billed dollars.

    Priced dollars are the best proxy for real cost; fall back to total tokens,
    then request count, so a workspace's split (and each key's environment) is
    preserved even when a model is unpriced.
    """
    priced = pricing.price(row.model or "", row.tokens_in, row.tokens_out, "anthropic")
    if priced > 0:
        return priced
    tokens = Decimal(row.tokens_in + row.tokens_out)
    if tokens > 0:
        return tokens
    return Decimal(row.request_count or 0)


def _allocate(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """Split ``total`` across ``weights`` so the parts sum EXACTLY to ``total``.

    The last row absorbs the rounding remainder, guaranteeing the reconciliation
    invariant (sum of allocated == authoritative billed) to the cent.
    """
    q = Decimal("0.0001")
    wsum = sum(weights, Decimal("0"))
    if not weights or wsum <= 0:
        return [Decimal("0") for _ in weights]
    out: list[Decimal] = []
    running = Decimal("0")
    for i, w in enumerate(weights):
        if i == len(weights) - 1:
            out.append((total - running).quantize(q))
        else:
            part = (total * w / wsum).quantize(q)
            out.append(part)
            running += part
    return out


def _attribute_detail(
    api_key_id: Optional[str], workspace_id: Optional[str], maps: tuple[dict, dict]
) -> tuple[Optional[str], str]:
    """Preserve existing feature attribution over the new explicit ids.

    A per-key mapping (api_key signal) wins; a per-workspace mapping (service
    signal) is next. No mapping -> Unattributed. (Feature/customer attribution of
    production traffic is a later milestone; this only keeps today's capability.)
    """
    by_api_key, by_service = maps
    if api_key_id and api_key_id in by_api_key:
        return by_api_key[api_key_id], "high"
    if workspace_id and workspace_id in by_service:
        return by_service[workspace_id], "med"
    if workspace_id and workspace_id in by_api_key:
        return by_api_key[workspace_id], "high"
    return None, "low"


def _insert_anthropic_row(
    conn,
    tenant_id: str,
    feature_id: Optional[str],
    row: UsageRecord,
    amount: Decimal,
    start: dt.date,
    workspace_id: Optional[str],
    workspace_name: Optional[str],
    api_key_name: Optional[str],
    environment: str,
    confidence: str,
) -> None:
    """Persist one reconciled Anthropic cost row with explicit identity columns.

    NOTE: ``api_key_ref`` now holds the genuine ``api_key_id`` (not the workspace,
    as the legacy fallback did); ``workspace_id`` has its own column.
    """
    conn.execute(
        """
        INSERT INTO inference_cost
            (tenant_id, feature_id, provider, model, api_key_ref, amount, currency,
             period, tokens_in, tokens_out, request_count, cached_tokens_in,
             workspace_id, workspace_name, api_key_id, api_key_name, environment,
             source, confidence)
        VALUES (%s, %s, 'anthropic', %s, %s, %s, 'USD', %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, 'cost_api', %s)
        """,
        (
            tenant_id,
            feature_id,
            row.model,
            row.api_key_id,
            amount,
            start,
            row.tokens_in or None,
            row.tokens_out or None,
            row.request_count or None,
            row.cached_tokens_in or None,
            workspace_id,
            workspace_name,
            row.api_key_id,
            api_key_name,
            environment,
            confidence,
        ),
    )


def ingest_anthropic(
    tenant_id: str,
    period: dt.date,
    cost_records: list[CostRecord],
    usage_records: list[UsageRecord],
    workspaces: dict[str, str],
    api_keys: dict[str, dict],
) -> dict:
    """Reconcile authoritative Cost Report dollars against detailed usage.

    The Cost Report is the billing authority (dollars per workspace); the Usage
    Report supplies the per-(api_key, model) split within a workspace. For each
    workspace we allocate its billed dollars across its usage rows by priced
    weight — so the persisted total ALWAYS equals the bill — and label each row's
    environment from the API-key name. A workspace billed with no usable usage is
    preserved as a single ``unclassified`` unattributed row rather than guessed.
    """
    start = month_start(period)

    # Authoritative billed dollars per workspace (cost_report groups by workspace_id).
    billed_by_ws: dict[Optional[str], Decimal] = {}
    for r in cost_records:
        billed_by_ws[r.project] = billed_by_ws.get(r.project, Decimal("0")) + r.amount
    billed_total = sum(billed_by_ws.values(), Decimal("0"))

    # Aggregate usage within each workspace by (api_key_id, model, service_tier).
    usage_by_ws: dict[Optional[str], dict[tuple, UsageRecord]] = defaultdict(dict)
    for u in usage_records:
        bucket = usage_by_ws[u.workspace_id]
        k = (u.api_key_id, u.model, u.service_tier)
        agg = bucket.get(k)
        if agg is None:
            bucket[k] = UsageRecord(
                workspace_id=u.workspace_id,
                api_key_id=u.api_key_id,
                model=u.model,
                service_tier=u.service_tier,
                tokens_in=u.tokens_in,
                tokens_out=u.tokens_out,
                cached_tokens_in=u.cached_tokens_in,
                request_count=u.request_count,
            )
        else:
            agg.tokens_in += u.tokens_in
            agg.tokens_out += u.tokens_out
            agg.cached_tokens_in += u.cached_tokens_in
            agg.request_count += u.request_count

    by_env: dict[str, Decimal] = {}
    attributed = Decimal("0")
    unattributed = Decimal("0")
    rows_written = 0

    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        maps = _load_mappings(conn)
        conn.execute(
            "DELETE FROM inference_cost WHERE provider = 'anthropic' "
            "AND period = %s AND source = 'cost_api'",
            (start,),
        )
        for ws_id, authoritative in billed_by_ws.items():
            ws_name = workspaces.get(ws_id) if ws_id else None
            rows = list(usage_by_ws.get(ws_id, {}).values())
            allocations = _allocate(authoritative, [_usage_weight(r) for r in rows])
            if rows and sum(allocations, Decimal("0")) > 0:
                for row, amount in zip(rows, allocations):
                    meta = api_keys.get(row.api_key_id or "", {})
                    api_key_name = meta.get("name")
                    environment = classification.classify("anthropic", api_key_name=api_key_name)
                    feature_id, confidence = _attribute_detail(row.api_key_id, ws_id, maps)
                    _insert_anthropic_row(
                        conn,
                        tenant_id,
                        feature_id,
                        row,
                        amount,
                        start,
                        ws_id,
                        ws_name,
                        api_key_name,
                        environment,
                        confidence,
                    )
                    by_env[environment] = by_env.get(environment, Decimal("0")) + amount
                    if feature_id:
                        attributed += amount
                    else:
                        unattributed += amount
                    rows_written += 1
            else:
                # Billed dollars we can't safely map to usage -> unclassified bucket.
                _insert_anthropic_row(
                    conn,
                    tenant_id,
                    None,
                    UsageRecord(workspace_id=ws_id),
                    authoritative,
                    start,
                    ws_id,
                    ws_name,
                    None,
                    classification.UNCLASSIFIED,
                    "low",
                )
                by_env[classification.UNCLASSIFIED] = (
                    by_env.get(classification.UNCLASSIFIED, Decimal("0")) + authoritative
                )
                unattributed += authoritative
                rows_written += 1

    return {
        "provider": "anthropic",
        "period": start.isoformat(),
        "rows": rows_written,
        "total": float(billed_total),
        "attributed": float(attributed),
        "unattributed": float(unattributed),
        "production": float(by_env.get(classification.PRODUCTION, Decimal("0"))),
        "unclassified": float(by_env.get(classification.UNCLASSIFIED, Decimal("0"))),
        "by_environment": {k: float(v) for k, v in by_env.items()},
    }


def anthropic_breakdown(tenant_id: str, period: Optional[dt.date] = None) -> dict:
    """Per-environment / per-workspace / per-key Anthropic split for a month.

    Reads persisted rows only (no provider calls). Powers the Cost Sources view
    and the production-vs-unclassified summary. Legacy rows (environment NULL) are
    surfaced as ``unclassified`` so nothing is presented as production by default.
    ``period`` defaults to the latest month that has Anthropic cost data.
    """
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        if period is None:
            latest = conn.execute(
                "SELECT MAX(period) FROM inference_cost "
                "WHERE provider = 'anthropic' AND source = 'cost_api'"
            ).fetchone()[0]
            start = latest or month_start(dt.date.today())
        else:
            start = month_start(period)
        rows = conn.execute(
            """
            SELECT workspace_id, workspace_name, api_key_id, api_key_name,
                   COALESCE(environment, 'unclassified') AS env, SUM(amount)
            FROM inference_cost
            WHERE provider = 'anthropic' AND period = %s AND source = 'cost_api'
            GROUP BY workspace_id, workspace_name, api_key_id, api_key_name, env
            ORDER BY SUM(amount) DESC
            """,
            (start,),
        ).fetchall()

    by_environment: dict[str, float] = {}
    workspaces: dict[tuple, dict] = {}
    keys: list[dict] = []
    total = 0.0
    for ws_id, ws_name, key_id, key_name, env, amount in rows:
        amt = float(amount)
        total += amt
        by_environment[env] = by_environment.get(env, 0.0) + amt
        ws = workspaces.setdefault(
            (ws_id, ws_name),
            {
                "workspace_id": ws_id,
                "workspace_name": ws_name,
                "total": 0.0,
                "by_environment": {},
            },
        )
        ws["total"] += amt
        ws["by_environment"][env] = ws["by_environment"].get(env, 0.0) + amt
        keys.append(
            {
                "workspace_id": ws_id,
                "workspace_name": ws_name,
                "api_key_id": key_id,
                "api_key_name": key_name,
                "environment": env,
                "amount": amt,
            }
        )

    return {
        "period": start.isoformat(),
        "total": total,
        "by_environment": by_environment,
        "by_workspace": sorted(workspaces.values(), key=lambda w: w["total"], reverse=True),
        "keys": keys,
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
                logging.getLogger("annapurna.ingest").warning(
                    "inference ingest failed for tenant=%s provider=%s: %s",
                    tenant_id,
                    provider,
                    exc,
                )
                results.append(
                    {"tenant_id": str(tenant_id), "provider": provider, "error": str(exc)}
                )
    return results


if __name__ == "__main__":
    summary = run_scheduled_ingest()
    print(f"Ingested {len(summary)} tenant/provider runs.")
    for item in summary:
        print(" ", item)
