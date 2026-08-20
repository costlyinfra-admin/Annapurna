"""Build-cost allocation on a known fixture, plus CSV parsing."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest
from annapurna import build, discovery
from annapurna.build import DeveloperSpend
from annapurna.github import CopilotSeat, PullRequest

PERIOD = dt.date(2026, 5, 1)


def _pr(number, title, branch, author):
    return PullRequest(number, "acme/core", title, "", branch, author, "2026-05-01T00:00:00Z", "")


# alice: 2 PRs on Threat; bob: 1 on Report; carol: 1 Threat + 1 Report; dave: none
FIXTURE_PRS = [
    _pr(1, "Threat triage automation", "feature/threat-triage", "alice"),
    _pr(2, "Threat scoring model", "feature/threat-scoring", "alice"),
    _pr(3, "Report generator", "feature/report-gen", "bob"),
    _pr(4, "Report CSV export", "feature/report-export", "carol"),
    _pr(5, "Threat intel feed", "feature/threat-intel", "carol"),
]


class _FakeGitHub:
    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def list_repos(self, owner):
        return sorted({p.repo for p in FIXTURE_PRS})

    def fetch_merged_prs(self, owner, since):
        return FIXTURE_PRS


@pytest.fixture
def discovered(tenant_id, monkeypatch):
    monkeypatch.setattr(discovery, "_make_github_client", lambda token: _FakeGitHub())
    discovery.run_discovery(tenant_id, "acme", "tok")
    return tenant_id


def test_split_amount_is_exact():
    out = build._split_amount(Decimal("100.00"), {"a": 1, "b": 1, "c": 1})
    assert sum(out.values()) == Decimal("100.00")  # remainder absorbed, exact total


def test_parse_csv_flexible_headers_and_amounts():
    # Legacy format (no github_handle column) still parses; name/handle stay None.
    text = 'developer,tool,amount\nalice,cursor,100\nbob,claude_code,"$1,234.50"\n'
    spends = build.parse_csv(text)
    assert spends[0] == DeveloperSpend("alice", "cursor", Decimal("100"), None)
    assert spends[0].name is None and spends[0].handle is None
    assert spends[1].amount == Decimal("1234.50")


def test_parse_csv_new_name_and_handle_format():
    text = "developer,github_handle,tool,amount\nMuzaffar,Muzaffar-ni,claude_code,50.00\n"
    (spend,) = build.parse_csv(text)
    assert spend.name == "Muzaffar"
    assert spend.handle == "Muzaffar-ni"
    assert spend.developer_id == "Muzaffar-ni"  # handle is the attribution key
    assert spend.amount == Decimal("50.00")


def test_parse_csv_handle_only_and_name_only():
    # Name missing -> handle is both key and identity.
    (s1,) = build.parse_csv("developer,github_handle,tool,amount\n,octo,cursor,10\n")
    assert s1.name is None and s1.handle == "octo" and s1.developer_id == "octo"
    # Handle missing -> name is the key.
    (s2,) = build.parse_csv("developer,github_handle,tool,amount\nDana,,cursor,10\n")
    assert s2.handle is None and s2.name == "Dana" and s2.developer_id == "Dana"


def test_parse_csv_rejects_bad_tool():
    with pytest.raises(build.CsvImportError):
        build.parse_csv("developer,tool,amount\nalice,myspace,10\n")


def test_parse_csv_rejects_blanks_and_invalid_amounts():
    # Both name and handle blank in the new format.
    with pytest.raises(build.CsvImportError, match="name or github_handle"):
        build.parse_csv("developer,github_handle,tool,amount\n,,cursor,10\n")
    # Missing amount.
    with pytest.raises(build.CsvImportError, match="missing amount"):
        build.parse_csv("developer,github_handle,tool,amount\nA,a,cursor,\n")
    # Non-numeric amount.
    with pytest.raises(build.CsvImportError, match="invalid amount"):
        build.parse_csv("developer,github_handle,tool,amount\nA,a,cursor,lots\n")
    # Negative amount.
    with pytest.raises(build.CsvImportError, match="cannot be negative"):
        build.parse_csv("developer,github_handle,tool,amount\nA,a,cursor,-5\n")
    # Legacy format: missing developer.
    with pytest.raises(build.CsvImportError, match="missing developer"):
        build.parse_csv("developer,tool,amount\n,cursor,10\n")


def test_developer_label_variants():
    assert build.developer_label("Muzaffar", "Muzaffar-ni") == "Muzaffar (Muzaffar-ni)"
    assert build.developer_label("Muzaffar", None) == "Muzaffar"
    assert build.developer_label("", "octo") == "octo"
    assert build.developer_label(None, None, fallback="Unattributed") == "Unattributed"


def test_attribution_uses_github_handle_case_insensitively(discovered):
    # Display name differs from the handle, and the handle's case differs from the
    # recorded PR actor ('alice') — attribution should still land on Alice's feature.
    text = (
        "developer,github_handle,tool,amount\n"
        "Alice Smith,ALICE,cursor,100\n"
        "Muzaffar,Muzaffar-ni,claude_code,50\n"  # no PRs -> Unattributed
    )
    spends = build.parse_csv(text)
    summary = build.allocate_and_store(discovered, spends, PERIOD)

    features = {f["name"]: f for f in summary["features"]}
    assert features["Threat"]["amount"] == 100.0  # matched despite ALICE vs alice
    assert summary["unattributed"] == 50.0  # Muzaffar had no attributable PRs


def test_allocation_by_pr_overlap(discovered):
    spends = [
        DeveloperSpend("alice", "cursor", Decimal("100")),
        DeveloperSpend("bob", "cursor", Decimal("60")),
        DeveloperSpend("carol", "claude_code", Decimal("80")),
        DeveloperSpend("dave", "cursor", Decimal("30")),  # no PRs -> Unattributed
    ]
    summary = build.allocate_and_store(discovered, spends, PERIOD)

    features = {f["name"]: f for f in summary["features"]}
    # Threat: alice 100 (cursor) + carol 40 (claude_code split) = 140
    assert features["Threat"]["amount"] == 140.0
    assert features["Threat"]["by_tool"] == {"cursor": 100.0, "claude_code": 40.0}
    assert features["Threat"]["confidence"] == "high"  # alice's PRs are all in Threat
    # Report: bob 60 + carol 40 = 100
    assert features["Reports"]["amount"] == 100.0

    devs = {d["developer_id"]: d for d in summary["developers"]}
    assert devs["alice"]["amount"] == 100.0
    assert devs["carol"]["by_tool"] == {"claude_code": 80.0}

    assert summary["unattributed"] == 30.0  # dave
    assert summary["total"] == 270.0  # 100 + 60 + 80 + 30


def test_reimport_is_idempotent(discovered):
    spends = [DeveloperSpend("alice", "cursor", Decimal("100"))]
    build.allocate_and_store(discovered, spends, PERIOD)
    summary = build.allocate_and_store(discovered, spends, PERIOD)  # again
    assert summary["total"] == 100.0  # not doubled


class _FakeCopilotGitHub:
    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def copilot_plan_type(self, owner):
        return "enterprise"

    def fetch_copilot_seats(self, owner):
        return [CopilotSeat("alice"), CopilotSeat("bob")]


def test_import_copilot_seats(discovered, monkeypatch):
    # Seats pulled from GitHub become per-developer build cost, allocated to
    # features by PR authorship — no CSV upload.
    monkeypatch.setattr(build, "_make_github_client", lambda token: _FakeCopilotGitHub())
    summary = build.import_copilot_seats(discovered, "acme", "tok", PERIOD)

    assert summary["seats"] == 2
    assert summary["plan"] == "enterprise"
    assert summary["seat_price"] == 39.0  # enterprise seat

    features = {f["name"]: f for f in summary["features"]}
    # alice's PRs are all in Threat -> her $39 seat lands there (high confidence).
    assert features["Threat"]["amount"] == 39.0
    assert features["Threat"]["by_tool"] == {"copilot": 39.0}
    assert features["Threat"]["confidence"] == "high"
    # bob's PR is in Report.
    assert features["Reports"]["amount"] == 39.0

    devs = {d["developer_id"]: d for d in summary["developers"]}
    assert devs["alice"]["amount"] == 39.0
    assert devs["bob"]["amount"] == 39.0
