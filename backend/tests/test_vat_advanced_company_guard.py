"""VAT Advanced (partial exemption, bad debt relief, designated zones): the X-Company-ID header,
query or body company_id must belong to a workspace the caller can use, viewers may only read,
and records stay with the company they were saved under."""

from __future__ import annotations

import os
import re
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import vat_advanced_rds as vat
from app.core import company_access
from app.core import tenant as core_tenant
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.client_data import BadDebtReliefClaim, DesignatedZoneTransaction, PartialExemptionCalculation
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "cccccccc-0000-4000-8000-00000000000a"
CO_A2 = "cccccccc-0000-4000-8000-0000000000a2"
CO_B = "cccccccc-0000-4000-8000-00000000000b"

ENDPOINTS = sorted(
    (method, re.sub(r"\{[^}]+\}", "x", route.path))
    for route in vat.router.routes
    for method in route.methods
)

BAD_DEBT = {
    "invoice_number": "INV-1",
    "invoice_date": "2025-01-01",
    "due_date": "2025-02-01",
    "invoice_amount": 1050,
    "vat_amount": 50,
}


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
    owners = {CO_A: WS_A, CO_A2: WS_A, CO_B: WS_B}
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    monkeypatch.setattr(company_access, "_company_workspace_ids", lambda _db, cid: iter([owners[cid]] if cid in owners else []))
    monkeypatch.setattr(vat, "_sb_list", lambda *_a, **_k: [])
    monkeypatch.setattr(vat, "_sb_insert", lambda *_a, **_k: pytest.fail("Supabase fallback should not run"))
    return e


@pytest.fixture()
def client(env):
    app = FastAPI()
    app.include_router(vat.router)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (BadDebtReliefClaim, DesignatedZoneTransaction, PartialExemptionCalculation):
        model.__table__.create(engine)
    factory = sessionmaker(bind=engine)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[validate_workspace] = env.ctx
    app.dependency_overrides[core_tenant.get_tenant_id] = lambda: WS_A
    app.dependency_overrides[core_tenant.get_current_user] = lambda: SimpleNamespace(id="user-1", company_id=None, role="user")
    return TestClient(app, raise_server_exceptions=False)


def test_every_route_is_swept():
    assert len(ENDPOINTS) == 8


@pytest.mark.parametrize(("method", "path"), ENDPOINTS)
def test_foreign_company_header_is_refused(client, method, path):
    assert client.request(method, path, headers={"X-Company-ID": CO_B}).status_code == 403


@pytest.mark.parametrize(("method", "path"), ENDPOINTS)
def test_foreign_company_query_is_refused(client, method, path):
    assert client.request(method, path, params={"company_id": CO_B}).status_code == 403


@pytest.mark.parametrize(("method", "path"), [(m, p) for m, p in ENDPOINTS if m != "GET"])
def test_foreign_company_body_is_refused(client, method, path):
    assert client.request(method, path, json={"company_id": CO_B}).status_code == 403


def test_bad_debt_saved_and_listed_per_own_company(client):
    res = client.post("/api/gulftax/vat-advanced/bad-debt", json=BAD_DEBT, headers={"X-Company-ID": CO_A})
    assert res.status_code == 201, res.text

    mine = client.get("/api/gulftax/vat-advanced/bad-debt", headers={"X-Company-ID": CO_A}).json()["items"]
    assert [r["invoice_number"] for r in mine] == ["INV-1"]
    other = client.get("/api/gulftax/vat-advanced/bad-debt", headers={"X-Company-ID": CO_A2}).json()["items"]
    assert other == []


def test_approving_a_record_of_another_company_is_404(client):
    rid = client.post("/api/gulftax/vat-advanced/bad-debt", json=BAD_DEBT, headers={"X-Company-ID": CO_A}).json()["id"]
    res = client.patch(f"/api/gulftax/vat-advanced/bad-debt/{rid}/approve", headers={"X-Company-ID": CO_A2})
    assert res.status_code == 404


def test_viewer_can_read_but_not_write(client, env):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/gulftax/vat-advanced/bad-debt", headers={"X-Company-ID": CO_A}).status_code == 200
    assert client.post("/api/gulftax/vat-advanced/bad-debt", json=BAD_DEBT, headers={"X-Company-ID": CO_A}).status_code == 403


def test_non_member_is_refused(client, env):
    env.roles[WS_A] = None
    assert client.get("/api/gulftax/vat-advanced/bad-debt").status_code == 403


def test_malformed_company_header_is_rejected(client):
    assert client.get("/api/gulftax/vat-advanced/bad-debt", headers={"X-Company-ID": "demo"}).status_code == 422
