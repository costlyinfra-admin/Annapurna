"""Discovery: capability-based heuristic clustering, LLM parsing, scope, persistence."""

from __future__ import annotations

import datetime as dt
import json

import pytest
from annapurna import discovery, features
from annapurna.github import PullRequest


def _pr(number, repo, title, branch, *, body="", labels=None, author="dev"):
    return PullRequest(
        number=number,
        repo=repo,
        title=title,
        body=body,
        branch=branch,
        author=author,
        merged_at="2026-05-01T00:00:00Z",
        url=f"https://github.com/{repo}/pull/{number}",
        labels=labels or [],
    )


MCS = "transilienceai/mcs"
MCS_PRS = [
    _pr(201, MCS, "Add notifications system", "feat/notifications", labels=["notifications"]),
    _pr(202, MCS, "Notifications: email digest", "feat/notifications-digest"),
    _pr(203, MCS, "Chat UI polish", "feat/chat-ui"),
    _pr(204, MCS, "Chat backend streaming", "feat/chat-backend"),
    _pr(205, MCS, "Fix running session refire and duplicate spawn", "fix/running-session-refire"),
    _pr(206, MCS, "Selected branch propagation fix", "fix/selected-branch-propagation"),
    _pr(207, MCS, "522", "fix/522"),
]


def test_heuristic_clusters_by_product_capability_not_branch_tokens():
    proposals = discovery.heuristic_cluster(MCS_PRS)
    by_name = {p.name: p for p in proposals}

    # Related PRs roll up into ONE capability, named from the title (not the branch).
    assert "Notifications" in by_name
    assert set(by_name["Notifications"].pr_refs) == {f"{MCS}#201", f"{MCS}#202"}
    assert by_name["Notifications"].confidence == "high"  # two agreeing titles

    assert "Chat" in by_name
    assert set(by_name["Chat"].pr_refs) == {f"{MCS}#203", f"{MCS}#204"}

    # "fix/running-session-refire" -> Sessions, NEVER "Running".
    assert "Sessions" in by_name
    assert f"{MCS}#205" in by_name["Sessions"].pr_refs
    assert "Running" not in by_name


def test_heuristic_never_emits_junk_tokens_and_routes_weak_to_review():
    names = {p.name for p in discovery.heuristic_cluster(MCS_PRS)}
    for junk in ("Running", "Selected", "Branch", "522", "In", "Per", "Fix", "Feature"):
        assert junk not in names
    # "Selected branch propagation" and "522" carry no capability -> Needs review.
    review = next(p for p in discovery.heuristic_cluster(MCS_PRS) if p.name == "Needs review")
    assert {f"{MCS}#206", f"{MCS}#207"} <= set(review.pr_refs)
    assert review.confidence == "low"


def test_confidence_reflects_signal_strength():
    proposals = {p.name: p for p in discovery.heuristic_cluster(MCS_PRS)}
    assert proposals["Notifications"].confidence == "high"  # 2 PRs, strong titles
    assert proposals["Sessions"].confidence == "med"  # 1 strong PR
    assert proposals["Needs review"].confidence == "low"


def test_stopwords_and_acronyms():
    # A single unknown branch fragment is too weak to name -> review, not "Widget".
    prs = [_pr(1, MCS, "Improve the thing", "chore/improve-widget")]
    assert discovery.heuristic_cluster(prs)[0].name == "Needs review"
    # Acronyms get proper casing.
    mfa = discovery.heuristic_cluster([_pr(2, MCS, "Add MFA to login", "feat/mfa")])
    assert mfa[0].name == "MFA"


def test_proposals_from_json_filters_unknown_refs():
    text = f"""Here you go:
    [
      {{"name": "Chat", "description": "d", "confidence": "high",
       "pr_refs": ["{MCS}#203", "{MCS}#999"], "branch_pattern": "feat/chat-*"}},
      {{"name": "Bad", "confidence": "nonsense", "pr_refs": ["{MCS}#205"]}}
    ]"""
    proposals = discovery._proposals_from_json(text, MCS_PRS)
    assert proposals[0].pr_refs == [f"{MCS}#203"]  # unknown ref dropped
    assert proposals[1].confidence == "low"  # invalid confidence normalized


def test_openai_compatible_cluster_sends_body_and_labels(monkeypatch):
    import httpx

    monkeypatch.setenv("ANNAPURNA_DISCOVERY_BASE_URL", "https://api.groq.com/openai/v1")
    monkeypatch.setenv("ANNAPURNA_DISCOVERY_API_KEY", "gsk_free")

    def handler(request: httpx.Request) -> httpx.Response:
        sent = json.loads(request.content)
        # The payload now carries body + labels, not just title/branch.
        user_msg = json.loads(sent["messages"][1]["content"])
        assert "labels" in user_msg[0] and "body" in user_msg[0]
        content = json.dumps(
            [{"name": "Notifications", "confidence": "high", "pr_refs": [f"{MCS}#201"]}]
        )
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    proposals = discovery.openai_compatible_cluster(
        MCS_PRS, client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    assert proposals[0].name == "Notifications"


def test_llm_backend_selection(monkeypatch):
    monkeypatch.delenv("ANNAPURNA_DISCOVERY_BASE_URL", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert discovery._llm_backend() is None
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    assert discovery._llm_backend() is discovery.claude_cluster
    monkeypatch.setenv("ANNAPURNA_DISCOVERY_BASE_URL", "http://localhost:11434/v1")
    assert discovery._llm_backend() is discovery.openai_compatible_cluster


class _FakeGitHub:
    """Fake with repos across two orgs/repos to exercise scope filtering."""

    def __init__(self, prs, repos=None):
        self._prs = prs
        self._repos = repos or sorted({p.repo for p in prs})

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def list_repos(self, owner):
        target = owner.lower()
        return [r for r in self._repos if r.split("/", 1)[0].lower() == target]

    def fetch_merged_prs(self, owner, since, *, repos=None, with_stats=True):
        if repos:
            allowed = set(repos)
            return [p for p in self._prs if p.repo in allowed]
        target = owner.lower()
        return [p for p in self._prs if p.repo.split("/", 1)[0].lower() == target]


def test_run_discovery_scopes_to_selected_repos_and_persists(tenant_id, monkeypatch):
    # Two repos in the org; only "mcs" is selected — "docs" PRs must be excluded.
    prs = MCS_PRS + [_pr(9, "transilienceai/docs", "Fix typos", "fix/typos")]
    repos = ["transilienceai/mcs", "transilienceai/docs"]
    monkeypatch.setattr(discovery, "_make_github_client", lambda token: _FakeGitHub(prs, repos))

    summary = discovery.run_discovery(
        tenant_id, "transilienceai", "tok", repos=["transilienceai/mcs"]
    )
    assert summary["repos"] == ["transilienceai/mcs"]  # only the selected repo analyzed
    assert summary["prs"] == len(MCS_PRS)  # the docs PR was not fetched

    proposed = features.list_features(tenant_id, status="proposed")
    all_refs = {
        s["external_ref"] for f in proposed for s in f["signals"] if s["signal_type"] == "pr"
    }
    assert all(ref.startswith("transilienceai/mcs#") for ref in all_refs)

    # PR detail (title/branch/url) is persisted on the signal for the review UI.
    notif = next(f for f in proposed if f["name"] == "Notifications")
    pr = next(s for s in notif["signals"] if s["signal_type"] == "pr")
    assert pr["title"] and pr["branch"] and pr["url"]

    # Scope is remembered for the next run.
    scope = discovery.get_scope(tenant_id)
    assert scope == {"owner": "transilienceai", "repos": ["transilienceai/mcs"]}


def test_rerun_replaces_proposals_but_keeps_confirmed(tenant_id, monkeypatch):
    monkeypatch.setattr(discovery, "_make_github_client", lambda token: _FakeGitHub(MCS_PRS))
    discovery.run_discovery(tenant_id, "transilienceai", "tok")
    features.confirm_features(tenant_id)
    monkeypatch.setattr(discovery, "_make_github_client", lambda token: _FakeGitHub([MCS_PRS[0]]))
    discovery.run_discovery(tenant_id, "transilienceai", "tok")

    confirmed = features.list_features(tenant_id, status="confirmed")
    proposed = features.list_features(tenant_id, status="proposed")
    assert len(confirmed) >= 2  # earlier confirmations survive
    assert len(proposed) == 1  # regenerated from the smaller re-run


def test_rerun_keeps_proposed_feature_ids_stable(tenant_id, monkeypatch):
    """Re-running discovery must REUSE proposed features, not recreate them.

    Ids used to churn on every run, so bookmarked /features/<id> links broke,
    feature-scoped alerts detached, and cost rows were orphaned (feature_id is
    ON DELETE SET NULL). Matching by branch pattern / name keeps them stable.
    """
    monkeypatch.setattr(discovery, "_make_github_client", lambda token: _FakeGitHub(MCS_PRS))
    discovery.run_discovery(tenant_id, "transilienceai", "tok")
    first = {f["name"]: f["id"] for f in features.list_features(tenant_id, status="proposed")}
    assert first

    discovery.run_discovery(tenant_id, "transilienceai", "tok")  # identical re-run
    second = {f["name"]: f["id"] for f in features.list_features(tenant_id, status="proposed")}

    assert second == first  # same features, SAME ids


def test_rerun_updates_in_place_without_duplicating_signals(tenant_id, monkeypatch):
    monkeypatch.setattr(discovery, "_make_github_client", lambda token: _FakeGitHub(MCS_PRS))
    discovery.run_discovery(tenant_id, "transilienceai", "tok")
    before = features.list_features(tenant_id, status="proposed")
    discovery.run_discovery(tenant_id, "transilienceai", "tok")
    after = features.list_features(tenant_id, status="proposed")

    # Same count, and each feature's signals are regenerated — never doubled up.
    assert len(after) == len(before)
    by_name = {f["name"]: f for f in after}
    for f in before:
        assert len(by_name[f["name"]]["signals"]) == len(f["signals"])


def test_rerun_drops_proposals_that_left_the_window(tenant_id, monkeypatch):
    monkeypatch.setattr(discovery, "_make_github_client", lambda token: _FakeGitHub(MCS_PRS))
    discovery.run_discovery(tenant_id, "transilienceai", "tok")
    kept_id = {f["name"]: f["id"] for f in features.list_features(tenant_id, status="proposed")}

    # A narrower window yields only the first PR's cluster.
    monkeypatch.setattr(discovery, "_make_github_client", lambda token: _FakeGitHub([MCS_PRS[0]]))
    discovery.run_discovery(tenant_id, "transilienceai", "tok")
    proposed = features.list_features(tenant_id, status="proposed")

    assert len(proposed) == 1  # the vanished proposals are gone
    # ...and the surviving one kept its original id rather than being recreated.
    survivor = proposed[0]
    assert survivor["id"] == kept_id[survivor["name"]]


def test_rerun_keeps_build_cost_attached_to_the_same_feature(tenant_id, monkeypatch):
    """The end-to-end payoff: attributed build cost survives a re-analysis intact."""
    from decimal import Decimal

    from annapurna import build
    from annapurna.build import DeveloperSpend
    from annapurna.db import app_dsn, connect, tenant_tx

    monkeypatch.setattr(discovery, "_make_github_client", lambda token: _FakeGitHub(MCS_PRS))
    discovery.run_discovery(tenant_id, "transilienceai", "tok")

    author = MCS_PRS[0].author
    build.allocate_and_store(
        tenant_id, [DeveloperSpend(author, "cursor", Decimal("120"))], dt.date(2026, 5, 1)
    )

    def attribution():
        with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
            return {
                (str(f) if f else None): float(a)
                for f, a in conn.execute(
                    "SELECT feature_id, SUM(amount) FROM build_cost GROUP BY feature_id"
                ).fetchall()
            }

    before = attribution()
    assert None not in before  # every dollar attributed to a feature
    assert round(sum(before.values()), 2) == 120.0

    discovery.run_discovery(tenant_id, "transilienceai", "tok")  # the action that broke it

    after = attribution()
    assert after == before  # same feature ids, same dollars — nothing orphaned


@pytest.mark.parametrize(
    "title,branch,expected",
    [
        ("Add LLM-powered alert summaries", "feature/llm-summary", "ai"),
        ("Wire up Claude for triage", "feature/triage", "ai"),
        ("Embeddings index for semantic search", "feature/search", "ai"),
        ("Cache the system prompt between calls", "feature/prompt-cache", "ai"),
        # Ordinary engineering — no AI vocabulary anywhere.
        ("Add SAML single sign-on", "feature/sso", "non_ai"),
        ("Fix pagination on the invoice list", "feature/invoices", "non_ai"),
        # Words AI shares with ordinary software must NOT trigger a false positive:
        # a false "AI" label silently moves normal work onto the AI bill.
        ("Refactor the User model", "feature/user-model", "non_ai"),
        ("Rotate the auth token on refresh", "feature/token-rotate", "non_ai"),
        ("Parse the user agent string", "feature/user-agent", "non_ai"),
        ("Train new staff on the runbook", "chore/runbook", "non_ai"),
    ],
)
def test_ai_kind_reads_pr_evidence(title, branch, expected):
    assert discovery._ai_kind([_pr(1, "acme/core", title, branch)]) == expected


def test_ai_kind_reads_labels_and_body_too():
    pr = _pr(
        2,
        "acme/core",
        "Summaries for the incident feed",
        "feature/incident-feed",
        body="Uses the Anthropic API to condense the timeline.",
        labels=["backend"],
    )
    assert discovery._ai_kind([pr]) == "ai"
