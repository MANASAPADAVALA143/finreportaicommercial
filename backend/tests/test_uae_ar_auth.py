"""UAE AR: login + workspace membership required; the tenant is always the validated workspace —
never a raw header, a `workspace_id` query/body value naming another workspace, or "demo"."""

from __future__ import annotations

import os
import re
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import uae_ar_routes as ar
from app.core import company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"


class Env:
    def __init__(self):
        self.workspace = WS_A
        self.roles = {WS_A: "accountant", WS_B: "accountant"}

    def ctx(self) -> WorkspaceContext:
        role = self.roles.get(self.workspace)
        return WorkspaceContext(
            workspace_id=self.workspace,
            workspace=SimpleNamespace(id=self.workspace),
            user=SimpleNamespace(id="user-1", email="a@example.com", role="user"),
            role=WorkspaceRole(role) if role else None,
        )


@pytest.fixture()
def posted(monkeypatch):
    calls: list[dict] = []

    def _fake_post(invoice_id, **kw):
        calls.append({"invoice_id": invoice_id, **kw})
        return {"ok": True, "invoice_id": invoice_id}

    monkeypatch.setattr(ar, "post_sales_invoice_to_gl_and_tax", _fake_post)
    return calls


@pytest.fixture()
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    return e


def _app(env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(ar.router)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    factory = sessionmaker(bind=engine)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


@pytest.fixture()
def client(env):
    return TestClient(_app(env))


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", "1", route.path))
    for route in ar.router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(method, path):
    res = TestClient(_app(None)).request(method, path, json={})
    assert res.status_code == 401, res.text


@pytest.mark.parametrize("header", ["demo", WS_B])
def test_header_naming_another_tenant_posts_in_the_validated_workspace(client, posted, header):
    res = client.post(
        "/api/uae/ar/approve-and-post",
        json={"invoice_id": "inv-1"},
        headers={"X-Workspace-ID": header, "X-Tenant-ID": header},
    )
    assert res.status_code == 200, res.text
    assert posted[0]["tenant_id"] == WS_A


def test_body_workspace_must_match_the_active_workspace(client, posted):
    res = client.post("/api/uae/ar/approve-and-post", json={"invoice_id": "inv-1", "workspace_id": WS_B})
    assert res.status_code == 403
    assert posted == []
    ok = client.post("/api/uae/ar/approve-and-post", json={"invoice_id": "inv-1", "workspace_id": WS_A})
    assert ok.status_code == 200, ok.text


@pytest.mark.parametrize("path", ["/api/uae/ar/invoices", "/api/uae/ar/aging", "/api/uae/ar/dunning-history"])
def test_query_workspace_must_match_the_active_workspace(client, path):
    assert client.get(path, params={"workspace_id": WS_B, "company_id": "c1"}).status_code == 403


def test_non_members_get_403(client, env, posted):
    env.roles[WS_A] = None
    assert client.post("/api/uae/ar/approve-and-post", json={"invoice_id": "inv-1"}).status_code == 403
    assert posted == []


def test_viewers_cannot_post(client, env, posted):
    env.roles[WS_A] = "viewer"
    assert client.post("/api/uae/ar/approve-and-post", json={"invoice_id": "inv-1"}).status_code == 403
    assert posted == []


def test_approver_is_the_signed_in_user_not_a_header(client, posted):
    res = client.post(
        "/api/uae/ar/approve-and-post",
        json={"invoice_id": "inv-1"},
        headers={"x-user-email": "ceo@victim.example"},
    )
    assert res.status_code == 200, res.text
    assert posted[0]["approved_by"] == "a@example.com"
