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

    # Requests = number of AI model calls the feature made (from inference_cost).
    assert triage["requests"] == 320_000

    # The Unattributed bucket carries both unmapped build and inference spend.
    assert data["unattributed"]["build_cost"] == 30.0
    assert data["unattributed"]["inference_cost"] == 760.0


def test_dashboard_range_sums_across_months(seeded):
    # A 3-month range (Mar–May) sums more inference than the single latest month.
    one = dashboard.dashboard(seeded, range_token="this_month")
    three = dashboard.dashboard(seeded, range_token="last_3_months")
    assert three["months"] == 3
    assert one["months"] == 1
    assert three["totals"]["inference_cost"] > one["totals"]["inference_cost"]
    # The response reports the resolved window.
    assert three["start"] < three["end"]
    assert one["start"] == one["end"]


def test_dashboard_totals_have_prev_month_and_token_split(seeded):
    totals = dashboard.dashboard(seeded, PERIOD)["totals"]
    # Month-over-month deltas: the prior month's spend is reported alongside.
    assert "prev_build_cost" in totals
    assert "prev_inference_cost" in totals
    # April carried inference cost in the base fixture, so prev inference > 0.
    assert totals["prev_inference_cost"] > 0
    # Token split for the current month, summed from connector/hook rows.
    assert totals["tokens_in"] > 0
    assert totals["tokens_out"] > 0


def test_dashboard_executive_highlights(seeded):
    h = dashboard.dashboard(seeded, PERIOD)["highlights"]

    # Most expensive overall (build + inference): AI threat triage (181 + 4200).
    assert h["most_expensive"]["name"] == "AI threat triage"
    # Highest cost/user: Report generator (1850 / 120 ≈ 15.42 > SOC's 15.08).
    assert h["highest_cost_per_user"]["name"] == "Report generator"
    # Biggest optimization lever: costliest "watch" feature -> Report generator (1850/mo).
    assert h["optimization"]["name"] == "Report generator"
    assert h["optimization"]["worth_it"] == "watch"


def test_dashboard_generates_executive_insights(seeded):
    texts = [i["text"] for i in dashboard.dashboard(seeded, PERIOD)["insights"]]

    # Concentration: triage (4200 + 181) is 54% of all AI spend (8131.75).
    assert "AI threat triage represents 54% of all AI spend." in texts
    # Efficiency: report cost/user (15.42) is ~2x triage's (7.78), the widest gap.
    assert "Report generator costs 2x more per user than AI threat triage." in texts
    # Governance: unattributed (790) is 9.7% of total AI costs.
    assert "Unattributed spend represents 9.7% of total AI costs." in texts


def test_feature_detail_has_breakdowns_and_evidence(seeded):
    data = dashboard.dashboard(seeded, PERIOD)
    triage = next(f for f in data["features"] if f["name"] == "AI threat triage")

    detail = dashboard.feature_detail(seeded, triage["feature_id"], PERIOD)
    assert detail["headline"]["build_cost"] == 181.0
    assert detail["headline"]["inference_cost"] == 4200.0
    assert detail["headline"]["active_users"] == 540

    by_dev = {d["developer_id"]: d for d in detail["build_by_developer"]}
    assert set(by_dev) == {"alice", "bob"}
    # PRs / commits / files per developer come from the authored-PR evidence
    # (alice: #1421 [9c,21f] + #1432 [5c,16f] -> 2 PRs, 14 commits, 37 files).
    assert by_dev["alice"]["prs"] == 2
    assert by_dev["alice"]["commits"] == 14
    assert by_dev["alice"]["files_changed"] == 37
    assert by_dev["bob"]["prs"] == 1
    assert by_dev["bob"]["commits"] == 7
    # Total AI build spend + contributors for this feature.
    assert detail["build_total"] == 181.0
    assert detail["build_contributors"] == 2

    # Evidence trail: the actual signals behind the number.
    signal_types = {s["signal_type"] for s in detail["evidence"]}
    assert "pr" in signal_types and "branch" in signal_types
    assert detail["inference_sources"] == ["cost_api"]  # connector, not hook (yet)

    # Optimization opportunities: heuristic, derived from this month's inference.
    opt = detail["optimization"]
    names = {o["opportunity"] for o in opt["opportunities"]}
    # Triage is input-heavy, high volume -> the heuristic surfaces prompt caching.
    # (Model downgrade is now a grounded MEASURED opportunity, not a heuristic here.)
    assert "Prompt caching" in names
    assert "Model downgrade" not in names
    assert opt["monthly_savings"] > 0
    assert opt["annual_savings"] == round(opt["monthly_savings"] * 12, 2)
    # Conservative: combined estimate stays well under the $4,200 bill.
    assert opt["monthly_savings"] < 4200.0 * 0.6
    for o in opt["opportunities"]:
        assert o["confidence"] in {"high", "med", "low"} and o["rationale"]


def test_feature_inference_breakdown_and_window(seeded):
    data = dashboard.dashboard(seeded, PERIOD)
    report_id = next(f for f in data["features"] if f["name"] == "Report generator")["feature_id"]

    # Month window: three models summing to the month's $1,850, gpt-4o on top.
    month = dashboard.feature_inference(seeded, report_id, "month")
    by_model = {m["model"]: m for m in month["by_model"]}
    assert set(by_model) == {"gpt-4o", "claude-sonnet-4-6", "claude-haiku-4-5"}
    assert by_model["gpt-4o"]["amount"] == 1250.0
    assert by_model["gpt-4o"]["requests"] == 60_000
    assert abs(sum(m["pct"] for m in month["by_model"]) - 100.0) < 1e-6
    assert round(by_model["gpt-4o"]["pct"]) == 68  # 1250 / 1850
    assert len(month["trend"]) == 1  # just the latest month

    # Quarter window pulls in the prior months: gpt-4o 1250 + 1000 + 800, 3 trend points.
    quarter = dashboard.feature_inference(seeded, report_id, "quarter")
    q_by_model = {m["model"]: m for m in quarter["by_model"]}
    assert q_by_model["gpt-4o"]["amount"] == 3050.0
    assert len(quarter["trend"]) == 3


def test_spend_by_provider_breakdown_and_window(seeded):
    # Month window: providers sum to the tenant's total inference for the month,
    # ordered by spend, with pct shares that add to 100.
    month = dashboard.spend_by_provider(seeded, range_token="this_month")
    by_provider = {p["provider"]: p for p in month["by_provider"]}
    assert set(by_provider) >= {"openai", "anthropic"}
    assert month["total"] == sum(p["amount"] for p in month["by_provider"])
    assert abs(sum(p["pct"] for p in month["by_provider"]) - 100.0) < 1e-6
    # Ordered by spend descending.
    amounts = [p["amount"] for p in month["by_provider"]]
    assert amounts == sorted(amounts, reverse=True)
    assert len(month["trend"]) == 1

    # Build cost is grouped by tool, separately from inference (never blended).
    by_tool = {t["tool"]: t for t in month["build_by_tool"]}
    assert set(by_tool) <= {"claude_code", "cursor", "copilot", "codex"}
    assert month["build_total"] == sum(t["amount"] for t in month["build_by_tool"])
    if month["build_by_tool"]:
        assert abs(sum(t["pct"] for t in month["build_by_tool"]) - 100.0) < 1e-6
    # Build trend is its own series, not summed with inference.
    assert "build_trend" in month

    # A 3-month range pulls in prior months and yields three trend points.
    quarter = dashboard.spend_by_provider(seeded, range_token="last_3_months")
    assert len(quarter["trend"]) == 3
    assert quarter["total"] >= month["total"]


def test_detail_missing_feature_returns_none(seeded):
    assert dashboard.feature_detail(seeded, "00000000-0000-0000-0000-000000000000", PERIOD) is None
