"""Provider cost clients — parsing + read-only behavior, via mock transport."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

import httpx
import pytest
from annapurna.providers import (
    AnthropicCostClient,
    OpenAICostClient,
    ProviderError,
    aggregate,
    month_start,
    next_month,
)


def test_month_helpers():
    assert month_start(dt.date(2026, 5, 17)) == dt.date(2026, 5, 1)
    assert next_month(dt.date(2026, 12, 1)) == dt.date(2027, 1, 1)


def test_aggregate_sums_same_key_project_model():
    from annapurna.providers import CostRecord

    recs = [
        CostRecord("openai", dt.date(2026, 5, 1), Decimal("10"), project="p1", model="gpt-4o"),
        CostRecord("openai", dt.date(2026, 5, 1), Decimal("5"), project="p1", model="gpt-4o"),
        CostRecord("openai", dt.date(2026, 5, 1), Decimal("7"), project="p2", model="gpt-4o"),
    ]
    out = {(r.project): r.amount for r in aggregate(recs)}
    assert out["p1"] == Decimal("15")
    assert out["p2"] == Decimal("7")


def test_anthropic_parses_cost_report():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-api-key"] == "sk-ant-admin"
        assert request.method == "GET"  # read-only
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "results": [
                            {
                                "workspace_id": "ws_triage",
                                "model": "claude-sonnet-4-6",
                                "amount": "4200.00",
                                "currency": "USD",
                            },
                            {
                                "workspace_id": "ws_shared",
                                "model": "claude-haiku-4-5",
                                "amount": "980.00",
                            },
                        ]
                    }
                ]
            },
        )

    client = AnthropicCostClient(
        "sk-ant-admin", client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    records = client.fetch_costs(dt.date(2026, 5, 10))
    by_ws = {r.project: r for r in records}
    assert by_ws["ws_triage"].amount == Decimal("4200.00")
    assert by_ws["ws_triage"].period == dt.date(2026, 5, 1)
    assert by_ws["ws_shared"].model == "claude-haiku-4-5"


def test_openai_parses_costs():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer sk-openai-admin"
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "results": [
                            {
                                "project_id": "proj_reports",
                                "line_item": "gpt-4o",
                                "amount": {"value": "1850.00", "currency": "USD"},
                            },
                        ]
                    }
                ]
            },
        )

    client = OpenAICostClient(
        "sk-openai-admin", client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    records = client.fetch_costs(dt.date(2026, 5, 1))
    assert records[0].project == "proj_reports"
    assert records[0].amount == Decimal("1850.00")


def test_provider_401_raises():
    def handler(_request):
        return httpx.Response(401, json={"error": "bad key"})

    client = AnthropicCostClient("bad", client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(ProviderError) as exc:
        client.fetch_costs(dt.date(2026, 5, 1))
    assert exc.value.status == 401
