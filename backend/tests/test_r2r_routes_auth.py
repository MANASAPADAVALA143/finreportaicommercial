"""R2R history and learning routers require a logged-in workspace member."""

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
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.r2r import db as r2r_db

WS = "aaaaaaaa-0000-4000-8000-000000000001"


def _ctx() -> WorkspaceContext:
    return WorkspaceContext(
        workspace_id=WS,
        workspace=SimpleNamespace(id=WS),
        user=SimpleNamespace(id="user-1", email="a@example.com", role="user"),
        role=None,
    )


@pytest.fixture()
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (r2r_models.R2RHistoricalEntry, r2r_models.ClientProfile,
                  r2r_models.JournalEntryFeedback, r2r_models.LearningEvent):
        model.__table__.create(engine)
    return sessionmaker(bind=engine)


@pytest.fixture()
def r2r_sqlite(tmp_path, monkeypatch):
    monkeypatch.setattr(r2r_db, "DB_PATH", str(tmp_path / "r2r.db"))
    r2r_db.init_db()


def _app(session_factory, logged_in: bool) -> FastAPI:
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
    if logged_in:
        app.dependency_overrides[validate_workspace] = _ctx
    return app


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
    res = TestClient(_app(session_factory, logged_in=False)).request(
        method, path + "?client_id=c1", json={}, headers={"X-Workspace-ID": WS},
    )
    assert res.status_code == 401, res.text


def test_history_routes_work_when_logged_in(session_factory, r2r_sqlite):
    client = TestClient(_app(session_factory, logged_in=True))
    created = client.post("/api/r2r/clients", json={"name": "Acme"})
    assert created.status_code == 200, created.text
    cid = created.json()["id"]
    assert [c["name"] for c in client.get("/api/r2r/clients").json()] == ["Acme"]

    up = client.post("/api/r2r/upload", json={"client_id": cid, "entries": [{"amount": 10}], "filename": "jan.csv"})
    assert up.status_code == 200 and up.json()["row_count"] == 1
    assert client.get(f"/api/r2r/history?client_id={cid}").json()["total"] == 1
    assert len(client.get(f"/api/r2r/uploads?client_id={cid}").json()["uploads"]) == 1


def test_learning_routes_work_when_logged_in(session_factory, r2r_sqlite):
    client = TestClient(_app(session_factory, logged_in=True))
    assert client.get("/api/r2r/learning-progress/c1").status_code == 200
    res = client.get("/api/r2r/feedback-history/c1")
    assert res.status_code == 200 and res.json()["count"] == 0
