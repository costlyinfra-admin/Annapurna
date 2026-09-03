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
    #: 'ai' | 'non_ai' — a keyword read of the PR evidence, never a certainty.
    ai_kind: str = "non_ai"
    #: Product surface (chat/api/ui/...), or None when the evidence doesn't say.
    category: Optional[str] = None


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
                ai_kind=_ai_kind(pr_list),
                category=_category(pr_list),
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
                ai_kind=_ai_kind(needs_review),
                category=_category(needs_review),
            )
        )

    # High-confidence, larger features first; "Needs review" always last.
    order = {"high": 0, "med": 1, "low": 2}
    proposals.sort(
        key=lambda p: (p.name == _NEEDS_REVIEW, order.get(p.confidence, 3), -len(p.pr_refs))
    )
    return proposals


# --------------------------------------------------------------------------
# AI / non-AI classification (heuristic, deterministic)
# --------------------------------------------------------------------------
# Most repositories contain a mix: some features call models, most don't. What
# discovery can honestly do is read the PR evidence for unambiguous AI vocabulary
# — provider and model names, the machinery of prompting and retrieval. It cannot
# tell whether a feature calls a model at RUNTIME; only inference cost proves
# that, and that check happens at read time (dashboard.resolve_ai_kind).
#
# So the terms below are deliberately narrow: each one is meaningless outside an
# AI context. Broad words that AI shares with ordinary software — "model" (MVC),
# "agent" (user agent), "token" (auth token), "train", "vision", "generate" —
# are excluded on purpose, because a false "AI" label is worse than an absent
# one: it silently attributes ordinary engineering to the AI bill.
_AI_TERMS = frozenset(
    """llm llms gpt chatgpt claude anthropic openai gemini bedrock mistral llama
    embedding embeddings rag prompt prompts prompting inference completion completions
    chatbot copilot genai generative summarization summarisation vectordb pinecone
    weaviate langchain llamaindex finetune finetuning transformer huggingface
    tokenizer hallucination sonnet haiku opus""".split()
)

#: Multi-word phrases worth matching whole ("ai" alone is far too noisy — it hits
#: "said", "detail", "chain" as a substring and "AI" as an initialism elsewhere).
_AI_PHRASES = (
    "ai-powered",
    "ai powered",
    "ai assistant",
    "ai-assistant",
    "machine learning",
    "language model",
    "large language",
    "vector store",
    "vector search",
    "semantic search",
    "retrieval augmented",
    "retrieval-augmented",
    "fine-tune",
    "fine-tuning",
    "model call",
    "system prompt",
)

_WORD_RE = re.compile(r"[a-z0-9]+")


def _evidence_text(prs: list) -> str:
    """All the words a cluster of PRs gives us, lowercased — titles, branches,
    labels, and the first part of each body (the rest is usually template)."""
    return " ".join(
        str(part or "").lower()
        for pr in prs
        for part in (
            getattr(pr, "title", ""),
            getattr(pr, "branch", ""),
            getattr(pr, "body", "")[:2000],
            " ".join(getattr(pr, "labels", []) or []),
        )
    )


def _ai_kind(prs: list) -> str:
    """'ai' when the PR evidence names AI machinery outright, else 'non_ai'.

    Absence of AI vocabulary is weak evidence, which is why a 'non_ai' verdict is
    always presented as changeable rather than as a finding.
    """
    haystack = _evidence_text(prs)
    if any(phrase in haystack for phrase in _AI_PHRASES):
        return "ai"
    return "ai" if _AI_TERMS & set(_WORD_RE.findall(haystack)) else "non_ai"


# --------------------------------------------------------------------------
# Product category (heuristic, deterministic)
# --------------------------------------------------------------------------
# What KIND of thing is this feature — which surface of the product does it live
# on? Unlike AI-ness there is no billing fact to fall back on, so this is a guess
# from PR vocabulary and nothing more; the user's tag always wins.
#
# Ordered, first match wins, because a PR can legitimately mention several: an
# "SSO login screen" is Auth before it is UI, and a "chat API endpoint" is Chat
# before it is API. The order below encodes that specificity, most specific first.
#: (category, terms) — terms are whole words, matched against titles, branches,
#: bodies and labels.
_CATEGORY_RULES: tuple = (
    (
        "chat",
        """chat chatbot conversation conversational assistant copilot message messaging
        thread reply prompt agent""".split(),
    ),
    (
        "auth",
        """auth authentication authorization sso saml oauth oidc scim login logout signin
        signup session password mfa 2fa rbac permission permissions role roles tenant
        identity""".split(),
    ),
    (
        "reporting",
        """report reports reporting dashboard dashboards invoice invoices billing export
        exports csv analytics chart charts metric metrics kpi""".split(),
    ),
    (
        "integration",
        """integration integrations connector connectors webhook webhooks sync oauth-app
        salesforce slack jira zendesk hubspot stripe third-party partner""".split(),
    ),
    (
        "data",
        """etl pipeline pipelines ingest ingestion warehouse migration migrations backfill
        schema index indexing query queries database dataset transform""".split(),
    ),
    (
        "infra",
        """ci cd deploy deployment docker kubernetes k8s terraform helm infra
        infrastructure observability logging tracing monitoring alerting runbook
        pipeline-config build-system""".split(),
    ),
    (
        "docs",
        """docs doc documentation readme changelog guide guides tutorial help onboarding
        summary summaries summarize summarise digest""".split(),
    ),
    (
        "api",
        """api apis endpoint endpoints rest graphql grpc route routes handler sdk client
        openapi swagger versioning ratelimit""".split(),
    ),
    (
        "ui",
        """ui ux frontend front-end component components page pages screen screens view
        views css styling layout modal button form table nav navigation responsive
        accessibility a11y""".split(),
    ),
)

#: Every category, in the order the UI offers them.
CATEGORIES = tuple(c for c, _ in _CATEGORY_RULES)

#: Human labels, shared with the frontend through the meta endpoint.
CATEGORY_LABELS = {
    "chat": "Chat",
    "api": "API",
    "ui": "UI",
    "docs": "Docs",
    "data": "Data/ETL",
    "auth": "Auth",
    "reporting": "Reporting",
    "integration": "Integration",
    "infra": "Infra",
}


def _category(prs: list) -> Optional[str]:
    """Best guess at a feature's product surface, or None when nothing matches.

    None is a real answer: "the PR titles don't say" is more useful than a
    confident wrong tag, because the user is the one who will correct it.
    """
    words = set(_WORD_RE.findall(_evidence_text(prs)))
    if not words:
        return None
    for category, terms in _CATEGORY_RULES:
        if words & set(terms):
            return category
    return None


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
    pr_by_ref = {p.ref: p for p in prs}
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
                ai_kind=_ai_kind([pr_by_ref[r] for r in refs]),
                category=_category([pr_by_ref[r] for r in refs]),
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


def _match_existing(conn) -> tuple[dict, dict, set]:
    """Index the tenant's existing PROPOSED features so a re-run can reuse them.

    Returns (by_branch_pattern, by_lowercased_name, all_ids). The branch pattern is
    the more stable identity — cluster names can drift slightly between runs while
    the branch convention stays put — so callers try it first.
    """
    rows = conn.execute(
        """
        SELECT f.id, f.name,
               (SELECT fs.external_ref FROM feature_signal fs
                WHERE fs.feature_id = f.id AND fs.signal_type = 'branch' LIMIT 1)
        FROM feature f
        WHERE f.status = 'proposed'
        """
    ).fetchall()
    by_branch: dict[str, str] = {}
    by_name: dict[str, str] = {}
    ids: set = set()
    for fid, name, branch in rows:
        ids.add(fid)
        if branch:
            by_branch.setdefault(branch, fid)
        if name:
            by_name.setdefault(name.strip().lower(), fid)
    return by_branch, by_name, ids


def _persist_proposals(
    tenant_id: str, proposals: list[Proposal], pr_by_ref: Optional[dict] = None
) -> None:
    """Persist regenerated proposals, REUSING existing proposed features' ids.

    A re-run used to delete every proposed feature and insert fresh rows, so ids
    churned on each analysis: bookmarked /features/<id> links broke, feature-scoped
    alerts detached, and cost rows were orphaned (build_cost.feature_id is
    ON DELETE SET NULL). Instead we match each new proposal to an existing feature
    — by branch pattern, else by name — and update it in place. Only proposals that
    truly disappeared from the analysis window are deleted. Confirmed features are
    never touched, as before.
    """
    pr_by_ref = pr_by_ref or {}
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        by_branch, by_name, stale = _match_existing(conn)
        for prop in proposals:
            key_branch = prop.branch_pattern
            key_name = prop.name.strip().lower()
            # Branch pattern is the stabler identity; fall back to the name. Only
            # claim a feature once, so two proposals never collapse onto one row.
            feature_id = None
            if key_branch and by_branch.get(key_branch) in stale:
                feature_id = by_branch[key_branch]
            elif by_name.get(key_name) in stale:
                feature_id = by_name[key_name]

            if feature_id is not None:
                stale.discard(feature_id)  # reused, so not deleted below
                # A person's AI/non-AI decision outlives re-discovery: the guess
                # is only written back where nobody has ruled on it (the same rule
                # resource_classification follows for environment).
                conn.execute(
                    """
                    UPDATE feature
                    SET name = %s, description = %s, discovery_confidence = %s,
                        ai_kind = CASE WHEN ai_kind_source = 'user'
                                       THEN ai_kind ELSE %s END,
                        ai_kind_source = CASE WHEN ai_kind_source = 'user'
                                              THEN 'user' ELSE 'discovery' END,
                        category = CASE WHEN category_source = 'user'
                                        THEN category ELSE %s END,
                        category_source = CASE WHEN category_source = 'user' THEN 'user'
                                               WHEN %s::text IS NULL THEN NULL
                                               ELSE 'discovery' END
                    WHERE id = %s
                    """,
                    (
                        prop.name,
                        prop.description,
                        prop.confidence,
                        prop.ai_kind,
                        prop.category,
                        prop.category,
                        feature_id,
                    ),
                )
                # Signals are regenerated wholesale — the PR set may have changed.
                conn.execute("DELETE FROM feature_signal WHERE feature_id = %s", (feature_id,))
            else:
                feature_id = conn.execute(
                    """
                    INSERT INTO feature
                        (tenant_id, name, description, status, discovery_confidence,
                         ai_kind, ai_kind_source, category, category_source)
                    VALUES (%s, %s, %s, 'proposed', %s, %s, 'discovery', %s,
                            CASE WHEN %s::text IS NULL THEN NULL ELSE 'discovery' END)
                    RETURNING id
                    """,
                    (
                        tenant_id,
                        prop.name,
                        prop.description,
                        prop.confidence,
                        prop.ai_kind,
                        prop.category,
                        prop.category,
                    ),
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
                    additions=getattr(pr, "additions", None),
                    deletions=getattr(pr, "deletions", None),
                    merged_at=_merged_date(pr),
                    title=getattr(pr, "title", None),
                    branch=getattr(pr, "branch", None),
                    url=getattr(pr, "url", None),
                )

        # Proposals that no longer appear in the analysis window are dropped.
        if stale:
            conn.execute("DELETE FROM feature WHERE id = ANY(%s)", (list(stale),))


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
    additions=None,
    deletions=None,
    merged_at=None,
    title=None,
    branch=None,
    url=None,
):
    conn.execute(
        """
        INSERT INTO feature_signal (tenant_id, feature_id, signal_type, external_ref,
                                    confidence, source, actor, commits, files_changed,
                                    additions, deletions, merged_at, title, branch, url)
        VALUES (%s, %s, %s, %s, %s, 'github', %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
            additions,
            deletions,
            merged_at,
            title,
            branch,
            url,
        ),
    )


def _merged_date(pr) -> Optional[dt.date]:
    """The PR's own merge date — the date the work landed, not when we synced."""
    raw = getattr(pr, "merged_at", None)
    if not raw:
        return None
    try:
        return dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00")).date()
    except ValueError:
        return None


# Type alias documenting the clusterer contract (used in tests for injection).
Clusterer = Callable[[list[PullRequest]], list[Proposal]]
