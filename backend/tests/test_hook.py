"""Metering hook: token auth, event ingest, reconciliation, no double-counting."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from annapurna import dashboard, features, hook, inference
from annapurna.providers import CostRecord

PERIOD = dt.date(2026, 6, 1)


def test_token_roundtrip(tenant_id):
    token = hook.generate_token(tenant_id)
    assert hook.resolve_tenant(token) == tenant_id
    assert hook.resolve_tenant("not-a-real-token") is None
    # Regenerating replaces the old token.
    token2 = hook.generate_token(tenant_id)
    assert hook.resolve_tenant(token) is None
    assert hook.resolve_tenant(token2) == tenant_id


def test_hook_events_write_high_confidence_rows(tenant_id):
    triage = features.add_feature(tenant_id, "AI threat triage")
    summary = hook.ingest_events(
        tenant_id,
        [
            {
                "provider": "anthropic",
                "model": "claude-sonnet-4-6",
                "tokens_in": 100_000_000,
                "tokens_out": 0,
                "feature_id": triage["id"],
                "occurred_at": "2026-06-15T10:00:00Z",
            },
            {  # foreign feature id -> Unattributed
                "provider": "anthropic",
                "model": "claude-sonnet-4-6",
                "tokens_in": 0,
                "tokens_out": 0,
                "feature_id": "00000000-0000-0000-0000-000000000000",
            },
        ],
    )
    assert summary["accepted"] == 2
    assert summary["cost"] == 300.0  # 100M input tokens * $3/M

    detail = dashboard.feature_detail(tenant_id, triage["id"], PERIOD)
    assert detail["headline"]["inference_cost"] == 300.0
    assert detail["inference_sources"] == ["hook"]  # connector-vs-hook indicator


def test_reconciliation_routes_gap_to_unattributed(tenant_id):
    triage = features.add_feature(tenant_id, "AI threat triage")

    # Provider bill (authoritative) = $1000 for anthropic, unmapped at the connector level.
    inference.ingest_records(
        tenant_id,
        "anthropic",
        PERIOD,
        [CostRecord("anthropic", PERIOD, Decimal("1000"), api_key_ref="key:shared")],
    )
    # Hook meters $300 of that to the triage feature.
    hook.ingest_events(
        tenant_id,
        [
            {
                "provider": "anthropic",
                "model": "claude-sonnet-4-6",
                "tokens_in": 100_000_000,
                "tokens_out": 0,
                "feature_id": triage["id"],
                "occurred_at": "2026-06-15T10:00:00Z",
            }
        ],
    )

    recon = hook.reconcile(tenant_id, PERIOD)
    anthropic = next(r for r in recon if r["provider"] == "anthropic")
    assert anthropic["billed"] == 1000.0
    assert anthropic["attributed"] == 300.0
    assert anthropic["delta"] == 700.0
    assert anthropic["status"] == "delta"

    # Dashboard: hook drives the feature number; the gap is Unattributed; the
    # total still equals the bill (no double-counting of connector + hook).
    data = dashboard.dashboard(tenant_id, PERIOD)
    triage_row = next(f for f in data["features"] if f["name"] == "AI threat triage")
    assert triage_row["inference_cost"] == 300.0
    assert triage_row["confidence"] == "high"  # hook lifts to top of the ladder
    assert data["unattributed"]["inference_cost"] == 700.0
    assert data["totals"]["inference_cost"] == 1000.0


def test_onboarding_unaffected_without_hook(tenant_id):
    # No hook token, no events: dashboard still works (connector path stands alone).
    features.add_feature(tenant_id, "Report generator")
    data = dashboard.dashboard(tenant_id, PERIOD)
    assert data["totals"]["inference_cost"] == 0.0
