"""UAE CT/CIT returns, account classification, FS validation, JE controls and JE approval:
login + workspace membership required, tenant = validated workspace, approvals need a manager."""

from __future__ import annotations

import os
import re
from datetime import date
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import cit_return as cit
from app.api.routes import ct_return as ct
from app.api.routes import uae_account_classification as acc
from app.api.routes import uae_controls_routes as ctrl
from app.api.routes import uae_fs_routes as fs
from app.api.routes import uae_journals_routes as jr
from app.core import company_access
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.client_data import CtReturn
from app.models.company_setup import UaeCompanyProfile
from app.models.uae_account_classification import UAEAccountClassification
from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "cccccccc-0000-4000-8000-00000000000a"
ROUTERS = [ct.router, cit.router, acc.router, fs.router, ctrl.router, jr.router]
TABLES = [CtReturn, UaeCompanyProfile, UAEAccount, UAEAccountClassification, UAEJournalEntry, UAEJournalLine]


class Env:
    def __init__(self):
        self.workspace = WS_A
        self.roles = {WS_A: "accountant", WS_B: "owner"}

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
    monkeypatch.setattr(company_access, "_company_workspace_ids", lambda _db, cid: iter([WS_A] if cid == CO_A else []))
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[t.__table__ for t in TABLES])
    return sessionmaker(bind=engine)


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    for r in ROUTERS:
        app.include_router(r)

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


def _seed(factory, *rows):
    db = factory()
    db.add_all(rows)
    db.commit()
    db.close()


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", "1", route.path))
    for r in ROUTERS
    for route in r.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(method, path, json={})
    assert res.status_code == 401, res.text


@pytest.mark.parametrize("path,params", [
    ("/api/gulftax/ct-return", {"company_id": CO_A}),
    ("/api/gulftax/cit-return/generate", {"from_date": "2026-01-01", "to_date": "2026-12-31"}),
    ("/api/uae/accounts/unclassified", {}),
    ("/api/uae/accounts/classification-summary", {}),
    ("/api/uae/fs/validate", {"period_start": "2026-01-01", "period_end": "2026-12-31"}),
])
def test_query_workspace_must_match_the_active_workspace(client, path, params):
    assert client.get(path, params={**params, "workspace_id": WS_B}).status_code == 403


def test_cannot_read_approve_or_file_another_workspaces_ct_return(client, factory):
    _seed(factory, CtReturn(id="ct-b", tenant_id=WS_B, company_id="c-b",
                            period_start=date(2026, 1, 1), period_end=date(2026, 12, 31)))
    assert client.get("/api/gulftax/ct-return/ct-b").status_code == 404
    assert client.post("/api/gulftax/ct-return/ct-b/approve").status_code != 200
    assert client.post("/api/gulftax/ct-return/ct-b/file", json={"override_reason": "rush job"}).status_code != 200
    db = factory()
    assert db.get(CtReturn, "ct-b").status == "draft"
    db.close()


def test_ct_return_workflow_still_works_in_own_workspace(client, factory):
    _seed(factory, CtReturn(id="ct-a", tenant_id=WS_A, company_id="c-a",
                            period_start=date(2026, 1, 1), period_end=date(2026, 12, 31)))
    assert client.get("/api/gulftax/ct-return/ct-a").status_code == 200
    assert client.post("/api/gulftax/ct-return/ct-a/approve").json()["status"] == "approved"
    assert client.post("/api/gulftax/ct-return/ct-a/file", json={}).json()["status"] == "filed"


def test_cit_return_does_not_expose_another_workspaces_company_profile(client, factory, monkeypatch):
    monkeypatch.setattr(cit, "get_trial_balance", lambda *_a, **_k: {"totals": {}, "lines": []})
    co_b = "cccccccc-0000-4000-8000-00000000000b"
    _seed(factory, UaeCompanyProfile(id=co_b, workspace_id=WS_B, company_name="Victim LLC",
                                     trn="100000000000003", address="Dubai"))
    res = client.get("/api/gulftax/cit-return/generate",
                     params={"company_id": co_b, "from_date": "2026-01-01", "to_date": "2026-12-31"})
    assert res.status_code == 403
    assert "Victim" not in res.text


def test_cannot_classify_another_workspaces_account(client, factory):
    _seed(factory, UAEAccount(id="acct-b", tenant_id=WS_B, code="1000", name="Cash"))
    res = client.post("/api/uae/accounts/manual-classify/acct-b", json={"bs_pl_main": "Current Assets"})
    assert res.status_code == 404
    db = factory()
    assert db.query(UAEAccountClassification).count() == 0
    db.close()


def test_header_naming_another_tenant_still_reads_the_validated_workspace(client, factory):
    _seed(factory, UAEJournalEntry(id="je-b", tenant_id=WS_B, entry_date=date(2026, 9, 1),
                                   status="pending_approval"))
    res = client.get("/api/uae/controls/pending-journals", headers={"X-Workspace-ID": WS_B})
    assert res.status_code == 200, res.text
    assert res.json()["entries"] == []


def test_viewers_cannot_write(client, env):
    env.roles[WS_A] = "viewer"
    res = client.post("/api/uae/accounts/ai-classify", json={})
    assert res.status_code == 403


@pytest.mark.parametrize("method,path,body", [
    ("PATCH", "/api/uae/controls", {"je_approval_threshold_aed": 1_000_000_000}),
    ("POST", "/api/uae/controls/journals/je-a/approve", None),
    ("POST", "/api/uae/controls/journals/je-a/reject", None),
    ("POST", "/api/uae/journals/approve-je", {"je_id": "je-a", "action": "approved"}),
])
def test_accountants_cannot_change_controls_or_approve_journals(client, factory, method, path, body):
    _seed(factory, UAEJournalEntry(id="je-a", tenant_id=WS_A, entry_date=date(2026, 9, 1),
                                   status="pending_approval"))
    assert client.request(method, path, json=body).status_code == 403
    db = factory()
    assert db.get(UAEJournalEntry, "je-a").status == "pending_approval"
    db.close()


def test_managers_can_change_controls(client, env, monkeypatch):
    env.roles[WS_A] = "finance_manager"
    seen = {}
    monkeypatch.setattr(ctrl.setup_svc, "save_controls", lambda _db, ws, _cid, data: seen.update(ws=ws) or data)
    res = client.patch("/api/uae/controls", json={"je_approval_threshold_aed": 25000})
    assert res.status_code == 200, res.text
    assert seen["ws"] == WS_A


def test_rejecting_records_the_signed_in_manager_not_a_body_or_header_name(client, env, factory, monkeypatch):
    env.roles[WS_A] = "owner"
    monkeypatch.setattr(jr, "log_audit", lambda *_a, **_k: None)
    monkeypatch.setattr(jr, "scan_notifications", lambda *_a, **_k: None)
    _seed(factory, UAEJournalEntry(id="je-a", tenant_id=WS_A, entry_date=date(2026, 9, 1),
                                   status="pending_approval"))
    res = client.post(
        "/api/uae/journals/approve-je",
        json={"je_id": "je-a", "action": "rejected", "approved_by": "cfo@victim.example"},
        headers={"x-user-email": "ceo@victim.example"},
    )
    assert res.status_code == 200, res.text
    db = factory()
    assert db.get(UAEJournalEntry, "je-a").approved_by == "a@example.com"
    db.close()
