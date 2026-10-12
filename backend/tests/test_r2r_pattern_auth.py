"""R2R pattern router: login required, clients and accounting history scoped to the workspace."""

from __future__ import annotations

import os
import re
import sys
from types import ModuleType, SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

try:
    import app.services.r2r_pattern_engine  # noqa: F401
except ImportError:
    _stub = ModuleType("app.services.r2r_pattern_engine")
    _stub.R2RPatternEngine = type("R2RPatternEngine", (), {})
    sys.modules["app.services.r2r_pattern_engine"] = _stub

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.r2r_learning as r2r_models
from app.api.routes import r2r_pattern
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


@pytest.fixture()
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (r2r_models.R2RClient, r2r_models.R2RHistoricalEntry, r2r_models.ClientProfile):
        model.__table__.create(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    db.add_all([
        r2r_models.R2RClient(id="clientA", workspace_id=WS_A, name="A client"),
        r2r_models.R2RClient(id="clientB", workspace_id=WS_B, name="B client"),
        r2r_models.R2RHistoricalEntry(company_id=WS_A, country="UAE", je_id="A-1", period="2025-01", amount=100),
        r2r_models.R2RHistoricalEntry(company_id=WS_B, country="UAE", je_id="B-1", period="2025-01", amount=999),
    ])
    db.commit()
    db.close()
    return factory


@pytest.fixture()
def engine_calls(monkeypatch):
    calls: list = []

    def fake_run(df, sensitivity, custom_threshold, materiality_amount, materiality_pct, client_id=None, db=None):
        calls.append(client_id)
        return {"entries": [], "client_id": client_id}

    monkeypatch.setattr(r2r_pattern, "_run_engine", fake_run)
    monkeypatch.setitem(sys.modules, "app.agents.intelligence", None)
    return calls


def _app(session_factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(r2r_pattern.router)

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
def client(session_factory, env, engine_calls):
    return TestClient(_app(session_factory, env))


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", WS_A, route.path))
    for route in r2r_pattern.router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


def test_every_route_is_covered():
    assert {p for _, p in ROUTES} == {
        "/api/r2r/pattern/analyse", f"/api/r2r/baseline-status/{WS_A}",
        "/api/r2r/load-from-accounting", "/api/r2r/sync-from-accounting",
    }


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(session_factory, method, path):
    res = TestClient(_app(session_factory, None)).request(
        method, path + f"?company_id={WS_A}", json={"rows": [{"amount": 1}], "company_id": WS_A},
        headers={"X-Workspace-ID": WS_A},
    )
    assert res.status_code == 401, res.text


ROWS = [{"amount": 100, "account": "4100"}]


def test_analyse_with_own_client_or_no_client(client, engine_calls):
    assert client.post("/api/r2r/pattern/analyse", json={"rows": ROWS, "client_id": "clientA"}).status_code == 200
    assert client.post("/api/r2r/pattern/analyse", json={"rows": ROWS}).status_code == 200
    assert engine_calls == ["clientA", None]


def test_analyse_rejects_other_workspace_or_unknown_client(client, engine_calls):
    assert client.post("/api/r2r/pattern/analyse", json={"rows": ROWS, "client_id": "clientB"}).status_code == 404
    assert client.post("/api/r2r/pattern/analyse", data={"rows_json": "[]", "client_id": "clientB"}).status_code == 404
    assert client.post("/api/r2r/pattern/analyse", json={"rows": ROWS, "client_id": "demo"}).status_code == 404
    assert engine_calls == []


def test_load_from_accounting_returns_only_own_workspace(client):
    res = client.get(f"/api/r2r/load-from-accounting?company_id={WS_A}")
    assert res.status_code == 200 and [r["id"] for r in res.json()["rows"]] == ["A-1"]
    assert [r["id"] for r in client.get("/api/r2r/load-from-accounting").json()["rows"]] == ["A-1"]
    assert client.get(f"/api/r2r/load-from-accounting?company_id={WS_B}").status_code == 404
    assert client.get("/api/r2r/load-from-accounting?company_id=demo").status_code == 404


def test_baseline_status_is_scoped(client):
    own = client.get(f"/api/r2r/baseline-status/{WS_A}")
    assert own.status_code == 200 and own.json()["total_entries"] == 1
    assert client.get(f"/api/r2r/baseline-status/{WS_B}").status_code == 404
    assert client.get("/api/r2r/baseline-status/demo").status_code == 404


def test_sync_from_accounting_needs_own_workspace_and_write_role(client, env):
    assert client.post("/api/r2r/sync-from-accounting", json={"company_id": WS_B}).status_code == 404
    assert client.post("/api/r2r/sync-from-accounting", json={"company_id": "demo"}).status_code == 404
    assert client.post("/api/r2r/sync-from-accounting", json={"company_id": WS_A}).status_code == 200
    env.roles[WS_A] = "viewer"
    assert client.post("/api/r2r/sync-from-accounting", json={"company_id": WS_A}).status_code == 403
    assert client.get(f"/api/r2r/load-from-accounting?company_id={WS_A}").status_code == 200


def test_non_member_is_forbidden(client, env):
    env.roles.pop(WS_A)
    assert client.get(f"/api/r2r/load-from-accounting?company_id={WS_A}").status_code == 403
    assert client.post("/api/r2r/pattern/analyse", json={"rows": ROWS}).status_code == 403
