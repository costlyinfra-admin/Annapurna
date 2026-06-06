"""Discovery: heuristic clustering, Claude-JSON parsing, and persistence."""

from __future__ import annotations

import json

from annapurna import discovery, features
from annapurna.github import PullRequest


def _pr(number, repo, branch, author="dev"):
    return PullRequest(
        number=number,
        repo=repo,
        title=f"PR {number}",
        body="",
        branch=branch,
        author=author,
        merged_at="2026-05-01T00:00:00Z",
        url=f"https://github.com/{repo}/pull/{number}",
    )


FIXTURE_PRS = [
    _pr(1, "acme/core", "feature/threat-triage"),
    _pr(2, "acme/core", "feature/threat-scoring"),
    _pr(3, "acme/core", "feature/report-gen"),
    _pr(4, "acme/infra", "main"),  # no feature prefix -> repo fallback
]


def test_heuristic_groups_by_branch_topic():
    proposals = discovery.heuristic_cluster(FIXTURE_PRS)
    by_name = {p.name: p for p in proposals}

    # threat-triage + threat-scoring cluster into one high-confidence feature.
    assert "Threat" in by_name
    threat = by_name["Threat"]
    assert threat.confidence == "high"
    assert set(threat.pr_refs) == {"acme/core#1", "acme/core#2"}
    assert threat.branch_pattern == "feature/threat-*"

    # single PR -> medium confidence.
    assert by_name["Report"].confidence == "med"

    # branch with no recognizable prefix falls back to a low-confidence repo group.
    assert any(p.confidence == "low" for p in proposals)


def test_proposals_from_json_filters_unknown_refs():
    text = """Here you go:
    [
      {"name": "Threat triage", "description": "d", "confidence": "high",
       "pr_refs": ["acme/core#1", "acme/core#999"], "branch_pattern": "feature/threat-*"},
      {"name": "Bad", "confidence": "nonsense", "pr_refs": ["acme/core#3"]}
    ]"""
    proposals = discovery._proposals_from_json(text, FIXTURE_PRS)
    assert proposals[0].pr_refs == ["acme/core#1"]  # unknown ref dropped
    assert proposals[1].confidence == "low"  # invalid confidence normalized


def test_openai_compatible_cluster_parses(monkeypatch):
    import httpx

    monkeypatch.setenv("ANNAPURNA_DISCOVERY_BASE_URL", "https://api.groq.com/openai/v1")
    monkeypatch.setenv("ANNAPURNA_DISCOVERY_API_KEY", "gsk_free")
    monkeypatch.setenv("ANNAPURNA_DISCOVERY_MODEL", "llama-3.3-70b-versatile")

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url).endswith("/chat/completions")
        assert request.headers["Authorization"] == "Bearer gsk_free"
        sent = json.loads(request.content)
        assert sent["model"] == "llama-3.3-70b-versatile"
        content = json.dumps(
            [
                {
                    "name": "Threat triage",
                    "description": "Classifies alerts.",
                    "confidence": "high",
                    "pr_refs": ["acme/core#1", "acme/core#2"],
                    "branch_pattern": "feature/threat-*",
                }
            ]
        )
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    proposals = discovery.openai_compatible_cluster(
        FIXTURE_PRS, client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    assert proposals[0].name == "Threat triage"
    assert set(proposals[0].pr_refs) == {"acme/core#1", "acme/core#2"}


def test_llm_backend_selection(monkeypatch):
    monkeypatch.delenv("ANNAPURNA_DISCOVERY_BASE_URL", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert discovery._llm_backend() is None  # nothing configured -> heuristic

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    assert discovery._llm_backend() is discovery.claude_cluster

    # An explicit OpenAI-compatible endpoint (free model) takes precedence.
    monkeypatch.setenv("ANNAPURNA_DISCOVERY_BASE_URL", "http://localhost:11434/v1")
    assert discovery._llm_backend() is discovery.openai_compatible_cluster


class _FakeGitHub:
    def __init__(self, prs):
        self._prs = prs

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def fetch_merged_prs(self, owner, since):
        return self._prs


def test_run_discovery_persists_proposed_features(tenant_id, monkeypatch):
    monkeypatch.setattr(discovery, "_make_github_client", lambda token: _FakeGitHub(FIXTURE_PRS))

    summary = discovery.run_discovery(tenant_id, "acme", "fake-token")
    assert summary["prs"] == 4
    assert summary["proposals"] >= 2
    assert set(summary["repos"]) == {"acme/core", "acme/infra"}

    proposed = features.list_features(tenant_id, status="proposed")
    assert len(proposed) == summary["proposals"]

    threat = next(f for f in proposed if f["name"] == "Threat")
    assert threat["discovery_confidence"] == "high"
    pr_signals = [s for s in threat["signals"] if s["signal_type"] == "pr"]
    branch_signals = [s for s in threat["signals"] if s["signal_type"] == "branch"]
    assert {s["external_ref"] for s in pr_signals} == {"acme/core#1", "acme/core#2"}
    assert branch_signals[0]["external_ref"] == "feature/threat-*"


def test_rerun_discovery_replaces_proposals_but_keeps_confirmed(tenant_id, monkeypatch):
    monkeypatch.setattr(discovery, "_make_github_client", lambda token: _FakeGitHub(FIXTURE_PRS))
    discovery.run_discovery(tenant_id, "acme", "tok")
    # confirm everything, then re-run discovery with fewer PRs
    features.confirm_features(tenant_id)
    monkeypatch.setattr(
        discovery, "_make_github_client", lambda token: _FakeGitHub([FIXTURE_PRS[0]])
    )
    discovery.run_discovery(tenant_id, "acme", "tok")

    confirmed = features.list_features(tenant_id, status="confirmed")
    proposed = features.list_features(tenant_id, status="proposed")
    assert len(confirmed) >= 2  # earlier confirmations survive
    assert len(proposed) == 1  # proposals were regenerated from the new run
