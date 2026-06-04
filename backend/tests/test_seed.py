"""Acceptance: the seed script loads — migrations + one demo tenant with data.

Drives seed.main() exactly as the CLI would, pointing DATABASE_URL at the
ephemeral test database.
"""

from __future__ import annotations

import psycopg


def test_seed_loads_demo_tenant(postgresql, admin_conninfo, monkeypatch):
    # Point the seed script's admin connection at the throwaway test DB.
    monkeypatch.setenv("DATABASE_URL", admin_conninfo)

    import seed

    seed.main()

    with psycopg.connect(admin_conninfo) as conn:  # admin bypasses RLS
        tenant = conn.execute(
            "SELECT id FROM tenant WHERE name = %s", (seed.DEMO_TENANT_NAME,)
        ).fetchone()
        assert tenant is not None, "demo tenant was not created"

        feature_count = conn.execute(
            "SELECT count(*) FROM feature WHERE tenant_id = %s", (tenant[0],)
        ).fetchone()[0]
        assert feature_count == 4

        # Unattributed spend landed in the bucket (feature_id NULL), not dropped.
        unattributed = conn.execute(
            "SELECT count(*) FROM inference_cost WHERE tenant_id = %s AND feature_id IS NULL",
            (tenant[0],),
        ).fetchone()[0]
        assert unattributed >= 1
