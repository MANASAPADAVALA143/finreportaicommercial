"""Rev-rec: login + workspace membership required; register data and Excel packs stay inside the caller's workspace."""

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

from app.api.routes import rev_rec_recon as rr
from app.core import company_access
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.rev_rec_leakage import RevRecLeakageSnapshot
from app.models.workspace import WorkspaceRole
from app.services import rev_rec_excel

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
def env(monkeypatch, tmp_path):
    e = Env()
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    monkeypatch.setattr(rev_rec_excel, "REV_REC_EXCEL_OUTPUT_DIR", tmp_path)

    async def _no_llm(*_a, **_k):
        return "ok"

    monkeypatch.setattr(rr, "call_nova", _no_llm)
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[RevRecLeakageSnapshot.__table__])
    return sessionmaker(bind=engine)


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(rr.router)

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


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", "1", route.path))
    for route in rr.router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]

ROLL_FORWARD = {
    "period": "2026-09", "opening_balance": 0, "new_billings": 0, "modification_increases": 0,
    "modification_decreases": 0, "revenue_recognised": 0, "cancellations": 0,
    "fx_retranslation": 0, "gl_closing_balance": 0,
}
LEAKAGE_ITEM = {"contract_id": "C1", "status": "missing_gl", "difference": 100.0, "billing_amount": 100.0}


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(method, path + "?period=2026-09", json={})
    assert res.status_code == 401, res.text


def test_non_members_cannot_use_calculators(client, env):
    assert client.post("/api/rev-rec/roll-forward", json=ROLL_FORWARD).status_code == 200
    env.roles.pop(WS_A)
    assert client.post("/api/rev-rec/roll-forward", json=ROLL_FORWARD).status_code == 403


def test_other_workspace_ids_in_body_or_query_are_refused(client):
    assert client.get(f"/api/rev-rec/contracts?workspace_id={WS_B}").status_code == 403
    assert client.get(f"/api/rev-rec/portfolio-summary?workspace_id={WS_B}").status_code == 403
    assert client.get(f"/api/rev-rec/leakage-snapshot?period=2026-09&workspace_id={WS_B}").status_code == 403
    assert client.post(
        "/api/rev-rec/leakage-snapshot", json={"period": "2026-09", "items": [LEAKAGE_ITEM], "workspace_id": WS_B}
    ).status_code == 403
    assert client.post(
        "/api/rev-rec/contracts", json={"customer_name": "X", "workspace_id": WS_B}
    ).status_code == 403
    assert client.post(
        "/api/rev-rec/calculate-recognition", json={"contract_id": "1", "workspace_id": WS_B}
    ).status_code == 403
    assert client.post(
        "/api/rev-rec/post-recognition-je",
        json={"contract_id": "1", "period_date": "2026-09-30", "amount_aed": 1, "workspace_id": WS_B},
    ).status_code == 403


def test_leakage_snapshots_are_isolated_between_workspaces(client, env):
    saved = client.post("/api/rev-rec/leakage-snapshot", json={"period": "2026-09", "items": [LEAKAGE_ITEM]})
    assert saved.status_code == 200, saved.text
    assert client.get("/api/rev-rec/leakage-snapshot?period=2026-09").status_code == 200

    env.workspace = WS_B
    assert client.get("/api/rev-rec/leakage-snapshot?period=2026-09").status_code == 404


def test_viewer_cannot_write_register_data(client, env):
    env.roles[WS_A] = "viewer"
    assert client.post(
        "/api/rev-rec/leakage-snapshot", json={"period": "2026-09", "items": [LEAKAGE_ITEM]}
    ).status_code == 403


def test_excel_packs_download_only_inside_owning_workspace(client, env, monkeypatch):
    def _fake_pack(_data, workspace_id):
        file_id = "0123456789abcdef0123456789abcdef"
        out = rev_rec_excel.pack_dir(workspace_id)
        out.mkdir(parents=True, exist_ok=True)
        (out / f"RevRec_PeriodClose_2026-09_{file_id}.xlsx").write_bytes(b"xlsx")
        return {"file_id": file_id}

    monkeypatch.setattr(rev_rec_excel, "generate_period_close_pack", _fake_pack)
    made = client.post(
        "/api/rev-rec/download-excel",
        json={"period": "2026-09", "include_ifrs15_calculated": False},
    )
    assert made.status_code == 200, made.text
    file_id = made.json()["file_id"]

    assert client.get(f"/api/rev-rec/download-file/{file_id}").status_code == 200
    for partial in ("0123", "2026", "a" * 33):
        assert client.get(f"/api/rev-rec/download-file/{partial}").status_code == 404

    env.workspace = WS_B
    assert client.get(f"/api/rev-rec/download-file/{file_id}").status_code == 404
