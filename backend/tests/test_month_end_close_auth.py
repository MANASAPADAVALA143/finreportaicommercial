"""Month-end close: login required; close runs and trackers are visible only inside the caller's workspace."""

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
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.month_end_close import CloseRun
from app.models.workspace import WorkspaceRole
from app.routers import month_end_close as close

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
    monkeypatch.setattr(company_access, "_company_workspace_ids", lambda _db, _cid: [])
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[CloseRun.__table__])
    return sessionmaker(bind=engine)


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(close.router)

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


def _run(factory, run_id: str, workspace_id: str | None, entity_id: str = "E1", status: str = "started") -> None:
    db = factory()
    try:
        db.add(CloseRun(
            run_id=run_id, workspace_id=workspace_id, entity_id=entity_id, period="2026-09",
            currency="INR", status=status, checks_json={"items": []}, snapshot_json={}, audit_trail=[],
        ))
        db.commit()
    finally:
        db.close()


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", "r1", route.path))
    for route in close.router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    _run(factory, "r1", WS_A)
    res = TestClient(_app(factory, None)).request(method, path + "?period=2026-09", json={})
    assert res.status_code == 401, res.text


def test_start_tags_run_with_callers_workspace(client, factory):
    multipart = client.post("/api/close/start", data={"entity_id": "E1", "period": "2026-09"})
    as_json = client.post("/api/close/start-json", json={"entity_id": "E1", "period": "2026-09"})
    assert multipart.status_code == 200, multipart.text
    assert as_json.status_code == 200, as_json.text
    db = factory()
    try:
        for res in (multipart, as_json):
            assert db.get(CloseRun, res.json()["run_id"]).workspace_id == WS_A
    finally:
        db.close()


def test_runs_are_isolated_between_workspaces(client, factory):
    _run(factory, "mine", WS_A)
    _run(factory, "theirs", WS_B)
    _run(factory, "legacy", None)

    assert client.get("/api/close/status/mine").status_code == 200
    assert client.get("/api/close/report/mine/pdf").status_code != 404
    assert [r["run_id"] for r in client.get("/api/close/history").json()["runs"]] == ["mine"]
    for rid in ("theirs", "legacy"):
        assert client.get(f"/api/close/status/{rid}").status_code == 404
        assert client.get(f"/api/close/report/{rid}/pdf").status_code == 404
        assert client.post(f"/api/close/run-checks/{rid}").status_code == 404
        assert client.post(f"/api/close/approve/{rid}", json={"approver": "x"}).status_code == 404


def test_tracker_is_scoped_to_callers_workspace(client, env, factory):
    _run(factory, "their-tracker", WS_B, entity_id=WS_B, status="tracker")

    own = client.get(f"/api/close/{WS_A}?period=2026-09")
    assert own.status_code == 200, own.text
    assert own.json()["run_id"] != "their-tracker"

    assert client.get(f"/api/close/{WS_B}?period=2026-09").status_code == 403
    assert client.patch(
        f"/api/close/{WS_B}/items/tb_import?period=2026-09", json={"completed": True}
    ).status_code == 403

    db = factory()
    try:
        assert db.get(CloseRun, own.json()["run_id"]).workspace_id == WS_A
    finally:
        db.close()


def test_viewer_can_read_but_not_write_and_non_member_is_refused(client, env, factory):
    _run(factory, "mine", WS_A)
    env.roles[WS_A] = "viewer"
    assert client.get("/api/close/status/mine").status_code == 200
    assert client.get("/api/close/history").status_code == 200
    assert client.post("/api/close/approve/mine", json={"approver": "x"}).status_code == 403
    assert client.post("/api/close/run-checks/mine").status_code == 403
    assert client.post("/api/close/start-json", json={"entity_id": "E1", "period": "2026-09"}).status_code == 403

    env.roles.pop(WS_A)
    assert client.get("/api/close/status/mine").status_code == 403
    assert client.get("/api/close/history").status_code == 403
