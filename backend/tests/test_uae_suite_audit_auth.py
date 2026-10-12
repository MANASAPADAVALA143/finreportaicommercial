"""UAE suite summary and GulfTax audit export: login + workspace membership required,
tenant = validated workspace, and only companies inside it are readable."""

from __future__ import annotations

import os
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import gulftax_audit_routes as audit
from app.api.routes import uae_suite_routes as suite
from app.core import company_access
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.company_setup import UaeCompanyProfile
from app.models.workspace import WorkspaceRole
from app.modules.gulftax import auth_cfo, ported_mount

ported_mount._alias_ported_orm_modules()
ported_mount._patch_auth()

import database as ported_database  # noqa: E402
from models import Company  # noqa: E402

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "aaaaaaaa-1111-4000-8000-000000000001"
CO_B = "bbbbbbbb-1111-4000-8000-000000000002"


class Env:
    def __init__(self):
        self.workspace = WS_A
        self.roles = {WS_A: "viewer"}
        self.company_workspaces = {CO_A: [WS_A], CO_B: [WS_B]}

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
def calls(monkeypatch):
    seen: list[dict] = []

    def _record(result):
        def fake(*_args, **kwargs):
            seen.append(kwargs)
            return result
        return fake

    monkeypatch.setattr(suite, "build_uae_suite_summary", _record({"ok": True}))
    monkeypatch.setattr(suite, "resolve_ap_company_id", lambda *_a, **_k: None)
    monkeypatch.setattr(audit, "get_vat_periods", _record([]))
    monkeypatch.setattr(audit.audit_svc, "preview_period_manifest", _record({"rows": 0}))
    return seen


def _app(env: Env | None) -> FastAPI:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    ported_database.Base.metadata.create_all(engine, tables=[Company.__table__])
    Base.metadata.create_all(engine, tables=[UaeCompanyProfile.__table__])
    make = sessionmaker(bind=engine)
    db = make()
    db.add_all([
        Company(id=CO_A, name="Mine LLC", entity_type="mainland", workspace_id=WS_A),
        Company(id=CO_B, name="Victim LLC", entity_type="mainland", workspace_id=WS_B),
    ])
    db.commit()
    db.close()

    def _db():
        session = make()
        try:
            yield session
        finally:
            session.close()

    app = FastAPI()
    app.include_router(suite.router)
    app.include_router(audit.router)
    for dep in (get_db, ported_mount.get_ported_db, auth_cfo._ported_db):
        app.dependency_overrides[dep] = _db
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


@pytest.fixture()
def client(env):
    return TestClient(_app(env))


@pytest.mark.parametrize("path", [
    "/api/uae-suite/summary",
    "/api/gulftax/audit/periods",
    "/api/gulftax/audit/manifest/2026-Q1",
    "/api/gulftax/audit/pack/2026-Q1",
])
def test_routes_reject_requests_without_login(path):
    assert TestClient(_app(None)).get(path).status_code == 401


def test_suite_summary_uses_the_active_workspace_not_the_header(client, calls):
    res = client.get("/api/uae-suite/summary", headers={"X-Workspace-ID": WS_B, "X-Tenant-ID": WS_B})
    assert res.status_code == 200, res.text
    assert calls[-1]["tenant_id"] == WS_A


def test_suite_summary_refuses_another_workspaces_company(client, calls):
    assert client.get(f"/api/uae-suite/summary?company_id={CO_B}").status_code == 403
    assert client.get("/api/uae-suite/summary", headers={"X-Company-ID": CO_B}).status_code == 403
    assert calls == []
    assert client.get(f"/api/uae-suite/summary?company_id={CO_A}").status_code == 200
    assert calls[-1]["company_id"] == CO_A


def test_suite_summary_needs_membership(client, env):
    env.roles[WS_A] = None
    assert client.get("/api/uae-suite/summary").status_code == 403


def test_audit_export_scoped_to_active_workspace_and_company(client, calls):
    res = client.get("/api/gulftax/audit/manifest/2026-Q1",
                     headers={"X-Workspace-ID": WS_B, "X-Company-Id": CO_A, "X-User-Email": "ceo@victim.example"})
    assert res.status_code == 200, res.text
    assert calls[-1]["tenant_id"] == WS_A
    assert calls[-1]["company_id"] == CO_A
    assert calls[-1]["generated_by"] == "a@example.com"


def test_audit_export_refuses_other_workspace_or_company(client, calls):
    assert client.get(f"/api/gulftax/audit/periods?workspace_id={WS_B}").status_code == 403
    assert client.get("/api/gulftax/audit/periods", headers={"X-Company-Id": CO_B}).status_code == 403
    assert client.get("/api/gulftax/audit/pack/2026-Q1", headers={"X-Company-Id": CO_B}).status_code == 403
    assert calls == []
