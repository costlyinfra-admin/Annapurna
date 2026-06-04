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


def _add_signal(conn, tenant_id, feature_id, signal_type, external_ref, confidence):
    conn.execute(
        """
        INSERT INTO feature_signal (tenant_id, feature_id, signal_type,
                                    external_ref, confidence, source)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (tenant_id, feature_id, signal_type, external_ref, confidence, "github"),
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
    conn.execute(
        """
        INSERT INTO build_cost (tenant_id, feature_id, developer_id, tool,
                                pr_ref, amount, period, confidence, source)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            tenant_id,
            feature_id,
            developer_id,
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
):
    conn.execute(
        """
        INSERT INTO inference_cost (tenant_id, feature_id, provider, model,
                                    api_key_ref, amount, period, tokens_in,
                                    tokens_out, request_count, source, confidence)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
            source,
            confidence,
        ),
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


def insert_sample_data(conn: psycopg.Connection, tenant_id: str) -> dict:
    """Populate one tenant with sample features and costs. Returns a small summary."""
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
    _add_signal(conn, tenant_id, triage, "branch", "feature/threat-*", "high")
    _add_signal(conn, tenant_id, triage, "pr", "acme/core#1421", "high")
    _add_signal(conn, tenant_id, report, "pr", "acme/core#1455", "high")
    _add_signal(conn, tenant_id, soc, "repo", "acme/soc-copilot", "med")
    _add_signal(conn, tenant_id, vuln, "pr", "acme/core#1490", "low")

    # --- Build cost (by developer and tool) -------------------------------
    _add_build_cost(
        conn, tenant_id, triage, "dev:alice", "claude_code", "acme/core#1421", 117.00, "high"
    )
    _add_build_cost(conn, tenant_id, triage, "dev:bob", "cursor", "acme/core#1421", 64.00, "med")
    _add_build_cost(
        conn, tenant_id, report, "dev:alice", "claude_code", "acme/core#1455", 88.50, "high"
    )
    _add_build_cost(
        conn, tenant_id, soc, "dev:carol", "copilot", "acme/soc-copilot#12", 42.25, "med"
    )
    # Unattributed build cost — a developer whose PRs didn't map to a feature.
    _add_build_cost(conn, tenant_id, None, "dev:dave", "cursor", None, 30.00, "low")

    # --- Inference cost (connector / cost_api source) ---------------------
    _add_inference_cost(
        conn,
        tenant_id,
        triage,
        "anthropic",
        "claude-sonnet-4-6",
        "key:triage-prod",
        4200.00,
        18_000_000,
        2_400_000,
        320_000,
        "high",
    )
    _add_inference_cost(
        conn,
        tenant_id,
        report,
        "openai",
        "gpt-4o",
        "proj:reports",
        1850.00,
        9_000_000,
        1_100_000,
        88_000,
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

    return {"features": 4, "tenant_id": tenant_id}
