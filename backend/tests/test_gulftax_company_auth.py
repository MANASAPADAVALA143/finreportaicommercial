"""Ported GulfTax routers: FinReportAI login + workspace membership required, and a company
(X-Company-Id header, company_id query/path) is only usable inside the caller's workspace."""

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

from app.core import company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole
from app.modules.gulftax import auth_cfo, ported_mount

ported_mount._alias_ported_orm_modules()
ported_mount._patch_auth()

import database as ported_database  # noqa: E402
from models import Company, Transaction  # noqa: E402
from routers.auth_router import router as auth_router  # noqa: E402
from routers.automations import router as automations_router  # noqa: E402
from routers.corporate_tax import router as corporate_tax_router  # noqa: E402
from routers.dashboard import router as dashboard_router  # noqa: E402
from routers.einvoicing import router as einvoicing_router  # noqa: E402
from routers.fta_reports import router as fta_reports_router  # noqa: E402
from routers.invoice_flow import router as invoice_flow_router  # noqa: E402
from routers import vat_classifier  # noqa: E402
from routers.vat_return import gulftax_vat_router, router as vat_return_router  # noqa: E402

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "co-a"
CO_B = "co-b"
EXT = "cccccccc-0000-4000-8000-000000000003"
ROUTERS = [
    (auth_router, {}), (dashboard_router, {}), (vat_return_router, {}), (gulftax_vat_router, {}),
    (vat_classifier.router, {}), (automations_router, {"prefix": "/api/automations"}),
    (corporate_tax_router, {"prefix": "/api/ct"}), (einvoicing_router, {}),
    (invoice_flow_router, {}), (fta_reports_router, {}),
]


class Env:
    def __init__(self):
        self.workspace = WS_A
        self.roles = {WS_A: "accountant", WS_B: "owner"}
        self.company_workspaces: dict[str, list[str]] = {}

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
    monkeypatch.setattr(company_access, "_company_workspace_ids",
                        lambda _db, cid: iter(e.company_workspaces.get(cid, [])))
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    ported_database.Base.metadata.create_all(engine, tables=[Company.__table__, Transaction.__table__])
    make = sessionmaker(bind=engine)
    db = make()
    db.add_all([
        Company(id=CO_A, name="Mine LLC", entity_type="mainland", workspace_id=WS_A, trn="100000000000001"),
        Company(id=CO_B, name="Victim LLC", entity_type="mainland", workspace_id=WS_B, trn="100000000000002"),
    ])
    db.commit()
    db.close()
    return make


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    for router, kw in ROUTERS:
        auth_cfo.include_guarded(app, router, **kw)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[ported_database.get_db] = _db
    app.dependency_overrides[auth_cfo._ported_db] = _db
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


@pytest.fixture()
def client(factory, env):
    return TestClient(_app(factory, env))


def _routes(routes, prefix: str = "", deps: tuple = ()):
    """(full path, route, include-level dependency callables), flattening nested includes."""
    out = []
    for route in routes:
        original = getattr(route, "original_router", None)
        if original is not None:
            include = route.include_context
            out += _routes(original.routes, prefix + include.prefix,
                           deps + tuple(d.dependency for d in include.dependencies))
        elif isinstance(route, APIRoute):
            out.append((prefix + route.path, route, deps))
    return out


ALL_ROUTES = _routes(_app(lambda: None, None).routes)
GUARDED = [
    (method, re.sub(r"\{[^}]+\}", "1", path))
    for path, route, _deps in ALL_ROUTES
    if auth_cfo.WEBHOOK_MARKER not in path
    for method in route.methods
]


@pytest.mark.parametrize("method,path", GUARDED, ids=[f"{m} {p}" for m, p in GUARDED])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(method, path, json={})
    assert res.status_code == 401, res.text


def test_signed_webhooks_stay_outside_the_login_guard():
    hooks = [(route, deps) for path, route, deps in ALL_ROUTES if auth_cfo.WEBHOOK_MARKER in path]
    assert len(hooks) == 4
    for route, deps in hooks:
        calls = {d.call for d in route.dependant.dependencies} | set(deps)
        assert auth_cfo.gulftax_guard not in calls and validate_workspace not in calls
    assert all(auth_cfo.gulftax_guard in deps for path, _r, deps in ALL_ROUTES
               if auth_cfo.WEBHOOK_MARKER not in path)


def test_own_company_is_usable(client):
    res = client.get("/api/gulftax/auth/company-profile", headers={"X-Company-Id": CO_A})
    assert res.status_code == 200, res.text
    assert res.json()["company_name"] == "Mine LLC"


def test_another_workspaces_company_is_refused(client):
    res = client.get("/api/gulftax/auth/company-profile", headers={"X-Company-Id": CO_B})
    assert res.status_code == 403


@pytest.mark.parametrize("path", [
    "/api/invoice/repair-transactions?company_id=co-b",
    "/api/gulftax/vat-return/all-boxes?period=2026-Q3&company_id=co-b",
    "/api/einvoicing/readiness/co-b",
])
def test_company_id_in_query_or_path_is_checked(client, env, path):
    env.roles[WS_A] = "owner"
    assert client.get(path).status_code == 403


def test_workspace_header_naming_another_workspace_does_not_pick_its_company(client):
    res = client.get("/api/gulftax/auth/company-profile",
                     headers={"X-Workspace-Id": WS_B, "X-Tenant-ID": WS_B})
    assert res.status_code == 200, res.text
    assert res.json()["company_id"] == CO_A


def test_unknown_external_company_is_refused_and_not_provisioned(client, factory):
    res = client.get("/api/gulftax/auth/company-profile", headers={"X-Company-Id": EXT})
    assert res.status_code == 403
    db = factory()
    assert db.query(Company).filter(Company.external_id == EXT).count() == 0
    db.close()


def test_accessible_external_company_is_provisioned_in_the_active_workspace(client, env, factory):
    env.company_workspaces[EXT] = [WS_A]
    res = client.get("/api/gulftax/auth/company-profile", headers={"X-Company-Id": EXT})
    assert res.status_code == 200, res.text
    db = factory()
    row = db.query(Company).filter(Company.external_id == EXT).one()
    assert row.workspace_id == WS_A
    db.close()


def test_non_members_get_403(client, env):
    env.roles[WS_A] = None
    assert client.get("/api/gulftax/auth/company-profile", headers={"X-Company-Id": CO_A}).status_code == 403


def test_viewers_cannot_write_or_run_get_repairs(client, env):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/gulftax/auth/company-profile", headers={"X-Company-Id": CO_A}).status_code == 200
    res = client.patch("/api/gulftax/auth/company-profile", json={"company_name": "x"},
                       headers={"X-Company-Id": CO_A})
    assert res.status_code == 403
    assert client.get("/api/invoice/repair-transactions?company_id=co-a").status_code == 403


@pytest.mark.parametrize("method,path", [
    ("POST", "/api/gulftax/auth/regenerate-api-key"),
    ("PATCH", "/api/gulftax/auth/company-settings"),
    ("DELETE", "/api/vat/transactions/all"),
    ("DELETE", "/api/invoice/demo/reset"),
])
def test_accountants_cannot_rotate_keys_change_settings_or_bulk_delete(client, method, path):
    res = client.request(method, path, json={"settings": {}}, headers={"X-Company-Id": CO_A})
    assert res.status_code == 403


def test_managers_can_rotate_the_api_key(client, env):
    env.roles[WS_A] = "finance_manager"
    res = client.post("/api/gulftax/auth/regenerate-api-key", headers={"X-Company-Id": CO_A})
    assert res.status_code == 200, res.text
    assert res.json()["settings"]["api_key"].startswith("gt_live_")


def test_bulk_excel_only_downloads_for_the_owning_company(client, monkeypatch, tmp_path):
    path = tmp_path / "x.xlsx"
    path.write_bytes(b"x")
    monkeypatch.setitem(vat_classifier._BULK_CLASSIFY_EXCEL_PATHS, "job-b", (CO_B, str(path)))
    monkeypatch.setitem(vat_classifier._BULK_CLASSIFY_EXCEL_PATHS, "job-a", (CO_A, str(path)))
    headers = {"X-Company-Id": CO_A}
    assert client.get("/api/vat/classify-bulk/job-b/excel", headers=headers).status_code == 404
    assert client.get("/api/vat/classify-bulk/job-a/excel", headers=headers).status_code == 200
