"""Dashboard + drill-down aggregation over a realistic seeded tenant."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest
from annapurna import dashboard, inference, resources
from annapurna.providers import CostRecord, UsageRecord
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


def test_spend_by_provider_daily_trend(seeded, app_env):
    # The By provider tab exposes a day-resolution trend from inference_cost_daily.
    for day, amt, env in [
        (dt.date(2026, 5, 4), 30, "production"),
        (dt.date(2026, 5, 5), 45, "development"),
        (dt.date(2026, 5, 20), 25, "production"),
    ]:
        app_env.execute(
            """
            INSERT INTO inference_cost_daily
                (tenant_id, provider, model, amount, day, environment, source, confidence)
            VALUES (%s, 'anthropic', 'c', %s, %s, %s, 'cost_api', 'high')
            """,
            (seeded, amt, day, env),
        )
    app_env.commit()

    data = dashboard.spend_by_provider(seeded, range_token="this_month")
    by_day = {p["period"]: p for p in data["daily_trend"]}
    assert by_day["2026-05-04"]["production"] == 30.0
    assert by_day["2026-05-05"]["development"] == 45.0
    assert by_day["2026-05-20"]["total"] == 25.0
    # One point per day, buckets summing to each day's total.
    for p in data["daily_trend"]:
        parts = p["production"] + p["development"] + p["internal"] + p["unclassified"]
        assert round(parts, 2) == round(p["total"], 2)


def test_trend_points_carry_a_workspace_breakdown(seeded, app_env):
    # Each trend point exposes where its spend came from, so the chart's hover can
    # show a per-workspace split alongside the classification split.
    day = dt.date(2026, 5, 6)
    for ws, amt in [("Triage WS", 70), ("Shared WS", 30)]:
        app_env.execute(
            """
            INSERT INTO inference_cost_daily
                (tenant_id, provider, model, amount, day, workspace_id, workspace_name,
                 environment, source, confidence)
            VALUES (%s, 'anthropic', 'c', %s, %s, %s, %s, 'production', 'cost_api', 'high')
            """,
            (seeded, amt, day, ws, ws),
        )
        app_env.execute(
            """
            INSERT INTO inference_cost
                (tenant_id, provider, model, amount, period, workspace_id, workspace_name,
                 environment, source, confidence)
            VALUES (%s, 'anthropic', 'c', %s, %s, %s, %s, 'production', 'cost_api', 'high')
            """,
            (seeded, amt, PERIOD, ws, ws),
        )
    app_env.commit()

    data = dashboard.spend_by_provider(seeded, range_token="this_month")
    point = next(p for p in data["daily_trend"] if p["period"] == day.isoformat())
    assert {w["workspace"]: w["amount"] for w in point["workspaces"]} == {
        "Triage WS": 70.0,
        "Shared WS": 30.0,
    }
    # Workspace amounts reconcile with that point's total, largest first.
    assert round(sum(w["amount"] for w in point["workspaces"]), 2) == round(point["total"], 2)
    assert [w["workspace"] for w in point["workspaces"]] == ["Triage WS", "Shared WS"]
    # The monthly trend carries the same split.
    m = next(p for p in data["trend"] if p["period"] == PERIOD.isoformat())
    assert {w["workspace"] for w in m["workspaces"]} == {"Triage WS", "Shared WS"}


def test_spend_by_provider_workspace_api_key_breakdown(seeded, app_env):
    # Anthropic rows carry workspace/api_key identity; the By provider tab rolls it
    # up into a workspace -> API key breakdown that reconciles to the inference total.
    for ws_id, ws_name, key, amt in [
        ("ws_triage", "Triage WS", "triage-key", 100),
        ("ws_triage", "Triage WS", "triage-key-2", 40),
        ("ws_shared", "Shared WS", "shared-key", 25),
    ]:
        app_env.execute(
            """
            INSERT INTO inference_cost
                (tenant_id, provider, model, amount, currency, period,
                 workspace_id, workspace_name, api_key_id, api_key_name, source, confidence)
            VALUES (%s, 'anthropic', 'claude', %s, 'USD', %s, %s, %s, %s, %s, 'cost_api', 'high')
            """,
            (seeded, amt, PERIOD, ws_id, ws_name, key, key),
        )
    app_env.commit()

    data = dashboard.spend_by_provider(seeded, range_token="this_month")
    by_ws = {w["workspace"]: w for w in data["by_workspace"]}
    assert by_ws["Triage WS"]["amount"] == 140.0
    assert {k["api_key"]: k["amount"] for k in by_ws["Triage WS"]["by_key"]} == {
        "triage-key": 100.0,
        "triage-key-2": 40.0,
    }
    assert by_ws["Shared WS"]["amount"] == 25.0
    assert data["workspace_total"] == 165.0
    # Each workspace's keys reconcile to its subtotal, with per-workspace shares to 100.
    for w in data["by_workspace"]:
        assert round(sum(k["amount"] for k in w["by_key"]), 2) == round(w["amount"], 2)
        assert abs(sum(k["pct"] for k in w["by_key"]) - 100.0) < 1e-6


def test_feature_detail_reconciles_with_overview_over_range(seeded):
    # A feature's detail totals must equal its Overview row for the SAME range.
    board = dashboard.dashboard(seeded, range_token="last_3_months")
    report = next(f for f in board["features"] if f["name"] == "Report generator")

    detail = dashboard.feature_detail(seeded, report["feature_id"], range_token="last_3_months")
    assert detail["build_total"] == report["build_cost"]
    assert detail["headline"]["inference_cost"] == report["inference_cost"]
    # Per-developer build spend reconciles with the feature's build total.
    assert round(sum(d["amount"] for d in detail["build_by_developer"]), 2) == round(
        detail["build_total"], 2
    )

    # The range genuinely widens inference vs a single month (report has 3 months
    # of history), proving the detail respects the selected period — and the single
    # month still reconciles with that month's Overview row.
    one_month = dashboard.feature_detail(seeded, report["feature_id"], range_token="this_month")
    assert detail["headline"]["inference_cost"] > one_month["headline"]["inference_cost"]
    board_month = dashboard.dashboard(seeded, range_token="this_month")
    report_month = next(f for f in board_month["features"] if f["name"] == "Report generator")
    assert one_month["headline"]["inference_cost"] == report_month["inference_cost"]


def test_feature_inference_breakdown_and_window(seeded):
    data = dashboard.dashboard(seeded, PERIOD)
    report_id = next(f for f in data["features"] if f["name"] == "Report generator")["feature_id"]

    # This-month range: three models summing to the month's $1,850, gpt-4o on top.
    month = dashboard.feature_inference(seeded, report_id, range_token="this_month")
    by_model = {m["model"]: m for m in month["by_model"]}
    assert set(by_model) == {"gpt-4o", "claude-sonnet-4-6", "claude-haiku-4-5"}
    assert by_model["gpt-4o"]["amount"] == 1250.0
    assert by_model["gpt-4o"]["requests"] == 60_000
    assert abs(sum(m["pct"] for m in month["by_model"]) - 100.0) < 1e-6
    assert round(by_model["gpt-4o"]["pct"]) == 68  # 1250 / 1850
    assert len(month["trend"]) == 1  # just the latest month

    # Last-3-months range pulls in the prior months: gpt-4o 1250 + 1000 + 800, 3 trend points.
    quarter = dashboard.feature_inference(seeded, report_id, range_token="last_3_months")
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

    # The trend is a per-month classification stack whose buckets sum to the total.
    # Seeded rows have NULL environment -> counted as unclassified (not production).
    m = month["trend"][0]
    assert m["production"] + m["development"] + m["internal"] + m["unclassified"] == pytest.approx(
        m["total"], abs=0.01
    )
    assert m["total"] == pytest.approx(month["total"], abs=0.01)
    assert m["production"] == 0.0  # nothing auto-classified
    assert m["unclassified"] == pytest.approx(m["total"], abs=0.01)

    # Each provider carries a model breakdown that sums back to its own total,
    # with per-provider pct shares adding to 100.
    for p in month["by_provider"]:
        assert p["by_model"], f"{p['provider']} should have a model breakdown"
        assert abs(sum(m["amount"] for m in p["by_model"]) - p["amount"]) < 1e-6
        assert abs(sum(m["pct"] for m in p["by_model"]) - 100.0) < 1e-6

    # Build cost is grouped by tool, separately from inference (never blended).
    by_tool = {t["tool"]: t for t in month["build_by_tool"]}
    assert set(by_tool) <= {"claude_code", "cursor", "copilot", "codex"}
    assert month["build_total"] == sum(t["amount"] for t in month["build_by_tool"])
    if month["build_by_tool"]:
        assert abs(sum(t["pct"] for t in month["build_by_tool"]) - 100.0) < 1e-6
    # Build trend is its own series, not summed with inference.
    assert "build_trend" in month

    # Build cost also breaks down by developer, each with a per-tool split, and
    # developers reconcile to the same build total (invariant 4: nothing dropped).
    devs = month["build_by_developer"]
    assert devs, "seeded data should attribute build cost to developers"
    assert month["build_total"] == pytest.approx(sum(d["amount"] for d in devs), abs=1e-6)
    assert abs(sum(d["pct"] for d in devs) - 100.0) < 1e-6
    # Ordered by spend descending.
    dev_amounts = [d["amount"] for d in devs]
    assert dev_amounts == sorted(dev_amounts, reverse=True)
    # Each developer's tools sum back to that developer's total (shares add to 100).
    for d in devs:
        assert d["by_tool"], f"{d['developer_id']} should have a tool breakdown"
        assert abs(sum(t["amount"] for t in d["by_tool"]) - d["amount"]) < 1e-6
        assert abs(sum(t["pct"] for t in d["by_tool"]) - 100.0) < 1e-6
        # Every developer carries a non-empty display label.
        assert d["label"]
    # The seed stores both a name and a handle, so at least one label combines them.
    assert any(d["label"].endswith(")") and " (" in d["label"] for d in devs)

    # A 3-month range pulls in prior months and yields three trend points.
    quarter = dashboard.spend_by_provider(seeded, range_token="last_3_months")
    assert len(quarter["trend"]) == 3
    assert quarter["total"] >= month["total"]


def test_detail_missing_feature_returns_none(seeded):
    assert dashboard.feature_detail(seeded, "00000000-0000-0000-0000-000000000000", PERIOD) is None


# ---------------------------------------------------------------------------
# Inference trend: per-month classification stack (provider-independent).
# ---------------------------------------------------------------------------
def _acost(ws, amount, period=PERIOD):
    return CostRecord("anthropic", period, Decimal(str(amount)), project=ws)


def _ausage(ws, key, period=PERIOD):
    return UsageRecord(
        workspace_id=ws, api_key_id=key, model="claude-sonnet-4-6", tokens_in=1_000_000
    )


def test_inference_trend_classification_stack(tenant_id):
    workspaces = {"ws1": "ws-one"}
    api_keys = {
        "k_prod": {"name": "prod", "workspace_id": "ws1"},
        "k_dev": {"name": "dev", "workspace_id": "ws1"},
        "k_ign": {"name": "ign", "workspace_id": "ws1"},
    }
    # $99 across three equally-used keys -> $33 each; plus an OpenAI row (no env).
    cost = [_acost("ws1", 99)]
    usage = [_ausage("ws1", "k_prod"), _ausage("ws1", "k_dev"), _ausage("ws1", "k_ign")]
    inference.ingest_anthropic(tenant_id, PERIOD, cost, usage, workspaces, api_keys)
    inference.ingest_records(
        tenant_id, "openai", PERIOD, [CostRecord("openai", PERIOD, Decimal("30"), project="p")]
    )

    resources.set_classification(tenant_id, "anthropic", "api_key", "k_prod", "production")
    resources.set_classification(tenant_id, "anthropic", "api_key", "k_dev", "development")
    resources.set_classification(tenant_id, "anthropic", "api_key", "k_ign", "ignore")
    # Re-snapshot the classifications onto the cost rows.
    inference.ingest_anthropic(tenant_id, PERIOD, cost, usage, workspaces, api_keys)

    data = dashboard.spend_by_provider(tenant_id, range_token="this_month")
    assert len(data["trend"]) == 1
    m = data["trend"][0]
    # Each classification lands in its own stack; OpenAI (NULL env) -> unclassified.
    assert m["production"] == pytest.approx(33.0, abs=0.01)  # from Anthropic
    assert m["development"] == pytest.approx(33.0, abs=0.01)
    assert m["internal"] == 0.0
    assert m["unclassified"] == pytest.approx(30.0, abs=0.01)  # the OpenAI row
    # Ignore ($33) is excluded: buckets sum to total, which excludes it.
    assert m["total"] == pytest.approx(96.0, abs=0.01)
    assert (
        m["production"] + m["development"] + m["internal"] + m["unclassified"]
    ) == pytest.approx(m["total"], abs=0.01)
    # Provider totals also exclude the ignored spend.
    by_provider = {p["provider"]: p for p in data["by_provider"]}
    assert by_provider["anthropic"]["amount"] == pytest.approx(66.0, abs=0.01)
    assert by_provider["openai"]["amount"] == pytest.approx(30.0, abs=0.01)


def test_multi_month_trend_is_independent_per_month(tenant_id):
    may, apr = dt.date(2026, 5, 1), dt.date(2026, 4, 1)
    ws, keys = {"ws1": "ws-one"}, {"k1": {"name": "k1", "workspace_id": "ws1"}}
    inference.ingest_anthropic(
        tenant_id, apr, [_acost("ws1", 40, apr)], [_ausage("ws1", "k1", apr)], ws, keys
    )
    inference.ingest_anthropic(
        tenant_id, may, [_acost("ws1", 60, may)], [_ausage("ws1", "k1", may)], ws, keys
    )
    resources.set_classification(tenant_id, "anthropic", "api_key", "k1", "production")
    inference.ingest_anthropic(
        tenant_id, apr, [_acost("ws1", 40, apr)], [_ausage("ws1", "k1", apr)], ws, keys
    )
    inference.ingest_anthropic(
        tenant_id, may, [_acost("ws1", 60, may)], [_ausage("ws1", "k1", may)], ws, keys
    )

    data = dashboard.spend_by_provider(tenant_id, range_token="last_3_months")
    by_period = {t["period"]: t for t in data["trend"]}
    assert by_period["2026-04-01"]["production"] == pytest.approx(40.0, abs=0.01)
    assert by_period["2026-05-01"]["production"] == pytest.approx(60.0, abs=0.01)


def test_classification_is_independent_of_feature_attribution(tenant_id):
    # A production key with NO feature mapping is Production in the trend, yet
    # Unattributed on the feature side — the two dimensions never conflate.
    ws, keys = {"ws1": "ws-one"}, {"k1": {"name": "k1", "workspace_id": "ws1"}}
    cost, usage = [_acost("ws1", 50)], [_ausage("ws1", "k1")]
    inference.ingest_anthropic(tenant_id, PERIOD, cost, usage, ws, keys)
    resources.set_classification(tenant_id, "anthropic", "api_key", "k1", "production")
    inference.ingest_anthropic(tenant_id, PERIOD, cost, usage, ws, keys)

    trend = dashboard.spend_by_provider(tenant_id, range_token="this_month")["trend"][0]
    assert trend["production"] == pytest.approx(50.0, abs=0.01)  # classification dimension

    board = dashboard.dashboard(tenant_id, PERIOD)
    # Attribution dimension: no feature mapping -> Unattributed inference, unchanged.
    assert board["unattributed"]["inference_cost"] == pytest.approx(50.0, abs=0.01)
