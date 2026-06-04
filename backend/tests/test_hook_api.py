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
