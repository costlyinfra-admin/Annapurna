"""Acceptance: the seed script loads — migrations + one demo tenant with data.

Drives seed.main() exactly as the CLI would, pointing DATABASE_URL at the
ephemeral test database.
"""

from __future__ import annotations

import psycopg


def _tenant_id(conn, name):
    return conn.execute("SELECT id FROM tenant WHERE name = %s", (name,)).fetchone()


def test_seed_loads_extended_demo_tenant(postgresql, admin_conninfo, monkeypatch):
    # Point the seed script's admin connection at the throwaway test DB.
    monkeypatch.setenv("DATABASE_URL", admin_conninfo)

    import seed

    seed.main()

    with psycopg.connect(admin_conninfo) as conn:  # admin bypasses RLS
        tenant = _tenant_id(conn, seed.DEMO_TENANT_NAME)
        assert tenant is not None, "demo tenant was not created"

        # Extended demo: 4 base + 4 new features.
        feature_count = conn.execute(
            "SELECT count(*) FROM feature WHERE tenant_id = %s", (tenant[0],)
        ).fetchone()[0]
        assert feature_count == 8

        # ~2 years of monthly history -> many distinct periods, spanning 2024-2026.
        periods = conn.execute(
            "SELECT min(period), max(period), count(DISTINCT period) "
            "FROM inference_cost WHERE tenant_id = %s",
            (tenant[0],),
        ).fetchone()
        assert periods[0].year == 2024
        assert periods[1].year == 2026
        assert periods[2] >= 12  # at least a year's worth of distinct months

        # Unattributed spend landed in the bucket (feature_id NULL), not dropped.
        unattributed = conn.execute(
            "SELECT count(*) FROM inference_cost WHERE tenant_id = %s AND feature_id IS NULL",
            (tenant[0],),
        ).fetchone()[0]
        assert unattributed >= 1


def test_seed_is_idempotent_without_reset(postgresql, admin_conninfo, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", admin_conninfo)
    import seed

    seed.main()
    with psycopg.connect(admin_conninfo) as conn:
        first = _tenant_id(conn, seed.DEMO_TENANT_NAME)[0]

    seed.main()  # second run is a no-op (demo user already exists)
    with psycopg.connect(admin_conninfo) as conn:
        tenants = conn.execute(
            "SELECT count(*) FROM tenant WHERE name = %s", (seed.DEMO_TENANT_NAME,)
        ).fetchone()[0]
        assert tenants == 1
        still = _tenant_id(conn, seed.DEMO_TENANT_NAME)[0]
        assert still == first  # same tenant, untouched


def test_seed_reset_rebuilds_demo_tenant(postgresql, admin_conninfo, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", admin_conninfo)
    import seed

    seed.main()
    with psycopg.connect(admin_conninfo) as conn:
        first = _tenant_id(conn, seed.DEMO_TENANT_NAME)[0]

    seed.main(reset=True)  # wipe + rebuild
    with psycopg.connect(admin_conninfo) as conn:
        # Exactly one demo tenant remains, and it's a fresh one (old data cascaded away).
        tenants = conn.execute(
            "SELECT count(*) FROM tenant WHERE name = %s", (seed.DEMO_TENANT_NAME,)
        ).fetchone()[0]
        assert tenants == 1
        rebuilt = _tenant_id(conn, seed.DEMO_TENANT_NAME)[0]
        assert rebuilt != first  # new tenant id

        # The old tenant's rows are gone (cascade), the new one's are present.
        orphans = conn.execute(
            "SELECT count(*) FROM feature WHERE tenant_id = %s", (first,)
        ).fetchone()[0]
        assert orphans == 0
        features = conn.execute(
            "SELECT count(*) FROM feature WHERE tenant_id = %s", (rebuilt,)
        ).fetchone()[0]
        assert features == 8
