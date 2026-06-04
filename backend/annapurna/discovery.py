"""Feature auto-discovery.

Pulls the last 90 days of merged PRs (github.py), clusters them into proposed
features, and persists each as a `feature` (status='proposed') with its evidence
`feature_signal` rows (the PRs and the branch pattern).

Clustering uses Claude when ANTHROPIC_API_KEY is set (per the design doc), and
falls back to a deterministic branch/repo heuristic otherwise — so the connector
path stands alone and tests are free and reproducible.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
from dataclasses import dataclass
from typing import Callable, Optional

from .db import app_dsn, connect, tenant_tx
from .github import GitHubClient, PullRequest

_BRANCH_PREFIXES = (
    "feature/",
    "feat/",
    "fix/",
    "bugfix/",
    "hotfix/",
    "chore/",
    "release/",
    "feature-",
    "feat-",
)
_VALID_CONFIDENCE = {"high", "med", "low"}


@dataclass
class Proposal:
    name: str
    description: str
    confidence: str  # high | med | low
    pr_refs: list[str]
    branch_pattern: Optional[str]
    repos: list[str]


# --------------------------------------------------------------------------
# Heuristic clusterer (deterministic, no external calls)
# --------------------------------------------------------------------------
def _branch_topic(branch: str) -> tuple[str, bool]:
    """Return (topic, matched_known_prefix) for a branch name."""
    if not branch:
        return "", False
    b = branch
    matched = False
    for prefix in _BRANCH_PREFIXES:
        if b.startswith(prefix):
            b = b[len(prefix) :]
            matched = True
            break
    if "/" in b:
        b = b.split("/", 1)[0]
    topic = re.split(r"[-_]", b, maxsplit=1)[0]
    return topic.lower(), matched


def _humanize(token: str) -> str:
    name = token.replace("-", " ").replace("_", " ").strip().title()
    return name or "Unnamed feature"


def heuristic_cluster(prs: list[PullRequest]) -> list[Proposal]:
    groups: dict[tuple[str, str], list[PullRequest]] = {}
    for pr in prs:
        topic, matched = _branch_topic(pr.branch)
        key = ("branch", topic) if matched and topic else ("repo", pr.repo)
        groups.setdefault(key, []).append(pr)

    proposals: list[Proposal] = []
    for (kind, ident), members in sorted(groups.items()):
        branches = [m.branch for m in members]
        repos = sorted({m.repo for m in members})
        if kind == "branch":
            common = os.path.commonprefix(branches)
            pattern = f"{common}*" if len(common) >= 3 else None
            name = _humanize(ident)
            confidence = "high" if len(members) >= 2 else "med"
        else:  # grouped by repo as a fallback — weaker signal
            pattern = None
            name = _humanize(ident.split("/")[-1])
            confidence = "low"
        proposals.append(
            Proposal(
                name=name,
                description=f"Auto-grouped from {len(members)} pull request(s).",
                confidence=confidence,
                pr_refs=[m.ref for m in members],
                branch_pattern=pattern,
                repos=repos,
            )
        )
    return proposals


# --------------------------------------------------------------------------
# Claude clusterer
# --------------------------------------------------------------------------
_CLAUDE_SYSTEM = """You group a software team's merged pull requests into the \
product FEATURES they built. A feature is a unit of shipped product work (e.g. \
"AI threat triage", "Report generator"), not a chore or refactor.

You will receive a JSON array of PRs, each with: ref, title, branch, repo.
Return ONLY a JSON array of features, each an object with:
  - name: short product feature name
  - description: one sentence on what the feature does
  - confidence: "high" | "med" | "low" (how sure you are these PRs are one real feature)
  - pr_refs: array of the PR refs that belong to this feature (use the exact refs given)
  - branch_pattern: a glob like "feature/threat-*" if the branches share a pattern, else null
Every PR ref should appear in exactly one feature. Output JSON only, no prose."""


def claude_cluster(prs: list[PullRequest]) -> list[Proposal]:
    from anthropic import Anthropic  # imported lazily so the dep is optional at runtime

    model = os.environ.get("ANNAPURNA_DISCOVERY_MODEL", "claude-sonnet-4-6")
    payload = [{"ref": p.ref, "title": p.title, "branch": p.branch, "repo": p.repo} for p in prs]
    client = Anthropic()  # reads ANTHROPIC_API_KEY
    message = client.messages.create(
        model=model,
        max_tokens=2000,
        system=_CLAUDE_SYSTEM,
        messages=[{"role": "user", "content": json.dumps(payload)}],
    )
    text = "".join(block.text for block in message.content if block.type == "text")
    return _proposals_from_json(text, prs)


def _proposals_from_json(text: str, prs: list[PullRequest]) -> list[Proposal]:
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        raise ValueError("No JSON array found in discovery response.")
    items = json.loads(match.group(0))

    valid_refs = {p.ref for p in prs}
    repo_by_ref = {p.ref: p.repo for p in prs}
    proposals: list[Proposal] = []
    for item in items:
        refs = [r for r in item.get("pr_refs", []) if r in valid_refs]
        if not refs:
            continue
        confidence = item.get("confidence", "low")
        if confidence not in _VALID_CONFIDENCE:
            confidence = "low"
        proposals.append(
            Proposal(
                name=str(item.get("name") or "Unnamed feature")[:200],
                description=str(item.get("description") or ""),
                confidence=confidence,
                pr_refs=refs,
                branch_pattern=item.get("branch_pattern") or None,
                repos=sorted({repo_by_ref[r] for r in refs}),
            )
        )
    return proposals


# --------------------------------------------------------------------------
# Selection + orchestration
# --------------------------------------------------------------------------
def cluster_prs(prs: list[PullRequest]) -> list[Proposal]:
    """Cluster with Claude when configured; fall back to the heuristic on any issue."""
    if not prs:
        return []
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return heuristic_cluster(prs)
    try:
        proposals = claude_cluster(prs)
        return proposals or heuristic_cluster(prs)
    except Exception:
        # Never let a discovery LLM hiccup break onboarding — degrade to heuristic.
        return heuristic_cluster(prs)


def _make_github_client(token: str) -> GitHubClient:
    # Indirection so tests can inject a fake client.
    return GitHubClient(token)


def run_discovery(tenant_id: str, owner: str, token: str, *, days: int = 90) -> dict:
    """Fetch PRs, cluster them, and persist proposed features. Returns a summary."""
    since = dt.date.today() - dt.timedelta(days=days)
    with _make_github_client(token) as gh:
        prs = gh.fetch_merged_prs(owner, since)
    proposals = cluster_prs(prs)
    author_by_ref = {pr.ref: pr.author for pr in prs}
    _persist_proposals(tenant_id, proposals, author_by_ref)
    return {
        "owner": owner,
        "prs": len(prs),
        "repos": sorted({p.repo for p in prs}),
        "proposals": len(proposals),
    }


def _persist_proposals(
    tenant_id: str, proposals: list[Proposal], author_by_ref: Optional[dict] = None
) -> None:
    author_by_ref = author_by_ref or {}
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        # Re-running discovery regenerates proposals; confirmed features are kept.
        conn.execute("DELETE FROM feature WHERE status = 'proposed'")
        for prop in proposals:
            feature_id = conn.execute(
                """
                INSERT INTO feature (tenant_id, name, description, status, discovery_confidence)
                VALUES (%s, %s, %s, 'proposed', %s)
                RETURNING id
                """,
                (tenant_id, prop.name, prop.description, prop.confidence),
            ).fetchone()[0]
            if prop.branch_pattern:
                _add_signal(
                    conn, tenant_id, feature_id, "branch", prop.branch_pattern, prop.confidence
                )
            for ref in prop.pr_refs:
                # record the PR author so build-cost allocation (M5) can use it
                _add_signal(
                    conn,
                    tenant_id,
                    feature_id,
                    "pr",
                    ref,
                    prop.confidence,
                    actor=author_by_ref.get(ref),
                )


def _add_signal(conn, tenant_id, feature_id, signal_type, external_ref, confidence, actor=None):
    conn.execute(
        """
        INSERT INTO feature_signal (tenant_id, feature_id, signal_type, external_ref,
                                    confidence, source, actor)
        VALUES (%s, %s, %s, %s, %s, 'github', %s)
        """,
        (tenant_id, feature_id, signal_type, external_ref, confidence, actor),
    )


# Type alias documenting the clusterer contract (used in tests for injection).
Clusterer = Callable[[list[PullRequest]], list[Proposal]]
