"""GL reconciler: login required; reconciliations are visible only inside the workspace that started them."""

from __future__ import annotations

import os
import re
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pandas as pd
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
from app.models.gl_reconciliation import GLReconciliation
from app.models.workspace import WorkspaceRole
from app.routers import gl_reconciliation as gl

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
    Base.metadata.create_all(engine, tables=[GLReconciliation.__table__])
    return sessionmaker(bind=engine)


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(gl.router)

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


def _recon(factory, recon_id: str, workspace_id: str | None, status: str = "complete") -> None:
    db = factory()
    try:
        db.add(GLReconciliation(
            recon_id=recon_id, workspace_id=workspace_id, entity_id="E1", period="2026-09",
            account_code="1000", currency="INR", status=status, summary_json={}, matches_json=[],
            unmatched_gl=[], unmatched_bank=[], suggested_jes=[], audit_trail=[], snapshot_json={},
        ))
        db.commit()
    finally:
        db.close()


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", "r1", route.path))
    for route in gl.router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    _recon(factory, "r1", WS_A)
    res = TestClient(_app(factory, None)).request(method, path, json={})
    assert res.status_code == 401, res.text


def test_start_tags_recon_with_callers_workspace(client, env, factory, monkeypatch):
    frame = pd.DataFrame()
    monkeypatch.setattr(gl.eng, "parse_gl", lambda *_: frame)
    monkeypatch.setattr(gl.eng, "parse_bank", lambda *_: frame)
    monkeypatch.setattr(gl.eng, "serialize_gl_bank_df", lambda *_: [])
    res = client.post(
        "/api/recon/gl/start",
        data={"entity_id": "E1", "period": "2026-09", "account_code": "1000"},
        files={"gl_file": ("gl.csv", b"x"), "bank_file": ("bank.csv", b"x")},
    )
    assert res.status_code == 200, res.text
    db = factory()
    try:
        assert db.get(GLReconciliation, res.json()["recon_id"]).workspace_id == WS_A
    finally:
        db.close()


def test_recons_are_isolated_between_workspaces(client, env, factory):
    _recon(factory, "mine", WS_A)
    _recon(factory, "theirs", WS_B)
    _recon(factory, "legacy", None)

    assert client.get("/api/recon/gl/status/mine").status_code == 200
    assert client.get("/api/recon/gl/report/mine/pdf").status_code != 404
    assert [r["recon_id"] for r in client.get("/api/recon/gl/history").json()["recons"]] == ["mine"]
    for rid in ("theirs", "legacy"):
        assert client.get(f"/api/recon/gl/status/{rid}").status_code == 404
        assert client.get(f"/api/recon/gl/matches/{rid}").status_code == 404
        assert client.get(f"/api/recon/gl/report/{rid}/pdf").status_code == 404
        assert client.post(f"/api/recon/gl/approve/{rid}", json={"approver": "x"}).status_code == 404
        assert client.post(f"/api/recon/gl/clear/{rid}", json={"source": "gl", "row_id": "1"}).status_code == 404


def test_viewer_can_read_but_not_write_and_non_member_is_refused(client, env, factory):
    _recon(factory, "mine", WS_A)
    env.roles[WS_A] = "viewer"
    assert client.get("/api/recon/gl/status/mine").status_code == 200
    assert client.get("/api/recon/gl/history").status_code == 200
    assert client.post("/api/recon/gl/approve/mine", json={"approver": "x"}).status_code == 403
    assert client.post("/api/recon/gl/run/mine").status_code == 403

    env.roles.pop(WS_A)
    assert client.get("/api/recon/gl/status/mine").status_code == 403
    assert client.get("/api/recon/gl/history").status_code == 403
