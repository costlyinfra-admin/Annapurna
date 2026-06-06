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
