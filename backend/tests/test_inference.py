"""Inference ingest + attribution: confidence ladder, Unattributed bucket, totals."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from annapurna import features, inference
from annapurna.providers import CostRecord

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
