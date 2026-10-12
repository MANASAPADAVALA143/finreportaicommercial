"""Command Center brief + board pack: login required and only the caller's workspace runs are visible."""

from __future__ import annotations

import os
import sys
import tempfile
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import agent_brief
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
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    return e


def _engine(with_tenant: bool = True):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE agent_runs (id INTEGER PRIMARY KEY, agent_name VARCHAR(128), insight TEXT, "
            "urgency VARCHAR(10), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
            + (", tenant_id VARCHAR(64))" if with_tenant else ")")
        ))
    return engine


def _seed(engine):
    rows = [
        (f"r2r_pattern:{WS_A}", '{"what_happened": "A insight"}', "red", WS_A, "datetime('now')"),
        (f"r2r_pattern:{WS_B}", '{"what_happened": "B insight"}', "yellow", WS_B, "datetime('now')"),
        ("fpa_variance", '{"what_happened": "untagged global"}', "red", None, "datetime('now')"),
        (f"r2r_pattern:{WS_A}:old", '{"what_happened": "A old"}', "green", WS_A, "datetime('now', '-3 day')"),
    ]
    with engine.begin() as conn:
        for name, insight, urgency, tenant, created in rows:
            conn.execute(
                text(
                    "INSERT INTO agent_runs (agent_name, insight, urgency, tenant_id, created_at) "
                    f"VALUES (:n, :i, :u, :t, {created})"
                ),
                {"n": name, "i": insight, "u": urgency, "t": tenant},
            )


def _app(engine, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(agent_brief.router)
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
def engine():
    e = _engine()
    _seed(e)
    return e


@pytest.fixture()
def client(engine, env):
    return TestClient(_app(engine, env))


@pytest.fixture()
def board_pack(monkeypatch):
    calls: dict = {}

    async def content(results):
        calls["results"] = results
        return {"summary": "ok"}

    async def pdf(_content, filename):
        calls["filename"] = filename
        return os.path.join(tempfile.gettempdir(), filename)

    async def no_sleep(_s):
        return None

    monkeypatch.setitem(sys.modules, "app.agents.intelligence", SimpleNamespace(generate_board_pack_content=content))
    monkeypatch.setitem(sys.modules, "app.board_pack_generator", SimpleNamespace(generate_pdf=pdf))
    monkeypatch.setattr(agent_brief, "asyncio", SimpleNamespace(sleep=no_sleep))
    return calls


ROUTES = [
    ("POST", "/api/agents/run"),
    ("GET", "/api/agents/latest-brief"),
    ("POST", "/api/board-pack/generate"),
    ("GET", f"/api/board-pack/download-file/board_pack_{WS_A}_2026_10.pdf"),
]


def test_every_route_is_covered():
    assert {r.path for r in agent_brief.router.routes} == {
        "/api/agents/run", "/api/agents/latest-brief", "/api/board-pack/generate",
        "/api/board-pack/download-file/{filename}",
    }


@pytest.mark.parametrize("method,path", ROUTES, ids=[p for _, p in ROUTES])
def test_routes_reject_requests_without_login(engine, method, path):
    res = TestClient(_app(engine, None)).request(method, path, headers={"X-Workspace-ID": WS_A})
    assert res.status_code == 401, res.text


def _agents(brief: dict) -> list[str]:
    return [a["insight"]["what_happened"] for bucket in brief["alerts"].values() for a in bucket]


def test_brief_returns_only_own_recent_runs(client, env):
    a = client.get("/api/agents/latest-brief").json()
    assert _agents(a) == ["A insight"] and a["total_agents_run"] == 1
    assert a["alerts"]["red"][0]["agent"] == "r2r_pattern"

    env.workspace = WS_B
    assert _agents(client.get("/api/agents/latest-brief").json()) == ["B insight"]


def test_brief_is_empty_without_tenant_column(env):
    engine = _engine(with_tenant=False)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO agent_runs (agent_name, insight, urgency) VALUES ('x', '{}', 'red')"))
    brief = TestClient(_app(engine, env)).get("/api/agents/latest-brief").json()
    assert brief["total_agents_run"] == 0 and _agents(brief) == []


def test_board_pack_uses_only_own_runs_and_workspace_filename(client, board_pack):
    res = client.post("/api/board-pack/generate")
    assert res.status_code == 200
    assert board_pack["results"] == {"r2r_pattern": {"what_happened": "A insight"}}
    assert board_pack["filename"].startswith(f"board_pack_{WS_A}_")
    assert f'"pdf_path": "{board_pack["filename"]}"' in res.text


def test_download_only_own_board_pack(client, env):
    name = f"board_pack_{WS_A}_2099_01.pdf"
    path = os.path.join(tempfile.gettempdir(), name)
    with open(path, "wb") as fh:
        fh.write(b"%PDF-1.4 test")
    try:
        ok = client.get(f"/api/board-pack/download-file/{name}")
        assert ok.status_code == 200 and ok.content.startswith(b"%PDF")

        env.workspace = WS_B
        assert client.get(f"/api/board-pack/download-file/{name}").status_code == 404
    finally:
        os.remove(path)

    env.workspace = WS_A
    for bad in (f"board_pack_{WS_A}_missing.pdf", "board_pack_2026_10.pdf", f"board_pack_{WS_A}_x.txt", "..%2F..%2Fetc%2Fpasswd"):
        assert client.get(f"/api/board-pack/download-file/{bad}").status_code == 404, bad


@pytest.fixture()
def queued(monkeypatch):
    calls: list[str] = []

    def create(_db, tenant_id, agent_name, _context):
        calls.append(tenant_id)
        return SimpleNamespace(run_id="new", id=1)

    monkeypatch.setitem(sys.modules, "app.agents.command_center.registry", SimpleNamespace(list_agent_names=lambda: ["recon"]))
    monkeypatch.setitem(
        sys.modules,
        "app.services.cfo_orchestrator_service",
        SimpleNamespace(create_queued_run=create, execute_cfo_agent_task=lambda _id: None),
    )
    return calls


def test_agent_run_is_tagged_with_callers_workspace(client, env, queued):
    assert client.post("/api/agents/run", json={"agent_name": "recon"}).status_code == 200
    env.workspace = WS_B
    assert client.post("/api/agents/run", json={"agent_name": "recon"}).status_code == 200
    assert queued == [WS_A, WS_B]
    assert client.post("/api/agents/run", json={"agent_name": "nope"}).status_code == 400


def test_agent_run_needs_write_access(client, env, queued):
    env.roles[WS_A] = "viewer"
    assert client.post("/api/agents/run", json={"agent_name": "recon"}).status_code == 403
    env.roles.pop(WS_A)
    assert client.post("/api/agents/run", json={"agent_name": "recon"}).status_code == 403
    assert queued == []


def test_viewer_can_read_and_non_member_is_forbidden(client, env, board_pack):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/agents/latest-brief").status_code == 200
    env.roles.pop(WS_A)
    assert client.get("/api/agents/latest-brief").status_code == 403
    assert client.post("/api/board-pack/generate").status_code == 403
    assert client.get(f"/api/board-pack/download-file/board_pack_{WS_A}_2026_10.pdf").status_code == 403
