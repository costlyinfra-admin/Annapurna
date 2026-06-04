"""Per-tenant connector credentials — encrypted at rest.

Secrets are encrypted (crypto.encrypt) before insert; only ciphertext is stored.
All access goes through the app role with tenant context, so RLS guarantees a
tenant can only ever touch its own credentials.

In M2 these are stored but not yet *used* — the connectors that consume them
(GitHub in M3, providers in M4) come later. The wizard's "Connect" step is a
shell with empty states; this is the storage capability behind it.
"""

from __future__ import annotations

from typing import Optional

from typing_extensions import TypedDict  # pydantic needs this on Python < 3.12

from .crypto import decrypt, encrypt
from .db import app_dsn, connect, tenant_tx

#: Connectors offered in the onboarding wizard. category drives how they're
#: grouped in the UI; "build_activity" feeds build cost, "inference" feeds run cost.
KNOWN_CONNECTORS = [
    {"type": "github", "name": "GitHub", "category": "build_activity"},
    {"type": "anthropic", "name": "Anthropic", "category": "inference"},
    {"type": "openai", "name": "OpenAI", "category": "inference"},
    {"type": "cursor", "name": "Cursor for Teams", "category": "build_activity"},
]
_KNOWN_TYPES = {c["type"] for c in KNOWN_CONNECTORS}


class ConnectorStatus(TypedDict):
    type: str
    name: str
    category: str
    connected: bool


def save_credential(
    tenant_id: str, connector_type: str, secret: str, label: Optional[str] = None
) -> None:
    """Encrypt and store a connector secret for a tenant."""
    if connector_type not in _KNOWN_TYPES:
        raise ValueError(f"Unknown connector type: {connector_type}")
    ciphertext = encrypt(secret)
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        conn.execute(
            """
            INSERT INTO connector_credential (tenant_id, connector_type, label, ciphertext)
            VALUES (%s, %s, %s, %s)
            """,
            (tenant_id, connector_type, label, ciphertext),
        )


def get_secret(tenant_id: str, connector_type: str) -> Optional[str]:
    """Decrypt and return the most recently stored secret for a connector."""
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        row = conn.execute(
            """
            SELECT ciphertext FROM connector_credential
            WHERE connector_type = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (connector_type,),
        ).fetchone()
    if row is None:
        return None
    return decrypt(row[0])


def connector_statuses(tenant_id: str) -> list[ConnectorStatus]:
    """Return every known connector with whether the tenant has connected it."""
    with connect(app_dsn()) as conn, tenant_tx(conn, tenant_id):
        rows = conn.execute("SELECT DISTINCT connector_type FROM connector_credential").fetchall()
    connected = {r[0] for r in rows}
    return [
        {
            "type": c["type"],
            "name": c["name"],
            "category": c["category"],
            "connected": c["type"] in connected,
        }
        for c in KNOWN_CONNECTORS
    ]
