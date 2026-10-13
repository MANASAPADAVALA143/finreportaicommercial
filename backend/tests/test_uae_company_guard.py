"""UAE AR and CT return routes: a company_id in the query, X-Company-ID header, JSON body or form
body must belong to a workspace the caller can use (write access for anything but GET), so AR
invoices, GulfTax VAT postings and CT returns can't be tagged with another tenant's company."""

from __future__ import annotations

import io
import os
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import ct_return as ct
from app.api.routes import uae_ar_routes as ar
from app.core import company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "cccccccc-0000-4000-8000-00000000000a"
CO_B = "cccccccc-0000-4000-8000-00000000000b"


class Env:
    def __init__(self):
        self.roles = {WS_A: "accountant", WS_B: None}

    def ctx(self) -> WorkspaceContext:
        return WorkspaceContext(
            workspace_id=WS_A,
            workspace=SimpleNamespace(id=WS_A),
            user=SimpleNamespace(id="user-1", email="a@example.com", role="user"),
            role=WorkspaceRole(self.roles[WS_A]) if self.roles[WS_A] else None,
        )


@pytest.fixture()
def env(monkeypatch):
    e = Env()
    owners = {CO_A: WS_A, CO_B: WS_B}
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    monkeypatch.setattr(company_access, "_company_workspace_ids", lambda _db, cid: iter([owners[cid]] if cid in owners else []))
    return e


@pytest.fixture()
def calls(monkeypatch):
    seen: list[tuple] = []
    monkeypatch.setattr(ar, "post_sales_invoice_to_gl_and_tax", lambda invoice_id, **kw: seen.append(("post", kw)) or {"ok": True})
    monkeypatch.setattr(ar, "generate_due_invoices", lambda _db, ws, _d, cid: seen.append(("recurring", cid)) or {"generated": 0})
    monkeypatch.setattr(ct.svc, "generate_ct_return", lambda _db, t, cid, *_a: seen.append(("ct", cid)) or {"id": "ct-1"})
    monkeypatch.setattr(ct.svc, "list_ct_returns", lambda _db, t, cid, status=None: seen.append(("ct-list", cid)) or [])
    return seen


@pytest.fixture()
def client(env):
    app = FastAPI()
    app.include_router(ar.router)
    app.include_router(ct.router)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    factory = sessionmaker(bind=engine)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[validate_workspace] = env.ctx
    return TestClient(app, raise_server_exceptions=False)


CT_BODY = {"period_start": "2026-01-01", "period_end": "2026-12-31"}


def test_approve_and_post_rejects_another_tenants_company_in_body(client, calls):
    res = client.post("/api/uae/ar/approve-and-post", json={"invoice_id": "inv-1", "company_id": CO_B})
    assert res.status_code == 403
    assert calls == []


def test_approve_and_post_rejects_another_tenants_company_in_header(client, calls):
    res = client.post("/api/uae/ar/approve-and-post", json={"invoice_id": "inv-1"}, headers={"X-Company-ID": CO_B})
    assert res.status_code == 403
    assert calls == []


def test_approve_and_post_accepts_own_company(client, calls):
    res = client.post("/api/uae/ar/approve-and-post", json={"invoice_id": "inv-1", "company_id": CO_A})
    assert res.status_code == 200, res.text
    assert calls[0][1]["company_id"] == CO_A


def test_recurring_generation_rejects_another_tenants_company(client, calls):
    assert client.post("/api/uae/ar/recurring-invoices/generate-due", json={"company_id": CO_B}).status_code == 403
    assert calls == []


@pytest.mark.parametrize("path", ["/api/uae/ar/invoices", "/api/uae/ar/aging", "/api/uae/ar/credit-notes"])
def test_reads_reject_another_tenants_company(client, path):
    assert client.get(path, params={"company_id": CO_B}).status_code == 403
    assert client.get(path, headers={"X-Company-ID": CO_B}).status_code == 403


def test_bulk_import_form_rejects_another_tenants_company(client):
    files = {"file": ("ar.csv", io.BytesIO(b"customer,amount\nA,1\n"), "text/csv")}
    assert client.post("/api/uae/ar/bulk-import", data={"company_id": CO_B}, files=files).status_code == 403


def test_malformed_company_id_is_rejected(client, calls):
    assert client.get("/api/uae/ar/invoices", params={"company_id": "demo"}).status_code == 422
    assert client.post("/api/gulftax/ct-return/generate", json={**CT_BODY, "company_id": "x"}).status_code == 422
    assert calls == []


def test_viewer_can_read_but_not_post(client, env, calls):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/uae/ar/invoices", params={"company_id": CO_A}).status_code not in (401, 403, 422)
    assert client.post("/api/uae/ar/approve-and-post", json={"invoice_id": "inv-1", "company_id": CO_A}).status_code == 403
    assert calls == []


def test_ct_return_generate_checks_body_and_header_company(client, calls):
    assert client.post("/api/gulftax/ct-return/generate", json={**CT_BODY, "company_id": CO_B}).status_code == 403
    assert client.post("/api/gulftax/ct-return/generate", json=CT_BODY, headers={"X-Company-ID": CO_B}).status_code == 403
    assert calls == []
    res = client.post("/api/gulftax/ct-return/generate", json={**CT_BODY, "company_id": CO_A})
    assert res.status_code == 200, res.text
    assert calls == [("ct", CO_A)]


def test_ct_return_list_checks_company(client, calls):
    assert client.get("/api/gulftax/ct-return", params={"company_id": CO_B}).status_code == 403
    assert client.get("/api/gulftax/ct-return", params={"company_id": CO_A}).status_code == 200
    assert calls == [("ct-list", CO_A)]
