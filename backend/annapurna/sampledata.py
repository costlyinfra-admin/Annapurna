"""Reusable sample-data builder.

`insert_sample_data` populates one tenant with a small, realistic cybersecurity
dataset: features (the spine), their evidence signals, build cost (by developer
and tool), inference cost (connector/`cost_api` source), usage, a bill
reconciliation row, and — importantly — some **Unattributed** spend (feature_id
NULL) so the Unattributed bucket is exercised.

Run as the bootstrap/admin role (it inserts across whatever tenant_id you pass,
which RLS would otherwise forbid). Both the seed CLI and the tenant-isolation
test build their data through here.
"""

from __future__ import annotations

import calendar as _cal
import datetime as _dt

import psycopg

DEFAULT_PERIOD = _dt.date(2026, 5, 1)  # monthly bucket = first of the month


def create_tenant(conn: psycopg.Connection, name: str) -> str:
    row = conn.execute("INSERT INTO tenant (name) VALUES (%s) RETURNING id", (name,)).fetchone()
    return row[0]


def _add_feature(
    conn: psycopg.Connection,
    tenant_id: str,
    name: str,
    description: str,
    status: str,
    discovery_confidence: str,
) -> str:
    row = conn.execute(
        """
        INSERT INTO feature (tenant_id, name, description, status,
                             shipped_at, discovery_confidence)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (tenant_id, name, description, status, DEFAULT_PERIOD, discovery_confidence),
    ).fetchone()
    return row[0]


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
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            tenant_id,
            feature_id,
            signal_type,
            external_ref,
            confidence,
            "github",
            actor,
            commits,
            files_changed,
        ),
    )


def _add_build_cost(
    conn,
    tenant_id,
    feature_id,
    developer_id,
    tool,
    pr_ref,
    amount,
    confidence,
    period=DEFAULT_PERIOD,
):
    # The seed's developer_id is the GitHub login (it lines up with PR actors);
    # store a lowercased handle and a prettified display name so the Overview "By
    # developer" view shows the "Name (handle)" format.
    handle = developer_id.lower()
    display_name = developer_id.replace("-", " ").replace("_", " ").title()
    conn.execute(
        """
        INSERT INTO build_cost (tenant_id, feature_id, developer_id, developer_name,
                                github_handle, tool, pr_ref, amount, period,
                                confidence, source)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            tenant_id,
            feature_id,
            developer_id,
            display_name,
            handle,
            tool,
            pr_ref,
            amount,
            period,
            confidence,
            "github+tool_admin",
        ),
    )


def _add_inference_cost(
    conn,
    tenant_id,
    feature_id,
    provider,
    model,
    api_key_ref,
    amount,
    tokens_in,
    tokens_out,
    requests,
    confidence,
    source="cost_api",
    period=DEFAULT_PERIOD,
    cached_tokens_in=None,
    cache_write_tokens=None,
    workspace=None,
    api_key=None,
):
    # Optional provider-resource identity (Anthropic workspace + API key). Left NULL
    # by default so the base fixture — and the tests pinned to it — are unchanged.
    conn.execute(
        """
        INSERT INTO inference_cost (tenant_id, feature_id, provider, model,
                                    api_key_ref, amount, period, tokens_in,
                                    tokens_out, request_count, cached_tokens_in,
                                    cache_write_tokens, workspace_id, workspace_name,
                                    api_key_id, api_key_name, source, confidence)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            tenant_id,
            feature_id,
            provider,
            model,
            api_key_ref,
            amount,
            period,
            tokens_in,
            tokens_out,
            requests,
            cached_tokens_in,
            cache_write_tokens,
            workspace,
            workspace,
            api_key,
            api_key,
            source,
            confidence,
        ),
    )


def _add_inference_daily(
    conn,
    tenant_id,
    feature_id,
    day,
    amount,
    environment,
    model="claude-sonnet-4-6",
    workspace=None,
):
    """One day-resolution inference row (inference_cost_daily) for the demo trend."""
    conn.execute(
        """
        INSERT INTO inference_cost_daily (tenant_id, feature_id, provider, model, amount,
                                          day, workspace_id, workspace_name, environment,
                                          source, confidence)
        VALUES (%s, %s, 'anthropic', %s, %s, %s, %s, %s, %s, 'cost_api', 'high')
        """,
        (tenant_id, feature_id, model, amount, day, workspace, workspace, environment),
    )


def _add_usage(conn, tenant_id, feature_id, active_users, events, period=DEFAULT_PERIOD):
    conn.execute(
        """
        INSERT INTO feature_usage (tenant_id, feature_id, period, active_users,
                                   events, source)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (tenant_id, feature_id, period, active_users, events, "manual"),
    )


def _add_usage_signal(
    conn,
    tenant_id,
    feature_id,
    kind,
    fingerprint,
    call_count,
    *,
    provider="anthropic",
    model="claude-sonnet-4-6",
    tokens_in=0,
    tokens_out=0,
    prefix_tokens=None,
    cached_count=0,
    period=DEFAULT_PERIOD,
):
    """Seed one optimize-mode signal (opt spec §5). Demo-only — fingerprints are
    illustrative opaque handles, not real salted hashes."""
    conn.execute(
        """
        INSERT INTO usage_signal (tenant_id, feature_id, provider, model, period,
                                  signal_kind, fingerprint, call_count, prefix_tokens,
                                  tokens_in, tokens_out, cached_count)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            tenant_id,
            feature_id,
            provider,
            model,
            period,
            kind,
            fingerprint,
            call_count,
            prefix_tokens,
            tokens_in,
            tokens_out,
            cached_count,
        ),
    )


def insert_sample_data(conn: psycopg.Connection, tenant_id: str, *, extended: bool = False) -> dict:
    """Populate one tenant with sample features and costs. Returns a small summary.

    The base dataset (4 features, a single recent month + a little history) is the
    stable fixture the tests pin to. Pass ``extended=True`` (the demo seed does) to
    layer on extra features and ~2 years of monthly history for a fuller live demo;
    this only *adds* rows, never alters the base ones.
    """
    # --- Features (the spine) ---------------------------------------------
    triage = _add_feature(
        conn,
        tenant_id,
        "AI threat triage",
        "Auto-classifies and prioritizes incoming security alerts.",
        "confirmed",
        "high",
    )
    report = _add_feature(
        conn,
        tenant_id,
        "Report generator",
        "Generates customer-facing incident and posture reports.",
        "confirmed",
        "high",
    )
    soc = _add_feature(
        conn,
        tenant_id,
        "SOC copilot",
        "Chat assistant for SOC analysts over investigation context.",
        "confirmed",
        "med",
    )
    vuln = _add_feature(
        conn,
        tenant_id,
        "Vuln summarizer",
        "Summarizes CVE/vulnerability findings for tickets.",
        "proposed",
        "low",
    )

    # --- Evidence signals (the trail) -------------------------------------
    # PR signals carry their author (actor) so build cost attributes per developer.
    _add_signal(conn, tenant_id, triage, "branch", "feature/threat-*", "high")
    _add_signal(
        conn,
        tenant_id,
        triage,
        "pr",
        "acme/core#1421",
        "high",
        actor="alice",
        commits=9,
        files_changed=21,
    )
    _add_signal(
        conn,
        tenant_id,
        triage,
        "pr",
        "acme/core#1432",
        "high",
        actor="alice",
        commits=5,
        files_changed=16,
    )
    _add_signal(
        conn,
        tenant_id,
        triage,
        "pr",
        "acme/core#1440",
        "high",
        actor="bob",
        commits=7,
        files_changed=12,
    )
    _add_signal(
        conn,
        tenant_id,
        report,
        "pr",
        "acme/core#1455",
        "high",
        actor="alice",
        commits=6,
        files_changed=9,
    )
    _add_signal(conn, tenant_id, soc, "repo", "acme/soc-copilot", "med")
    _add_signal(
        conn,
        tenant_id,
        soc,
        "pr",
        "acme/soc-copilot#12",
        "med",
        actor="carol",
        commits=4,
        files_changed=7,
    )
    _add_signal(
        conn,
        tenant_id,
        vuln,
        "pr",
        "acme/core#1490",
        "low",
        actor="dave",
        commits=3,
        files_changed=5,
    )

    # --- Build cost (by developer and tool) -------------------------------
    # developer_id matches the PR author (actor) so per-developer PRs line up.
    _add_build_cost(
        conn, tenant_id, triage, "alice", "claude_code", "acme/core#1421", 117.00, "high"
    )
    _add_build_cost(conn, tenant_id, triage, "bob", "cursor", "acme/core#1440", 64.00, "med")
    _add_build_cost(
        conn, tenant_id, report, "alice", "claude_code", "acme/core#1455", 88.50, "high"
    )
    _add_build_cost(conn, tenant_id, soc, "carol", "copilot", "acme/soc-copilot#12", 42.25, "med")
    # Unattributed build cost — a developer whose PRs didn't map to a feature.
    _add_build_cost(conn, tenant_id, None, "dave", "cursor", None, 30.00, "low")

    # --- Inference cost (connector / cost_api source) ---------------------
    _add_inference_cost(
        conn,
        tenant_id,
        triage,
        "anthropic",
        "claude-sonnet-4-6",
        "key:triage-prod",
        3500.00,
        15_000_000,
        2_000_000,
        260_000,
        "high",
    )
    # Same feature, a second model — so the model breakdown/pie has >1 slice.
    _add_inference_cost(
        conn,
        tenant_id,
        triage,
        "anthropic",
        "claude-opus-4-8",
        "key:triage-prod",
        700.00,
        3_000_000,
        400_000,
        60_000,
        "high",
    )
    # Report generator spans three models (the pie's showcase): gpt-4o dominant.
    # gpt-4o reports cached input tokens from the cost API — so cache utilization
    # surfaces for this feature WITHOUT the SDK (opt spec §8, Tier A): 720K / 9M
    # total input ≈ 8% cached.
    _add_inference_cost(
        conn,
        tenant_id,
        report,
        "openai",
        "gpt-4o",
        "proj:reports",
        1250.00,
        6_000_000,
        750_000,
        60_000,
        "med",
        cached_tokens_in=720_000,
        cache_write_tokens=240_000,
    )
    _add_inference_cost(
        conn,
        tenant_id,
        report,
        "anthropic",
        "claude-sonnet-4-6",
        "proj:reports",
        400.00,
        1_800_000,
        250_000,
        20_000,
        "med",
    )
    _add_inference_cost(
        conn,
        tenant_id,
        report,
        "anthropic",
        "claude-haiku-4-5",
        "proj:reports",
        200.00,
        1_200_000,
        100_000,
        8_000,
        "med",
    )
    _add_inference_cost(
        conn,
        tenant_id,
        soc,
        "anthropic",
        "claude-haiku-4-5",
        "key:shared-prod",
        980.00,
        12_000_000,
        900_000,
        410_000,
        "low",
    )
    # Unattributed inference — shared key spend not yet mapped to a feature.
    _add_inference_cost(
        conn,
        tenant_id,
        None,
        "anthropic",
        "claude-haiku-4-5",
        "key:shared-prod",
        760.00,
        8_000_000,
        500_000,
        300_000,
        "low",
    )

    # Prior months of inference for triage + report, so the trend chart and the
    # month/quarter/year filter on the drill-down have real history to show.
    _mar = _dt.date(2026, 3, 1)
    _apr = _dt.date(2026, 4, 1)
    for feat, model, mar_amt, apr_amt in (
        (triage, "claude-sonnet-4-6", 2400.00, 3000.00),
        (triage, "claude-opus-4-8", 400.00, 500.00),
        (report, "gpt-4o", 800.00, 1000.00),
    ):
        provider = "openai" if model.startswith("gpt") else "anthropic"
        _add_inference_cost(
            conn,
            tenant_id,
            feat,
            provider,
            model,
            "key:hist",
            mar_amt,
            0,
            0,
            int(mar_amt * 60),
            "med",
            period=_mar,
        )
        _add_inference_cost(
            conn,
            tenant_id,
            feat,
            provider,
            model,
            "key:hist",
            apr_amt,
            0,
            0,
            int(apr_amt * 60),
            "med",
            period=_apr,
        )

    # --- Bill reconciliation (connector totals; hook reconciliation is M7) -
    conn.execute(
        """
        INSERT INTO bill_reconciliation (tenant_id, provider, period,
                                         billed_total, attributed_total, status)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (tenant_id, "anthropic", DEFAULT_PERIOD, 5940.00, 5180.00, "delta"),
    )

    # --- Usage (manual/CSV for now; real connector is Slice 2) ------------
    _add_usage(conn, tenant_id, triage, 540, 1_200_000)
    _add_usage(conn, tenant_id, report, 120, 18_000)
    _add_usage(conn, tenant_id, soc, 65, 9_400)

    feature_count = 4
    if extended:
        feature_count += _add_extended_demo(
            conn, tenant_id, {"triage": triage, "report": report, "soc": soc}
        )
        _add_alert_demo(conn, tenant_id, {"triage": triage, "report": report})

    return {"features": feature_count, "tenant_id": tenant_id}


# ==========================================================================
# Extended demo data — extra features + ~2 years of monthly history.
# Only the demo seed turns this on; the test fixture never does.
# ==========================================================================

# Mild, deterministic month-of-year multipliers (Jan..Dec) so trend lines wobble
# realistically instead of being a straight ramp.
_SEASON = [0.98, 0.96, 1.00, 1.03, 1.06, 1.04, 0.98, 0.97, 1.02, 1.07, 1.12, 1.09]

# Each new feature: a couple of models, a few contributors, and monthly usage.
# (provider, model, api_key_ref, latest_monthly_amount, confidence)
# build: (developer, tool, pr_ref, amount, confidence, commits, files_changed)
_NEW_FEATURES = [
    {
        "name": "Phishing detection",
        "desc": "Classifies suspicious emails and URLs in real time.",
        "status": "confirmed",
        "conf": "high",
        "branch": "feature/phishing-*",
        "users": 820,
        "events": 2_400_000,
        "models": [
            ("openai", "gpt-4o-mini", "key:phishing", 900.00, "high"),
            ("anthropic", "claude-haiku-4-5", "key:phishing", 520.00, "high"),
        ],
        "build": [
            ("erin", "claude_code", "acme/core#1502", 96.00, "high", 11, 28),
            ("frank", "cursor", "acme/core#1509", 58.00, "med", 6, 15),
        ],
    },
    {
        "name": "Malware sandbox analysis",
        "desc": "Summarizes detonation reports from the malware sandbox.",
        "status": "confirmed",
        "conf": "med",
        "branch": "feature/sandbox-*",
        "users": 95,
        "events": 41_000,
        "models": [
            ("anthropic", "claude-opus-4-8", "key:sandbox", 540.00, "med"),
            ("anthropic", "claude-sonnet-4-6", "key:sandbox", 360.00, "med"),
        ],
        "build": [
            ("grace", "claude_code", "acme/core#1521", 134.00, "high", 9, 33),
        ],
    },
    {
        "name": "Compliance assistant",
        "desc": "Maps security controls to evidence for audits (SOC 2, ISO 27001).",
        "status": "confirmed",
        "conf": "high",
        "branch": "feature/compliance-*",
        "users": 210,
        "events": 22_500,
        "models": [
            ("anthropic", "claude-sonnet-4-6", "key:compliance", 380.00, "high"),
            ("openai", "gpt-4o", "proj:compliance", 240.00, "med"),
        ],
        "build": [
            ("heidi", "copilot", "acme/core#1538", 73.00, "med", 7, 19),
            ("erin", "claude_code", "acme/core#1544", 41.00, "high", 4, 9),
        ],
    },
    {
        "name": "Anomaly explainer",
        "desc": "Explains UEBA anomalies in plain language for analysts.",
        "status": "proposed",
        "conf": "med",
        "branch": "feature/anomaly-*",
        "users": 140,
        "events": 12_000,
        "models": [
            ("anthropic", "claude-haiku-4-5", "key:anomaly", 380.00, "med"),
        ],
        "build": [
            ("frank", "cursor", "acme/core#1551", 52.00, "low", 5, 12),
        ],
    },
]


def _months(start: tuple, count: int) -> list:
    """`count` first-of-month dates starting at (year, month)."""
    year, month = start
    out = []
    for _ in range(count):
        out.append(_dt.date(year, month, 1))
        month += 1
        if month > 12:
            month = 1
            year += 1
    return out


def _ramp(latest: float, i: int, n: int, low: float = 0.4) -> float:
    """Scale `latest` from `low` (oldest month) up to 1.0 (newest)."""
    if n <= 1:
        return latest
    return latest * (low + (1.0 - low) * (i / (n - 1)))


def _hist_inference(conn, tenant_id, feature_id, provider, model, ref, latest, periods, confidence):
    """Write a growing monthly inference series ending at ~`latest` in the last period."""
    n = len(periods)
    for i, period in enumerate(periods):
        amount = round(_ramp(latest, i, n) * _SEASON[period.month - 1], 2)
        if amount <= 0:
            continue
        _add_inference_cost(
            conn,
            tenant_id,
            feature_id,
            provider,
            model,
            ref,
            amount,
            int(amount * 3800),
            int(amount * 480),
            int(amount * 55),
            confidence,
            period=period,
        )


def _hist_build(conn, tenant_id, feature_id, dev, tool, ref, latest, periods, confidence):
    """Write a monthly build-cost series for a feature.

    Build cost is NOT one-off: developers keep enhancing and maintaining a
    feature month over month, so its build spend recurs (heavier early during
    active development, then a steadier maintenance tail). Mirrors the inference
    history so the by-tool trend has real depth.
    """
    n = len(periods)
    for i, period in enumerate(periods):
        amount = round(_ramp(latest, i, n) * _SEASON[period.month - 1], 2)
        if amount <= 0:
            continue
        _add_build_cost(
            conn, tenant_id, feature_id, dev, tool, ref, amount, confidence, period=period
        )


def _add_extended_demo(conn, tenant_id, base: dict) -> int:
    """Add multi-year history for the base features + several new features.

    Returns the number of *new* features added.
    """
    # 1) Backfill ~21-23 months of history for the existing confirmed features
    #    (their dominant model), leading up to — but not overwriting — the recent
    #    months the base data already wrote.
    _hist_inference(
        conn,
        tenant_id,
        base["triage"],
        "anthropic",
        "claude-sonnet-4-6",
        "key:triage-prod",
        2300.00,
        _months((2024, 6), 21),
        "high",
    )  # ends Feb 2026 (base has Mar/Apr/May)
    _hist_inference(
        conn,
        tenant_id,
        base["report"],
        "openai",
        "gpt-4o",
        "proj:reports",
        720.00,
        _months((2024, 6), 21),
        "med",
    )  # ends Feb 2026 (base has Mar/Apr/May)
    _hist_inference(
        conn,
        tenant_id,
        base["soc"],
        "anthropic",
        "claude-haiku-4-5",
        "key:shared-prod",
        940.00,
        _months((2024, 6), 23),
        "low",
    )  # ends Apr 2026 (base has May)

    # Anthropic workspace + API-key identity for the latest month, so the Overview
    # "By provider" tab can show its workspace/key breakdown (only Anthropic exposes
    # this today). Attributed to base features and split across a couple of keys.
    for feat, model, ws, key, amt in (
        (base["triage"], "claude-sonnet-4-6", "threat-triage", "triage-prod", 1800.00),
        (base["triage"], "claude-opus-4-8", "threat-triage", "triage-batch", 700.00),
        (base["soc"], "claude-haiku-4-5", "soc-copilot", "soc-shared", 620.00),
        (base["report"], "claude-sonnet-4-6", "reporting", "report-gen", 410.00),
    ):
        _add_inference_cost(
            conn,
            tenant_id,
            feat,
            "anthropic",
            model,
            f"key:{key}",
            amt,
            int(amt * 40),
            int(amt * 10),
            int(amt * 5),
            "high",
            workspace=ws,
            api_key=key,
        )

    # Day-resolution inference for the current month, so the Overview "By provider"
    # tab renders a DAILY trend (a real sync writes inference_cost_daily; here we
    # synthesize a gentle daily rhythm split across two classifications).
    _wave = [0.6, 0.8, 1.0, 1.3, 1.6, 1.2, 0.9]  # weekly-ish shape, cycled by day
    _ndays = _cal.monthrange(DEFAULT_PERIOD.year, DEFAULT_PERIOD.month)[1]
    for _i in range(_ndays):
        _day = DEFAULT_PERIOD.replace(day=_i + 1)
        _mult = _wave[_i % len(_wave)]
        _add_inference_daily(
            conn,
            tenant_id,
            base["triage"],
            _day,
            round(180 * _mult, 2),
            "production",
            workspace="threat-triage",
        )
        _add_inference_daily(
            conn,
            tenant_id,
            base["soc"],
            _day,
            round(60 * _mult, 2),
            "development",
            "claude-haiku-4-5",
            workspace="soc-copilot",
        )

    # Build cost recurs too — backfill a monthly build series for each base
    # feature's main contributor (the latest month is already in the base data).
    _bld_hist = _months((2024, 6), 23)  # Jun 2024 -> Apr 2026 (base wrote May)
    _hist_build(
        conn,
        tenant_id,
        base["triage"],
        "alice",
        "claude_code",
        "acme/core#1421",
        117.00,
        _bld_hist,
        "high",
    )
    _hist_build(
        conn,
        tenant_id,
        base["report"],
        "alice",
        "claude_code",
        "acme/core#1455",
        88.50,
        _bld_hist,
        "high",
    )
    _hist_build(
        conn,
        tenant_id,
        base["soc"],
        "carol",
        "copilot",
        "acme/soc-copilot#12",
        42.25,
        _bld_hist,
        "med",
    )

    # 2) New features, each with a full 24-month history (Jun 2024 -> May 2026).
    full = _months((2024, 6), 24)
    for f in _NEW_FEATURES:
        fid = _add_feature(conn, tenant_id, f["name"], f["desc"], f["status"], f["conf"])
        _add_signal(conn, tenant_id, fid, "branch", f["branch"], "high")
        for dev, tool, ref, amount, conf, commits, files in f["build"]:
            _add_signal(
                conn,
                tenant_id,
                fid,
                "pr",
                ref,
                conf,
                actor=dev,
                commits=commits,
                files_changed=files,
            )
            _add_build_cost(conn, tenant_id, fid, dev, tool, ref, amount, conf)
            # Recurring build/maintenance over the prior months (latest already set).
            _hist_build(conn, tenant_id, fid, dev, tool, ref, amount, full[:-1], conf)
        for provider, model, ref, latest, conf in f["models"]:
            _hist_inference(conn, tenant_id, fid, provider, model, ref, latest, full, conf)
        _add_usage(conn, tenant_id, fid, f["users"], f["events"])

    # 2b) Optimize-mode signals for AI threat triage (opt spec §5) — so the demo
    #     shows MEASURED opportunities, not just heuristic estimates. Duplicate
    #     calls (avoidable repeats) + a large uncached system-prompt prefix.
    for fp, calls, tin, tout in (
        ("dup-alert-format", 620, 52_000_000, 3_000_000),
        ("dup-enrich-lookup", 430, 30_000_000, 1_500_000),
        ("dup-triage-batch", 190, 14_000_000, 900_000),
    ):
        _add_usage_signal(
            conn,
            tenant_id,
            base["triage"],
            "duplicate",
            fp,
            calls,
            tokens_in=tin,
            tokens_out=tout,
        )
    # A 4,100-token static system prompt across 26,000 calls, ~8% already cached.
    _add_usage_signal(
        conn,
        tenant_id,
        base["triage"],
        "prefix",
        "prefix-system-triage",
        26_000,
        prefix_tokens=4100,
        cached_count=2080,
        tokens_in=106_600_000,
        tokens_out=5_200_000,
    )
    # An applied optimization (opt spec §11/§20): dedup was applied in March with a
    # $500/mo projection. This month's duplicate waste is ~$369, so the realized
    # saving is ~$131/mo — and it has held for 2 periods (Mar→May), so it's VERIFIED,
    # the terminal Prove state a CFO can trust.
    conn.execute(
        """
        INSERT INTO optimization_action (tenant_id, feature_id, lever, applied_on,
                                         projected_monthly)
        VALUES (%s, %s, 'duplicate_calls', %s, 500.00)
        """,
        (tenant_id, base["triage"], _dt.date(2026, 3, 1)),
    )

    # 2c) A feature on a HOSTED open model — cross-provider arbitrage (opt spec
    #     §16, M-opt-8). The same Llama-3.1-70B is ~59% cheaper on DeepInfra
    #     ($0.35/$0.40) than on Together ($0.88/$0.88), at identical weights.
    enrich = _add_feature(
        conn,
        tenant_id,
        "Log enrichment",
        "Enriches raw alerts with context via a hosted Llama-3.1-70B endpoint.",
        "confirmed",
        "med",
    )
    _add_signal(conn, tenant_id, enrich, "branch", "feature/enrich-*", "high")
    _add_build_cost(conn, tenant_id, enrich, "grace", "claude_code", "acme/core#1560", 68.00, "med")
    _add_inference_cost(
        conn,
        tenant_id,
        enrich,
        "together",
        "meta-llama-3.1-70b-instruct",
        "key:enrich-prod",
        123.20,  # 120M in @ $0.88 + 20M out @ $0.88
        120_000_000,
        20_000_000,
        90_000,
        "med",
    )
    _add_usage(conn, tenant_id, enrich, 300, 90_000)

    # 3) A self-hosted / open-source feature: Llama-3.1-70B on the company's own
    #    GPUs. Its run cost is a $6,500/mo infra pool allocated by usage (med
    #    confidence), and it carries a one-time fine-tuning run as BUILD cost.
    _add_self_hosted_demo(conn, tenant_id)

    return len(_NEW_FEATURES) + 2


def _add_self_hosted_demo(conn, tenant_id) -> None:
    feature = _add_feature(
        conn,
        tenant_id,
        "Log triage (self-hosted)",
        "Fine-tuned Llama-3.1-70B on our own GPUs triages raw log noise.",
        "confirmed",
        "med",
    )
    _add_signal(conn, tenant_id, feature, "branch", "feature/logtriage-*", "high")
    _add_signal(
        conn,
        tenant_id,
        feature,
        "pr",
        "acme/core#1566",
        "high",
        actor="grace",
        commits=8,
        files_changed=22,
    )
    _add_build_cost(
        conn, tenant_id, feature, "grace", "claude_code", "acme/core#1566", 78.00, "high"
    )

    # Fine-tuning run -> one-time BUILD cost (separate from inference, invariant 2).
    conn.execute(
        """
        INSERT INTO build_cost
            (tenant_id, feature_id, developer_id, tool, pr_ref, amount, period, confidence, source)
        VALUES (%s, %s, %s, 'fine_tune', %s, %s, %s, 'high', 'fine_tune')
        """,
        (tenant_id, feature, "Llama-3.1-70B tuning", "run:ft-2026-04", 4200.00, DEFAULT_PERIOD),
    )

    # The GPU serving pool ($6,500/mo infra bill) + per-feature usage weights.
    pool_id = conn.execute(
        """
        INSERT INTO compute_pool (tenant_id, name, provider_label, monthly_cost)
        VALUES (%s, %s, %s, %s) RETURNING id
        """,
        (tenant_id, "Llama-3.1-70B GPU pool", "self_hosted", 6500.00),
    ).fetchone()[0]
    # 580M tokens tagged to the feature, 70M untagged (-> Unattributed share).
    for feat, model, tin, tout, reqs in (
        (feature, "llama-3.1-70b", 520_000_000, 60_000_000, 410_000),
        (None, "llama-3.1-70b", 60_000_000, 10_000_000, 55_000),
    ):
        conn.execute(
            """
            INSERT INTO pool_usage
                (tenant_id, pool_id, feature_id, model, period,
                 tokens_in, tokens_out, request_count)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (tenant_id, pool_id, feat, model, DEFAULT_PERIOD, tin, tout, reqs),
        )
    # Allocated self-hosted inference (what `compute.allocate` would write):
    # $6,500 split 580/70 -> $5,800 to the feature, $700 Unattributed.
    _add_inference_cost(
        conn,
        tenant_id,
        feature,
        "self_hosted",
        "Llama-3.1-70B GPU pool",
        "pool:self_hosted",
        5800.00,
        520_000_000,
        60_000_000,
        410_000,
        "med",
        source="self_host",
    )
    _add_inference_cost(
        conn,
        tenant_id,
        None,
        "self_hosted",
        "Llama-3.1-70B GPU pool",
        "pool:self_hosted",
        700.00,
        60_000_000,
        10_000_000,
        55_000,
        "med",
        source="self_host",
    )
    _add_usage(conn, tenant_id, feature, 75, 210_000)


# ==========================================================================
# Alert demo data — a realistic mix the /alerts screen can render immediately:
# one healthy rule, one actively triggered, one with a delivery failure, and one
# disabled, plus a few days of triggered/resolved activity (some unread).
# Only the demo seed turns this on; the test fixture never does.
# ==========================================================================


def _add_alert_rule(conn, tenant_id, **kw) -> str:
    """Insert one alert_rule with sensible demo defaults; returns its id."""
    cols = {
        "name": kw["name"],
        "description": kw.get("description"),
        "metric": kw.get("metric", "inference_cost"),
        "scope_type": kw.get("scope_type", "organization"),
        "scope_ref": kw.get("scope_ref"),
        "condition_type": kw.get("condition_type", "exceeds"),
        "threshold": kw["threshold"],
        "budget_amount": kw.get("budget_amount"),
        "window": kw.get("window", "monthly"),
        "cooldown": kw.get("cooldown", "day"),
        "recovery_notify": kw.get("recovery_notify", True),
        "enabled": kw.get("enabled", True),
        "status": kw.get("status", "healthy"),
        "last_observed": kw.get("last_observed"),
        "last_evaluated_at": kw.get("last_evaluated_at"),
        "last_triggered_at": kw.get("last_triggered_at"),
        "created_by": kw.get("created_by", "cto@acme.com"),
    }
    row = conn.execute(
        """
        INSERT INTO alert_rule
            (tenant_id, name, description, metric, scope_type, scope_ref,
             condition_type, threshold, budget_amount, "window", cooldown,
             recovery_notify, enabled, status, last_observed, last_evaluated_at,
             last_triggered_at, next_eval_at, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, now(), %s)
        RETURNING id
        """,
        (
            tenant_id,
            cols["name"],
            cols["description"],
            cols["metric"],
            cols["scope_type"],
            cols["scope_ref"],
            cols["condition_type"],
            cols["threshold"],
            cols["budget_amount"],
            cols["window"],
            cols["cooldown"],
            cols["recovery_notify"],
            cols["enabled"],
            cols["status"],
            cols["last_observed"],
            cols["last_evaluated_at"],
            cols["last_triggered_at"],
            cols["created_by"],
        ),
    ).fetchone()
    return row[0]


def _add_alert_dest(conn, tenant_id, alert_id, channel, target=None) -> None:
    conn.execute(
        """
        INSERT INTO alert_destination (tenant_id, alert_id, channel, target)
        VALUES (%s, %s, %s, %s)
        """,
        (tenant_id, alert_id, channel, target),
    )


def _add_alert_event(conn, tenant_id, alert_id, incident_id, **kw) -> str:
    row = conn.execute(
        """
        INSERT INTO alert_event
            (tenant_id, alert_id, incident_id, event_type, event_key,
             observed_value, threshold, "window", message, read, occurred_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            tenant_id,
            alert_id,
            incident_id,
            kw["event_type"],
            kw["event_key"],
            kw.get("observed_value"),
            kw.get("threshold"),
            kw.get("window", "monthly"),
            kw.get("message"),
            kw.get("read", False),
            kw["occurred_at"],
        ),
    ).fetchone()
    return row[0]


def _add_alert_notif(conn, tenant_id, alert_id, event_id, channel, status, error=None) -> None:
    conn.execute(
        """
        INSERT INTO alert_notification
            (tenant_id, alert_id, event_id, channel, status, attempts, error)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (tenant_id, alert_id, event_id, channel, status, 3 if status == "failed" else 1, error),
    )


def _add_alert_demo(conn, tenant_id, features: dict) -> None:
    now = _dt.datetime.now(_dt.timezone.utc)
    day = _dt.timedelta(days=1)

    # 1) Healthy — combined AI spend under a monthly budget.
    healthy = _add_alert_rule(
        conn,
        tenant_id,
        name="Monthly AI budget",
        description="Warns before combined build + inference spend blows the monthly budget.",
        metric="combined_cost",
        condition_type="budget_pct",
        threshold=90,
        budget_amount=25000,
        window="monthly",
        status="healthy",
        last_observed=18240,
        last_evaluated_at=now - _dt.timedelta(hours=1),
    )
    _add_alert_dest(conn, tenant_id, healthy, "in_app")
    _add_alert_dest(conn, tenant_id, healthy, "email", "cto@acme.com")

    # 2) Triggered — a feature's daily inference cost is over the line right now.
    triggered = _add_alert_rule(
        conn,
        tenant_id,
        name="Threat triage daily inference",
        description="Catches a runaway day of inference on the busiest feature.",
        metric="inference_cost",
        scope_type="feature",
        scope_ref=features["triage"],
        condition_type="exceeds",
        threshold=1200,
        window="daily",
        status="triggered",
        last_observed=1638,
        last_evaluated_at=now - _dt.timedelta(minutes=20),
        last_triggered_at=now - _dt.timedelta(hours=6),
    )
    _add_alert_dest(conn, tenant_id, triggered, "in_app")
    _add_alert_dest(conn, tenant_id, triggered, "slack", "hooks.slack.com/services/•••••")
    incident = conn.execute(
        """
        INSERT INTO alert_incident (tenant_id, alert_id, status, opened_at,
                                    observed_value, threshold)
        VALUES (%s, %s, 'open', %s, %s, %s) RETURNING id
        """,
        (tenant_id, triggered, now - _dt.timedelta(hours=6), 1638, 1200),
    ).fetchone()[0]
    trig_evt = _add_alert_event(
        conn,
        tenant_id,
        triggered,
        incident,
        event_type="triggered",
        event_key=f"triggered:{incident}",
        observed_value=1638,
        threshold=1200,
        window="daily",
        message="Daily inference cost exceeded $1,200.",
        read=False,
        occurred_at=now - _dt.timedelta(hours=6),
    )
    _add_alert_notif(conn, tenant_id, triggered, trig_evt, "in_app", "sent")
    _add_alert_notif(conn, tenant_id, triggered, trig_evt, "slack", "sent")

    # 3) Delivery error — the rule itself is fine, but its webhook is failing.
    delivery = _add_alert_rule(
        conn,
        tenant_id,
        name="Unattributed spend watch",
        description="Flags a jump in spend we can't yet attribute to a feature.",
        metric="unattributed_cost",
        condition_type="exceeds",
        threshold=2000,
        window="monthly",
        status="delivery_error",
        last_observed=2450,
        last_evaluated_at=now - _dt.timedelta(minutes=35),
        last_triggered_at=now - day,
    )
    _add_alert_dest(conn, tenant_id, delivery, "in_app")
    _add_alert_dest(conn, tenant_id, delivery, "webhook", "https://ops.acme.com/hooks/•••••")
    d_incident = conn.execute(
        """
        INSERT INTO alert_incident (tenant_id, alert_id, status, opened_at,
                                    observed_value, threshold)
        VALUES (%s, %s, 'open', %s, %s, %s) RETURNING id
        """,
        (tenant_id, delivery, now - day, 2450, 2000),
    ).fetchone()[0]
    d_trig = _add_alert_event(
        conn,
        tenant_id,
        delivery,
        d_incident,
        event_type="triggered",
        event_key=f"triggered:{d_incident}",
        observed_value=2450,
        threshold=2000,
        message="Unattributed spend exceeded $2,000.",
        read=True,
        occurred_at=now - day,
    )
    _add_alert_notif(conn, tenant_id, delivery, d_trig, "in_app", "sent")
    _add_alert_notif(
        conn,
        tenant_id,
        delivery,
        d_trig,
        "webhook",
        "failed",
        "HTTP 503 from endpoint after 3 attempts",
    )
    _add_alert_event(
        conn,
        tenant_id,
        delivery,
        d_incident,
        event_type="delivery_error",
        event_key=f"delivery:{d_trig}",
        observed_value=2450,
        threshold=2000,
        message="Webhook delivery failed (HTTP 503).",
        read=False,
        occurred_at=now - day + _dt.timedelta(minutes=1),
    )

    # 4) Disabled — kept around but paused.
    disabled = _add_alert_rule(
        conn,
        tenant_id,
        name="Token usage spike (paused)",
        description="Watches for a sudden jump in token volume. Paused during migration.",
        metric="token_usage",
        condition_type="increase_pct",
        threshold=40,
        window="weekly",
        enabled=False,
        status="disabled",
        last_evaluated_at=now - 5 * day,
    )
    _add_alert_dest(conn, tenant_id, disabled, "in_app")
    _add_alert_dest(conn, tenant_id, disabled, "email", "cto@acme.com")

    # A few days of resolved history on the healthy budget rule so the Activity
    # feed and "last triggered" reads look lived-in (a past incident, resolved).
    past = conn.execute(
        """
        INSERT INTO alert_incident (tenant_id, alert_id, status, opened_at,
                                    resolved_at, observed_value, threshold)
        VALUES (%s, %s, 'resolved', %s, %s, %s, %s) RETURNING id
        """,
        (tenant_id, healthy, now - 4 * day, now - 3 * day, 24100, 22500),
    ).fetchone()[0]
    past_trig = _add_alert_event(
        conn,
        tenant_id,
        healthy,
        past,
        event_type="triggered",
        event_key=f"triggered:{past}",
        observed_value=24100,
        threshold=22500,
        message="Combined AI spend reached 96% of the monthly budget.",
        read=True,
        occurred_at=now - 4 * day,
    )
    _add_alert_notif(conn, tenant_id, healthy, past_trig, "in_app", "sent")
    _add_alert_notif(conn, tenant_id, healthy, past_trig, "email", "sent")
    past_res = _add_alert_event(
        conn,
        tenant_id,
        healthy,
        past,
        event_type="resolved",
        event_key=f"resolved:{past}",
        observed_value=19800,
        threshold=22500,
        message="Combined AI spend fell back under budget.",
        read=True,
        occurred_at=now - 3 * day,
    )
    _add_alert_notif(conn, tenant_id, healthy, past_res, "in_app", "sent")
    _add_alert_notif(conn, tenant_id, healthy, past_res, "email", "sent")
