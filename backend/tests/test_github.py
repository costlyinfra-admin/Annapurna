"""Tests for the read-only GitHub client, using httpx.MockTransport (no network)."""

from __future__ import annotations

import datetime as dt

import httpx
import pytest
from annapurna.github import GitHubClient, GitHubError

NOW = dt.datetime.now(dt.timezone.utc)


def _iso(days_ago: int) -> str:
    return (NOW - dt.timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")


def _pr(number, branch, user, merged_days_ago, merged=True):
    return {
        "number": number,
        "title": f"PR {number}",
        "body": "body",
        "head": {"ref": branch},
        "user": {"login": user},
        "merged_at": _iso(merged_days_ago) if merged else None,
        "updated_at": _iso(merged_days_ago),
        "html_url": f"https://github.com/testorg/x/pull/{number}",
    }


REPOS = {
    "testorg/core": [
        _pr(1, "feature/threat-triage", "alice", 5),
        _pr(2, "hotfix/old", "alice", 200),  # too old
        _pr(3, "feature/wip", "bob", 1, merged=False),  # not merged
        _pr(4, "feature/threat-scoring", "bob", 10),
    ],
    "testorg/web": [
        _pr(10, "feature/report-gen", "carol", 3),
    ],
}


def _handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    page = int(request.url.params.get("page", "1"))
    if path == "/orgs/testorg/repos":
        if page > 1:
            return httpx.Response(200, json=[])
        return httpx.Response(200, json=[{"full_name": name} for name in REPOS])
    if path.startswith("/repos/") and path.endswith("/pulls"):
        repo = path[len("/repos/") : -len("/pulls")]
        return httpx.Response(200, json=REPOS.get(repo, []) if page == 1 else [])
    return httpx.Response(404, json={"message": "not found"})


def _client(handler=_handler) -> GitHubClient:
    return GitHubClient("token", client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_fetch_merged_prs_filters_and_parses():
    since = (NOW - dt.timedelta(days=90)).date()
    prs = _client().fetch_merged_prs("testorg", since)

    refs = {pr.ref for pr in prs}
    assert refs == {"testorg/core#1", "testorg/core#4", "testorg/web#10"}

    by_ref = {pr.ref: pr for pr in prs}
    assert by_ref["testorg/core#1"].branch == "feature/threat-triage"
    assert by_ref["testorg/core#1"].author == "alice"
    assert by_ref["testorg/web#10"].repo == "testorg/web"


def test_falls_back_to_user_endpoint_when_org_missing():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/orgs/someuser/repos":
            return httpx.Response(404, json={"message": "Not Found"})
        if path == "/users/someuser/repos":
            return httpx.Response(200, json=[{"full_name": "someuser/proj"}])
        if path == "/repos/someuser/proj/pulls" and request.url.params.get("page", "1") == "1":
            return httpx.Response(200, json=[_pr(7, "feature/x", "dev", 2)])
        return httpx.Response(200, json=[])

    since = (NOW - dt.timedelta(days=90)).date()
    prs = _client(handler).fetch_merged_prs("someuser", since)
    assert [pr.ref for pr in prs] == ["someuser/proj#7"]


def test_lists_private_repos_via_authenticated_endpoint():
    # A private repo whose org/user public endpoints 404, but the token sees it
    # via /user/repos. Owner is matched case-insensitively.
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        page = int(request.url.params.get("page", "1"))
        if path == "/user/repos":
            repos = [{"full_name": "Cloudoku-training/cloudoku-training"}] if page == 1 else []
            return httpx.Response(200, json=repos)
        if path == "/repos/Cloudoku-training/cloudoku-training/pulls":
            return httpx.Response(
                200, json=[_pr(5, "feature/lesson-plan", "dev", 4)] if page == 1 else []
            )
        return httpx.Response(404, json={"message": "Not Found"})

    since = (NOW - dt.timedelta(days=90)).date()
    prs = _client(handler).fetch_merged_prs("cloudoku-training", since)  # different case
    assert [pr.ref for pr in prs] == ["Cloudoku-training/cloudoku-training#5"]


def test_auth_error_raised_on_401():
    def handler(_request):
        return httpx.Response(401, json={"message": "Bad credentials"})

    with pytest.raises(GitHubError) as exc:
        _client(handler).fetch_merged_prs("testorg", (NOW - dt.timedelta(days=90)).date())
    assert exc.value.status == 401


def test_fetch_pr_stats_from_detail_endpoint():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        page = int(request.url.params.get("page", "1"))
        if path == "/orgs/testorg/repos":
            return httpx.Response(200, json=[{"full_name": "testorg/core"}] if page == 1 else [])
        if path == "/repos/testorg/core/pulls/1":  # PR detail (check before the list path)
            return httpx.Response(200, json={"commits": 9, "changed_files": 21})
        if path == "/repos/testorg/core/pulls":
            return httpx.Response(200, json=[_pr(1, "feature/x", "alice", 5)] if page == 1 else [])
        return httpx.Response(200, json=[])

    since = (NOW - dt.timedelta(days=90)).date()
    prs = _client(handler).fetch_merged_prs("testorg", since)
    assert prs[0].commits == 9
    assert prs[0].changed_files == 21

    # with_stats=False skips the detail call -> stats stay None.
    no_stats = _client(handler).fetch_merged_prs("testorg", since, with_stats=False)
    assert no_stats[0].commits is None
