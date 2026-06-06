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

import httpx

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
# LLM clusterers (Claude, or any OpenAI-compatible endpoint)
# --------------------------------------------------------------------------
_DISCOVERY_SYSTEM = """You group a software team's merged pull requests into the \
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


def _pr_payload(prs: list[PullRequest]) -> str:
    return json.dumps(
        [{"ref": p.ref, "title": p.title, "branch": p.branch, "repo": p.repo} for p in prs]
    )


def claude_cluster(prs: list[PullRequest]) -> list[Proposal]:
    from anthropic import Anthropic  # imported lazily so the dep is optional at runtime

    model = os.environ.get("ANNAPURNA_DISCOVERY_MODEL", "claude-sonnet-4-6")
    client = Anthropic()  # reads ANTHROPIC_API_KEY
    message = client.messages.create(
        model=model,
        max_tokens=2000,
        system=_DISCOVERY_SYSTEM,
        messages=[{"role": "user", "content": _pr_payload(prs)}],
    )
    text = "".join(block.text for block in message.content if block.type == "text")
    return _proposals_from_json(text, prs)


def openai_compatible_cluster(
    prs: list[PullRequest], *, client: Optional[httpx.Client] = None
) -> list[Proposal]:
    """Cluster via any OpenAI-compatible /chat/completions endpoint.

    Lets discovery run on a FREE model — Groq's free tier, a local Ollama, an
    OpenRouter ``:free`` model, etc. — configured by env:
        ANNAPURNA_DISCOVERY_BASE_URL  e.g. https://api.groq.com/openai/v1
        ANNAPURNA_DISCOVERY_API_KEY   the provider key ("ollama" for local Ollama)
        ANNAPURNA_DISCOVERY_MODEL     e.g. llama-3.3-70b-versatile
    Only PR metadata (ref/title/branch/repo) is sent — never source code.
    """
    base = os.environ["ANNAPURNA_DISCOVERY_BASE_URL"].rstrip("/")
    api_key = os.environ.get("ANNAPURNA_DISCOVERY_API_KEY", "")
    model = os.environ.get("ANNAPURNA_DISCOVERY_MODEL", "llama-3.3-70b-versatile")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    body = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": _DISCOVERY_SYSTEM},
            {"role": "user", "content": _pr_payload(prs)},
        ],
    }
    owns = client is None
    client = client or httpx.Client(timeout=60.0)
    try:
        resp = client.post(f"{base}/chat/completions", json=body, headers=headers)
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"]
    finally:
        if owns:
            client.close()
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
def _llm_backend() -> Optional[Callable[[list[PullRequest]], list[Proposal]]]:
    """Pick the configured LLM clusterer, if any.

    An explicit OpenAI-compatible endpoint (free models: Groq, Ollama, OpenRouter)
    takes precedence; then Anthropic; otherwise None -> the heuristic.
    """
    if os.environ.get("ANNAPURNA_DISCOVERY_BASE_URL"):
        return openai_compatible_cluster
    if os.environ.get("ANTHROPIC_API_KEY"):
        return claude_cluster
    return None


def cluster_prs(prs: list[PullRequest]) -> list[Proposal]:
    """Cluster with the configured LLM; fall back to the heuristic on any issue."""
    if not prs:
        return []
    backend = _llm_backend()
    if backend is None:
        return heuristic_cluster(prs)
    try:
        proposals = backend(prs)
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
    pr_by_ref = {pr.ref: pr for pr in prs}
    _persist_proposals(tenant_id, proposals, pr_by_ref)
    return {
        "owner": owner,
        "prs": len(prs),
        "repos": sorted({p.repo for p in prs}),
        "proposals": len(proposals),
    }


def _persist_proposals(
    tenant_id: str, proposals: list[Proposal], pr_by_ref: Optional[dict] = None
) -> None:
    pr_by_ref = pr_by_ref or {}
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
                # record the PR author + stats so build cost attributes per developer
                pr = pr_by_ref.get(ref)
                _add_signal(
                    conn,
                    tenant_id,
                    feature_id,
                    "pr",
                    ref,
                    prop.confidence,
                    actor=getattr(pr, "author", None),
                    commits=getattr(pr, "commits", None),
                    files_changed=getattr(pr, "changed_files", None),
                )


def _add_signal(
    conn,
    tenant_id,
    feature_id,
    signal_type,
    external_ref,
    confidence,
    actor=None,
    commits=None,
    files_changed=None,
):
    conn.execute(
        """
        INSERT INTO feature_signal (tenant_id, feature_id, signal_type, external_ref,
                                    confidence, source, actor, commits, files_changed)
        VALUES (%s, %s, %s, %s, %s, 'github', %s, %s, %s)
        """,
        (
            tenant_id,
            feature_id,
            signal_type,
            external_ref,
            confidence,
            actor,
            commits,
            files_changed,
        ),
    )


# Type alias documenting the clusterer contract (used in tests for injection).
Clusterer = Callable[[list[PullRequest]], list[Proposal]]
