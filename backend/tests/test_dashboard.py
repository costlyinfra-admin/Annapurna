"""Dashboard + drill-down aggregation over a realistic seeded tenant."""

from __future__ import annotations

import datetime as dt

import pytest
from annapurna import dashboard
from annapurna.sampledata import insert_sample_data

PERIOD = dt.date(2026, 5, 1)  # sampledata's period


@pytest.fixture
def seeded(tenant_id, app_env):
    insert_sample_data(app_env, tenant_id)
    app_env.commit()
    return tenant_id


def test_dashboard_keeps_build_and_inference_separate(seeded):
    data = dashboard.dashboard(seeded, PERIOD)
    by_name = {f["name"]: f for f in data["features"]}
    triage = by_name["AI threat triage"]

    # Separate fields — never blended into one number.
    assert triage["build_cost"] == 181.0  # alice 117 + bob 64
    assert triage["inference_cost"] == 4200.0
    assert triage["confidence"] in {"high", "med", "low"}

    # cost per user uses recurring inference only.
    assert triage["active_users"] == 540
    assert abs(triage["cost_per_user"] - 4200.0 / 540) < 1e-6

    # The Unattributed bucket carries both unmapped build and inference spend.
    assert data["unattributed"]["build_cost"] == 30.0
    assert data["unattributed"]["inference_cost"] == 760.0


def test_dashboard_executive_highlights(seeded):
    h = dashboard.dashboard(seeded, PERIOD)["highlights"]

    # Most expensive overall (build + inference): AI threat triage (181 + 4200).
    assert h["most_expensive"]["name"] == "AI threat triage"
    # Highest cost/user: Report generator (1850 / 120 ≈ 15.42 > SOC's 15.08).
    assert h["highest_cost_per_user"]["name"] == "Report generator"
    # Biggest optimization lever: costliest "watch" feature -> Report generator (1850/mo).
    assert h["optimization"]["name"] == "Report generator"
    assert h["optimization"]["worth_it"] == "watch"


def test_feature_detail_has_breakdowns_and_evidence(seeded):
    data = dashboard.dashboard(seeded, PERIOD)
    triage = next(f for f in data["features"] if f["name"] == "AI threat triage")

    detail = dashboard.feature_detail(seeded, triage["feature_id"], PERIOD)
    assert detail["headline"]["build_cost"] == 181.0
    assert detail["headline"]["inference_cost"] == 4200.0
    assert detail["headline"]["active_users"] == 540

    developers = {d["developer_id"] for d in detail["build_by_developer"]}
    assert developers == {"dev:alice", "dev:bob"}
    assert detail["inference_trend"]  # at least one month

    # Evidence trail: the actual signals behind the number.
    signal_types = {s["signal_type"] for s in detail["evidence"]}
    assert "pr" in signal_types and "branch" in signal_types
    assert detail["inference_sources"] == ["cost_api"]  # connector, not hook (yet)


def test_detail_missing_feature_returns_none(seeded):
    assert dashboard.feature_detail(seeded, "00000000-0000-0000-0000-000000000000", PERIOD) is None
