"""Seed script — one fake tenant with sample data, so the UI has something to render.

Usage (with DATABASE_URL / DATABASE_ADMIN_URL set to a Postgres instance):

    python -m seed            # apply migrations, then seed "Acme Security"

Runs as the bootstrap/admin role. Idempotent on schema (migrations are tracked);
re-running creates an additional demo tenant, which is fine for local dev.
"""

from __future__ import annotations

from annapurna.auth import hash_password
from annapurna.db import admin_dsn, connect
from annapurna.migrations import apply_migrations
from annapurna.sampledata import create_tenant, insert_sample_data

DEMO_TENANT_NAME = "Acme Security"
DEMO_USER_EMAIL = "demo@acme.com"
DEMO_USER_PASSWORD = "annapurna-demo"


def main() -> None:
    applied = apply_migrations()
    if applied:
        print("Applied migrations:", ", ".join(applied))

    with connect(admin_dsn()) as conn:
        with conn.transaction():
            tenant_id = create_tenant(conn, DEMO_TENANT_NAME)
            summary = insert_sample_data(conn, tenant_id)
            # A login for the demo tenant so the seeded data is viewable in the UI.
            conn.execute(
                "INSERT INTO app_user (tenant_id, email, password_hash) VALUES (%s, %s, %s)",
                (tenant_id, DEMO_USER_EMAIL, hash_password(DEMO_USER_PASSWORD)),
            )
    print(
        f"Seeded tenant {DEMO_TENANT_NAME!r} ({tenant_id}) "
        f"with {summary['features']} features and sample build/inference costs."
    )
    print(f"Demo login: {DEMO_USER_EMAIL} / {DEMO_USER_PASSWORD}")


if __name__ == "__main__":
    main()
