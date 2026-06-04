"""Read-only GitHub connector.

Fetches merged pull requests (with repo, branch, author) for an owner over a
time window. READ-ONLY: only GET requests are ever issued. The token is the
customer's own personal access token, supplied per tenant (stored encrypted).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Optional

import httpx

from .retrying import http_get_with_retry

GITHUB_API = "https://api.github.com"
_PER_PAGE = 100
_MAX_PAGES_PER_REPO = 10  # safety cap; 90 days of PRs per repo fits comfortably


class GitHubError(Exception):
    """A GitHub API call failed. `status` is the HTTP status when available."""

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


@dataclass
class PullRequest:
    number: int
    repo: str  # "owner/name"
    title: str
    body: str
    branch: str  # head ref
    author: str
    merged_at: str  # ISO-8601
    url: str

    @property
    def ref(self) -> str:
        return f"{self.repo}#{self.number}"


class GitHubClient:
    """Minimal read-only GitHub REST client.

    Pass an ``httpx.Client`` to inject transport (the tests use a MockTransport);
    otherwise one is created and owned by this client.
    """

    def __init__(
        self,
        token: str,
        *,
        client: Optional[httpx.Client] = None,
        base_url: str = GITHUB_API,
    ):
        self._token = token
        self._base = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=20.0)
        self._owns_client = client is None

    def __enter__(self) -> GitHubClient:
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def _get(self, path: str, params: Optional[dict] = None) -> httpx.Response:
        resp = http_get_with_retry(
            self._client,
            f"{self._base}{path}",
            params=params,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        if resp.status_code == 401:
            raise GitHubError("GitHub authentication failed — check the access token.", 401)
        if resp.status_code >= 400:
            raise GitHubError(
                f"GitHub API error {resp.status_code}: {resp.text[:200]}", resp.status_code
            )
        return resp

    def list_repos(self, owner: str) -> list[str]:
        """Return full names ("owner/name") of an org's (or user's) repos."""
        # Try the org endpoint first; fall back to the user endpoint on 404.
        for path in (f"/orgs/{owner}/repos", f"/users/{owner}/repos"):
            try:
                return self._paginate_full_names(path)
            except GitHubError as exc:
                if exc.status == 404:
                    continue
                raise
        raise GitHubError(f"GitHub owner '{owner}' not found.", 404)

    def _paginate_full_names(self, path: str) -> list[str]:
        names: list[str] = []
        page = 1
        while True:
            resp = self._get(path, {"per_page": _PER_PAGE, "page": page, "type": "all"})
            batch = resp.json()
            names.extend(repo["full_name"] for repo in batch)
            if len(batch) < _PER_PAGE:
                return names
            page += 1

    def fetch_merged_prs(self, owner: str, since: dt.date) -> list[PullRequest]:
        """All PRs across the owner's repos merged on/after ``since``."""
        prs: list[PullRequest] = []
        for repo in self.list_repos(owner):
            prs.extend(self._fetch_repo_merged_prs(repo, since))
        return prs

    def _fetch_repo_merged_prs(self, repo: str, since: dt.date) -> list[PullRequest]:
        out: list[PullRequest] = []
        for page in range(1, _MAX_PAGES_PER_REPO + 1):
            resp = self._get(
                f"/repos/{repo}/pulls",
                {
                    "state": "closed",
                    "sort": "updated",
                    "direction": "desc",
                    "per_page": _PER_PAGE,
                    "page": page,
                },
            )
            batch = resp.json()
            if not batch:
                break
            page_all_stale = True
            for pr in batch:
                updated = _parse_date(pr.get("updated_at"))
                if updated and updated >= since:
                    page_all_stale = False
                merged_at = pr.get("merged_at")
                if not merged_at:
                    continue
                if _parse_date(merged_at) < since:
                    continue
                out.append(_to_pull_request(repo, pr))
            # Sorted by updated desc: once an entire page predates the window, stop.
            if page_all_stale:
                break
            if len(batch) < _PER_PAGE:
                break
        return out


def _parse_date(value: Optional[str]) -> Optional[dt.date]:
    if not value:
        return None
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).date()


def _to_pull_request(repo: str, pr: dict) -> PullRequest:
    return PullRequest(
        number=pr["number"],
        repo=repo,
        title=pr.get("title") or "",
        body=pr.get("body") or "",
        branch=(pr.get("head") or {}).get("ref") or "",
        author=(pr.get("user") or {}).get("login") or "",
        merged_at=pr["merged_at"],
        url=pr.get("html_url") or "",
    )
