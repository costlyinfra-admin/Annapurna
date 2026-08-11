"""End-to-end API: connect provider -> map a key -> ingest -> summary."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest
from annapurna import inference
from annapurna.api import create_app
from annapurna.providers import CostRecord
from fastapi.testclient import TestClient

PASSWORD = "correct horse battery"


class _FakeAnthropic:
    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def fetch_costs(self, period):
        today = dt.date.today()
        return [
            CostRecord("anthropic", today, Decimal("4200"), api_key_ref="key:triage"),
            CostRecord("anthropic", today, Decimal("760"), api_key_ref="key:shared"),
        ]


@pytest.fixture
def client(admin_conn, admin_conninfo, app_conninfo, monkeypatch):
    monkeypatch.setenv("APP_SECRET_KEY", "unit-test-secret-key")
    monkeypatch.setenv("DATABASE_URL", admin_conninfo)
    monkeypatch.setenv("DATABASE_APP_URL", app_conninfo)
    monkeypatch.setattr(inference, "_make_cost_client", lambda provider, key: _FakeAnthropic())
    c = TestClient(create_app())
    c.post("/api/auth/signup", json={"email": "cto@acme.com", "password": PASSWORD})
    return c


class _FakeAnthropicDetailed:
    """A full Anthropic admin client: cost + usage + workspace/key metadata."""

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def fetch_costs(self, period):
        from annapurna.providers import month_start

        start = month_start(period)
        return [CostRecord("anthropic", start, Decimal("1000"), project="ws_mcs")]

    def fetch_usage(self, period):
        from annapurna.providers import UsageRecord

        return [
            UsageRecord("ws_mcs", "k_a", "claude-sonnet-4-6", tokens_in=1_000_000, tokens_out=0),
            UsageRecord("ws_mcs", "k_b", "claude-sonnet-4-6", tokens_in=1_000_000, tokens_out=0),
        ]

    def fetch_workspaces(self):
        return {"ws_mcs": "mcs-dev"}

    def fetch_api_keys(self):
        return {
            "k_a": {"name": "service-a-prod", "workspace_id": "ws_mcs"},
            "k_b": {"name": "experimental", "workspace_id": "ws_mcs"},
        }


def test_anthropic_breakdown_endpoint_reports_prod_vs_unclassified(client, monkeypatch):
    monkeypatch.setattr(
        inference, "_make_cost_client", lambda provider, key: _FakeAnthropicDetailed()
    )
    client.post("/api/connectors/anthropic/credential", json={"secret": "sk-ant-admin"})
    summary = client.post("/api/inference/ingest", json={"provider": "anthropic"}).json()
    assert summary["total"] == 1000.0

    breakdown = client.get("/api/inference/anthropic/breakdown").json()
    # Reconciled to the authoritative bill, split 1:1 between the two keys.
    assert breakdown["total"] == pytest.approx(1000.0, abs=0.01)
    assert breakdown["by_environment"]["production"] == pytest.approx(500.0, abs=0.01)
    assert breakdown["by_environment"]["unclassified"] == pytest.approx(500.0, abs=0.01)
    keys = {k["api_key_name"]: k for k in breakdown["keys"]}
    assert keys["service-a-prod"]["environment"] == "production"
    assert keys["service-a-prod"]["workspace_name"] == "mcs-dev"
    assert keys["experimental"]["environment"] == "unclassified"


class _FakeTogether:
    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def fetch_costs(self, period):
        today = dt.date.today()
        return [
            CostRecord("together", today, Decimal("900"), api_key_ref="key:phishing"),
            CostRecord("together", today, Decimal("120"), api_key_ref="key:misc"),
        ]


def test_ingest_requires_provider_connected(client):
    assert client.post("/api/inference/ingest", json={"provider": "anthropic"}).status_code == 400


def test_hosted_open_source_connector_ingests(client, monkeypatch):
    # A hosted open-source aggregator is a first-class inference connector.
    monkeypatch.setattr(inference, "_make_cost_client", lambda provider, key: _FakeTogether())
    client.post("/api/connectors/together/credential", json={"secret": "tg-admin"})
    feature = client.post("/api/features", json={"name": "Phishing detection"}).json()
    client.post(
        f"/api/features/{feature['id']}/signals",
        json={"signal_type": "api_key", "external_ref": "key:phishing"},
    )

    summary = client.post("/api/inference/ingest", json={"provider": "together"}).json()
    assert summary["attributed"] == 900.0
    assert summary["unattributed"] == 120.0  # unmapped key -> Unattributed

    view = client.get("/api/inference/summary").json()
    assert view["by_provider"]["together"] == 1020.0


class _FakeBedrock:
    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def fetch_costs(self, period):
        today = dt.date.today()
        return [
            CostRecord("bedrock", today, Decimal("4200"), api_key_ref="triage"),  # tag value
            CostRecord("bedrock", today, Decimal("300"), api_key_ref=None),  # untagged
        ]


def test_bedrock_cloud_cost_connector_ingests_by_tag(client, monkeypatch):
    import json

    monkeypatch.setattr(inference, "_make_cost_client", lambda provider, key: _FakeBedrock())
    # AWS creds are stored as one JSON blob.
    client.post(
        "/api/connectors/bedrock/credential",
        json={
            "secret": json.dumps(
                {"access_key_id": "AKIA", "secret_access_key": "s", "tag": "feature"}
            )
        },
    )
    feature = client.post("/api/features", json={"name": "AI threat triage"}).json()
    client.post(
        f"/api/features/{feature['id']}/signals",
        json={"signal_type": "api_key", "external_ref": "triage"},  # map the tag value
    )

    summary = client.post("/api/inference/ingest", json={"provider": "bedrock"}).json()
    assert summary["attributed"] == 4200.0
    assert summary["unattributed"] == 300.0  # untagged Bedrock spend


def test_connect_map_ingest_summary(client):
    # Connect Anthropic + create a feature mapped to one of the API keys.
    client.post("/api/connectors/anthropic/credential", json={"secret": "sk-ant-admin"})
    feature = client.post("/api/features", json={"name": "AI threat triage"}).json()
    mapped = client.post(
        f"/api/features/{feature['id']}/signals",
        json={"signal_type": "api_key", "external_ref": "key:triage"},
    )
    assert mapped.status_code == 200

    summary = client.post("/api/inference/ingest", json={"provider": "anthropic"}).json()
    assert summary["total"] == 4960.0
    assert summary["attributed"] == 4200.0
    assert summary["unattributed"] == 760.0

    view = client.get("/api/inference/summary").json()
    by_name = {f["name"]: f for f in view["features"]}
    assert by_name["AI threat triage"]["amount"] == 4200.0
    assert by_name["AI threat triage"]["confidence"] == "high"
    assert view["unattributed"] == 760.0  # shared key landed in Unattributed
    assert view["by_provider"]["anthropic"] == 4960.0  # matches the provider total
