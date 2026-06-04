"""Database access helpers for Annapurna.

Two connection roles:
  * **bootstrap/admin** — the role that owns the schema (a superuser locally).
    Used by migrations and seeding. Bypasses RLS, so it can load many tenants.
  * **app** (`annapurna_app`) — the non-privileged role the running app uses.
    RLS policies apply to it; every request must set the tenant context.

The tenant context is a transaction-local Postgres setting, `app.current_tenant`.
`tenant_tx()` sets it and runs your work inside one transaction so it can never
leak across pooled/serverless connections.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Iterator
from contextlib import contextmanager
from glob import glob

import psycopg

#: The non-privileged role the application connects as (see migration 0002).
APP_ROLE = "annapurna_app"

#: Transaction-local Postgres setting that drives the RLS policies.
TENANT_GUC = "app.current_tenant"


def admin_dsn() -> str:
    """Connection string for the bootstrap/admin role (migrations, seed)."""
    return os.environ.get("DATABASE_ADMIN_URL") or os.environ["DATABASE_URL"]


def app_dsn() -> str:
    """Connection string for the non-privileged application role."""
    return os.environ.get("DATABASE_APP_URL") or os.environ["DATABASE_URL"]


def connect(conninfo: str | None = None, *, autocommit: bool = False) -> psycopg.Connection:
    """Open a psycopg connection. Defaults to the app DSN from the environment."""
    return psycopg.connect(conninfo or app_dsn(), autocommit=autocommit)


@contextmanager
def tenant_tx(conn: psycopg.Connection, tenant_id) -> Iterator[psycopg.Connection]:
    """Run a block inside one transaction scoped to a single tenant.

    Sets `app.current_tenant` transaction-locally (via set_config(..., is_local=true)),
    so RLS filters every statement to ``tenant_id``. Commits on success, rolls
    back on error, and the setting is discarded with the transaction either way.
    """
    with conn.transaction():
        conn.execute("SELECT set_config(%s, %s, true)", (TENANT_GUC, str(tenant_id)))
        yield conn


def find_pg_binary(name: str) -> str:
    """Locate a Postgres CLI binary (e.g. ``psql``), tolerating keg-only installs.

    Checks PATH first, then common Homebrew (macOS) and apt (Linux/CI) locations.
    """
    found = shutil.which(name)
    if found:
        return found
    patterns = [
        f"/opt/homebrew/opt/postgresql@*/bin/{name}",
        f"/usr/local/opt/postgresql@*/bin/{name}",
        f"/usr/lib/postgresql/*/bin/{name}",
        f"/Applications/Postgres.app/Contents/Versions/*/bin/{name}",
    ]
    for pattern in patterns:
        matches = sorted(glob(pattern))
        if matches:
            return matches[-1]  # highest version
    raise FileNotFoundError(
        f"Could not find the Postgres binary '{name}'. Install Postgres (e.g. "
        f"`brew install postgresql@16`) or put it on PATH."
    )
