"""AR collections, CRM and O2C: login + workspace membership required; every read and write is keyed
by the validated workspace, and ids from the client (invoices, deals, contacts) must belong to it."""

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

from app.api.routes import ar_collections, ar_collections_routes, crm_routes, o2c_routes
from app.core import company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.crm import CRMActivity, CRMContact, CRMDeal, CRMQuote
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "cccccccc-0000-4000-8000-00000000000a"
CO_B = "cccccccc-0000-4000-8000-00000000000b"

ROUTERS = [ar_collections.router, ar_collections_routes.router, crm_routes.router, o2c_routes.router]


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
    owners = {CO_A: WS_A, CO_B: WS_B}
    monkeypatch.setattr(company_access, "_company_workspace_ids", lambda _db, cid: iter([owners[cid]] if cid in owners else []))
    return e


def _app(env: Env | None, db_dep) -> FastAPI:
    app = FastAPI()
    for r in ROUTERS:
        app.include_router(r)
    app.dependency_overrides[get_db] = db_dep
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


# ─── Fake session for the raw-SQL collections routes ──────────────────────────


class _Result:
    def __init__(self, row=None, rows=(), rowcount=0):
        self._row, self._rows, self.rowcount = row, list(rows), rowcount

    def first(self):
        return self._row

    def fetchone(self):
        return self._row

    def scalar(self):
        return self._row[0] if self._row else 0

    def mappings(self):
        return self

    def all(self):
        return self._rows


class FakeSQL:
    """Records statements; answers the invoice-ownership probe from `invoices` {(id, tenant)}."""

    def __init__(self):
        self.invoices = {("inv-a", WS_A), ("inv-b", WS_B)}
        self.calls: list[tuple[str, dict]] = []

    def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        params = dict(params or {})
        self.calls.append((sql, params))
        if sql.startswith("SELECT 1 FROM uae_sales_invoices"):
            hit = (params["id"], params["tenant_id"]) in self.invoices
            return _Result(row=(1,) if hit else None)
        if "RETURNING invoice_id" in sql:
            return _Result(row=("inv-a",))
        if sql.startswith("SELECT COUNT(*)"):
            return _Result(row=(0,))
        return _Result(row={}, rows=[])

    def commit(self):
        pass

    def writes(self, keyword: str):
        return [p for s, p in self.calls if s.startswith(keyword)]


@pytest.fixture()
def fake_sql():
    return FakeSQL()


@pytest.fixture()
def sql_client(env, fake_sql):
    return TestClient(_app(env, lambda: fake_sql))


ROUTES = [
    (method, re.sub(r"\{[^}]+\}", "1", route.path))
    for r in ROUTERS
    for route in r.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


def test_every_route_is_covered():
    assert len(ROUTES) == 33


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(method, path, fake_sql):
    res = TestClient(_app(None, lambda: fake_sql)).request(method, path, json={}, params={"company_id": CO_A})
    assert res.status_code == 401, res.text
    assert fake_sql.calls == []


PROMISE = {"invoice_id": "inv-a", "invoice_number": "INV-1", "customer_name": "Acme", "promised_date": "2026-11-01"}


def test_promise_is_stored_under_the_validated_workspace_not_the_header(sql_client, fake_sql):
    res = sql_client.post(
        "/api/ar/collections/promises", json=PROMISE, headers={"X-Tenant-ID": WS_B, "X-Workspace-ID": WS_B}
    )
    assert res.status_code == 200, res.text
    (insert,) = fake_sql.writes("INSERT INTO ar_promises")
    assert insert["tenant_id"] == WS_A
    (update,) = fake_sql.writes("UPDATE uae_sales_invoices")
    assert update["tenant_id"] == WS_A


@pytest.mark.parametrize(
    "path,body",
    [
        ("/api/ar/collections/promises", PROMISE),
        ("/api/ar/collections/disputes", {"invoice_id": "inv-b", "invoice_number": "X", "customer_name": "C", "reason": "r"}),
        (
            "/api/ar/collections/queue",
            {"invoice_id": "inv-b", "invoice_number": "X", "customer_name": "C", "amount": 1, "days_overdue": 3, "queue_type": "call"},
        ),
        ("/api/ar/collections/reply-events", {"invoice_id": "inv-b", "raw_snippet": "s", "classified_intent": "PAY", "confidence_score": 0.9}),
    ],
)
def test_another_workspaces_invoice_cannot_be_touched(sql_client, fake_sql, path, body):
    res = sql_client.post(path, json={**body, "invoice_id": "inv-b"})
    assert res.status_code == 404, res.text
    assert fake_sql.writes("INSERT") == []
    assert fake_sql.writes("UPDATE") == []


def test_every_invoice_update_is_tenant_filtered(sql_client, fake_sql):
    assert sql_client.patch("/api/ar/collections/promises/p1", json={"status": "BROKEN"}).status_code == 200
    assert sql_client.patch("/api/ar/collections/disputes/d1/resolve", json={"resolution_notes": "ok"}).status_code == 200
    assert sql_client.post("/api/ar/collections/queue/q1/action", json={"action": "approved"}).status_code == 200
    updates = [s for s, _ in fake_sql.calls if s.startswith("UPDATE uae_sales_invoices")]
    assert updates and all("tenant_id = :tenant_id" in s for s in updates)


def test_tenant_query_param_must_match(sql_client, fake_sql):
    assert sql_client.get("/api/ar/collections/promises", params={"tenant_id": WS_B}).status_code == 403
    assert fake_sql.calls == []


def test_queue_approver_is_the_signed_in_user(sql_client, fake_sql):
    res = sql_client.post("/api/ar/collections/queue/q1/action", json={"action": "approved", "actioned_by": "ceo@victim.example"})
    assert res.status_code == 200, res.text
    (update,) = fake_sql.writes("UPDATE ar_human_queue")
    assert update["actioned_by"] == "a@example.com"


def test_viewers_can_read_but_not_write(sql_client, env, fake_sql):
    env.roles[WS_A] = "viewer"
    assert sql_client.get("/api/ar/collections/promises").status_code == 200
    assert sql_client.post("/api/ar/collections/promises", json=PROMISE).status_code == 403
    assert fake_sql.writes("INSERT") == []


def test_non_members_get_403(sql_client, env, fake_sql):
    env.roles[WS_A] = None
    assert sql_client.get("/api/ar/collections/promises").status_code == 403
    assert fake_sql.calls == []


def test_customer_tag_lookup_is_tenant_filtered(sql_client, fake_sql):
    assert sql_client.patch("/api/ar/collections/customer-tag", json={"customer_name": "Acme", "tag": "KEY"}).status_code == 200
    (sql, params), = [(s, p) for s, p in fake_sql.calls if s.startswith("UPDATE uae_sales_invoices")]
    assert "FROM uae_customers WHERE tenant_id = :tenant_id" in sql
    assert params["tenant_id"] == WS_A


# ─── AR summary / AI insight ───────────────────────────────────────────────────


def test_ar_summary_uses_the_validated_workspace_and_viewers_get_insights(env, fake_sql, monkeypatch):
    seen: list[str] = []
    monkeypatch.setattr(ar_collections.uae_cfo, "has_uae_transactions", lambda _db, ws, _cid: seen.append(ws) or False)
    client = TestClient(_app(env, lambda: fake_sql))
    env.roles[WS_A] = "viewer"
    assert client.get("/api/ar-collections/summary", headers={"X-Workspace-ID": WS_B}).status_code == 200
    assert client.post("/api/ar-collections/ai-insight").status_code == 200
    assert seen == [WS_A, WS_A]


# ─── O2C ───────────────────────────────────────────────────────────────────────


def test_o2c_summary_rejects_another_workspace(env, fake_sql):
    client = TestClient(_app(env, lambda: fake_sql))
    assert client.get("/api/o2c/summary", params={"company_id": CO_A, "workspace_id": WS_B}).status_code == 403


# ─── CRM (real SQLite tables) ─────────────────────────────────────────────────


@pytest.fixture()
def crm(env):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (CRMContact, CRMDeal, CRMActivity, CRMQuote):
        model.__table__.create(engine)
    factory = sessionmaker(bind=engine)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    seed = factory()
    seed.add_all(
        [
            CRMContact(id="contact-a", workspace_id=WS_A, name="Alice"),
            CRMContact(id="contact-b", workspace_id=WS_B, name="Bob", company_name="Victim Co"),
            CRMDeal(id="deal-b", workspace_id=WS_B, deal_name="Their deal", stage="Proposal"),
        ]
    )
    seed.commit()
    seed.close()
    return SimpleNamespace(client=TestClient(_app(env, _db)), session=factory)


def test_crm_lists_only_the_validated_workspace(crm):
    res = crm.client.get("/api/crm/contacts", headers={"X-Workspace-ID": WS_B, "X-Tenant-ID": WS_B})
    assert res.status_code == 200, res.text
    assert [c["id"] for c in res.json()["contacts"]] == ["contact-a"]
    assert crm.client.get("/api/crm/contacts", params={"workspace_id": WS_B}).status_code == 403


@pytest.mark.parametrize(
    "path,body",
    [
        ("/api/crm/activities", {"subject": "call", "deal_id": "deal-b"}),
        ("/api/crm/activities", {"subject": "call", "contact_id": "contact-b"}),
        ("/api/crm/quotes", {"line_items": [{"description": "x", "unit_price": 10}], "contact_id": "contact-b"}),
        ("/api/crm/quotes", {"line_items": [{"description": "x", "unit_price": 10}], "deal_id": "deal-b"}),
        ("/api/crm/deals", {"deal_name": "d", "contact_id": "contact-b"}),
    ],
)
def test_crm_rejects_references_to_another_workspace(crm, path, body):
    assert crm.client.post(path, json=body).status_code == 404


def test_convert_quote_never_touches_another_workspaces_deal_or_contact(crm, monkeypatch):
    from app.api.routes import uae_ar_routes
    from app.services import ar_invoice_post_service

    invoices: list = []

    def _create(payload, request, db):
        invoices.append(payload)
        return {"invoice_id": "inv-new", "invoice_number": "INV-9", "total": 10.5, "posted": False}

    monkeypatch.setattr(uae_ar_routes, "create_invoice", _create)
    monkeypatch.setattr(ar_invoice_post_service, "post_sales_invoice_to_gl_and_tax", lambda *a, **k: {"ok": True})

    s = crm.session()
    s.add(CRMQuote(id="q-legacy", workspace_id=WS_A, deal_id="deal-b", contact_id="contact-b",
                   line_items=[{"description": "x", "qty": 1, "unit_price": 10, "vat_rate": 5}]))
    s.commit()
    s.close()

    res = crm.client.post("/api/crm/quotes/q-legacy/convert-to-invoice", json={"company_id": CO_A})
    assert res.status_code == 200, res.text
    assert invoices[0].customer_name == "Customer"
    assert invoices[0].workspace_id == WS_A
    s = crm.session()
    assert s.get(CRMDeal, "deal-b").stage == "Proposal"
    assert s.get(CRMDeal, "deal-b").ar_invoice_id is None
    s.close()


def test_convert_quote_requires_access_to_the_company(crm, env):
    env.roles[WS_B] = None
    s = crm.session()
    s.add(CRMQuote(id="q1", workspace_id=WS_A, line_items=[{"description": "x", "unit_price": 10}]))
    s.commit()
    s.close()
    assert crm.client.post("/api/crm/quotes/q1/convert-to-invoice", json={"company_id": CO_B}).status_code == 403
