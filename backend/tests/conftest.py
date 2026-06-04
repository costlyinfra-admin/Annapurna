"""Test fixtures: an ephemeral Postgres with migrations applied.

`pytest-postgresql` spins up a throwaway Postgres cluster in a temp directory
per test session (using the local `pg_ctl`), so nothing persistent runs on the
machine. We resolve the Postgres binary even when it's keg-only (Homebrew) or
in an apt path (CI).
"""

from __future__ import annotations

import pytest
from annapurna import db
from annapurna.migrations import apply_migrations
from pytest_postgresql import factories

# Point pytest-postgresql at a discoverable pg_ctl (PATH, Homebrew, or apt/CI).
_PG_CTL = db.find_pg_binary("pg_ctl")
postgresql_proc = factories.postgresql_proc(executable=_PG_CTL)
postgresql = factories.postgresql("postgresql_proc")


def _conninfo(conn, *, user: str | None = None) -> str:
    """Build a libpq conninfo string from an open connection's parameters."""
    info = conn.info
    params = {
        "host": info.host,
        "port": info.port,
        "user": user or info.user,
        "dbname": info.dbname,
    }
    return " ".join(f"{key}={value}" for key, value in params.items() if value != "")


@pytest.fixture
def admin_conn(postgresql):
    """A superuser/bootstrap connection to a migrated database (bypasses RLS)."""
    admin_conninfo = _conninfo(postgresql)
    applied = apply_migrations(admin_conninfo)
    # Migrations should apply cleanly: both files, in order, on a fresh DB.
    assert applied == ["0001_core_schema", "0002_tenant_isolation"]
    return postgresql


@pytest.fixture
def admin_conninfo(postgresql):
    """Conninfo for the superuser/bootstrap role (bypasses RLS)."""
    return _conninfo(postgresql)


@pytest.fixture
def app_conninfo(postgresql):
    """Conninfo for the non-privileged application role (RLS applies)."""
    return _conninfo(postgresql, user=db.APP_ROLE)
