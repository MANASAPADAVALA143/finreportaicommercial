"""Internal audit (audit intelligence, command center, audit log): login required; data stays inside the caller's workspace."""

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

from app.api.routes import audit_command_center, audit_intelligence, audit_log_routes
from app.core import company_access
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.audit_intelligence import AuditRun
from app.models.workspace import WorkspaceRole
from app.models.workspace_audit import WorkspaceAuditLog
from app.modules.gulftax.ported_mount import get_ported_db

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
ROUTERS = (audit_intelligence.router, audit_command_center.router, audit_log_routes.router)


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
    monkeypatch.setattr(audit_intelligence, "invoke_audit_json", lambda *_a, **_k: {})
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[AuditRun.__table__, WorkspaceAuditLog.__table__])
    return sessionmaker(bind=engine)


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_ported_db] = _db
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


@pytest.fixture()
def client(factory, env):
    return TestClient(_app(factory, env))


def _add(factory, *rows) -> list[int | str]:
    db = factory()
    try:
        db.add_all(rows)
        db.commit()
        return [r.id for r in rows]
    finally:
        db.close()


def _run(workspace_id: str | None, agent_type: str = "evidence-collector", full_result: dict | None = None) -> AuditRun:
    return AuditRun(workspace_id=workspace_id, agent_type=agent_type, full_result=full_result or {})


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", "1", route.path))
    for router in ROUTERS
    for route in router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    _add(factory, _run(WS_A))
    res = TestClient(_app(factory, None)).request(method, path, json={})
    assert res.status_code == 401, res.text


def test_agent_runs_are_tagged_with_callers_workspace(client, factory):
    res = client.post(
        "/api/audit/controls-tester",
        data={"process_description": "p", "control_type": "c", "company_size": "s"},
    )
    assert res.status_code == 200, res.text
    db = factory()
    try:
        assert db.get(AuditRun, res.json()["run_id"]).workspace_id == WS_A
    finally:
        db.close()


def test_runs_are_isolated_between_workspaces(client, factory):
    mine, theirs, legacy = _add(factory, _run(WS_A), _run(WS_B), _run(None))

    assert [r["id"] for r in client.get("/api/audit/runs").json()["runs"]] == [mine]
    assert client.get(f"/api/audit/runs/{mine}/evidence-checklist.xlsx").status_code == 200
    for rid in (theirs, legacy):
        for suffix in ("pdf", "evidence-checklist.xlsx", "management-letter.docx"):
            assert client.get(f"/api/audit/runs/{rid}/{suffix}").status_code == 404


def test_viewer_can_read_but_not_run_agents_and_non_member_is_refused(client, env, factory):
    (mine,) = _add(factory, _run(WS_A))
    env.roles[WS_A] = "viewer"
    assert client.get("/api/audit/runs").status_code == 200
    assert client.get(f"/api/audit/runs/{mine}/evidence-checklist.xlsx").status_code == 200
    assert client.post(
        "/api/audit/controls-tester",
        data={"process_description": "p", "control_type": "c", "company_size": "s"},
    ).status_code == 403

    env.roles.pop(WS_A)
    assert client.get("/api/audit/runs").status_code == 403
    assert client.get("/api/audit/log").status_code == 403
    assert client.post("/api/audit/narrative", json={"period": "2026-Q3"}).status_code == 403


def test_other_workspace_ids_in_body_or_query_are_refused(client):
    q = f"period=2026-Q3&workspace_id={WS_B}&company_id=c1"
    assert client.get(f"/api/r2r/pattern/summary?{q}").status_code == 403
    assert client.get(f"/api/ap-invoices/anomaly/summary?{q}").status_code == 403
    assert client.get(f"/api/audit/log?workspace_id={WS_B}").status_code == 403
    assert client.post(
        "/api/audit/command-center/score",
        json={"period": "2026-Q3", "workspace_id": WS_B, "company_id": "c1"},
    ).status_code == 403
    assert client.post(
        "/api/audit/going-concern",
        json={"workspace_id": WS_B, "company_id": "c1", "period": "2026-Q3"},
    ).status_code == 403


def test_audit_log_only_returns_callers_workspace(client, factory):
    _add(
        factory,
        WorkspaceAuditLog(workspace_id=WS_A, action="a", entity_type="t"),
        WorkspaceAuditLog(workspace_id=WS_B, action="b", entity_type="t"),
    )
    entries = client.get("/api/audit/log").json()["entries"]
    assert [e["workspace_id"] for e in entries] == [WS_A]


def test_command_center_ignores_other_workspaces_going_concern_runs(client, factory, monkeypatch):
    monkeypatch.setattr(audit_command_center, "compute_command_center_score", lambda *_a, **_k: {})
    forged = {"period": "2026-Q3", "workspace_id": WS_A, "company_id": "c1", "going_concern_level": "high"}
    _add(factory, _run(WS_B, "going_concern", forged))
    res = client.post(
        "/api/audit/command-center/score",
        json={"period": "2026-Q3", "workspace_id": WS_A, "company_id": "c1"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["going_concern_run_id"] is None
