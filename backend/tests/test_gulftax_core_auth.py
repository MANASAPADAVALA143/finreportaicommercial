"""GulfTax VAT router, e-invoicing and ESR: login + workspace membership required, workspace =
validated workspace, and company ids in bodies / aliases are checked like headers."""

from __future__ import annotations

import hashlib
import hmac
import json
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

from app.api.routes import vat_advanced_rds
from app.core import company_access
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.client_data import EinvoicingSubmission
from app.models.workspace import WorkspaceRole
from app.modules.gulftax import auth_cfo, esr_filing, gulftax_einvoicing as einv, ported_mount
from app.modules.gulftax import router as gt
from app.services import einvoicing_service_unified, gulftax_supabase, gulftax_sync_service
from app.services import uae_journal_service

ported_mount._alias_ported_orm_modules()
ported_mount._patch_auth()

import database as ported_database  # noqa: E402
from models import Company  # noqa: E402

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "co-a"
CO_B = "co-b"
GUARDED_ROUTERS = [gt.router, einv.router, esr_filing.router]
ESR = {"relevant_activity": "Banking", "directed_managed_uae": True, "cigas_uae": True,
       "uae_employees": 3, "uae_expenditure": 100000, "uae_assets": 50000}
PUBLIC = {"/api/gulftax/health", "/api/gulftax/status", "/api/gulftax/einvoicing/asp/inbound"}


class Env:
    def __init__(self):
        self.workspace = WS_A
        self.roles = {WS_A: "accountant"}

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
    monkeypatch.setattr(company_access, "_company_workspace_ids", lambda _db, _cid: iter(()))
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    ported_database.Base.metadata.create_all(engine, tables=[Company.__table__])
    Base.metadata.create_all(engine, tables=[EinvoicingSubmission.__table__])
    make = sessionmaker(bind=engine)
    db = make()
    db.add_all([
        Company(id=CO_A, name="Mine LLC", entity_type="mainland", workspace_id=WS_A),
        Company(id=CO_B, name="Victim LLC", entity_type="mainland", workspace_id=WS_B),
        EinvoicingSubmission(id="sub-a", tenant_id=WS_A, company_id=CO_A, invoice_id="inv-a",
                             invoice_number="A-1", xml_payload="<Invoice/>"),
        EinvoicingSubmission(id="sub-b", tenant_id=WS_B, company_id=CO_B, invoice_id="inv-b",
                             invoice_number="B-1", xml_payload="<Invoice/>", submission_status="error"),
    ])
    db.commit()
    db.close()
    return make


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    for r in (gt.public_router, gt.router, einv.router, einv.inbound_router, esr_filing.router):
        app.include_router(r)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    for dep in (get_db, ported_mount.get_ported_db, auth_cfo._ported_db, einv._ported_db):
        app.dependency_overrides[dep] = _db
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


@pytest.fixture()
def client(factory, env):
    return TestClient(_app(factory, env))


@pytest.fixture()
def calls(monkeypatch):
    seen: dict[str, dict] = {}

    def record(name, result):
        def fake(*args, **kwargs):
            seen[name] = {"args": args, **kwargs}
            return result
        return fake

    monkeypatch.setattr(gulftax_sync_service, "list_transactions", record("list", []))
    monkeypatch.setattr(gulftax_sync_service, "aggregate_vat_return_summary", record("summary", {}))
    monkeypatch.setattr(gulftax_sync_service, "sync_period", record("sync_period", {"ok": True}))
    monkeypatch.setattr(gulftax_sync_service, "sync_approved_invoice_to_gulftax", record("sync_invoice", {"ok": True}))
    monkeypatch.setattr(gulftax_sync_service, "_fetch_invoice",
                        lambda iid: {"id": iid, "company_id": CO_B if iid == "inv-b" else CO_A})
    monkeypatch.setattr(gulftax_supabase, "fetch_vat_return_boxes", record("boxes", {}))
    monkeypatch.setattr(uae_journal_service, "create_journal_entry",
                        record("je", SimpleNamespace(id="je-1", entry_number="JE-1")))
    monkeypatch.setattr(esr_filing, "_persist_esr", record("esr", None))
    monkeypatch.setattr(vat_advanced_rds, "save_dz", record("dz", {"ok": True}))
    monkeypatch.setattr(einvoicing_service_unified, "update_submission_status",
                        record("asp_status", SimpleNamespace(submission_status="accepted")))
    return seen


GUARDED = sorted({
    (method, re.sub(r"\{[^}]+\}", "1", route.path))
    for router in GUARDED_ROUTERS
    for route in router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
})


@pytest.mark.parametrize("method,path", GUARDED, ids=[f"{m} {p}" for m, p in GUARDED])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(method, path, json={})
    assert res.status_code == 401, res.text


def test_only_health_checks_and_the_signed_asp_callback_are_public():
    public = {r.path for r in gt.public_router.routes} | {r.path for r in einv.inbound_router.routes}
    assert public == PUBLIC
    assert not PUBLIC & {path for _m, path in GUARDED}


def test_non_members_get_403(client, env):
    env.roles[WS_A] = None
    assert client.get("/api/gulftax/vat-return/boxes?period=2026-Q1").status_code == 403


def test_workspace_comes_from_the_validated_workspace(client, calls):
    res = client.get("/api/gulftax/vat-return/boxes?period=2026-Q1", headers={"X-Workspace-Id": WS_B})
    assert res.status_code == 200, res.text
    assert calls["boxes"]["args"][0] == WS_A
    assert client.get(f"/api/gulftax/vat-return/boxes?period=2026-Q1&workspace_id={WS_B}").status_code == 403


@pytest.mark.parametrize("path", [
    "/api/gulftax/transactions?tax_period=2026-Q1&tenant_id=co-b",
    "/api/gulftax/vat-return-summary?tax_period=2026-Q1&tenant_id=co-b",
    "/api/gulftax/transactions?tax_period=2026-Q1&company_id=co-b",
])
def test_company_aliases_in_query_are_checked(client, calls, path):
    assert client.get(path).status_code == 403
    assert calls == {}


def test_own_company_transactions_are_scoped_to_the_workspace(client, calls):
    res = client.get("/api/gulftax/transactions?tax_period=2026-Q1&tenant_id=co-a")
    assert res.status_code == 200, res.text
    assert calls["list"]["args"][0] == CO_A
    assert calls["list"]["workspace_id"] == WS_A


@pytest.mark.parametrize("path,body", [
    ("/api/gulftax/sync-period", {"tax_period": "2026-Q1", "company_id": CO_B}),
    ("/api/gulftax/sync-period", {"tax_period": "2026-Q1", "tenant_id": CO_B}),
    ("/api/gulftax/vat-return/record-payment",
     {"company_id": CO_B, "payment_date": "2026-04-01", "amount_aed": 10}),
    ("/api/gulftax/vat-return/record-payment",
     {"workspace_id": WS_B, "payment_date": "2026-04-01", "amount_aed": 10}),
    ("/api/gulftax/sync-invoice", {"invoice_id": "inv-a", "company_id": CO_B}),
    ("/api/gulftax/sync-invoice", {"invoice_id": "inv-b", "company_id": CO_A}),
    ("/api/gulftax/recon/override", {"period": "2026-Q1", "reason": "fine", "company_id": CO_B}),
    ("/api/gulftax/designated-zones/log", {"transaction_type": "goods", "supplier_location": "x",
                                           "customer_location": "y", "vat_treatment": "zero",
                                           "company_id": CO_B}),
    ("/api/gulftax/esr/calculate", {**ESR, "company_id": CO_B}),
    ("/api/gulftax/einvoicing/asp/submit",
     {"invoice_number": "X", "net_amount": 1, "vat_amount": 0, "gross_amount": 1, "company_id": CO_B}),
])
def test_company_and_workspace_in_bodies_are_checked(client, calls, path, body):
    assert client.post(path, json=body).status_code == 403
    assert not {"sync_period", "je", "sync_invoice", "dz", "esr"} & calls.keys()


def test_vat_payment_posts_in_the_active_workspace(client, calls):
    res = client.post("/api/gulftax/vat-return/record-payment",
                      json={"company_id": CO_A, "payment_date": "2026-04-01", "amount_aed": 10})
    assert res.status_code == 200, res.text
    assert calls["je"]["tenant_id"] == WS_A and calls["je"]["company_id"] == CO_A


def test_sync_invoice_for_own_company(client, calls):
    res = client.post("/api/gulftax/sync-invoice", json={"invoice_id": "inv-a", "company_id": CO_A})
    assert res.status_code == 200, res.text
    assert calls["sync_invoice"]["workspace_id"] == WS_A


def test_esr_is_saved_in_the_active_workspace(client, calls):
    res = client.post("/api/gulftax/esr/calculate", json={**ESR, "company_id": CO_A},
                      headers={"X-Workspace-Id": WS_B})
    assert res.status_code == 200, res.text
    assert calls["esr"]["tenant_id"] == WS_A and calls["esr"]["company_id"] == CO_A


def test_bulk_excel_only_downloads_in_the_creating_workspace(client, monkeypatch, tmp_path):
    path = tmp_path / "x.xlsx"
    path.write_bytes(b"x")
    monkeypatch.setitem(gt._BULK_EXCEL_PATHS, "job-b", (WS_B, str(path)))
    monkeypatch.setitem(gt._BULK_EXCEL_PATHS, "job-a", (WS_A, str(path)))
    assert client.get("/api/gulftax/classify-bulk/job-b/excel").status_code == 404
    assert client.get("/api/gulftax/classify-bulk/job-a/excel").status_code == 200


def test_einvoice_xml_and_submissions_are_tenant_scoped(client):
    assert client.get("/api/gulftax/einvoicing/inv-b/download-xml").status_code == 404
    assert client.get("/api/gulftax/einvoicing/inv-a/download-xml").status_code == 200
    assert client.get(f"/api/gulftax/einvoicing/asp/submissions?workspace_id={WS_B}").status_code == 403
    assert client.post("/api/gulftax/einvoicing/asp/sub-b/redrive").status_code == 404


def test_asp_callback_requires_the_n8n_signature(client, calls, monkeypatch):
    monkeypatch.setenv("N8N_WEBHOOK_SECRET", "s3cret")
    raw = json.dumps({"submission_id": "sub-b", "status": "accepted"}).encode()
    url = "/api/gulftax/einvoicing/asp/inbound"
    assert client.post(url, content=raw).status_code == 401
    assert client.post(url, content=raw, headers={"X-N8N-Signature": "nope"}).status_code == 401
    assert "asp_status" not in calls
    sig = hmac.new(b"s3cret", raw, hashlib.sha256).hexdigest()
    res = client.post(url, content=raw, headers={"X-N8N-Signature": sig, "Content-Type": "application/json"})
    assert res.status_code == 200, res.text
    assert calls["asp_status"]["args"][1] == "sub-b"
