"""IFRS 9/15/16, IFRS exports, IFRS statement helpers and Tally push: login + workspace membership;
records are keyed by the validated workspace, writes need write access to the company, trial-balance
exports check the tenant, IFRS 15 downloads stay inside the workspace, and Tally pushes never reach
private addresses."""

from __future__ import annotations

import os
import re
import tempfile
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models.ifrs_statement as ifrs_models
from app.api.routes import ifrs_export, ifrs_statements, tally_push
from app.core import company_access
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.ifrs16_lease import IFRS16Lease
from app.models.ifrs9_ecl import IFRS9Asset, IFRS9Portfolio
from app.models.workspace import WorkspaceRole
from app.modules.ifrs15 import router as ifrs15
from app.modules.ifrs16 import router as ifrs16
from app.modules.ifrs9 import router as ifrs9

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "cccccccc-0000-4000-8000-00000000000a"
CO_B = "cccccccc-0000-4000-8000-00000000000b"


class Env:
    def __init__(self):
        self.workspace = WS_A
        self.roles = {WS_A: "accountant", WS_B: None}

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
    owners = {CO_A: WS_A, CO_B: WS_B}
    monkeypatch.setattr(company_access, "_company_workspace_ids", lambda _db, cid: iter([owners[cid]] if cid in owners else []))
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(
        engine,
        tables=[IFRS16Lease.__table__, IFRS9Portfolio.__table__, IFRS9Asset.__table__, ifrs_models.TrialBalance.__table__],
    )
    return sessionmaker(bind=engine)


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(ifrs16.router)
    app.include_router(ifrs9.router)
    app.include_router(ifrs15.router)
    app.include_router(ifrs_export.router, prefix="/api/ifrs")
    app.include_router(ifrs_statements.router)
    app.include_router(tally_push.router)

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


def _routes(router, prefix: str = ""):
    return [
        (method, prefix + re.sub(r"\{[^}]+\}", "1", route.path))
        for route in router.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    ]


ROUTES = (
    _routes(ifrs16.router)
    + _routes(ifrs9.router)
    + _routes(ifrs15.router)
    + _routes(ifrs_export.router, "/api/ifrs")
    + _routes(ifrs_statements.router)
    + _routes(tally_push.router)
)


def test_every_route_is_covered():
    assert len(ROUTES) == 46


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(method, path, json={})
    assert res.status_code == 401, res.text


# ─── IFRS 16 ───────────────────────────────────────────────────────────────────

LEASE = {"lease_name": "HQ", "commencement_date": "2026-01-01", "lease_term_months": 24, "monthly_payment": 1000}
CALC = {"lease_id": "L1", "asset_description": "Office", "commencement_date": "2026-01-01",
        "lease_term_months": 12, "monthly_payment": 1000, "annual_discount_rate": 0.05}


def _lease(factory, ws: str, cid: str | None = None) -> str:
    db = factory()
    try:
        from datetime import date

        lease = IFRS16Lease(workspace_id=ws, company_id=cid, lease_name="Theirs", commencement_date=date(2026, 1, 1),
                            lease_term_months=12, status="active")
        db.add(lease)
        db.commit()
        return lease.id
    finally:
        db.close()


def test_lease_is_saved_in_the_validated_workspace(client, factory):
    res = client.post("/api/ifrs16/leases", json=LEASE, headers={"X-Workspace-ID": WS_B, "X-Tenant-ID": WS_B})
    assert res.status_code == 200, res.text
    assert res.json()["lease"]["workspace_id"] == WS_A


def test_lease_body_or_query_workspace_must_match(client):
    assert client.post("/api/ifrs16/leases", json={**LEASE, "workspace_id": WS_B}).status_code == 403
    assert client.get("/api/ifrs16/leases", params={"workspace_id": WS_B}).status_code == 403


def test_lease_with_another_workspaces_company_is_rejected(client):
    assert client.post("/api/ifrs16/leases", json={**LEASE, "company_id": CO_B}).status_code == 403
    assert client.post("/api/ifrs16/leases", json={**LEASE, "company_id": CO_A}).status_code == 200


def test_other_workspaces_leases_are_invisible(client, factory):
    theirs = _lease(factory, WS_B)
    assert client.get(f"/api/ifrs16/leases/{theirs}").status_code == 404
    assert client.patch(f"/api/ifrs16/leases/{theirs}", json={"status": "terminated"}).status_code == 404
    assert client.delete(f"/api/ifrs16/leases/{theirs}").status_code == 404
    assert client.get("/api/ifrs16/leases").json()["leases"] == []


def test_viewers_can_calculate_but_not_change_leases(client, env, factory):
    env.roles[WS_A] = "viewer"
    mine = _lease(factory, WS_A)
    assert client.post("/api/ifrs16/calculate", json=CALC).status_code == 200
    assert client.get("/api/ifrs16/leases").status_code == 200
    assert client.post("/api/ifrs16/leases", json=LEASE).status_code == 403
    assert client.delete(f"/api/ifrs16/leases/{mine}").status_code == 403
    assert client.post("/api/ifrs16/post-all-monthly-je", json={"period_date": "2026-01-31"}).status_code == 403


def test_non_members_get_403(client, env):
    env.roles[WS_A] = None
    assert client.post("/api/ifrs16/calculate", json=CALC).status_code == 403


# ─── IFRS 9 ────────────────────────────────────────────────────────────────────

PORTFOLIO = {"portfolio_name": "AR", "calculation_date": "2026-01-31", "assets": [], "portfolio_summary": {}}


def test_ifrs9_portfolio_company_and_role_checks(client, env):
    assert client.post("/api/ifrs9/save-portfolio", json={**PORTFOLIO, "company_id": CO_B}).status_code == 403
    assert client.post("/api/ifrs9/save-portfolio", json=PORTFOLIO).status_code == 200
    assert len(client.get("/api/ifrs9/portfolios").json()["portfolios"]) == 1
    assert len(client.get("/api/ifrs9/portfolios", headers={"X-Workspace-ID": WS_B}).json()["portfolios"]) == 1
    env.roles[WS_A] = "viewer"
    assert client.post("/api/ifrs9/stage-assets", json={"assets": []}).status_code == 200
    assert client.post("/api/ifrs9/save-portfolio", json=PORTFOLIO).status_code == 403
    assert client.post("/api/ifrs9/post-provision-je", json={"portfolio_id": "p", "period_date": "2026-01-31"}).status_code == 403


# ─── IFRS 15 exports ───────────────────────────────────────────────────────────


@pytest.fixture()
def exports(monkeypatch, tmp_path):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(
        ifrs15.IFRS15ExcelExporter, "export_ifrs15_workbook", lambda self, _res, path: open(path, "wb").write(b"xlsx")
    )
    return tmp_path


def test_ifrs15_downloads_stay_in_the_workspace(client, env, exports):
    res = client.post("/api/ifrs15/export-excel", json={"calculation_results": {}, "filename": "../../evil.xlsx"})
    assert res.status_code == 200, res.text
    file_id = res.json()["file_id"]
    assert client.get(f"/api/ifrs15/download/{file_id}").status_code == 200
    assert client.get("/api/ifrs15/download/*").status_code == 404
    assert not list(exports.glob("*.xlsx")) and not list(exports.parent.glob("evil*"))

    env.workspace = WS_B
    env.roles[WS_B] = "accountant"
    assert client.get(f"/api/ifrs15/download/{file_id}").status_code == 404


# ─── IFRS export (trial balance) ───────────────────────────────────────────────


def _tb(factory, tenant: str) -> int:
    db = factory()
    try:
        tb = ifrs_models.TrialBalance(tenant_id=tenant, company_name="Acme", file_name="tb.csv")
        db.add(tb)
        db.commit()
        return tb.id
    finally:
        db.close()


@pytest.mark.parametrize("path", ["export/excel", "export/pdf", "export/word", "ct-bridge"])
def test_trial_balance_exports_check_the_tenant(client, factory, monkeypatch, path):
    import app.services.ifrs_export as export_svc
    import app.services.uae_ct_bridge as ct_svc

    for name in ("export_to_excel", "export_to_pdf", "export_to_word"):
        monkeypatch.setattr(export_svc, name, lambda tb_id, db: b"file")
    monkeypatch.setattr(ct_svc, "get_saved_ct_bridge", lambda tb_id, db: {"trial_balance_id": tb_id})

    theirs, mine = _tb(factory, WS_B), _tb(factory, WS_A)
    assert client.get(f"/api/ifrs/trial-balance/{theirs}/{path}").status_code == 404
    assert client.get(f"/api/ifrs/trial-balance/{mine}/{path}").status_code == 200


def test_ct_bridge_post_checks_the_tenant(client, factory, monkeypatch):
    import app.services.uae_ct_bridge as ct_svc

    monkeypatch.setattr(ct_svc, "generate_ct_bridge", lambda trial_balance_id, db, **_kw: {"trial_balance_id": trial_balance_id})
    theirs, mine = _tb(factory, WS_B), _tb(factory, WS_A)
    assert client.post(f"/api/ifrs/trial-balance/{theirs}/ct-bridge", json={}).status_code == 404
    assert client.post(f"/api/ifrs/trial-balance/{mine}/ct-bridge", json={}).status_code == 200


# ─── Tally push ────────────────────────────────────────────────────────────────


class _NoNetwork:
    def __init__(self, *a, **k):
        raise AssertionError("server must not connect to a private address")


@pytest.mark.parametrize(
    "url",
    ["http://localhost:9000", "http://127.0.0.1:9000", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5", "file:///etc/passwd"],
)
def test_tally_push_never_reaches_private_addresses(client, monkeypatch, url):
    monkeypatch.setattr(tally_push.httpx, "AsyncClient", _NoNetwork)
    res = client.post(
        "/api/tally/push-journal",
        json={"settings": {"url": url, "company": "Acme"}, "entries": [{"date": "2026-01-31", "amount": 10}]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["fallback"] is True
    assert "<ENVELOPE>" in res.json()["xml"]


def test_tally_push_needs_write_access(client, env):
    env.roles[WS_A] = "viewer"
    res = client.post(
        "/api/tally/push-journal",
        json={"settings": {"url": "http://localhost:9000", "company": "Acme"}, "entries": [{"date": "2026-01-31"}]},
    )
    assert res.status_code == 403
