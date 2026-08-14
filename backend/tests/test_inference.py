"""Inference ingest + attribution: confidence ladder, Unattributed bucket, totals."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest
from annapurna import features, inference, resources
from annapurna.providers import CostRecord, UsageRecord

PERIOD = dt.date(2026, 5, 1)


def _record(provider, amount, *, api_key_ref=None, project=None, model="m"):
    return CostRecord(
        provider=provider,
        period=PERIOD,
        amount=Decimal(str(amount)),
        api_key_ref=api_key_ref,
        project=project,
        model=model,
    )


def _mapped_tenant(tenant_id):
    """A tenant with a per-key feature and a per-project feature."""
    triage = features.add_feature(tenant_id, "AI threat triage")
    features.add_signal(tenant_id, triage["id"], "api_key", "key:triage")
    reports = features.add_feature(tenant_id, "Report generator")
    features.add_signal(tenant_id, reports["id"], "service", "proj_reports")
    return triage, reports


def test_attribution_confidence_and_unattributed(tenant_id):
    triage, reports = _mapped_tenant(tenant_id)

    anthropic_records = [
        _record("anthropic", 4200, api_key_ref="key:triage"),  # -> triage, high
        _record("anthropic", 760, api_key_ref="key:shared"),  # -> Unattributed, low
    ]
    openai_records = [
        _record("openai", 1850, project="proj_reports"),  # -> reports, med
    ]

    a_summary = inference.ingest_records(tenant_id, "anthropic", PERIOD, anthropic_records)
    inference.ingest_records(tenant_id, "openai", PERIOD, openai_records)

    assert a_summary["total"] == 4960.0
    assert a_summary["attributed"] == 4200.0
    assert a_summary["unattributed"] == 760.0

    summary = inference.inference_summary(tenant_id, PERIOD)
    by_name = {f["name"]: f for f in summary["features"]}
    assert by_name["AI threat triage"]["amount"] == 4200.0
    assert by_name["AI threat triage"]["confidence"] == "high"
    assert by_name["Report generator"]["confidence"] == "med"
    assert summary["unattributed"] == 760.0
    # Provider totals (== dashboard) are preserved across attributed + unattributed.
    assert summary["by_provider"] == {"anthropic": 4960.0, "openai": 1850.0}
    assert summary["total"] == 6810.0


def test_reingest_is_idempotent(tenant_id):
    _mapped_tenant(tenant_id)
    records = [_record("anthropic", 4200, api_key_ref="key:triage")]
    inference.ingest_records(tenant_id, "anthropic", PERIOD, records)
    inference.ingest_records(tenant_id, "anthropic", PERIOD, records)  # run again

    summary = inference.inference_summary(tenant_id, PERIOD)
    assert summary["by_provider"]["anthropic"] == 4200.0  # not doubled


def test_run_inference_ingest_with_injected_client(tenant_id, monkeypatch):
    _mapped_tenant(tenant_id)

    class _FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def fetch_costs(self, period):
            return [_record("anthropic", 4200, api_key_ref="key:triage")]

    monkeypatch.setattr(inference, "_make_cost_client", lambda provider, key: _FakeClient())
    summary = inference.run_inference_ingest(tenant_id, "anthropic", PERIOD, "admin-key")
    assert summary["attributed"] == 4200.0


def test_unmapped_tenant_all_unattributed(tenant_id):
    records = [_record("openai", 500, project="proj_x"), _record("openai", 300, api_key_ref="k")]
    inference.ingest_records(tenant_id, "openai", PERIOD, records)
    summary = inference.inference_summary(tenant_id, PERIOD)
    assert summary["features"] == []
    assert summary["unattributed"] == 800.0
    assert summary["total"] == 800.0


# ---------------------------------------------------------------------------
# Anthropic detailed path: workspace/API-key identity, environment, reconcile.
# ---------------------------------------------------------------------------
def _usage(ws, key, model, tin, tout, *, tier=None, cached=0, reqs=0):
    return UsageRecord(
        workspace_id=ws,
        api_key_id=key,
        model=model,
        service_tier=tier,
        tokens_in=tin,
        tokens_out=tout,
        cached_tokens_in=cached,
        request_count=reqs,
    )


def _cost(ws, amount):
    return CostRecord("anthropic", PERIOD, Decimal(str(amount)), project=ws)


_WORKSPACES = {"ws_mcs": "mcs-dev", "ws_sos": "sos-dev"}
_API_KEYS = {
    "k_a": {"name": "service-a-prod", "workspace_id": "ws_mcs"},
    "k_b": {"name": "experimental", "workspace_id": "ws_mcs"},
    "k_c": {"name": "pentest-prod", "workspace_id": "ws_sos"},
}


def test_anthropic_reconciles_to_cost_report_total(tenant_id):
    cost = [_cost("ws_mcs", 1000), _cost("ws_sos", 200)]
    usage = [
        _usage("ws_mcs", "k_a", "claude-sonnet-4-6", 1_000_000, 1_000_000),
        _usage("ws_mcs", "k_b", "claude-sonnet-4-6", 1_000_000, 0),
        _usage("ws_sos", "k_c", "claude-haiku-4-5", 500_000, 100_000),
    ]
    summary = inference.ingest_anthropic(tenant_id, PERIOD, cost, usage, _WORKSPACES, _API_KEYS)
    # INVARIANT: persisted total == authoritative Cost Report total, to the cent.
    assert summary["total"] == 1200.0
    detail = inference.anthropic_resource_detail(tenant_id, PERIOD)
    assert sum(r["cost"] for r in detail["rows"]) == pytest.approx(1200.0, abs=0.01)


def test_anthropic_resources_default_unclassified_no_name_inference(tenant_id):
    # "service-a-prod" must NOT auto-become production. Everything starts unclassified.
    cost = [_cost("ws_mcs", 100)]
    usage = [
        _usage("ws_mcs", "k_a", "claude-sonnet-4-6", 1_000_000, 0),
        _usage("ws_mcs", "k_b", "claude-sonnet-4-6", 1_000_000, 0),
    ]
    inference.ingest_anthropic(tenant_id, PERIOD, cost, usage, _WORKSPACES, _API_KEYS)
    detail = inference.anthropic_resource_detail(tenant_id, PERIOD)
    by_name = {r["name"]: r for r in detail["rows"]}
    assert by_name["service-a-prod"]["classification"] == "unclassified"
    assert by_name["service-a-prod"]["group"] == "mcs-dev"
    assert by_name["experimental"]["classification"] == "unclassified"
    # Detail is one flat table (no by_environment / by_workspace summaries).
    assert set(detail) == {"provider", "period", "classifiable", "columns", "rows"}
    assert detail["columns"] == {"group": "Workspace", "name": "API key"}


def test_anthropic_manual_classification_persists_and_survives_resync(tenant_id):
    cost = [_cost("ws_mcs", 100)]
    usage = [
        _usage("ws_mcs", "k_a", "claude-sonnet-4-6", 1_000_000, 0),
        _usage("ws_mcs", "k_b", "claude-sonnet-4-6", 1_000_000, 0),
    ]
    inference.ingest_anthropic(tenant_id, PERIOD, cost, usage, _WORKSPACES, _API_KEYS)
    # User classifies one key production. It shows immediately in the detail.
    resources.set_classification(tenant_id, "anthropic", "api_key", "k_a", "production")
    detail = inference.anthropic_resource_detail(tenant_id, PERIOD)
    by_name = {r["name"]: r for r in detail["rows"]}
    assert by_name["service-a-prod"]["classification"] == "production"

    # A later sync must NOT overwrite the manual choice, and must snapshot it onto
    # the cost rows so reporting reflects production.
    inference.ingest_anthropic(tenant_id, PERIOD, cost, usage, _WORKSPACES, _API_KEYS)
    assert resources.get_classifications(tenant_id, "anthropic")[("api_key", "k_a")] == "production"
    summary = inference.inference_summary(tenant_id, PERIOD)
    assert summary["by_provider"]["anthropic"] == pytest.approx(100.0, abs=0.01)


def test_anthropic_workspace_without_usage_is_not_lost(tenant_id):
    summary = inference.ingest_anthropic(
        tenant_id, PERIOD, [_cost("ws_mcs", 500)], [], _WORKSPACES, _API_KEYS
    )
    assert summary["total"] == 500.0
    detail = inference.anthropic_resource_detail(tenant_id, PERIOD)
    assert sum(r["cost"] for r in detail["rows"]) == pytest.approx(500.0, abs=0.01)
    assert all(r["classification"] == "unclassified" for r in detail["rows"])


def test_ignore_excluded_from_reporting_totals(tenant_id):
    cost = [_cost("ws_mcs", 100)]
    usage = [
        _usage("ws_mcs", "k_a", "claude-sonnet-4-6", 1_000_000, 0),  # -> ignore
        _usage("ws_mcs", "k_b", "claude-sonnet-4-6", 1_000_000, 0),  # -> unclassified
    ]
    inference.ingest_anthropic(tenant_id, PERIOD, cost, usage, _WORKSPACES, _API_KEYS)
    resources.set_classification(tenant_id, "anthropic", "api_key", "k_a", "ignore")
    inference.ingest_anthropic(
        tenant_id, PERIOD, cost, usage, _WORKSPACES, _API_KEYS
    )  # re-snapshot

    # The ignored $50 is excluded from reporting; the other $50 remains.
    summary = inference.inference_summary(tenant_id, PERIOD)
    assert summary["by_provider"]["anthropic"] == pytest.approx(50.0, abs=0.01)
    # But the source detail still shows every resource (auditability).
    detail = inference.anthropic_resource_detail(tenant_id, PERIOD)
    assert sum(r["cost"] for r in detail["rows"]) == pytest.approx(100.0, abs=0.01)


def test_run_inference_ingest_routes_anthropic_to_detailed_path(tenant_id, monkeypatch):
    class _FakeAnthropic:
        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def fetch_costs(self, period):
            return [_cost("ws_mcs", 1000)]

        def fetch_usage(self, period):
            return [
                _usage("ws_mcs", "k_a", "claude-sonnet-4-6", 1_000_000, 0),
                _usage("ws_mcs", "k_b", "claude-sonnet-4-6", 1_000_000, 0),
            ]

        def fetch_workspaces(self):
            return _WORKSPACES

        def fetch_api_keys(self):
            return _API_KEYS

    monkeypatch.setattr(inference, "_make_cost_client", lambda provider, key: _FakeAnthropic())
    summary = inference.run_inference_ingest(tenant_id, "anthropic", PERIOD, "admin-key")
    assert summary["total"] == 1000.0
    detail = inference.anthropic_resource_detail(tenant_id, PERIOD)
    assert {r["group"] for r in detail["rows"]} == {"mcs-dev"}
    assert all(r["classification"] == "unclassified" for r in detail["rows"])


# ---------------------------------------------------------------------------
# Multi-month backfill (Sync now pulls history, not just the current month).
# ---------------------------------------------------------------------------
def test_backfill_ingests_each_month_of_the_window(tenant_id, monkeypatch):
    seen: list = []

    class _FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def fetch_costs(self, period):
            seen.append(period)
            return [_record("openai", 100, project="proj_x")]

    monkeypatch.setattr(inference, "_make_cost_client", lambda provider, key: _FakeClient())
    anchor = dt.date(2026, 8, 1)
    summary = inference.run_inference_backfill(tenant_id, "openai", "key", months=12, anchor=anchor)

    assert len(seen) == 12  # one fetch per month
    assert min(seen) == dt.date(2025, 9, 1)  # 12 months back, inclusive
    assert max(seen) == anchor
    assert summary["months"] == 12
    assert len(summary["by_month"]) == 12
    assert summary["total"] == 1200.0  # 12 * 100
    # Persisted across the window: last-12-months range sees every month.
    view = inference.inference_summary(tenant_id, dt.date(2026, 8, 1))
    assert view["by_provider"]["openai"] == 100.0  # each month stored separately


def test_backfill_is_idempotent_per_month(tenant_id, monkeypatch):
    class _FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def fetch_costs(self, period):
            return [_record("openai", 50, project="proj_x")]

    monkeypatch.setattr(inference, "_make_cost_client", lambda provider, key: _FakeClient())
    anchor = dt.date(2026, 8, 1)
    inference.run_inference_backfill(tenant_id, "openai", "key", months=3, anchor=anchor)
    inference.run_inference_backfill(tenant_id, "openai", "key", months=3, anchor=anchor)  # again
    # A month's total is not doubled by re-running the backfill.
    view = inference.inference_summary(tenant_id, anchor)
    assert view["by_provider"]["openai"] == 50.0


def test_backfill_survives_a_single_bad_month(tenant_id, monkeypatch):
    class _FlakyClient:
        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def fetch_costs(self, period):
            if period == dt.date(2026, 7, 1):
                raise RuntimeError("transient provider error")
            return [_record("openai", 10, project="proj_x")]

    monkeypatch.setattr(inference, "_make_cost_client", lambda provider, key: _FlakyClient())
    summary = inference.run_inference_backfill(
        tenant_id, "openai", "key", months=3, anchor=dt.date(2026, 8, 1)
    )
    assert len(summary["by_month"]) == 2  # June + August landed
    assert len(summary["errors"]) == 1  # July recorded, not fatal
    assert summary["errors"][0]["period"] == "2026-07-01"


def test_backfill_raises_when_every_month_fails(tenant_id, monkeypatch):
    class _DeadClient:
        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def fetch_costs(self, period):
            raise RuntimeError("bad admin key")

    monkeypatch.setattr(inference, "_make_cost_client", lambda provider, key: _DeadClient())
    with pytest.raises(RuntimeError, match="bad admin key"):
        inference.run_inference_backfill(tenant_id, "openai", "key", months=3)
