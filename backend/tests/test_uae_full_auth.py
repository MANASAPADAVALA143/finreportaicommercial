"""UAE full accounting + FX revaluation: login + workspace membership required, and every query is
keyed by the validated workspace, never by the raw X-Workspace-ID / X-Tenant-ID header."""

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

from app.api.routes import uae_full_routes as uf
from app.core import company_access
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.uae_accounting_full import (
    UAEAccount, UAEAccrual, UAEBankAccount, UAEBankStatement, UAEBankStatementLine,
    UAEJournalEntry, UAEJournalLine,
)
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
TABLES = [UAEAccount, UAEJournalEntry, UAEJournalLine, UAEBankAccount, UAEBankStatement,
          UAEBankStatementLine, UAEAccrual]


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
    Base.metadata.create_all(engine, tables=[t.__table__ for t in TABLES])
    return sessionmaker(bind=engine)


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    app.include_router(uf.router)
    app.include_router(uf.fx_router)

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


def _accrual(tenant: str, desc: str) -> UAEAccrual:
    return UAEAccrual(id=f"acc-{tenant}", tenant_id=tenant, period="2026-09", description=desc,
                      amount=10, status="suggested")


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", "1", route.path))
    for r in (uf.router, uf.fx_router)
    for route in r.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(method, path, json={})
    assert res.status_code == 401, res.text


@pytest.mark.parametrize("header", ["demo", WS_B, "anything-else"])
def test_header_naming_another_tenant_still_reads_the_validated_workspace(client, factory, header):
    _seed(factory, _accrual(WS_A, "mine"), _accrual(WS_B, "theirs"), _accrual("demo", "legacy demo"))
    res = client.get("/api/uae/full/accruals", headers={"X-Workspace-ID": header, "X-Tenant-ID": header})
    assert res.status_code == 200, res.text
    assert [a["description"] for a in res.json()["accruals"]] == ["mine"]


def test_non_members_get_403(client, env):
    env.roles[WS_A] = None
    assert client.get("/api/uae/full/accruals").status_code == 403


def test_viewers_can_read_but_not_write(client, env):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/uae/full/accruals").status_code == 200
    res = client.post("/api/uae/full/accruals", json={
        "period": "2026-09", "description": "x", "amount": 1, "account_code": "2100",
    })
    assert res.status_code == 403


def test_writes_land_in_the_validated_workspace(client, factory):
    res = client.post(
        "/api/uae/full/accruals",
        json={"period": "2026-09", "description": "x", "amount": 1, "account_code": "2100"},
        headers={"X-Workspace-ID": "demo"},
    )
    assert res.status_code == 200, res.text
    db = factory()
    assert db.get(UAEAccrual, res.json()["id"]).tenant_id == WS_A
    db.close()


def test_fx_revaluation_rejects_another_workspace_in_the_body(client):
    res = client.post("/api/uae/fx/revalue", json={
        "workspace_id": WS_B, "period": "2026-09", "revaluation_date": "2026-09-30",
        "exchange_rates": {"USD": 3.6725},
    })
    assert res.status_code == 403


def test_cannot_import_a_statement_into_another_workspaces_bank_account(client, factory):
    _seed(factory, UAEBankAccount(id="ba-b", tenant_id=WS_B, bank_name="B", account_number="1"))
    res = client.post(
        "/api/uae/full/bank-accounts/ba-b/import-statement",
        params={"bank_name": "generic", "statement_date": "2026-09-30",
                "opening_balance": 0, "closing_balance": 0},
        files={"file": ("s.csv", b"date,description,amount\n", "text/csv")},
    )
    assert res.status_code == 404
    db = factory()
    assert db.query(UAEBankStatement).count() == 0
    db.close()


def test_cannot_touch_another_workspaces_journal(client, factory):
    _seed(factory, UAEJournalEntry(id="je-b", tenant_id=WS_B, entry_date=date(2026, 9, 1), status="draft"))
    assert client.get("/api/uae/full/journals/je-b").status_code == 404
    assert client.delete("/api/uae/full/journals/je-b").status_code == 404


def test_accountants_cannot_approve_pending_journals(client, factory):
    _seed(factory, UAEJournalEntry(id="je-p", tenant_id=WS_A, entry_date=date(2026, 9, 1),
                                   status="pending_approval"))
    assert client.post("/api/uae/full/journals/je-p/approve").status_code == 403
    db = factory()
    assert db.get(UAEJournalEntry, "je-p").status == "pending_approval"
    db.close()


def test_audit_trail_uses_signed_in_user_not_header(client, factory, monkeypatch):
    seen = {}
    monkeypatch.setattr(uf, "log_audit", lambda _db, **kw: seen.update(kw))
    _seed(factory, UAEJournalEntry(id="je-a", tenant_id=WS_A, entry_date=date(2026, 9, 1), status="draft"))
    res = client.delete("/api/uae/full/journals/je-a", headers={"x-user-email": "ceo@victim.example"})
    assert res.status_code == 200, res.text
    assert seen["user_email"] == "a@example.com"
    assert seen["workspace_id"] == WS_A
