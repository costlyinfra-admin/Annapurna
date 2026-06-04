"""Annapurna HTTP API (FastAPI).

Auth is cookie-session based: a signed, http-only session cookie (Starlette
SessionMiddleware) holds the user id. Tenant-scoped data is always read/written
under the authenticated user's tenant, which drives RLS.

Run locally:  uvicorn --factory annapurna.api:create_app --reload
"""

from __future__ import annotations

import os
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from . import auth, credentials, discovery, features
from .github import GitHubError


class SignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=auth.MIN_PASSWORD_LENGTH, max_length=1024)


class LoginRequest(BaseModel):
    email: str
    password: str


class CredentialRequest(BaseModel):
    secret: str = Field(min_length=1, max_length=8192)
    label: Optional[str] = Field(default=None, max_length=200)


class DiscoveryRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=200)  # GitHub org or user
    days: int = Field(default=90, ge=1, le=365)


class AddFeatureRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)


class RenameFeatureRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)


class SplitGroup(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    signal_ids: list[str] = Field(default_factory=list)
    description: Optional[str] = Field(default=None, max_length=2000)


class SplitRequest(BaseModel):
    groups: list[SplitGroup] = Field(min_length=1)


class MergeRequest(BaseModel):
    feature_ids: list[str] = Field(min_length=2)
    name: Optional[str] = Field(default=None, max_length=200)


class ConfirmRequest(BaseModel):
    feature_ids: Optional[list[str]] = None


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

    # ---- Feature discovery + editing (wizard step 2) --------------------
    @app.post("/api/discovery/run")
    def run_discovery(body: DiscoveryRequest, user: CurrentUser) -> dict:
        token = credentials.get_secret(user["tenant_id"], "github")
        if not token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Connect GitHub before running discovery.",
            )
        try:
            return discovery.run_discovery(user["tenant_id"], body.owner, token, days=body.days)
        except GitHubError as exc:
            if exc.status == 401:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="GitHub rejected the token. Reconnect with a valid token.",
                ) from exc
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=f"GitHub error: {exc}"
            ) from exc

    @app.get("/api/features")
    def list_features(
        user: CurrentUser,
        status_filter: Optional[str] = Query(default=None, alias="status"),
    ) -> list[dict]:
        return features.list_features(user["tenant_id"], status=status_filter)

    @app.post("/api/features", status_code=status.HTTP_201_CREATED)
    def add_feature(body: AddFeatureRequest, user: CurrentUser) -> dict:
        return features.add_feature(user["tenant_id"], body.name, body.description)

    @app.patch("/api/features/{feature_id}")
    def rename_feature(feature_id: str, body: RenameFeatureRequest, user: CurrentUser) -> dict:
        try:
            return features.rename_feature(
                user["tenant_id"], feature_id, name=body.name, description=body.description
            )
        except features.FeatureNotFound as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found"
            ) from exc

    @app.delete("/api/features/{feature_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_feature(feature_id: str, user: CurrentUser) -> Response:
        try:
            features.delete_feature(user["tenant_id"], feature_id)
        except features.FeatureNotFound as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found"
            ) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.post("/api/features/{feature_id}/split")
    def split_feature(feature_id: str, body: SplitRequest, user: CurrentUser) -> list[dict]:
        groups = [g.model_dump() for g in body.groups]
        try:
            return features.split_feature(user["tenant_id"], feature_id, groups)
        except features.FeatureNotFound as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found"
            ) from exc

    @app.post("/api/features/merge")
    def merge_features(body: MergeRequest, user: CurrentUser) -> dict:
        try:
            return features.merge_features(user["tenant_id"], body.feature_ids, name=body.name)
        except features.FeatureNotFound as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found"
            ) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/api/onboarding/confirm")
    def confirm_onboarding(body: ConfirmRequest, user: CurrentUser) -> list[dict]:
        return features.confirm_features(user["tenant_id"], body.feature_ids)

    return app
