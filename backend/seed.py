"""Seed script — one fake tenant with sample data, so the UI has something to render.

Usage (with DATABASE_URL / DATABASE_ADMIN_URL set to a Postgres instance):

    python -m seed            # apply migrations, then seed "Acme Security"

Runs as the bootstrap/admin role. Idempotent on schema (migrations are tracked);
re-running creates an additional demo tenant, which is fine for local dev.
"""

from __future__ import annotations

from annapurna.db import admin_dsn, connect
from annapurna.migrations import apply_migrations
from annapurna.sampledata import create_tenant, insert_sample_data

DEMO_TENANT_NAME = "Acme Security"


def main() -> None:
    applied = apply_migrations()
    if applied:
        print("Applied migrations:", ", ".join(applied))

    with connect(admin_dsn()) as conn:
        with conn.transaction():
            tenant_id = create_tenant(conn, DEMO_TENANT_NAME)
            summary = insert_sample_data(conn, tenant_id)
    print(
        f"Seeded tenant {DEMO_TENANT_NAME!r} ({tenant_id}) "
        f"with {summary['features']} features and sample build/inference costs."
    )


if __name__ == "__main__":
    main()
