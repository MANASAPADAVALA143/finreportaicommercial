"""Bank reconciliation: login required; recon workspaces scoped to the caller's workspace or accessible company."""

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

import app.models.bank_recon as recon_models
from app.api.routes import bank_recon
from app.core import company_access
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
FOREIGN_COMPANY = "cccccccc-0000-4000-8000-000000000003"

NEW_WS = {"workspace_name": "Sept bank", "period_start": "2026-09-01", "period_end": "2026-09-30"}


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
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))

    def company_check(_db, ctx, company_id, _level):
        raise company_access.HTTPException(status_code=404, detail="Company not found")

    monkeypatch.setattr("app.core.history_scope.require_company_access", company_check)
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    tables = [t for t in Base.metadata.sorted_tables if t.name in {
        "recon_workspaces", "match_groups", "book_transactions", "bank_transactions",
        "subledger_transactions", "recon_adjustments", "recon_exceptions", "recon_audit_trail",
    }]
    Base.metadata.create_all(engine, tables=tables)
    return sessionmaker(bind=engine)


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(bank_recon.router)

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
def client(factory, env):
    return TestClient(_app(factory, env))


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", "1", route.path))
    for route in bank_recon.router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(method, path + "?tenant_id=default", json={})
    assert res.status_code == 401, res.text


def test_workspaces_are_isolated_between_workspaces(client, env):
    created = client.post("/api/recon/workspace", json=NEW_WS)
    assert created.status_code == 200
    rid = created.json()["id"]
    assert [w["id"] for w in client.get("/api/recon/workspaces").json()] == [rid]
    assert client.get(f"/api/recon/workspace/{rid}").status_code == 200

    env.workspace = WS_B
    assert client.get("/api/recon/workspaces").json() == []
    assert client.get(f"/api/recon/workspace/{rid}").status_code == 404
    assert client.get(f"/api/recon/workspace/{rid}?tenant_id={WS_A}").status_code == 404
    assert client.post(f"/api/recon/workspace/{rid}/preparer-signoff").status_code == 404


def test_spoofed_or_shared_tenant_values_are_contained(client, env):
    assert client.get(f"/api/recon/workspaces?tenant_id={FOREIGN_COMPANY}").status_code == 404
    assert client.post("/api/recon/workspace?tenant_id=default", json=NEW_WS).status_code == 200

    db_rows = client.get("/api/recon/workspaces?tenant_id=default").json()
    assert len(db_rows) == 1

    env.workspace = WS_B
    assert client.get("/api/recon/workspaces?tenant_id=default").json() == []


def test_viewer_can_read_but_not_write(client, env):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/recon/workspaces").status_code == 200
    assert client.post("/api/recon/workspace", json=NEW_WS).status_code == 403
    env.roles.pop(WS_A)
    assert client.get("/api/recon/workspaces").status_code == 403


def test_matching_run_tags_agent_run_with_callers_workspace(client, monkeypatch):
    calls: list[tuple] = []

    async def worker(job_id, recon_id, tenant_id, owner_workspace_id):
        calls.append((recon_id, tenant_id, owner_workspace_id))

    monkeypatch.setattr(bank_recon, "_matching_worker", worker)
    rid = client.post("/api/recon/workspace", json=NEW_WS).json()["id"]
    assert client.post(f"/api/recon/workspace/{rid}/run-matching").status_code == 200
    assert calls == [(rid, WS_A, WS_A)]
