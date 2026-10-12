"""India accounting, India Excel/Sheets and the CA bank-statement classifier: login + workspace
membership; rows are keyed by the validated workspace (the X-Tenant-ID header no longer defaults
to a shared "demo" tenant), linked customers/vendors must belong to the same workspace, and
client COA lists and ML models are namespaced per workspace."""

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

import app.models.india_accounting as india_models
from app.api.routes import ca_bank_router, india_excel_routes, india_routes
from app.core import company_access
from app.core.database import Base, get_db
from app.db.models import ClientCOA
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"


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
    monkeypatch.setattr(company_access, "_company_workspace_ids", lambda _db, cid: iter([]))
    monkeypatch.setattr(india_excel_routes, "_sheets_config", {})
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    india_tables = [
        obj.__table__
        for obj in vars(india_models).values()
        if isinstance(obj, type) and issubclass(obj, Base) and hasattr(obj, "__table__")
        and obj.__module__ == india_models.__name__
    ]
    Base.metadata.create_all(engine, tables=india_tables)
    ClientCOA.metadata.create_all(engine, tables=[ClientCOA.__table__])
    return sessionmaker(bind=engine)


ROUTERS = [india_routes.router, india_excel_routes.router, ca_bank_router.router]


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router)

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
    for router in ROUTERS
    for route in router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
})


def test_every_route_is_covered():
    assert len(ROUTES) == 64


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(method, path, json={})
    assert res.status_code == 401, res.text


# ─── India accounting ──────────────────────────────────────────────────────────

FULL = "/api/india/full"


def _add(factory, model, **kw):
    db = factory()
    try:
        row = model(id=kw.pop("id", None) or f"{model.__name__}-{kw['tenant_id'][:4]}", **kw)
        db.add(row)
        db.commit()
        return row.id
    finally:
        db.close()


def test_tenant_header_is_ignored_on_create(client, factory):
    res = client.post(f"{FULL}/customers", json={"name": "Acme"}, headers={"X-Tenant-ID": "demo"})
    assert res.status_code == 200, res.text
    db = factory()
    try:
        assert [c.tenant_id for c in db.query(india_models.IndiaCustomer).all()] == [WS_A]
    finally:
        db.close()


def test_lists_only_show_own_workspace(client, factory):
    _add(factory, india_models.IndiaCustomer, tenant_id=WS_B, name="Theirs")
    _add(factory, india_models.IndiaCustomer, tenant_id="demo", name="Shared demo")
    _add(factory, india_models.IndiaCustomer, tenant_id=WS_A, name="Ours")
    res = client.get(f"{FULL}/customers", headers={"X-Tenant-ID": WS_B})
    assert res.status_code == 200
    assert [c["name"] for c in res.json()["customers"]] == ["Ours"]


def test_non_members_are_rejected(client, env):
    env.workspace = WS_B
    assert client.get(f"{FULL}/customers").status_code == 403
    assert client.post(f"{FULL}/tds/calc", json={"section": "194J", "taxable_amount": 1000}).status_code == 403


def test_viewers_can_read_and_calculate_but_not_write(client, env):
    env.roles[WS_A] = "viewer"
    assert client.get(f"{FULL}/customers").status_code == 200
    assert client.post(f"{FULL}/tds/calc", json={"section": "194J", "taxable_amount": 100000}).status_code == 200
    assert client.post(f"{FULL}/customers", json={"name": "Acme"}).status_code == 403


def test_sales_invoice_rejects_other_workspace_customer(client, factory):
    cid = _add(factory, india_models.IndiaCustomer, tenant_id=WS_B, name="Theirs")
    body = {"customer_id": cid, "invoice_date": "2026-04-01", "due_date": "2026-05-01",
            "lines": [{"description": "x", "unit_price": 100}]}
    assert client.post(f"{FULL}/sales-invoices", json=body).status_code == 404
    own = _add(factory, india_models.IndiaCustomer, id="own-cust", tenant_id=WS_A, name="Ours")
    assert client.post(f"{FULL}/sales-invoices", json={**body, "customer_id": own}).status_code == 200


def test_purchase_invoice_rejects_other_workspace_vendor(client, factory):
    vid = _add(factory, india_models.IndiaVendor, tenant_id=WS_B, name="Theirs")
    body = {"vendor_id": vid, "invoice_date": "2026-04-01", "due_date": "2026-05-01", "invoice_number": "P1",
            "lines": [{"description": "x", "unit_price": 100}]}
    assert client.post(f"{FULL}/purchase-invoices", json=body).status_code == 404


def test_tds_entry_rejects_other_workspace_vendor(client, factory):
    vid = _add(factory, india_models.IndiaVendor, tenant_id=WS_B, name="Theirs")
    body = {"deductee_name": "X", "section": "194J", "nature": "fees", "payment_amount": 50000, "vendor_id": vid}
    assert client.post(f"{FULL}/tds", params={"period": "2026-04"}, json=body).status_code == 404


def test_other_workspace_journal_is_not_found(client, factory):
    from datetime import date

    jid = _add(factory, india_models.IndiaJournalEntry, tenant_id=WS_B, entry_date=date(2026, 4, 1),
               period="2026-04", description="Theirs")
    assert client.get(f"{FULL}/journals/{jid}").status_code == 404
    assert client.post(f"{FULL}/journals/{jid}/post").status_code == 404


# ─── India Excel & Sheets ──────────────────────────────────────────────────────


def test_demo_seed_goes_to_validated_workspace(client, factory):
    res = client.post("/api/india/demo/seed", headers={"X-Tenant-ID": "demo"})
    assert res.status_code == 200, res.text
    db = factory()
    try:
        assert {i.tenant_id for i in db.query(india_models.IndiaPurchaseInvoice).all()} == {WS_A}
    finally:
        db.close()


def test_google_sheets_config_is_per_workspace(client, env):
    cfg = {"sheet_url": "https://docs.google.com/spreadsheets/d/abc/edit"}
    assert client.post("/api/india/settings/google-sheets", json=cfg).status_code == 200
    env.workspace = WS_B
    env.roles[WS_B] = "accountant"
    assert client.get("/api/india/settings/google-sheets").json()["sheet_url"] == ""


def test_purchase_export_does_not_join_other_workspace_vendor(factory):
    from datetime import date

    from app.api.routes.india_excel_routes import _VENDOR_JOIN

    vid = _add(factory, india_models.IndiaVendor, tenant_id=WS_B, name="Theirs")
    _add(factory, india_models.IndiaPurchaseInvoice, tenant_id=WS_A, vendor_id=vid, invoice_number="P1",
         invoice_date=date(2026, 4, 1), due_date=date(2026, 5, 1))
    db = factory()
    try:
        rows = (
            db.query(india_models.IndiaPurchaseInvoice, india_models.IndiaVendor)
            .outerjoin(india_models.IndiaVendor, _VENDOR_JOIN)
            .filter(india_models.IndiaPurchaseInvoice.tenant_id == WS_A)
            .all()
        )
        assert [v for _, v in rows] == [None]
    finally:
        db.close()


# ─── CA bank statement classifier ─────────────────────────────────────────────


def test_client_coa_is_namespaced_per_workspace(client, env):
    res = client.post("/api/bank/client-coa/upload", data={"client_id": "c1", "ledgers": "Rent,Salary"})
    assert res.status_code == 200, res.text
    assert res.json()["client_id"] == "c1"
    assert client.get("/api/bank/client-coa/c1").json()["count"] == 2
    env.workspace = WS_B
    env.roles[WS_B] = "accountant"
    assert client.get("/api/bank/client-coa/c1").json()["count"] == 0


def test_ml_models_are_namespaced_per_workspace(client, monkeypatch):
    seen = []
    monkeypatch.setattr(ca_bank_router, "model_status", lambda org, acct: seen.append(org) or {"exists": False, "org_id": org})
    monkeypatch.setattr(ca_bank_router, "classify_transactions", lambda org, acct, txns: seen.append(org) or [])
    res = client.get("/api/bank/model-status/org1/acct1")
    assert res.status_code == 200
    assert res.json()["org_id"] == "org1"
    assert client.post("/api/bank/classify", json={"org_id": "org1", "account_id": "a", "transactions": []}).status_code == 200
    assert seen == [f"{WS_A}:org1", f"{WS_A}:org1"]


def test_viewer_cannot_train_or_upload_coa(client, env):
    env.roles[WS_A] = "viewer"
    assert client.post("/api/bank/train", json={"org_id": "o", "account_id": "a", "transactions": []}).status_code == 403
    assert client.post("/api/bank/client-coa/upload", data={"client_id": "c1", "ledgers": "Rent"}).status_code == 403
    assert client.post("/api/bank/confirm", json={"transactions": [], "confirmations": []}).status_code == 200
