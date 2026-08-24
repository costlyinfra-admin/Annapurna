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
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Callable, Optional

import httpx

from . import build
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
    "refactor/",
    "feature-",
    "feat-",
)
_VALID_CONFIDENCE = {"high", "med", "low"}
_NEEDS_REVIEW = "Needs review"


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
# A capability name is a product NOUN, never a generic verb/adjective or a
# branch-name fragment. These tokens can never become (or dominate) a feature name.
_STOPWORDS = frozenset(
    # conventional-commit types + generic engineering verbs
    """add added adds fix fixes fixed fixing update updated updates updating remove removed
    removes refactor refactored refactoring improve improved improvement improvements implement
    implemented implementing create created creates enable enabled enables disable disabled support
    supported supporting handle handled handling use uses used using run runs running reduce reduced
    reduces prevent prevents avoid avoids ensure ensures allow allows make makes made set sets get
    gets move moved moves rename renamed renames split merge merged merges bump bumps revert reverts
    cleanup clean tidy tweak tweaks adjust adjusts wire wired hook hooks chore docs doc document
    style perf ci cd build builds release releases hotfix bugfix feat feature features test tests
    testing wip draft init initial initialize initialise setup patch patches
    # generic adjectives / prepositions / fillers, plus the caller's explicit junk list
    branch internal local active selected pre per in on of to for and or the a an with without new
    old main master dev develop prod production staging misc various minor major small large quick
    final default current latest first last next better best more less some all any other others
    related from into via when where which that this these those are was were has have had not but
    its our your their them they into out up down off over under again also just only very much many
    change changes changed changing thing things stuff todo temp tmp draft duplicate spawn refire
    propagation""".split()
)

# Known product-capability vocabulary (roots, singular, lowercase). A PR whose title
# mentions one of these is strongly a real feature — steers naming toward domains,
# not stray tokens. Extend freely as domains recur; unknown-but-repeated terms still
# cluster on their own via the co-occurrence rule below.
_KNOWN = frozenset(
    """auth authentication login logout signup signin password credential session token oauth sso
    saml mfa otp rbac permission role invite invitation member membership team org organization
    workspace tenant account profile user admin settings preference notification alert reminder
    email inbox message messaging chat comment thread mention reaction feed timeline post story
    digest report reporting analytics metric dashboard insight chart graph export import download
    upload file document folder attachment preview thumbnail media image video audio call meeting
    calendar schedule event booking reservation task todo ticket issue project milestone board
    card kanban workflow automation pipeline deployment release rollback integration connector
    webhook api sdk cli plugin extension marketplace billing payment invoice subscription plan
    checkout pricing coupon refund wallet transaction search filter sort query index recommendation
    onboarding wizard tour walkthrough setup migration backup restore encryption security audit
    compliance governance policy quota ratelimit throttle cache queue scheduler cron worker job
    agent copilot assistant prompt model inference embedding retrieval knowledge document rag
    vector moderation classification detection triage scoring enrichment sandbox malware phishing
    vulnerability incident threat log logging telemetry tracing monitoring observability alerting
    sharing share collaboration presence cursor comment annotation whiteboard canvas map location
    geolocation aws gcp azure kubernetes docker terraform database postgres redis mcp mcs""".split()
)

# Display casing for acronyms/brands and canonical feature names (keyed by root).
_CANON = {
    "auth": "Authentication",
    "authentication": "Authentication",
    "mfa": "MFA",
    "otp": "OTP",
    "sso": "SSO",
    "saml": "SAML",
    "oauth": "OAuth",
    "rbac": "RBAC",
    "api": "API",
    "sdk": "SDK",
    "cli": "CLI",
    "ui": "UI",
    "ux": "UX",
    "aws": "AWS",
    "gcp": "GCP",
    "azure": "Azure",
    "mcp": "MCP",
    "mcs": "MCS",
    "llm": "LLM",
    "rag": "RAG",
    "notification": "Notifications",
    "session": "Sessions",
    "report": "Reports",
    "integration": "Integrations",
    "permission": "Permissions",
    "setting": "Settings",
    "webhook": "Webhooks",
    "metric": "Metrics",
    "analytic": "Analytics",
}

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9]*")
# Conventional-commit prefix, e.g. "feat(auth): " / "fix!: ".
_CC_RE = re.compile(
    r"^\s*(feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert|hotfix|bugfix)"
    r"(\([^)]*\))?!?:\s*",
    re.IGNORECASE,
)


def _singular(token: str) -> str:
    if len(token) > 3 and token.endswith("ies"):
        return token[:-3] + "y"
    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def _terms(text: str) -> list[str]:
    """Meaningful capability roots from a piece of text — never stopwords/numbers."""
    text = _CC_RE.sub("", text or "")
    out: list[str] = []
    for tok in _WORD_RE.findall(text.lower()):
        if len(tok) < 3 or tok.isdigit() or tok in _STOPWORDS:
            continue
        root = _singular(tok)
        if root in _STOPWORDS:
            continue
        out.append(root)
    return out


def _branch_terms(branch: str) -> list[str]:
    b = branch or ""
    for prefix in _BRANCH_PREFIXES:
        if b.startswith(prefix):
            b = b[len(prefix) :]
            break
    return _terms(b.replace("/", " ").replace("-", " ").replace("_", " "))


def _display(root: str) -> str:
    return _CANON.get(root, root.replace("-", " ").replace("_", " ").title())


def heuristic_cluster(prs: list[PullRequest]) -> list[Proposal]:
    """Group PRs into product capabilities from their TITLE/labels/body (branch is only
    supporting evidence). Weak/ambiguous PRs go to a single "Needs review" bucket rather
    than becoming a junk one-word feature (opt: sharper discovery)."""
    if not prs:
        return []

    # For each PR: a weighted term map, and the set of terms seen in a STRONG source
    # (title/label/body) vs. only the branch.
    per_pr: list[tuple[PullRequest, Counter, set]] = []
    global_weight: Counter = Counter()
    for pr in prs:
        weights: Counter = Counter()
        strong: set = set()
        for term in _terms(pr.title):
            weights[term] += 3
            strong.add(term)
        for label in pr.labels:
            for term in _terms(label):
                weights[term] += 3
                strong.add(term)
        body_head = (pr.body or "").strip().splitlines()[0][:200] if pr.body else ""
        for term in _terms(body_head):
            weights[term] += 2
            strong.add(term)
        for term in _branch_terms(pr.branch):
            weights[term] += 1
        per_pr.append((pr, weights, strong))
        global_weight.update(weights)

    def _best_term(weights: Counter) -> Optional[str]:
        if not weights:
            return None
        # Prefer a KNOWN capability, then this PR's heaviest term, then the term that
        # recurs most across all PRs (so "chat ui" + "chat backend" both pick "chat").
        return max(
            weights,
            key=lambda t: (t in _KNOWN, weights[t], global_weight[t]),
        )

    clusters: dict[str, list[tuple[PullRequest, set]]] = defaultdict(list)
    needs_review: list[PullRequest] = []
    for pr, weights, strong in per_pr:
        term = _best_term(weights)
        if term is None:
            needs_review.append(pr)
        else:
            clusters[term].append((pr, strong))

    proposals: list[Proposal] = []
    for term, members in clusters.items():
        pr_list = [m[0] for m in members]
        strong_count = sum(1 for _pr, strong in members if term in strong)
        known = term in _KNOWN
        # A single PR whose only signal is an UNKNOWN token is too weak to name — it
        # would be a branch-fragment guess. Route it to review instead.
        if not known and len(pr_list) < 2:
            needs_review.extend(pr_list)
            continue
        if len(pr_list) >= 2 and strong_count >= 2:
            confidence = "high"  # multiple PRs, agreeing titles
        elif strong_count >= 1:
            confidence = "med"  # a real title signal, but thin
        else:
            confidence = "low"  # inferred from branch naming only
        proposals.append(
            Proposal(
                name=_display(term),
                description=f"{len(pr_list)} pull request(s) about {_display(term).lower()}.",
                confidence=confidence,
                pr_refs=[p.ref for p in pr_list],
                branch_pattern=_branch_pattern([p.branch for p in pr_list]),
                repos=sorted({p.repo for p in pr_list}),
            )
        )

    if needs_review:
        proposals.append(
            Proposal(
                name=_NEEDS_REVIEW,
                description="Weak signal — please name or split these PRs.",
                confidence="low",
                pr_refs=[p.ref for p in needs_review],
                branch_pattern=None,
                repos=sorted({p.repo for p in needs_review}),
            )
        )

    # High-confidence, larger features first; "Needs review" always last.
    order = {"high": 0, "med": 1, "low": 2}
    proposals.sort(
        key=lambda p: (p.name == _NEEDS_REVIEW, order.get(p.confidence, 3), -len(p.pr_refs))
    )
    return proposals


def _branch_pattern(branches: list[str]) -> Optional[str]:
    named = [b for b in branches if b]
    if len(named) < 2:
        return None
    common = os.path.commonprefix(named)
    return f"{common}*" if len(common) >= 3 else None


# --------------------------------------------------------------------------
# LLM clusterers (Claude, or any OpenAI-compatible endpoint)
# --------------------------------------------------------------------------
_DISCOVERY_SYSTEM = """You group a software team's merged pull requests into the \
product FEATURES they built — the real product capabilities/domains, e.g. \
"Chat", "Notifications", "Authentication", "MFA", "Reports", "AWS Integration", \
"Shareable Sessions". A feature is a unit of shipped product work, NOT a chore, \
refactor, or a stray word from a branch name.

You receive a JSON array of PRs, each with: ref, title, body, branch, labels, repo.

Rules:
- Infer the capability from the PR TITLE first, then body, then labels; the BRANCH
  name is only weak supporting evidence. e.g. "fix/running-session-refire" is about
  session management, so it belongs under "Sessions" — never a feature called
  "Running". "fix/selected-branch-propagation" is NOT a feature called "Selected".
- NEVER output generic tokens as feature names: In, Per, Pre, Using, Selected,
  Running, Reduce, Fix, Feat, Feature, Branch, Internal, Local, Active, or bare
  numbers like 522.
- Cluster related PRs into ONE feature (chat ui + chat backend + chat history ->
  "Chat"). Do NOT over-merge unrelated work that merely shares a word.
- Deduplicate/normalize near-duplicates (MFA / Per-org MFA -> one "MFA";
  Report / Reports / Report Export -> one "Reports") using sensible judgement.
- If you cannot infer a meaningful product capability for some PRs, put them in a
  single feature named exactly "Needs review" with confidence "low" — do NOT invent
  a name from a random token.

Confidence:
- "high": multiple PRs clearly point to the same capability with agreeing titles.
- "med": likely a feature but ambiguous naming or only one strong PR.
- "low": weak signal / inferred mostly from branch naming -> prefer "Needs review".

Return ONLY a JSON array of features, each an object with:
  - name: the product capability name (or "Needs review")
  - description: one sentence on what the feature does
  - confidence: "high" | "med" | "low"
  - pr_refs: the exact PR refs that belong to this feature
  - branch_pattern: a glob like "feature/chat-*" if the branches share one, else null
Every PR ref appears in exactly one feature. Output JSON only, no prose."""


def _pr_payload(prs: list[PullRequest]) -> str:
    return json.dumps(
        [
            {
                "ref": p.ref,
                "title": p.title,
                "body": (p.body or "").strip()[:300],
                "branch": p.branch,
                "labels": p.labels,
                "repo": p.repo,
            }
            for p in prs
        ]
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


def list_repos(owner: str, token: Optional[str]) -> list[str]:
    """Full "owner/name" repositories in the org the token can see (for the selector)."""
    with _make_github_client(token) as gh:
        return sorted(gh.list_repos(owner))


def run_discovery(
    tenant_id: str,
    owner: str,
    token: Optional[str],
    *,
    days: int = 90,
    repos: Optional[list[str]] = None,
) -> dict:
    """Fetch PRs for the SELECTED repos (or the whole org if none given), cluster into
    features, persist them, and remember the repo scope. Returns a summary."""
    since = dt.date.today() - dt.timedelta(days=days)
    selected = [r for r in (repos or []) if r]
    with _make_github_client(token) as gh:
        accessible = gh.list_repos(owner)  # repos the token can actually see
        if selected:
            scope = [r for r in selected if r in accessible]
            prs = gh.fetch_merged_prs(owner, since, repos=scope)
        else:
            scope = accessible  # no selection -> whole org (legacy behavior)
            prs = gh.fetch_merged_prs(owner, since)
    proposals = cluster_prs(prs)
    pr_by_ref = {pr.ref: pr for pr in prs}
    _persist_proposals(tenant_id, proposals, pr_by_ref)
    _save_scope(tenant_id, owner, selected)
    # Regenerating proposals deletes the old ones, and build_cost.feature_id is
    # ON DELETE SET NULL — so previously-attributed build spend would silently fall
    # into Unattributed and stay there. Re-run the PR-authorship allocation over the
    # stored rows against the NEW proposals. Totals are preserved; only attribution
    # moves. (Inference needs no equivalent: every sync re-attributes it.)
    reattributed = build.reattribute(tenant_id)

    per_repo: Counter = Counter(p.repo for p in prs)
    return {
        "owner": owner,
        "prs": len(prs),
        "repos": sorted(scope),  # repos actually analyzed (the selected scope)
        "repos_with_prs": sorted({p.repo for p in prs}),
        "prs_by_repo": dict(per_repo),
        "repos_scanned": len(accessible),  # repos accessible to the token
        "proposals": len(proposals),
        "build_cost_reattributed": reattributed,
    }


def get_scope(tenant_id: str) -> Optional[dict]:
    """The tenant's saved discovery scope (owner + selected repos), or None."""
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        row = conn.execute(
            "SELECT owner, repos FROM discovery_scope WHERE tenant_id = %s", (tenant_id,)
        ).fetchone()
    if row is None:
        return None
    return {"owner": row[0], "repos": list(row[1] or [])}


def _save_scope(tenant_id: str, owner: str, repos: list[str]) -> None:
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        conn.execute(
            """
            INSERT INTO discovery_scope (tenant_id, owner, repos, updated_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (tenant_id) DO UPDATE
            SET owner = EXCLUDED.owner, repos = EXCLUDED.repos, updated_at = now()
            """,
            (tenant_id, owner, json.dumps(repos)),
        )


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
                # record the PR author + stats (build cost attributes per developer)
                # and its title/branch/url (the review UI shows real product context).
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
                    title=getattr(pr, "title", None),
                    branch=getattr(pr, "branch", None),
                    url=getattr(pr, "url", None),
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
    title=None,
    branch=None,
    url=None,
):
    conn.execute(
        """
        INSERT INTO feature_signal (tenant_id, feature_id, signal_type, external_ref,
                                    confidence, source, actor, commits, files_changed,
                                    title, branch, url)
        VALUES (%s, %s, %s, %s, %s, 'github', %s, %s, %s, %s, %s, %s)
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
            title,
            branch,
            url,
        ),
    )


# Type alias documenting the clusterer contract (used in tests for injection).
Clusterer = Callable[[list[PullRequest]], list[Proposal]]
