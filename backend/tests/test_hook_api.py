"""End-to-end API: mint ingest token -> SDK posts events -> reconcile."""

from __future__ import annotations

import pytest
from annapurna.api import create_app
from fastapi.testclient import TestClient

PASSWORD = "correct horse battery"


@pytest.fixture
def client(admin_conn, admin_conninfo, app_conninfo, monkeypatch):
    monkeypatch.setenv("APP_SECRET_KEY", "unit-test-secret-key")
    monkeypatch.setenv("DATABASE_URL", admin_conninfo)
    monkeypatch.setenv("DATABASE_APP_URL", app_conninfo)
    c = TestClient(create_app())
    c.post("/api/auth/signup", json={"email": "cto@acme.com", "password": PASSWORD})
    return c


def test_hook_token_and_event_ingest(client):
    feature = client.post("/api/features", json={"name": "AI threat triage"}).json()
    token = client.post("/api/hook/token").json()["token"]

    # The SDK posts events with the ingest token (no session cookie).
    bad = client.post("/api/hook/events", json={"events": [{"provider": "anthropic"}]})
    assert bad.status_code == 401  # no/!bad token

    resp = client.post(
        "/api/hook/events",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "events": [
                {
                    "provider": "anthropic",
                    "model": "claude-sonnet-4-6",
                    "tokens_in": 100_000_000,
                    "tokens_out": 0,
                    "feature_id": feature["id"],
                }
            ]
        },
    )
    assert resp.status_code == 200
    assert resp.json()["cost"] == 300.0

    detail = client.get(f"/api/features/{feature['id']}/detail").json()
    assert detail["inference_sources"] == ["hook"]

    recon = client.post("/api/inference/reconcile", json={}).json()
    assert any(r["provider"] == "anthropic" and r["attributed"] == 300.0 for r in recon)


def test_hook_ingest_captures_latency_and_customer(client):
    # Regression: the API event model must NOT strip SDK v0.2 fields
    # (latency_ms, metadata.customer_id) before they reach the hook.
    feature = client.post("/api/features", json={"name": "AI threat triage"}).json()
    token = client.post("/api/hook/token").json()["token"]

    def ev(latency, customer):
        return {
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "tokens_in": 1_000_000,
            "tokens_out": 0,
            "feature_id": feature["id"],
            "occurred_at": "2026-06-15T10:00:00Z",
            "latency_ms": latency,
            "metadata": {"customer_id": customer},
        }

    resp = client.post(
        "/api/hook/events",
        headers={"Authorization": f"Bearer {token}"},
        json={"events": [ev(800, "Acme"), ev(1200, "Acme"), ev(400, "Globex")]},
    )
    assert resp.status_code == 200

    # Avg latency across the 3 calls = (800 + 1200 + 400) / 3 = 800 ms.
    detail = client.get(f"/api/features/{feature['id']}/detail?period=2026-06").json()
    assert detail["headline"]["avg_latency_ms"] == 800

    # Per-customer metered spend (anthropic $3/M input): Acme 2M -> $6, Globex 1M -> $3.
    prov = client.get("/api/dashboard/providers?start=2026-06&end=2026-06").json()
    by_customer = {c["customer_id"]: c["amount"] for c in prov["by_customer"]}
    assert by_customer == {"Acme": 6.0, "Globex": 3.0}
