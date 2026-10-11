"""R2R history and learning routers: login required and clients isolated per workspace."""

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

import app.models.r2r_learning as r2r_models
from app.api.routes import r2r_history, r2r_learning_routes
from app.core import company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole
from app.r2r import db as r2r_db

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
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (r2r_models.R2RClient, r2r_models.R2RHistoricalEntry, r2r_models.ClientProfile,
                  r2r_models.JournalEntryFeedback, r2r_models.LearningEvent):
        model.__table__.create(engine)
    return sessionmaker(bind=engine)


@pytest.fixture()
def r2r_sqlite(tmp_path, monkeypatch):
    monkeypatch.setattr(r2r_db, "DB_PATH", str(tmp_path / "r2r.db"))
    r2r_db.init_db()


def _app(session_factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(r2r_history.router)
    app.include_router(r2r_learning_routes.router)

    def _db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


@pytest.fixture()
def client(session_factory, env, r2r_sqlite):
    return TestClient(_app(session_factory, env))


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", "c1", route.path))
    for router in (r2r_history.router, r2r_learning_routes.router)
    for route in router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


def test_every_route_is_covered():
    paths = {p for _, p in ROUTES}
    assert {"/api/r2r/clients", "/api/r2r/upload", "/api/r2r/history", "/api/r2r/uploads",
            "/api/r2r/feedback", "/api/r2r/build-baseline", "/api/r2r/upload-history",
            "/api/r2r/learning-progress/c1", "/api/r2r/feedback-history/c1"} <= paths


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(session_factory, r2r_sqlite, method, path):
    res = TestClient(_app(session_factory, None)).request(
        method, path + "?client_id=c1", json={}, headers={"X-Workspace-ID": WS_A},
    )
    assert res.status_code == 401, res.text


def _new_client(client, name="Acme"):
    res = client.post("/api/r2r/clients", json={"name": name})
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _feedback(cid):
    return {"client_id": cid, "entry_id": "JE1", "feedback": "approved",
            "entry_data": {"account": "4100", "amount": 10, "risk_score": 70, "risk_level": "HIGH"}}


def test_history_routes_work_for_own_client(client):
    cid = _new_client(client)
    assert [c["name"] for c in client.get("/api/r2r/clients").json()] == ["Acme"]
    up = client.post("/api/r2r/upload", json={"client_id": cid, "entries": [{"amount": 10}], "filename": "jan.csv"})
    assert up.status_code == 200 and up.json()["row_count"] == 1
    assert client.get(f"/api/r2r/history?client_id={cid}").json()["total"] == 1
    assert len(client.get(f"/api/r2r/uploads?client_id={cid}").json()["uploads"]) == 1


def test_learning_routes_work_for_own_client(client):
    cid = _new_client(client)
    assert client.post("/api/r2r/feedback", json=_feedback(cid)).status_code == 200
    assert client.get(f"/api/r2r/learning-progress/{cid}").status_code == 200
    res = client.get(f"/api/r2r/feedback-history/{cid}")
    assert res.status_code == 200 and res.json()["count"] == 1


def test_other_workspace_cannot_list_or_use_client(client, env):
    cid = _new_client(client, "Workspace A client")
    client.post("/api/r2r/upload", json={"client_id": cid, "entries": [{"amount": 10}]})
    client.post("/api/r2r/feedback", json=_feedback(cid))

    env.workspace = WS_B
    assert client.get("/api/r2r/clients").json() == []
    assert client.get(f"/api/r2r/history?client_id={cid}").status_code == 404
    assert client.get(f"/api/r2r/uploads?client_id={cid}").status_code == 404
    assert client.post("/api/r2r/upload", json={"client_id": cid, "entries": [{"amount": 1}]}).status_code == 404
    assert client.post("/api/r2r/feedback", json=_feedback(cid)).status_code == 404
    assert client.get(f"/api/r2r/learning-progress/{cid}").status_code == 404
    assert client.get(f"/api/r2r/feedback-history/{cid}").status_code == 404
    files = {"file": ("h.csv", b"amount,account\n1,4100\n", "text/csv")}
    assert client.post("/api/r2r/upload-history", data={"client_id": cid}, files=files).status_code == 404
    assert client.post("/api/r2r/build-baseline", data={"client_id": cid}, files=files).status_code == 404

    env.workspace = WS_A
    assert client.get(f"/api/r2r/history?client_id={cid}").json()["total"] == 1
    assert client.get(f"/api/r2r/feedback-history/{cid}").json()["count"] == 1


def test_unregistered_client_ids_are_not_found(client):
    assert client.get("/api/r2r/history?client_id=legacy01").status_code == 404
    assert client.get("/api/r2r/learning-progress/demo").status_code == 404


def test_viewer_can_read_but_not_write(client, env):
    cid = _new_client(client)
    env.roles[WS_A] = "viewer"
    assert client.get(f"/api/r2r/history?client_id={cid}").status_code == 200
    assert client.get("/api/r2r/clients").status_code == 200
    assert client.post("/api/r2r/clients", json={"name": "X"}).status_code == 403
    assert client.post("/api/r2r/upload", json={"client_id": cid, "entries": [{"amount": 1}]}).status_code == 403
    assert client.post("/api/r2r/feedback", json=_feedback(cid)).status_code == 403


def test_non_member_is_forbidden(client, env):
    env.roles.pop(WS_A)
    assert client.get("/api/r2r/clients").status_code == 403
