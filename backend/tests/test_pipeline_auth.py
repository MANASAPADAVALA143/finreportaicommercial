"""Legacy bookkeeping pipeline: login + workspace membership required, every GL entry, accrual,
recon match and audit-log row is tagged with and filtered by the validated workspace."""

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

from app.api.routes import pipeline
from app.core import company_access
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.pipeline import AccountingAuditLog, AccrualSuggestion, BankReconMatch, GLEntry
from app.models.uae_accounting_full import UAESalesInvoice
from app.models.workspace import WorkspaceRole
from app.services import ar_invoice_post_service

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
PERIOD = "2026-09"
TABLES = [GLEntry, AccrualSuggestion, BankReconMatch, AccountingAuditLog, UAESalesInvoice]


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
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[t.__table__ for t in TABLES])
    make = sessionmaker(bind=engine)
    db = make()
    for tenant, amount in ((WS_A, 100.0), (WS_B, 9999.0), (None, 5555.0)):
        db.add_all([
            GLEntry(tenant_id=tenant, je_id=f"JE-{amount}", account_code="6001", account_name="Opex",
                    debit=amount, credit=0.0, period=PERIOD, source="invoice"),
            GLEntry(tenant_id=tenant, je_id=f"JE-{amount}", account_code="2001", account_name="AP",
                    debit=0.0, credit=amount, period=PERIOD, source="invoice"),
            AccountingAuditLog(tenant_id=tenant, action_type="seed", entity_type="invoice", entity_id=str(amount)),
        ])
    db.add_all([
        AccrualSuggestion(id=1, tenant_id=WS_A, period=PERIOD, description="a", amount_aed=10,
                          debit_account="6001", credit_account="2001", status="suggested"),
        AccrualSuggestion(id=2, tenant_id=WS_B, period=PERIOD, description="b", amount_aed=10,
                          debit_account="6001", credit_account="2001", status="suggested"),
        BankReconMatch(id=1, tenant_id=WS_A, period=PERIOD, amount=5, match_tier=4, status="exception"),
        BankReconMatch(id=2, tenant_id=WS_B, period=PERIOD, amount=5, match_tier=4, status="exception"),
        UAESalesInvoice(id="si-b", tenant_id=WS_B, invoice_number="INV-B-1"),
        UAESalesInvoice(id="si-a", tenant_id=WS_A, invoice_number="INV-A-1"),
    ])
    db.commit()
    db.close()
    return make


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(pipeline.router)

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


ROUTES = sorted({
    (method, re.sub(r"\{[^}]+\}", "1", route.path))
    for route in pipeline.router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
})


def test_every_pipeline_route_is_covered():
    assert len(ROUTES) == 19


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(method, path, json={})
    assert res.status_code == 401, res.text


def test_non_members_get_403(client, env):
    env.roles[WS_A] = None
    assert client.get(f"/api/accounting/trial-balance/{PERIOD}").status_code == 403


@pytest.mark.parametrize("path", [
    f"/api/accounting/trial-balance/{PERIOD}",
    f"/api/uae/accounting/trial-balance/generate/{PERIOD}",
])
def test_trial_balance_only_sums_the_active_workspace(client, path):
    res = client.get(path, headers={"X-Workspace-ID": WS_B})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["demo_data"] is False
    assert body["total_debit"] == 100.0


def test_close_status_and_audit_trail_are_scoped(client):
    status = client.get(f"/api/accounting/close-status/{PERIOD}").json()
    assert next(s for s in status["checklist"] if s["step"] == "journal_entries_posted")["count"] == 2
    trail = client.get("/api/audit/trail").json()
    assert [r["entity_id"] for r in trail["records"]] == ["100.0"]


def test_new_entries_are_tagged_with_the_workspace(client, factory):
    res = client.post("/api/accounting/invoice-to-je",
                      json={"invoice_id": "X1", "invoice_type": "AP", "amount": 50})
    assert res.status_code == 200, res.text
    db = factory()
    rows = db.query(GLEntry).filter(GLEntry.je_id == res.json()["je_id"]).all()
    log = db.query(AccountingAuditLog).filter(AccountingAuditLog.entity_id == "X1").one()
    db.close()
    assert rows and {r.tenant_id for r in rows} == {WS_A}
    assert log.tenant_id == WS_A and log.user_id == "a@example.com"


@pytest.mark.parametrize("path", ["/api/accounting/accept-accrual/1", "/api/recon/approve-match/1"])
def test_accountants_cannot_post_accruals_or_approve_matches(client, path):
    assert client.post(path).status_code == 403


@pytest.mark.parametrize("own,other", [
    ("/api/accounting/accept-accrual/1", "/api/accounting/accept-accrual/2"),
    ("/api/recon/approve-match/1", "/api/recon/approve-match/2"),
])
def test_managers_only_reach_their_own_accruals_and_matches(client, env, factory, own, other):
    env.roles[WS_A] = "finance_manager"
    assert client.post(other).status_code == 404
    res = client.post(own)
    assert res.status_code == 200, res.text
    db = factory()
    je_id = res.json().get("je_id")
    if je_id:
        assert {r.tenant_id for r in db.query(GLEntry).filter(GLEntry.je_id == je_id)} == {WS_A}
    db.close()


def test_uae_ar_invoice_to_je_only_posts_own_invoices(client, monkeypatch):
    posted = []
    monkeypatch.setattr(ar_invoice_post_service, "post_sales_invoice_to_gl_and_tax",
                        lambda inv_id, **kw: posted.append((inv_id, kw)) or {"ok": True})
    assert client.post("/api/uae/accounting/invoice-to-je",
                       json={"invoice_type": "AR", "invoice_id": "INV-B-1"}).status_code == 404
    assert posted == []
    res = client.post("/api/uae/accounting/invoice-to-je", json={"invoice_type": "AR", "invoice_id": "si-a"})
    assert res.status_code == 200, res.text
    assert posted[0][0] == "si-a" and posted[0][1]["tenant_id"] == WS_A
