"""Connection-string resolution (esp. the production app-DSN derivation)."""

from __future__ import annotations

import psycopg.conninfo
from annapurna import db


def test_app_dsn_prefers_explicit(monkeypatch):
    monkeypatch.setenv("DATABASE_APP_URL", "postgresql://explicit/here")
    monkeypatch.setenv("DATABASE_URL", "postgresql://owner@host/db")
    assert db.app_dsn() == "postgresql://explicit/here"


def test_app_dsn_derived_from_password(monkeypatch):
    monkeypatch.delenv("DATABASE_APP_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://owner:pw@host:5432/annapurna?sslmode=require")
    monkeypatch.setenv("ANNAPURNA_APP_DB_PASSWORD", "app-secret")

    params = psycopg.conninfo.conninfo_to_dict(db.app_dsn())
    assert params["user"] == "annapurna_app"
    assert params["password"] == "app-secret"
    assert params["dbname"] == "annapurna"
    assert params["host"] == "host"
    assert params.get("sslmode") == "require"  # SSL preserved for managed Postgres


def test_app_dsn_falls_back_to_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_APP_URL", raising=False)
    monkeypatch.delenv("ANNAPURNA_APP_DB_PASSWORD", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://owner@host/db")
    assert db.app_dsn() == "postgresql://owner@host/db"
