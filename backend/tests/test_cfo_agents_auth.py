"""CFO agent queue + briefing: login required, tenant always comes from the caller's workspace."""

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

from app.api.routes import cfo_agents
from app.core import company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models import cfo_command_center as m
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
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (m.CFOAgentRun, m.CFOAgentLog, m.CFOAgentOutput, m.CFOBriefing, m.CFOAlert):
        model.__table__.create(engine)
    f = sessionmaker(bind=engine)
    db = f()
    db.add_all([
        m.CFOAgentRun(run_id="run-a", tenant_id=WS_A, agent_name="recon", status=m.CFOAgentRunStatus.completed),
        m.CFOAgentRun(run_id="run-b", tenant_id=WS_B, agent_name="recon", status=m.CFOAgentRunStatus.completed),
        m.CFOAlert(id=1, tenant_id=WS_A, agent_name="recon", title="A alert"),
        m.CFOAlert(id=2, tenant_id=WS_B, agent_name="recon", title="B alert"),
    ])
    db.commit()
    db.close()
    return f


@pytest.fixture()
def queued(monkeypatch):
    calls: list[str] = []

    def create(_db, tenant_id, agent_name, _context):
        calls.append(tenant_id)
        return SimpleNamespace(run_id="new", id=99)

    monkeypatch.setattr(cfo_agents, "create_queued_run", create)
    monkeypatch.setattr(cfo_agents, "execute_cfo_agent_task", lambda _id: None)
    monkeypatch.setattr(cfo_agents, "list_agent_names", lambda: ["recon"])
    return calls


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(cfo_agents.agents_router)
    app.include_router(cfo_agents.briefing_router)

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
def client(factory, env, queued):
    return TestClient(_app(factory, env), headers={"X-Tenant-ID": WS_B})


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", "1", route.path))
    for router in (cfo_agents.agents_router, cfo_agents.briefing_router)
    for route in router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


def test_no_unauthenticated_stream_route():
    assert all(isinstance(r, APIRoute) for r in cfo_agents.agents_router.routes)


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m_} {p}" for m_, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(
        method, path, json={"context": {}, "question": "q"}, headers={"X-Tenant-ID": WS_A}
    )
    assert res.status_code == 401, res.text


def test_status_and_runs_ignore_spoofed_tenant_header(client):
    status = client.get("/api/agents/status").json()["agents"]
    assert [a["last_run_id"] for a in status] and all(a["last_run_id"] in (None, "run-a") for a in status)
    assert client.get("/api/agents/runs/run-a").status_code == 200
    assert client.get("/api/agents/runs/run-b").status_code == 404


def test_alerts_are_scoped(client):
    assert [a["title"] for a in client.get("/api/agents/alerts").json()["alerts"]] == ["A alert"]
    assert client.patch("/api/agents/alerts/2/dismiss").status_code == 404
    assert client.patch("/api/agents/alerts/1/dismiss").status_code == 200


def test_run_is_queued_for_callers_workspace(client, queued):
    assert client.post("/api/agents/run/recon", json={"context": {}}).status_code == 200
    assert queued == [WS_A]


def test_briefing_uses_callers_workspace(client, monkeypatch):
    seen: list[str] = []
    monkeypatch.setattr(cfo_agents.cfo_briefing_service, "get_briefing_today", lambda _db, t: seen.append(t))
    assert client.get("/api/briefing/today").status_code == 200
    assert seen == [WS_A]


def test_viewer_can_read_but_not_run_or_dismiss(client, env, queued):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/agents/status").status_code == 200
    assert client.post("/api/agents/run/recon", json={"context": {}}).status_code == 403
    assert client.patch("/api/agents/alerts/1/dismiss").status_code == 403
    assert client.post("/api/briefing/generate").status_code == 403
    assert queued == []


def test_non_member_is_forbidden(client, env):
    env.roles.pop(WS_A)
    assert client.get("/api/agents/status").status_code == 403
