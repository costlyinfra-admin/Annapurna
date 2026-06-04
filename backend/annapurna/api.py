"""Annapurna HTTP API (FastAPI).

Auth is cookie-session based: a signed, http-only session cookie (Starlette
SessionMiddleware) holds the user id. Tenant-scoped data is always read/written
under the authenticated user's tenant, which drives RLS.

Run locally:  uvicorn --factory annapurna.api:create_app --reload
"""

from __future__ import annotations

import os
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from . import auth, credentials


class SignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=auth.MIN_PASSWORD_LENGTH, max_length=1024)


class LoginRequest(BaseModel):
    email: str
    password: str


class CredentialRequest(BaseModel):
    secret: str = Field(min_length=1, max_length=8192)
    label: Optional[str] = Field(default=None, max_length=200)


def _current_user(request: Request) -> auth.User:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    user = auth.get_user(user_id)
    if user is None:  # session points at a deleted user
        request.session.clear()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


# The authenticated user, resolved from the session cookie (FastAPI dependency).
CurrentUser = Annotated[auth.User, Depends(_current_user)]


def create_app() -> FastAPI:
    secret_key = os.environ.get("APP_SECRET_KEY")
    if not secret_key:
        raise RuntimeError("APP_SECRET_KEY must be set to run the API.")

    app = FastAPI(title="Annapurna API")
    app.add_middleware(
        SessionMiddleware,
        secret_key=secret_key,
        same_site="lax",
        https_only=False,  # set True behind HTTPS in production
    )

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.post("/api/auth/signup")
    def signup(body: SignupRequest, request: Request) -> auth.User:
        try:
            user = auth.signup(body.email, body.password)
        except auth.EmailAlreadyRegistered as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
            ) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        request.session["user_id"] = user["id"]
        return user

    @app.post("/api/auth/login")
    def login(body: LoginRequest, request: Request) -> auth.User:
        user = auth.login(body.email, body.password)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
            )
        request.session["user_id"] = user["id"]
        return user

    @app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
    def logout(request: Request) -> Response:
        request.session.clear()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/auth/me")
    def me(user: CurrentUser) -> auth.User:
        return user

    @app.get("/api/connectors")
    def list_connectors(user: CurrentUser) -> list[credentials.ConnectorStatus]:
        return credentials.connector_statuses(user["tenant_id"])

    @app.post("/api/connectors/{connector_type}/credential", status_code=status.HTTP_204_NO_CONTENT)
    def save_connector_credential(
        connector_type: str,
        body: CredentialRequest,
        user: CurrentUser,
    ) -> Response:
        try:
            credentials.save_credential(user["tenant_id"], connector_type, body.secret, body.label)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return app
