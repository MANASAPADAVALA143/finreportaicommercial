"""IFRS week-1, IFRS agentic, board-pack finalize: login required; X-Tenant-ID must be an accessible tenant."""

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

import app.models.ifrs_agentic as agentic_models
import app.models.ifrs_statement as ifrs_models
from app.api.routes import board_pack_routes, ifrs_agentic, ifrs_statements, ifrs_week1
from app.core import company_access
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
FOREIGN_COMPANY = "cccccccc-0000-4000-8000-000000000003"


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


def _model_tables(*modules):
    return [
        obj.__table__
        for mod in modules
        for obj in vars(mod).values()
        if isinstance(obj, type) and hasattr(obj, "__table__") and obj.__module__ == mod.__name__
    ]


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=_model_tables(ifrs_models, agentic_models))
    return sessionmaker(bind=engine)


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(ifrs_week1.router, prefix="/api/ifrs")
    app.include_router(ifrs_agentic.router)
    app.include_router(board_pack_routes.router, prefix="/api/board-pack")
    app.include_router(ifrs_statements.router)

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


def _tb(factory, tenant: str) -> int:
    db = factory()
    try:
        tb = ifrs_models.TrialBalance(tenant_id=tenant, company_name="Acme", file_name="tb.csv")
        db.add(tb)
        db.commit()
        return tb.id
    finally:
        db.close()


def _routes(router, prefix: str = ""):
    return [
        (method, prefix + re.sub(r"\{[^}]+\}", "1", route.path))
        for route in router.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    ]


PUBLIC_BOARD_PACK = {"/api/board-pack/download/1", "/api/board-pack/view/1"}
ROUTES = (
    _routes(ifrs_week1.router, "/api/ifrs")
    + _routes(ifrs_agentic.router)
    + [r for r in _routes(board_pack_routes.router, "/api/board-pack") if r[1] not in PUBLIC_BOARD_PACK]
    + [("GET", "/api/ifrs/mapping-templates")]
)


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(method, path, json={}, headers={"X-Tenant-ID": "default"})
    assert res.status_code == 401, res.text


def test_board_pack_share_links_stay_public(factory):
    anon = TestClient(_app(factory, None))
    assert anon.get("/api/board-pack/view/nope").status_code == 404
    assert anon.get("/api/board-pack/download/nope").status_code == 404


def test_trial_balances_are_isolated_between_workspaces(client, env, factory):
    tb = _tb(factory, WS_A)
    assert client.get(f"/api/ifrs/trial-balance/{tb}").status_code == 200

    env.workspace = WS_B
    assert client.get(f"/api/ifrs/trial-balance/{tb}").status_code == 404
    assert client.get(f"/api/ifrs/trial-balance/{tb}", headers={"X-Tenant-ID": WS_A}).status_code == 404
    assert client.get(f"/api/ifrs/trial-balance/{tb}", headers={"X-Tenant-ID": FOREIGN_COMPANY}).status_code == 404


def test_default_label_is_namespaced_per_workspace(client, env, factory):
    tb = _tb(factory, f"ws:{WS_A}:default")
    assert client.get(f"/api/ifrs/trial-balance/{tb}", headers={"X-Tenant-ID": "default"}).status_code == 200
    _tb(factory, "default")

    env.workspace = WS_B
    assert client.get(f"/api/ifrs/trial-balance/{tb}", headers={"X-Tenant-ID": "default"}).status_code == 404


def test_saved_templates_are_scoped(client, env):
    body = {
        "template_name": "Mine",
        "entries": [{
            "gl_code": "1000", "gl_description": "Cash", "ifrs_statement": "balance_sheet",
            "ifrs_section": "Current assets", "ifrs_line_item": "Cash and cash equivalents",
        }],
    }
    assert client.post("/api/ifrs/mapping-templates/from-coa", json=body).status_code == 200
    assert len(client.get("/api/ifrs/mapping-templates").json()["saved_templates"]) == 1

    env.workspace = WS_B
    assert client.get("/api/ifrs/mapping-templates").json()["saved_templates"] == []


def test_viewer_can_read_but_not_write_and_non_member_is_refused(client, env, factory):
    tb = _tb(factory, WS_A)
    env.roles[WS_A] = "viewer"
    assert client.get(f"/api/ifrs/trial-balance/{tb}").status_code == 200
    assert client.post(f"/api/ifrs/trial-balance/{tb}/generate-statements").status_code == 403
    assert client.post("/api/ifrs/agentic/start", json={"trial_balance_id": tb}).status_code == 403

    env.roles.pop(WS_A)
    assert client.get(f"/api/ifrs/trial-balance/{tb}").status_code == 403


def test_generate_statements_pins_module_data_to_callers_scope(client, env, factory, monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr("app.services.statement_generator.ensure_prior_tb_column", lambda _db: None)
    monkeypatch.setattr(ifrs_week1, "generate_all_statements", lambda *a, **kw: calls.append(kw) or {"ok": True})
    tb = _tb(factory, WS_A)
    other_tb = _tb(factory, WS_B)

    spoofed = {"X-Company-Id": FOREIGN_COMPANY, "X-Workspace-Id": WS_B}
    assert client.post(f"/api/ifrs/trial-balance/{tb}/generate-statements", headers=spoofed).status_code == 404
    assert client.post(
        f"/api/ifrs/trial-balance/{tb}/generate-statements", json={"prior_trial_balance_id": other_tb}
    ).status_code == 404
    assert calls == []

    res = client.post(f"/api/ifrs/trial-balance/{tb}/generate-statements", headers={"X-Workspace-Id": WS_B})
    assert res.status_code == 200, res.text
    assert calls[0]["company_id"] == WS_A and calls[0]["workspace_id"] == WS_A


def test_agentic_runs_are_isolated(client, env, factory, monkeypatch):
    monkeypatch.setattr(ifrs_agentic, "execute_agentic_pipeline", lambda *a, **kw: None)
    tb = _tb(factory, WS_A)
    other_tb = _tb(factory, WS_B)

    assert client.post("/api/ifrs/agentic/start", json={"trial_balance_id": other_tb}).status_code == 404
    assert client.post(
        "/api/ifrs/agentic/start", json={"trial_balance_id": tb, "prior_trial_balance_id": other_tb}
    ).status_code == 404
    started = client.post("/api/ifrs/agentic/start", json={"trial_balance_id": tb})
    assert started.status_code == 200, started.text
    run_id = started.json()["run_id"]
    assert client.get(f"/api/ifrs/agentic/{run_id}/status").status_code == 200

    env.workspace = WS_B
    assert client.get(f"/api/ifrs/agentic/{run_id}/status").status_code == 404
    assert client.get(f"/api/ifrs/agentic/{run_id}/status", headers={"X-Tenant-ID": WS_A}).status_code == 404
    assert client.post(f"/api/ifrs/agentic/{run_id}/human-input", json={"action": "abort"}).status_code == 404


def test_board_pack_finalize_is_scoped(client, env, factory):
    tb = _tb(factory, WS_A)
    db = factory()
    try:
        bp = ifrs_models.BoardPack(
            tenant_id=WS_A, trial_balance_id=tb, company_name="Acme", pdf_path="x.pdf", public_token="tok-1"
        )
        db.add(bp)
        db.commit()
        bp_id = bp.id
    finally:
        db.close()

    env.workspace = WS_B
    assert client.post(f"/api/board-pack/{bp_id}/finalize", json={}).status_code == 404
    env.workspace = WS_A
    env.roles[WS_A] = "viewer"
    assert client.post(f"/api/board-pack/{bp_id}/finalize", json={}).status_code == 403
