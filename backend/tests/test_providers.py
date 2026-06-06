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


def test_google_gemini_parses_cost_by_project():
    from annapurna.providers import GoogleCostClient

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer goog-token"
        assert request.method == "GET"  # read-only
        return httpx.Response(
            200,
            json={
                "data": [
                    {"project_id": "proj_triage", "model": "gemini-2.5-pro", "cost": "300.00"},
                    # No cost -> price the tokens (flash: $0.30/M in).
                    {
                        "project_id": "proj_reports",
                        "model": "gemini-2.5-flash",
                        "prompt_tokens": 1_000_000,
                        "completion_tokens": 0,
                    },
                ]
            },
        )

    client = GoogleCostClient(
        "goog-token", client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    by_project = {r.project: r for r in client.fetch_costs(dt.date(2026, 5, 1))}
    assert by_project["proj_triage"].amount == Decimal("300.00")  # reported $
    assert by_project["proj_reports"].amount == Decimal("0.3000")  # priced by us


def test_hosted_oss_uses_reported_dollar_cost():
    from annapurna.providers import make_cost_client

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer or-key"
        assert request.method == "GET"  # read-only
        assert "openrouter.ai" in str(request.url)
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "model": "meta-llama-3.1-70b-instruct",
                        "cost": "123.45",
                        "requests": 5000,
                        "api_key": "key:prod",
                    }
                ]
            },
        )

    client = make_cost_client("openrouter", "or-key")
    client._client = httpx.Client(transport=httpx.MockTransport(handler))
    records = client.fetch_costs(dt.date(2026, 5, 10))
    assert records[0].amount == Decimal("123.45")  # reported $ wins
    assert records[0].model == "meta-llama-3.1-70b-instruct"
    assert records[0].request_count == 5000


def test_hosted_oss_prices_tokens_when_no_dollar_cost():
    from annapurna.providers import HostedUsageCostClient

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                # No cost field -> price the tokens via our (provider, model) table.
                # together meta-llama-3.1-70b-instruct = $0.88/M in + out.
                "data": [
                    {
                        "model": "meta-llama-3.1-70b-instruct",
                        "prompt_tokens": 1_000_000,
                        "completion_tokens": 1_000_000,
                    }
                ]
            },
        )

    client = HostedUsageCostClient(
        "together",
        "tg-key",
        "/v1/usage",
        base_url="https://api.together.xyz",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    records = client.fetch_costs(dt.date(2026, 5, 1))
    assert records[0].amount == Decimal("1.7600")  # 0.88 + 0.88, computed by us


def test_bedrock_reads_cost_explorer_by_tag():
    import json

    from annapurna.providers import BedrockCostClient

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"  # Cost Explorer is a POST API
        assert "ce.us-east-1.amazonaws.com" in str(request.url)
        assert request.headers["Authorization"].startswith("AWS4-HMAC-SHA256")
        assert request.headers["X-Amz-Target"].endswith("GetCostAndUsage")
        return httpx.Response(
            200,
            json={
                "ResultsByTime": [
                    {
                        "Groups": [
                            {
                                "Keys": ["feature$triage"],
                                "Metrics": {"UnblendedCost": {"Amount": "4200.00", "Unit": "USD"}},
                            },
                            {  # untagged Bedrock spend -> Unattributed
                                "Keys": ["feature$"],
                                "Metrics": {"UnblendedCost": {"Amount": "300.00", "Unit": "USD"}},
                            },
                        ]
                    }
                ]
            },
        )

    creds = json.dumps(
        {
            "access_key_id": "AKIA",
            "secret_access_key": "secret",
            "region": "us-east-1",
            "tag": "feature",
        }
    )
    client = BedrockCostClient(creds, client=httpx.Client(transport=httpx.MockTransport(handler)))
    records = client.fetch_costs(dt.date(2026, 5, 1))
    by_tag = {r.api_key_ref: r for r in records}
    assert by_tag["triage"].amount == Decimal("4200.00")
    assert by_tag["triage"].provider == "bedrock"
    assert by_tag[None].amount == Decimal("300.00")  # untagged -> no key -> Unattributed


def test_bedrock_requires_json_credentials():
    from annapurna.providers import BedrockCostClient, ProviderError

    with pytest.raises(ProviderError):
        BedrockCostClient("not-json")


def test_provider_401_raises():
    def handler(_request):
        return httpx.Response(401, json={"error": "bad key"})

    client = AnthropicCostClient("bad", client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(ProviderError) as exc:
        client.fetch_costs(dt.date(2026, 5, 1))
    assert exc.value.status == 401
