"""Authentication: signup, login, and user lookup.

Email + password with bcrypt-hashed passwords. Signup creates a brand-new tenant
and the first user in it. These operations run on the bootstrap/admin connection
because authentication must resolve an identity *before* any tenant context
exists (RLS would otherwise hide the user during login).
"""

from __future__ import annotations

from typing import Optional

import bcrypt
import psycopg
from typing_extensions import TypedDict  # pydantic needs this on Python < 3.12

from .db import admin_dsn, connect

MIN_PASSWORD_LENGTH = 8


class EmailAlreadyRegistered(Exception):
    """Raised when signing up with an email that already exists."""


class User(TypedDict):
    id: str
    tenant_id: str
    email: str


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def _default_tenant_name(email: str) -> str:
    local = email.split("@", 1)[0]
    return f"{local}'s workspace"


def signup(email: str, password: str) -> User:
    """Create a new tenant and its first user. Returns the user."""
    email = email.strip().lower()
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    password_hash = hash_password(password)

    try:
        with connect(admin_dsn()) as conn, conn.transaction():
            tenant_id = conn.execute(
                "INSERT INTO tenant (name) VALUES (%s) RETURNING id",
                (_default_tenant_name(email),),
            ).fetchone()[0]
            user_id = conn.execute(
                """
                INSERT INTO app_user (tenant_id, email, password_hash)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (tenant_id, email, password_hash),
            ).fetchone()[0]
    except psycopg.errors.UniqueViolation as exc:
        raise EmailAlreadyRegistered(email) from exc

    return {"id": str(user_id), "tenant_id": str(tenant_id), "email": email}


def login(email: str, password: str) -> Optional[User]:
    """Return the user if the email/password are valid, else None."""
    email = email.strip().lower()
    with connect(admin_dsn()) as conn:
        row = conn.execute(
            "SELECT id, tenant_id, password_hash FROM app_user WHERE email = %s",
            (email,),
        ).fetchone()
    if row is None:
        return None
    user_id, tenant_id, password_hash = row
    if not verify_password(password, password_hash):
        return None
    return {"id": str(user_id), "tenant_id": str(tenant_id), "email": email}


def get_user(user_id: str) -> Optional[User]:
    """Look up a user by id (used to rehydrate the session)."""
    with connect(admin_dsn()) as conn:
        row = conn.execute(
            "SELECT id, tenant_id, email FROM app_user WHERE id = %s", (user_id,)
        ).fetchone()
    if row is None:
        return None
    return {"id": str(row[0]), "tenant_id": str(row[1]), "email": row[2]}
