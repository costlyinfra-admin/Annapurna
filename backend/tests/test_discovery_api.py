"""End-to-end API: connect GitHub -> discover -> edit -> confirm & go live."""

from __future__ import annotations

import pytest
from annapurna import discovery
from annapurna.api import create_app
from annapurna.github import PullRequest
from fastapi.testclient import TestClient

PASSWORD = "correct horse battery"


def _pr(number, repo, title, branch):
    return PullRequest(number, repo, title, "", branch, "dev", "2026-05-01T00:00:00Z", "")


FIXTURE_PRS = [
    _pr(1, "acme/core", "Threat triage automation", "feature/threat-triage"),
    _pr(2, "acme/core", "Threat scoring model", "feature/threat-scoring"),
    _pr(3, "acme/core", "Report generator", "feature/report-gen"),
]


class _FakeGitHub:
    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def list_repos(self, owner):
        return sorted({p.repo for p in FIXTURE_PRS})

    def fetch_merged_prs(self, owner, since, *, repos=None, with_stats=True):
        if repos is not None:
            return [p for p in FIXTURE_PRS if p.repo in set(repos)]
        return FIXTURE_PRS


@pytest.fixture
def client(admin_conn, admin_conninfo, app_conninfo, monkeypatch):
    monkeypatch.setenv("APP_SECRET_KEY", "unit-test-secret-key")
    monkeypatch.setenv("DATABASE_URL", admin_conninfo)
    monkeypatch.setenv("DATABASE_APP_URL", app_conninfo)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)  # heuristic clustering
    monkeypatch.setattr(discovery, "_make_github_client", lambda token: _FakeGitHub())
    c = TestClient(create_app())
    c.post("/api/auth/signup", json={"email": "cto@acme.com", "password": PASSWORD})
    return c


def test_discovery_runs_without_github_credential(client):
    # No token connected -> discovery still runs (public, unauthenticated GitHub).
    resp = client.post("/api/discovery/run", json={"owner": "acme"})
    assert resp.status_code == 200
    assert resp.json()["prs"] == 3


def test_full_discovery_edit_confirm_flow(client):
    # Connect GitHub, then run discovery.
    client.post("/api/connectors/github/credential", json={"secret": "ghp_token"})
    summary = client.post("/api/discovery/run", json={"owner": "acme"}).json()
    assert summary["prs"] == 3
    assert summary["proposals"] >= 2

    proposed = client.get("/api/features", params={"status": "proposed"}).json()
    names = {f["name"] for f in proposed}
    assert "Threat" in names and "Reports" in names
    threat = next(f for f in proposed if f["name"] == "Threat")
    assert any(s["signal_type"] == "pr" for s in threat["signals"])
    assert threat["discovery_confidence"] == "high"

    # Rename one proposal.
    renamed = client.patch(f"/api/features/{threat['id']}", json={"name": "AI threat triage"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "AI threat triage"

    # Add a manual feature.
    manual = client.post("/api/features", json={"name": "Manual feature"})
    assert manual.status_code == 201

    # Merge two proposals.
    report = next(f for f in proposed if f["name"] == "Reports")
    merged = client.post(
        "/api/features/merge",
        json={"feature_ids": [renamed.json()["id"], report["id"]], "name": "Merged feature"},
    )
    assert merged.status_code == 200

    # Confirm & go live.
    confirmed = client.post("/api/onboarding/confirm", json={}).json()
    assert confirmed and all(f["status"] == "confirmed" for f in confirmed)
    assert client.get("/api/features", params={"status": "proposed"}).json() == []


def test_split_via_api(client):
    client.post("/api/connectors/github/credential", json={"secret": "ghp_token"})
    client.post("/api/discovery/run", json={"owner": "acme"})
    proposed = client.get("/api/features", params={"status": "proposed"}).json()
    threat = next(f for f in proposed if f["name"] == "Threat")
    pr_sigs = [s for s in threat["signals"] if s["signal_type"] == "pr"]

    resp = client.post(
        f"/api/features/{threat['id']}/split",
        json={
            "groups": [
                {"name": "Triage", "signal_ids": [pr_sigs[0]["id"]]},
                {"name": "Scoring", "signal_ids": [pr_sigs[1]["id"]]},
            ]
        },
    )
    assert resp.status_code == 200
    assert {f["name"] for f in resp.json()} == {"Triage", "Scoring"}


def test_repos_endpoint_lists_org_repositories(client):
    # The selector fetches the org's repos before running discovery.
    resp = client.get("/api/discovery/repos", params={"owner": "acme"})
    assert resp.status_code == 200
    assert resp.json() == {"owner": "acme", "repos": ["acme/core"]}


def test_scope_is_empty_then_remembers_selection(client):
    # Nothing chosen yet -> empty scope prefill.
    assert client.get("/api/discovery/scope").json() == {"owner": None, "repos": []}

    # Running discovery scoped to a repo persists that selection.
    client.post("/api/discovery/run", json={"owner": "acme", "repos": ["acme/core"]})
    assert client.get("/api/discovery/scope").json() == {
        "owner": "acme",
        "repos": ["acme/core"],
    }


def test_feature_category_endpoint_records_a_user_tag(client):
    feature = client.post("/api/features", json={"name": "Alert digest"}).json()
    assert feature["category"] is None  # nobody has tagged it yet

    tagged = client.put(f"/api/features/{feature['id']}/category", json={"category": "reporting"})
    assert tagged.status_code == 200
    assert tagged.json()["category"] == "reporting"
    assert tagged.json()["category_source"] == "user"

    # Clearing hands it back to whatever discovery guesses next.
    cleared = client.put(f"/api/features/{feature['id']}/category", json={"category": None})
    assert cleared.json()["category"] is None

    # Only the shipped vocabulary is accepted.
    bad = client.put(f"/api/features/{feature['id']}/category", json={"category": "misc"})
    assert bad.status_code == 422
    missing = client.put(
        "/api/features/00000000-0000-0000-0000-000000000000/category",
        json={"category": "ui"},
    )
    assert missing.status_code == 404


def test_feature_categories_endpoint_publishes_the_vocabulary(client):
    # The UI renders the picker from this, so the list is never hardcoded twice.
    body = client.get("/api/features/categories").json()
    values = [c["value"] for c in body["categories"]]
    assert {"chat", "api", "ui", "docs", "auth"} <= set(values)
    assert {"value": "data", "label": "Data/ETL"} in body["categories"]
