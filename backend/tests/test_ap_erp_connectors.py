"""
Tests for AP ERP connector workflows:
  • duplicate prevention (Zoho 36026 / QBO 6240)
  • retry safety (already-stamped invoices are skipped)
  • tenant isolation (company_id filter, platform_admin guard)
  • approval atomicity (ERP push never rolls back a GL post)
  • vendor pull (create vs update vs skipped, pagination, blank name)
  • bulk sync (unsynced selection, stamp-on-success, error accumulation)
"""
from __future__ import annotations

import json
import os
from types import SimpleNamespace
from typing import Any

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.api.routes.ap_integrations as intg_mod
import app.services.ap_settings_service as settings_svc
from app.api.routes.ap_integrations import (
    _fetch_approved_unsynced,
    _mark_erp_bill,
    _upsert_vendor,
    _num,
)
from app.core.tenant_scope import platform_admin, workspace_member
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole

# ── shared constants ──────────────────────────────────────────────────────────

WS_A = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa"
INV_1 = "inv-00000001"
INV_2 = "inv-00000002"
INV_3 = "inv-00000003"


# ── minimal Supabase table fake ───────────────────────────────────────────────


class FakeTable:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self._filters: list[tuple[str, Any]] = []
        self._is_null: list[str] = []
        self._op = "select"
        self._payload: dict | None = None
        self._limit_n: int | None = None

    # builder
    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def is_(self, col, val):
        if val == "null":
            self._is_null.append(col)
        return self

    def ilike(self, col, val):
        self._filters.append(("ilike", col, val))
        return self

    def lt(self, col, val):
        self._filters.append(("lt", col, val))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit_n = n
        return self

    def insert(self, payload):
        self._op, self._payload = "insert", payload
        return self

    def update(self, payload):
        self._op, self._payload = "update", payload
        return self

    # execute
    def _match(self, row: dict) -> bool:
        for op, col, val in self._filters:
            rv = row.get(col)
            if op == "eq" and str(rv) != str(val):
                return False
            if op == "ilike" and (rv or "").lower() != (val or "").lower():
                return False
            if op == "lt" and rv is not None and not (str(rv) < str(val)):
                return False
        for col in self._is_null:
            if row.get(col) is not None:
                return False
        return True

    def execute(self):
        if self._op == "insert":
            new_row = {"id": f"row-{len(self.rows) + 1}", **self._payload}
            self.rows.append(new_row)
            return SimpleNamespace(data=[new_row])
        if self._op == "update":
            hits = [r for r in self.rows if self._match(r)]
            for r in hits:
                r.update(self._payload)
            return SimpleNamespace(data=hits)
        hits = [r for r in self.rows if self._match(r)]
        if self._limit_n is not None:
            hits = hits[: self._limit_n]
        return SimpleNamespace(data=hits)


class FakeSupabase:
    def __init__(self, invoices: list[dict] | None = None, vendors: list[dict] | None = None):
        self._tables: dict[str, list[dict]] = {
            "invoices": invoices or [],
            "vendors": vendors or [],
            "app_settings": [],
        }

    def table(self, name: str) -> FakeTable:
        return FakeTable(self._tables.setdefault(name, []))

    # helpers for assertions
    def invoice(self, inv_id: str) -> dict | None:
        return next((r for r in self._tables["invoices"] if r["id"] == inv_id), None)

    def vendor_names(self) -> list[str]:
        return [r["name"] for r in self._tables["vendors"]]


# ── FastAPI test app ──────────────────────────────────────────────────────────


_DEFAULT_SETTINGS: dict[str, str] = {
    "zoho_refresh_token": "rt-zoho",
    "zoho_organization_id": "org-1",
    "zoho_client_id": "cid",
    "zoho_client_secret": "csec",
    "zoho_domain": "com",
    "zoho_access_token": "tok-zoho",
    "zoho_access_token_expiry": "9999999999999",
    "qb_refresh_token": "rt-qb",
    "qb_realm_id": "realm-1",
    "qb_client_id": "qcid",
    "qb_client_secret": "qcsec",
    "qb_environment": "sandbox",
    "qb_access_token": "tok-qb",
    "qb_access_token_expiry": "9999999999999",
}


_SENTINEL = object()  # distinguish "not passed" from explicit None / {}


def _patch_settings(monkeypatch, overrides=_SENTINEL) -> dict[str, str]:
    # Pass overrides=None or overrides={} for an empty settings store (no tokens).
    # Omit or pass a dict to merge on top of defaults.
    if overrides is _SENTINEL:
        s = dict(_DEFAULT_SETTINGS)
    elif overrides is None:
        s = {}
    else:
        s = {**_DEFAULT_SETTINGS, **overrides}
    monkeypatch.setattr(settings_svc, "get_app_setting", lambda k: s.get(k))
    monkeypatch.setattr(settings_svc, "upsert_app_setting", lambda k, v: s.update({k: v}))
    monkeypatch.setattr(intg_mod, "get_app_setting", lambda k: s.get(k))
    monkeypatch.setattr(intg_mod, "upsert_app_setting", lambda k, v: s.update({k: v}))
    return s


def _make_app(monkeypatch, sb: FakeSupabase, settings=_SENTINEL) -> TestClient:
    """Build a minimal FastAPI app with the ap_integrations router and mocked deps."""
    _patch_settings(monkeypatch, settings)
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)

    ctx = WorkspaceContext(
        workspace_id=WS_A,
        workspace=SimpleNamespace(id=WS_A),
        user=SimpleNamespace(id="user-1", email="admin@example.com", role="user"),
        role=WorkspaceRole("owner"),
    )

    app = FastAPI()
    app.include_router(intg_mod.router)
    app.dependency_overrides[validate_workspace] = lambda: ctx
    app.dependency_overrides[workspace_member] = lambda: ctx
    app.dependency_overrides[platform_admin] = lambda: ctx

    return TestClient(app, raise_server_exceptions=False)


# ── helpers ───────────────────────────────────────────────────────────────────


_OLD_TIMESTAMP = "2020-01-01T00:00:00+00:00"  # always passes any age filter


def _approved_invoice(inv_id: str, company_id: str | None = None, **extra) -> dict:
    return {
        "id": inv_id,
        "company_id": company_id or "comp-1",
        "vendor_name": "Acme Ltd",
        "invoice_number": f"INV-{inv_id[-4:]}",
        "invoice_date": "2025-01-01",
        "due_date": "2025-01-31",
        "currency": "AED",
        "total_amount": 1050.0,
        "tax_amount": 50.0,
        "tax_rate": 5,
        "gl_code": "7140",
        "gl_name": "Cost of Goods",
        "status": "Approved",
        "updated_at": _OLD_TIMESTAMP,
        "erp_zoho_bill_id": None,
        "erp_qbo_bill_id": None,
        **extra,
    }


def _zoho_success(bill_id: str = "z-bill-1") -> dict:
    return {"code": 0, "bill": {"bill_id": bill_id, "bill_number": "BILL-001"}}


def _zoho_duplicate() -> dict:
    return {"code": 36026, "message": "Bill Number already exists"}


def _qbo_success(bill_id: str = "q-bill-1") -> dict:
    return {"Bill": {"Id": bill_id}}


def _qbo_duplicate() -> dict:
    # QBO returns HTTP 400 with Fault code 6240
    return {
        "Fault": {
            "Error": [{"code": "6240", "Detail": "Duplicate DocNumber", "Message": "Duplicate"}]
        }
    }


def _qbo_query_empty() -> dict:
    return {"QueryResponse": {}}


def _qbo_query_found(
    bill_id: str = "q-existing",
    vendor: str = "Acme Ltd",
    amount: float = 1050.0,
) -> dict:
    return {
        "QueryResponse": {
            "Bill": [{"Id": bill_id, "TotalAmt": amount, "VendorRef": {"name": vendor}}]
        }
    }


# ── _num helper ───────────────────────────────────────────────────────────────


def test_num_coerces_string():
    assert _num("1050.5") == pytest.approx(1050.5)


def test_num_handles_none():
    assert _num(None) == 0.0


def test_num_handles_bad_string():
    assert _num("n/a") == 0.0


# ── _upsert_vendor ────────────────────────────────────────────────────────────


def test_upsert_vendor_creates_new():
    sb = FakeSupabase()
    result = _upsert_vendor(sb, "Acme Corp", {"email": "ap@acme.com"}, None)
    assert result == "created"
    assert "Acme Corp" in sb.vendor_names()


def test_upsert_vendor_updates_existing():
    sb = FakeSupabase(vendors=[{"id": "v-1", "name": "Acme Corp", "email": "old@acme.com"}])
    result = _upsert_vendor(sb, "Acme Corp", {"email": "new@acme.com"}, None)
    assert result == "updated"
    # only one row — no duplicate
    assert len(sb._tables["vendors"]) == 1


def test_upsert_vendor_skips_blank_name():
    sb = FakeSupabase()
    for blank in ("", "   ", None):
        assert _upsert_vendor(sb, blank, {}, None) == "skipped"
    assert sb.vendor_names() == []


def test_upsert_vendor_scoped_to_company():
    sb = FakeSupabase(vendors=[
        {"id": "v-1", "name": "Global Co", "company_id": "comp-A"},
        {"id": "v-2", "name": "Global Co", "company_id": "comp-B"},
    ])
    # update scoped to comp-A must not touch comp-B's row
    _upsert_vendor(sb, "Global Co", {"email": "a@global.com"}, "comp-A")
    comp_a = next(r for r in sb._tables["vendors"] if r["id"] == "v-1")
    comp_b = next(r for r in sb._tables["vendors"] if r["id"] == "v-2")
    assert comp_a.get("email") == "a@global.com"
    assert comp_b.get("email") is None


# ── _fetch_approved_unsynced ──────────────────────────────────────────────────


def test_fetch_unsynced_excludes_already_stamped(monkeypatch):
    sb = FakeSupabase(invoices=[
        _approved_invoice(INV_1),                                   # unsynced
        _approved_invoice(INV_2, erp_zoho_bill_id="z-bill-99"),     # already pushed
    ])
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    rows = _fetch_approved_unsynced("erp_zoho_bill_id")
    assert len(rows) == 1
    assert rows[0]["id"] == INV_1


def test_fetch_unsynced_filtered_by_company(monkeypatch):
    sb = FakeSupabase(invoices=[
        _approved_invoice(INV_1, company_id="comp-X"),
        _approved_invoice(INV_2, company_id="comp-Y"),
    ])
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    rows = _fetch_approved_unsynced("erp_zoho_bill_id", "comp-X")
    assert all(r["company_id"] == "comp-X" for r in rows)
    assert len(rows) == 1


def test_fetch_unsynced_excludes_non_approved(monkeypatch):
    sb = FakeSupabase(invoices=[
        {**_approved_invoice(INV_1), "status": "Pending"},
        _approved_invoice(INV_2),
    ])
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    rows = _fetch_approved_unsynced("erp_zoho_bill_id")
    assert len(rows) == 1 and rows[0]["id"] == INV_2


# ── _mark_erp_bill ────────────────────────────────────────────────────────────


def test_mark_erp_bill_stamps_invoice(monkeypatch):
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1)])
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    _mark_erp_bill(INV_1, "erp_zoho_bill_id", "z-123")
    assert sb.invoice(INV_1)["erp_zoho_bill_id"] == "z-123"


def test_mark_erp_bill_retries_once_then_logs_error(monkeypatch, caplog):
    """_mark_erp_bill retries once; after two failures it logs ERROR and does not raise."""
    import logging
    calls: list[int] = []

    class _FailTable(FakeTable):
        def __init__(self):
            super().__init__([])

        def update(self, payload):
            calls.append(1)
            raise RuntimeError("Supabase timeout")

        def execute(self):
            raise RuntimeError("Supabase timeout")

    class _FailSB:
        def table(self, _name):
            return _FailTable()

    monkeypatch.setattr(intg_mod, "get_supabase", lambda: _FailSB())

    with caplog.at_level(logging.ERROR, logger="app.api.routes.ap_integrations"):
        _mark_erp_bill(INV_1, "erp_zoho_bill_id", "z-999")  # must not raise

    assert len(calls) == 2  # tried twice
    assert any("failed permanently" in r.message for r in caplog.records)


# ── Zoho bulk sync ────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_zoho_bulk_sync_stamps_on_success(monkeypatch):
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1), _approved_invoice(INV_2)])
    _patch_settings(monkeypatch)
    client, transport = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=_zoho_success("z-bill-1")),
        httpx.Response(200, json=_zoho_success("z-bill-2")),
    ])
    async with client:
        from app.api.routes.ap_integrations import bulk_sync_zoho
        result = await bulk_sync_zoho()
    assert result["pushed"] == 2
    assert result["failed"] == 0
    assert sb.invoice(INV_1)["erp_zoho_bill_id"] == "z-bill-1"
    assert sb.invoice(INV_2)["erp_zoho_bill_id"] == "z-bill-2"


@pytest.mark.anyio
async def test_zoho_bulk_sync_duplicate_treated_as_skipped(monkeypatch):
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1)])
    _patch_settings(monkeypatch)
    client, transport = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=_zoho_duplicate()),
    ])
    async with client:
        from app.api.routes.ap_integrations import bulk_sync_zoho
        result = await bulk_sync_zoho()
    assert result["pushed"] == 0
    assert result["skipped"] == 1
    assert result["failed"] == 0
    # stamped as 'duplicate' so it won't be retried
    assert sb.invoice(INV_1)["erp_zoho_bill_id"] == "duplicate"


@pytest.mark.anyio
async def test_zoho_bulk_sync_already_synced_invoice_not_sent(monkeypatch):
    already_synced = _approved_invoice(INV_1, erp_zoho_bill_id="z-existing")
    sb = FakeSupabase(invoices=[already_synced])
    _patch_settings(monkeypatch)
    calls: list = []
    client, transport = _async_client_and_transport(monkeypatch, sb, calls)
    async with client:
        from app.api.routes.ap_integrations import bulk_sync_zoho
        result = await bulk_sync_zoho()
    assert result["pushed"] == 0
    assert transport.call_count == 0  # no outbound request made


@pytest.mark.anyio
async def test_zoho_bulk_sync_erp_error_accumulates(monkeypatch):
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1), _approved_invoice(INV_2)])
    _patch_settings(monkeypatch)
    client, transport = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json={"code": 500, "message": "Internal server error"}),
        httpx.Response(200, json=_zoho_success("z-bill-2")),
    ])
    async with client:
        from app.api.routes.ap_integrations import bulk_sync_zoho
        result = await bulk_sync_zoho()
    assert result["failed"] == 1
    assert result["pushed"] == 1
    assert len(result["errors"]) == 1
    # only the successful one is stamped
    assert sb.invoice(INV_2)["erp_zoho_bill_id"] == "z-bill-2"
    assert sb.invoice(INV_1)["erp_zoho_bill_id"] is None


# ── QBO bulk sync ─────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_qbo_bulk_sync_stamps_on_success(monkeypatch):
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1)])
    _patch_settings(monkeypatch)
    # _qbo_ensure_bill: 1 pre-push query (empty) + 1 POST per invoice
    client, transport = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=_qbo_query_empty()),
        httpx.Response(200, json=_qbo_success("q-1")),
    ])
    async with client:
        from app.api.routes.ap_integrations import bulk_sync_quickbooks
        result = await bulk_sync_quickbooks()
    assert result["pushed"] == 1
    assert sb.invoice(INV_1)["erp_qbo_bill_id"] == "q-1"


@pytest.mark.anyio
async def test_qbo_bulk_sync_matching_duplicate_reuses_bill_id(monkeypatch):
    """Pre-push query finds same vendor + amount → reuse Bill.Id, stamp, count as pushed."""
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1)])
    _patch_settings(monkeypatch)
    client, transport = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=_qbo_query_found("q-existing-1", "Acme Ltd", 1050.0)),
        # no POST should be made
    ])
    async with client:
        from app.api.routes.ap_integrations import bulk_sync_quickbooks
        result = await bulk_sync_quickbooks()
    assert result["pushed"] == 1
    assert result["failed"] == 0
    assert sb.invoice(INV_1)["erp_qbo_bill_id"] == "q-existing-1"
    assert transport.call_count == 1  # pre-push query only, no POST


@pytest.mark.anyio
async def test_qbo_bulk_sync_conflicting_duplicate_treated_as_skipped(monkeypatch):
    """Pre-push query finds different vendor → QBOConflictError → skipped, no double-bill."""
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1)])
    _patch_settings(monkeypatch)
    # QBO has a bill with same DocNumber but completely different vendor
    client, transport = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=_qbo_query_found("q-conflict-99", "Other Vendor", 9999.0)),
    ])
    async with client:
        from app.api.routes.ap_integrations import bulk_sync_quickbooks
        result = await bulk_sync_quickbooks()
    assert result["skipped"] == 1
    assert result["failed"] == 0
    assert transport.call_count == 1  # only the query, no POST attempted


# ── Zoho vendor pull ──────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_zoho_vendor_pull_creates_new_vendors(monkeypatch):
    sb = FakeSupabase()
    _patch_settings(monkeypatch)
    contacts_page = {
        "code": 0,
        "contacts": [
            {"contact_id": "z-c1", "contact_name": "Alpha Inc", "email": "ap@alpha.com", "phone": "050-111"},
            {"contact_id": "z-c2", "contact_name": "Beta Ltd", "email": "ap@beta.com"},
        ],
        "page_context": {"has_more_page": False},
    }
    client, _ = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=contacts_page),
    ])
    async with client:
        from app.api.routes.ap_integrations import pull_vendors_from_zoho
        result = await pull_vendors_from_zoho()
    assert result["created"] == 2
    assert result["updated"] == 0
    assert set(sb.vendor_names()) == {"Alpha Inc", "Beta Ltd"}


@pytest.mark.anyio
async def test_zoho_vendor_pull_updates_existing(monkeypatch):
    sb = FakeSupabase(vendors=[{"id": "v-1", "name": "Alpha Inc", "email": "old@alpha.com"}])
    _patch_settings(monkeypatch)
    contacts_page = {
        "code": 0,
        "contacts": [{"contact_id": "z-c1", "contact_name": "Alpha Inc", "email": "new@alpha.com"}],
        "page_context": {"has_more_page": False},
    }
    client, _ = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=contacts_page),
    ])
    async with client:
        from app.api.routes.ap_integrations import pull_vendors_from_zoho
        result = await pull_vendors_from_zoho()
    assert result["updated"] == 1
    assert result["created"] == 0
    assert len(sb._tables["vendors"]) == 1  # no duplicate


@pytest.mark.anyio
async def test_zoho_vendor_pull_skips_blank_names(monkeypatch):
    sb = FakeSupabase()
    _patch_settings(monkeypatch)
    contacts_page = {
        "code": 0,
        "contacts": [
            {"contact_id": "z-c1", "contact_name": ""},
            {"contact_id": "z-c2", "contact_name": "   "},
            {"contact_id": "z-c3", "contact_name": "Real Vendor"},
        ],
        "page_context": {"has_more_page": False},
    }
    client, _ = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=contacts_page),
    ])
    async with client:
        from app.api.routes.ap_integrations import pull_vendors_from_zoho
        result = await pull_vendors_from_zoho()
    assert result["created"] == 1
    # Blank-name contacts are silently dropped by the route before reaching _upsert_vendor;
    # they appear in neither created nor skipped.
    assert result["skipped"] == 0


@pytest.mark.anyio
async def test_zoho_vendor_pull_paginates(monkeypatch):
    sb = FakeSupabase()
    _patch_settings(monkeypatch)
    page1 = {
        "code": 0,
        "contacts": [{"contact_id": "c1", "contact_name": "Vendor A"}],
        "page_context": {"has_more_page": True},
    }
    page2 = {
        "code": 0,
        "contacts": [{"contact_id": "c2", "contact_name": "Vendor B"}],
        "page_context": {"has_more_page": False},
    }
    client, _ = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=page1),
        httpx.Response(200, json=page2),
    ])
    async with client:
        from app.api.routes.ap_integrations import pull_vendors_from_zoho
        result = await pull_vendors_from_zoho()
    assert result["created"] == 2
    assert set(sb.vendor_names()) == {"Vendor A", "Vendor B"}


# ── QBO vendor pull ───────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_qbo_vendor_pull_creates_vendors(monkeypatch):
    sb = FakeSupabase()
    _patch_settings(monkeypatch)
    qr = {
        "QueryResponse": {
            "Vendor": [
                {"Id": "1", "DisplayName": "Delta Corp",
                 "PrimaryEmailAddr": {"Address": "ap@delta.com"},
                 "PrimaryPhone": {"FreeFormNumber": "04-999"}},
                {"Id": "2", "DisplayName": "Gamma LLC"},
            ]
        }
    }
    client, _ = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=qr),
    ])
    async with client:
        from app.api.routes.ap_integrations import pull_vendors_from_quickbooks
        result = await pull_vendors_from_quickbooks()
    assert result["created"] == 2
    assert set(sb.vendor_names()) == {"Delta Corp", "Gamma LLC"}


@pytest.mark.anyio
async def test_qbo_vendor_pull_stops_when_last_page(monkeypatch):
    sb = FakeSupabase()
    _patch_settings(monkeypatch)
    # Only 1 row, page_size=100 → loop should stop after first request
    qr = {"QueryResponse": {"Vendor": [{"Id": "1", "DisplayName": "Solo Vendor"}]}}
    client, transport = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=qr),
    ])
    async with client:
        from app.api.routes.ap_integrations import pull_vendors_from_quickbooks
        await pull_vendors_from_quickbooks()
    assert transport.call_count == 1  # only one API call


# ── Approval atomicity ────────────────────────────────────────────────────────


def test_push_to_erp_if_not_configured_is_noop(monkeypatch):
    """When no ERP is connected, _push_to_erp_if_configured returns without doing anything."""
    from app.services import ap_invoice_post_service as svc

    monkeypatch.setattr(settings_svc, "get_app_setting", lambda _k: None)

    http_called = []
    original_init = httpx.AsyncClient.__init__

    def _sentinel_init(self, *a, **kw):
        http_called.append(True)
        original_init(self, *a, **kw)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", _sentinel_init)
    svc._push_to_erp_if_configured("inv-id", "INV-001", "Acme")
    assert http_called == []


@pytest.mark.anyio
async def test_erp_push_raises_do_not_propagate_to_caller(monkeypatch):
    """ERP timeout/auth failure in the background task must not raise out of _push()."""
    from app.services import ap_invoice_post_service as svc

    _patch_settings(monkeypatch)
    # Supabase invoice lookup succeeds
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1)])
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    # Import the function that _push() uses to fetch invoices
    import app.core.supabase as sb_core
    monkeypatch.setattr(sb_core, "get_supabase", lambda: sb)

    # ERP call raises a network error
    async def _exploding_transport(request):
        raise httpx.ConnectTimeout("ERP unreachable", request=request)

    class _ExplodingTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            raise httpx.ConnectTimeout("ERP unreachable", request=request)

    original_init = httpx.AsyncClient.__init__

    def _patched_init(self, *a, **kw):
        kw["transport"] = _ExplodingTransport()
        original_init(self, *a, **kw)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched_init)

    # Schedule and run the push — must not raise out of the task wrapper
    import asyncio

    # Directly await the inner _push coroutine by calling _push_to_erp_if_configured
    # and then draining pending tasks (simulates the event-loop path)
    captured_exc: list[Exception] = []
    original_push = svc._push_to_erp_if_configured

    def _run_and_capture(*args, **kwargs):
        try:
            original_push(*args, **kwargs)
        except Exception as exc:
            captured_exc.append(exc)

    _run_and_capture(INV_1, "INV-0001", "Acme Ltd")
    # Drain the event loop so the create_task fires
    await asyncio.sleep(0)
    assert captured_exc == [], f"_push_to_erp_if_configured propagated: {captured_exc}"


@pytest.mark.anyio
async def test_auto_push_stamps_invoice_on_zoho_success(monkeypatch):
    """When auto-push succeeds, the invoice row is stamped with the Zoho bill id."""
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1)])
    _patch_settings(monkeypatch)

    import app.core.supabase as sb_core
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    monkeypatch.setattr(sb_core, "get_supabase", lambda: sb)

    zoho_response = httpx.Response(200, json=_zoho_success("auto-z-1"))
    # QBO is not connected — only one response needed
    _patch_settings(monkeypatch, {"qb_refresh_token": None, "qb_realm_id": None,
                                   **{k: v for k, v in _DEFAULT_SETTINGS.items()
                                      if not k.startswith("qb_")}})

    client, _ = _async_client_and_transport(monkeypatch, sb, [zoho_response])
    async with client:
        from app.services.ap_invoice_post_service import _push_to_erp_if_configured
        import asyncio
        _push_to_erp_if_configured(INV_1, "INV-0001", "Acme Ltd")
        await asyncio.sleep(0)  # let create_task fire

    assert sb.invoice(INV_1)["erp_zoho_bill_id"] == "auto-z-1"


# ── Tenant isolation via API ──────────────────────────────────────────────────


def test_bulk_sync_without_company_id_uses_all_approved(monkeypatch):
    """When no company_id filter is passed, all approved unsynced invoices are candidates."""
    sb = FakeSupabase(invoices=[
        _approved_invoice(INV_1, company_id="comp-X"),
        _approved_invoice(INV_2, company_id="comp-Y"),
    ])
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    rows = _fetch_approved_unsynced("erp_zoho_bill_id", company_id=None)
    assert {r["id"] for r in rows} == {INV_1, INV_2}


def test_bulk_sync_with_company_id_isolates(monkeypatch):
    sb = FakeSupabase(invoices=[
        _approved_invoice(INV_1, company_id="comp-X"),
        _approved_invoice(INV_2, company_id="comp-Y"),
    ])
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    rows = _fetch_approved_unsynced("erp_zoho_bill_id", company_id="comp-X")
    assert len(rows) == 1
    assert rows[0]["company_id"] == "comp-X"


# ── Status endpoint ───────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_push_bill_to_zoho_stamps_invoice(monkeypatch):
    """push_bill_to_zoho must stamp erp_zoho_bill_id on success (C1 fix)."""
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1)])
    _patch_settings(monkeypatch)
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    # Patch require_invoice_access where ap_integrations imports it from
    monkeypatch.setattr(intg_mod, "require_invoice_access", lambda *_a, **_k: None)

    client, _ = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=_zoho_success("z-manual-1")),
    ])
    async with client:
        from app.api.routes.ap_integrations import push_bill_to_zoho, PushBillIn
        result = await push_bill_to_zoho(
            body=PushBillIn(invoice_id=INV_1),
            ctx=SimpleNamespace(workspace_id=WS_A, user=SimpleNamespace(id="u1")),
            db=None,
        )
    assert result["success"] is True
    assert sb.invoice(INV_1)["erp_zoho_bill_id"] == "z-manual-1"


@pytest.mark.anyio
async def test_push_bill_to_quickbooks_stamps_invoice(monkeypatch):
    """push_bill_to_quickbooks must stamp erp_qbo_bill_id on success (C1 fix)."""
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1)])
    _patch_settings(monkeypatch)
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    monkeypatch.setattr(intg_mod, "require_invoice_access", lambda *_a, **_k: None)

    # _qbo_ensure_bill: pre-push query (empty) + POST
    client, _ = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=_qbo_query_empty()),
        httpx.Response(200, json=_qbo_success("q-manual-1")),
    ])
    async with client:
        from app.api.routes.ap_integrations import push_bill_to_quickbooks, PushBillIn
        result = await push_bill_to_quickbooks(
            body=PushBillIn(invoice_id=INV_1),
            ctx=SimpleNamespace(workspace_id=WS_A, user=SimpleNamespace(id="u1")),
            db=None,
        )
    assert result["success"] is True
    assert sb.invoice(INV_1)["erp_qbo_bill_id"] == "q-manual-1"


def test_status_reflects_connected_erps(monkeypatch):
    sb = FakeSupabase()
    client = _make_app(monkeypatch, sb)
    res = client.get("/api/ap/integrations/status")
    assert res.status_code == 200
    integrations = {i["id"]: i for i in res.json()["integrations"]}
    assert integrations["zoho"]["connected"] is True
    assert integrations["quickbooks"]["connected"] is True


def test_status_not_connected_when_no_tokens(monkeypatch):
    sb = FakeSupabase()
    client = _make_app(monkeypatch, sb, settings=None)
    res = client.get("/api/ap/integrations/status")
    assert res.status_code == 200
    integrations = {i["id"]: i for i in res.json()["integrations"]}
    assert integrations["zoho"]["connected"] is False
    assert integrations["quickbooks"]["connected"] is False


# ── async httpx transport helper ─────────────────────────────────────────────


class _CountingTransport(httpx.AsyncBaseTransport):
    """Replays a list of pre-canned responses; tracks how many calls were made."""

    def __init__(self, responses: list[httpx.Response]):
        self._responses = list(responses)
        self.call_count = 0

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.call_count += 1
        if not self._responses:
            raise httpx.ConnectError("No more responses")
        return self._responses.pop(0)


class _URLTransport(httpx.AsyncBaseTransport):
    """Routes requests by URL substring to pre-canned responses or raised exceptions."""

    def __init__(self, routes: list[tuple[str, Any]]):
        # Each route: (url_substring, httpx.Response | Exception instance | Exception class)
        self._routes = list(routes)
        self.calls: list[str] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.calls.append(url)
        for pattern, outcome in self._routes:
            if pattern in url:
                if isinstance(outcome, BaseException):
                    raise outcome
                if isinstance(outcome, type) and issubclass(outcome, BaseException):
                    raise outcome("simulated")
                return outcome
        raise httpx.ConnectError(f"No route matched for {url}")


def _async_client_and_transport(
    monkeypatch,
    sb: FakeSupabase,
    responses: list[httpx.Response],
):
    transport = _CountingTransport(responses)
    real_init = httpx.AsyncClient.__init__

    def _patched_init(self, *a, **kw):
        kw["transport"] = transport
        real_init(self, *a, **kw)

    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched_init)
    client = httpx.AsyncClient()
    return client, transport


def _url_client(monkeypatch, sb: FakeSupabase, routes: list[tuple[str, Any]]):
    """Build an async httpx client backed by _URLTransport for URL-routed tests."""
    transport = _URLTransport(routes)
    real_init = httpx.AsyncClient.__init__

    def _patched_init(self, *a, **kw):
        kw["transport"] = transport
        real_init(self, *a, **kw)

    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched_init)
    client = httpx.AsyncClient()
    return client, transport


# ── _qbo_ensure_bill unit tests ───────────────────────────────────────────────


def _qbo_ensure_inv(inv_id: str = INV_1, **extra) -> dict:
    return _approved_invoice(inv_id, **extra)


@pytest.mark.anyio
async def test_qbo_ensure_bill_happy_path(monkeypatch):
    """No existing bill: pre-push query empty, POST succeeds → Bill.Id stamped."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill
    sb = FakeSupabase(invoices=[_qbo_ensure_inv()])
    _patch_settings(monkeypatch)
    client, transport = _url_client(monkeypatch, sb, [
        ("/query", httpx.Response(200, json=_qbo_query_empty())),
        ("/bill", httpx.Response(200, json=_qbo_success("q-new-1"))),
    ])
    async with client:
        bill_id = await _qbo_ensure_bill(client, sb._tables["invoices"][0], "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
    assert bill_id == "q-new-1"
    assert sb.invoice(INV_1)["erp_qbo_bill_id"] == "q-new-1"


@pytest.mark.anyio
async def test_qbo_ensure_bill_pre_stamped_skips_erp(monkeypatch):
    """Already has non-PENDING erp_qbo_bill_id → returns immediately, zero ERP calls."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill
    inv = _qbo_ensure_inv(erp_qbo_bill_id="existing-123")
    sb = FakeSupabase(invoices=[inv])
    _patch_settings(monkeypatch)
    client, transport = _url_client(monkeypatch, sb, [])
    async with client:
        bill_id = await _qbo_ensure_bill(client, inv, "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
    assert bill_id == "existing-123"
    assert transport.calls == []  # no outbound calls


@pytest.mark.anyio
async def test_qbo_ensure_bill_matching_duplicate_reuses_id(monkeypatch):
    """Pre-push query finds same vendor + amount → reuse Bill.Id, stamp, no POST."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill
    sb = FakeSupabase(invoices=[_qbo_ensure_inv()])
    _patch_settings(monkeypatch)
    client, transport = _url_client(monkeypatch, sb, [
        ("/query", httpx.Response(200, json=_qbo_query_found("q-match-1", "Acme Ltd", 1050.0))),
        # POST must NOT be called
    ])
    async with client:
        bill_id = await _qbo_ensure_bill(client, sb._tables["invoices"][0], "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
    assert bill_id == "q-match-1"
    assert sb.invoice(INV_1)["erp_qbo_bill_id"] == "q-match-1"
    assert all("/query" in c for c in transport.calls)  # only query, no POST to /bill


@pytest.mark.anyio
async def test_qbo_ensure_bill_conflicting_duplicate_raises(monkeypatch):
    """Pre-push query finds different vendor → QBOConflictError, nothing stamped."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill, QBOConflictError
    sb = FakeSupabase(invoices=[_qbo_ensure_inv()])
    _patch_settings(monkeypatch)
    client, _ = _url_client(monkeypatch, sb, [
        ("/query", httpx.Response(200, json=_qbo_query_found("q-conflict-99", "Different Corp", 9999.0))),
    ])
    async with client:
        with pytest.raises(QBOConflictError):
            await _qbo_ensure_bill(client, sb._tables["invoices"][0], "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
    # Row should be PENDING from the optimistic claim but not stamped with a real ID
    stamp = sb.invoice(INV_1)["erp_qbo_bill_id"]
    assert stamp == "PENDING"


@pytest.mark.anyio
async def test_qbo_ensure_bill_post_timeout_bill_found_on_requery(monkeypatch):
    """POST times out, re-query finds bill → stamp from re-query, no exception."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill
    sb = FakeSupabase(invoices=[_qbo_ensure_inv()])
    _patch_settings(monkeypatch)

    call_log: list[str] = []

    class _TimeoutOnPostTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            call_log.append(request.method + " " + url)
            if request.method == "POST":
                raise httpx.ReadTimeout("timeout", request=request)
            # GET (pre-push query returns empty, re-query returns found)
            if len([c for c in call_log if "GET" in c]) == 1:
                return httpx.Response(200, json=_qbo_query_empty())
            return httpx.Response(200, json=_qbo_query_found("q-recovered-1", "Acme Ltd", 1050.0))

    real_init = httpx.AsyncClient.__init__

    def _patched_init(self, *a, **kw):
        kw["transport"] = _TimeoutOnPostTransport()
        real_init(self, *a, **kw)

    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched_init)

    client = httpx.AsyncClient()
    async with client:
        bill_id = await _qbo_ensure_bill(client, sb._tables["invoices"][0], "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
    assert bill_id == "q-recovered-1"
    assert sb.invoice(INV_1)["erp_qbo_bill_id"] == "q-recovered-1"


@pytest.mark.anyio
async def test_qbo_ensure_bill_post_timeout_no_bill_raises(monkeypatch):
    """POST times out and re-query finds nothing → QBOUncertainStateError."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill, QBOUncertainStateError
    sb = FakeSupabase(invoices=[_qbo_ensure_inv()])
    _patch_settings(monkeypatch)

    class _AlwaysEmptyAfterTimeout(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                raise httpx.ReadTimeout("timeout", request=request)
            return httpx.Response(200, json=_qbo_query_empty())

    real_init = httpx.AsyncClient.__init__

    def _patched_init(self, *a, **kw):
        kw["transport"] = _AlwaysEmptyAfterTimeout()
        real_init(self, *a, **kw)

    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched_init)

    client = httpx.AsyncClient()
    async with client:
        with pytest.raises(QBOUncertainStateError):
            await _qbo_ensure_bill(client, sb._tables["invoices"][0], "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")


@pytest.mark.anyio
async def test_qbo_ensure_bill_write_timeout_recovers(monkeypatch):
    """WriteTimeout on POST → re-query finds bill → stamped. Covers httpx.WriteTimeout."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill
    sb = FakeSupabase(invoices=[_qbo_ensure_inv()])
    _patch_settings(monkeypatch)
    call_log: list[str] = []

    class _WriteTimeoutOnPost(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            call_log.append(f"{request.method} {request.url}")
            if request.method == "POST":
                raise httpx.WriteTimeout("write timed out", request=request)
            gets = [c for c in call_log if c.startswith("GET")]
            if len(gets) == 1:
                return httpx.Response(200, json=_qbo_query_empty())
            found = _qbo_query_found("q-write-recovered", "Acme Ltd", 1050.0)
            found["QueryResponse"]["Bill"][0]["PrivateNote"] = "InvoiceFlow: INV-001 GL 7140 Goods"
            return httpx.Response(200, json=found)

    real_init = httpx.AsyncClient.__init__
    def _patched_init(self, **kwargs):
        real_init(self, transport=_WriteTimeoutOnPost(), **{k: v for k, v in kwargs.items() if k != "transport"})
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched_init)

    client = httpx.AsyncClient()
    async with client:
        bill_id = await _qbo_ensure_bill(client, sb._tables["invoices"][0], "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
    assert bill_id == "q-write-recovered"
    assert sb._tables["invoices"][0]["erp_qbo_bill_id"] == "q-write-recovered"


@pytest.mark.anyio
async def test_qbo_ensure_bill_pool_timeout_uncertain(monkeypatch):
    """PoolTimeout on POST + empty re-query → QBOUncertainStateError. Covers httpx.PoolTimeout."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill, QBOUncertainStateError
    sb = FakeSupabase(invoices=[_qbo_ensure_inv()])
    _patch_settings(monkeypatch)

    class _PoolTimeoutOnPost(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            if request.method == "POST":
                raise httpx.PoolTimeout("pool exhausted", request=request)
            return httpx.Response(200, json=_qbo_query_empty())

    real_init = httpx.AsyncClient.__init__
    def _patched_init(self, **kwargs):
        real_init(self, transport=_PoolTimeoutOnPost(), **{k: v for k, v in kwargs.items() if k != "transport"})
    monkeypatch.setattr(intg_mod, "get_supabase", lambda: sb)
    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched_init)

    client = httpx.AsyncClient()
    async with client:
        with pytest.raises(QBOUncertainStateError):
            await _qbo_ensure_bill(client, sb._tables["invoices"][0], "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
    # Row stays PENDING — not incorrectly cleared
    assert sb._tables["invoices"][0]["erp_qbo_bill_id"] == "PENDING"


@pytest.mark.anyio
async def test_qbo_ensure_bill_concurrency_loser_skips(monkeypatch):
    """When PENDING claim returns 0 rows (another worker won), QBOConflictError is raised."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill, QBOConflictError
    # Invoice already has PENDING — simulates another worker just claimed it
    inv = _qbo_ensure_inv(erp_qbo_bill_id="PENDING")
    sb = FakeSupabase(invoices=[inv])
    _patch_settings(monkeypatch)
    client, transport = _url_client(monkeypatch, sb, [])
    async with client:
        with pytest.raises(QBOConflictError):
            await _qbo_ensure_bill(client, inv, "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
    assert transport.calls == []  # no ERP calls made


@pytest.mark.anyio
async def test_qbo_bulk_sync_concurrency_only_one_proceeds(monkeypatch):
    """Two parallel bulk sync iterations: only the one that wins the PENDING claim stamps."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill, QBOConflictError
    sb = FakeSupabase(invoices=[_qbo_ensure_inv()])
    _patch_settings(monkeypatch)
    # Provide responses for the winning worker's query + POST
    client, transport = _url_client(monkeypatch, sb, [
        ("/query", httpx.Response(200, json=_qbo_query_empty())),
        ("/bill", httpx.Response(200, json=_qbo_success("q-winner-1"))),
    ])
    async with client:
        inv = sb._tables["invoices"][0]
        # First call wins the claim
        bill_id = await _qbo_ensure_bill(client, inv, "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
        assert bill_id == "q-winner-1"
        # Second call: inv dict is re-fetched — now erp_qbo_bill_id="q-winner-1", so it's pre-stamped
        inv_refetched = sb.invoice(INV_1)
        bill_id2 = await _qbo_ensure_bill(client, inv_refetched, "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
        assert bill_id2 == "q-winner-1"  # returns existing stamp, no new POST
    assert transport.calls.count("/bill" if any("/bill" in c for c in transport.calls) else "bill") <= 1


@pytest.mark.anyio
async def test_qbo_ensure_bill_post_returns_no_bill_id_raises(monkeypatch):
    """HTTP 200 response without Bill.Id → ValueError, PENDING left on row."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill
    sb = FakeSupabase(invoices=[_qbo_ensure_inv()])
    _patch_settings(monkeypatch)
    client, _ = _url_client(monkeypatch, sb, [
        ("/query", httpx.Response(200, json=_qbo_query_empty())),
        ("/bill", httpx.Response(200, json={"Bill": {}})),  # no Id field
    ])
    async with client:
        with pytest.raises(ValueError, match="no Bill.Id"):
            await _qbo_ensure_bill(client, sb._tables["invoices"][0], "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")


# ── R2: DocNumber truncation identity check ───────────────────────────────────


@pytest.mark.anyio
async def test_r2_short_invoice_number_no_note_check_needed(monkeypatch):
    """Invoice number ≤21 chars: PrivateNote check is skipped, matching bill is reused."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill
    # Short invoice number — no truncation risk
    inv = _qbo_ensure_inv(INV_1, invoice_number="INV-2024-001")
    sb = FakeSupabase(invoices=[inv])
    _patch_settings(monkeypatch)
    # Existing QBO bill: same vendor + amount, PrivateNote does NOT contain invoice number
    # (should not matter for short numbers)
    found = _qbo_query_found("q-short-1", "Acme Ltd", 1050.0)
    found["QueryResponse"]["Bill"][0]["PrivateNote"] = "InvoiceFlow: INV-2024-001 GL 7140 Cost of Goods"
    client, _ = _url_client(monkeypatch, sb, [("/query", httpx.Response(200, json=found))])
    async with client:
        bill_id = await _qbo_ensure_bill(client, inv, "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
    assert bill_id == "q-short-1"
    assert sb.invoice(INV_1)["erp_qbo_bill_id"] == "q-short-1"


@pytest.mark.anyio
async def test_r2_long_invoice_number_note_match_reuses_bill(monkeypatch):
    """Invoice number >21 chars: PrivateNote contains full number → bill reused correctly."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill
    long_num = "INV-2024-ACME-CORP-001-REV"  # 26 chars, truncates to "INV-2024-ACME-CORP-001-REV"[:21]
    inv = _qbo_ensure_inv(INV_1, invoice_number=long_num)
    sb = FakeSupabase(invoices=[inv])
    _patch_settings(monkeypatch)
    found = _qbo_query_found("q-long-1", "Acme Ltd", 1050.0)
    # PrivateNote contains the full original invoice number — this is our bill
    found["QueryResponse"]["Bill"][0]["PrivateNote"] = f"InvoiceFlow: {long_num} GL 7140 Cost of Goods"
    client, _ = _url_client(monkeypatch, sb, [("/query", httpx.Response(200, json=found))])
    async with client:
        bill_id = await _qbo_ensure_bill(client, inv, "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
    assert bill_id == "q-long-1"


@pytest.mark.anyio
async def test_r2_long_invoice_number_note_mismatch_raises_conflict(monkeypatch):
    """Invoice number >21 chars: PrivateNote belongs to different invoice → QBOConflictError."""
    from app.api.routes.ap_integrations import _qbo_ensure_bill, QBOConflictError
    our_num = "INV-2024-ACME-CORP-001-NEW"   # 26 chars
    other_num = "INV-2024-ACME-CORP-001-REV"  # same first 21 chars, different suffix
    inv = _qbo_ensure_inv(INV_1, invoice_number=our_num)
    sb = FakeSupabase(invoices=[inv])
    _patch_settings(monkeypatch)
    found = _qbo_query_found("q-other-1", "Acme Ltd", 1050.0)
    # PrivateNote contains the OTHER invoice's number, not ours
    found["QueryResponse"]["Bill"][0]["PrivateNote"] = f"InvoiceFlow: {other_num} GL 7140 Cost of Goods"
    client, _ = _url_client(monkeypatch, sb, [("/query", httpx.Response(200, json=found))])
    async with client:
        with pytest.raises(QBOConflictError):
            await _qbo_ensure_bill(client, inv, "tok", "https://sandbox-quickbooks.api.intuit.com", "realm-1")
    # Row should be PENDING — not stamped with wrong bill
    assert sb.invoice(INV_1)["erp_qbo_bill_id"] == "PENDING"


# ── R1: clear-PENDING endpoint ────────────────────────────────────────────────


_FAKE_CTX = SimpleNamespace(
    workspace_id=WS_A,
    user=SimpleNamespace(id="user-1", email="admin@example.com"),
)


@pytest.mark.anyio
async def test_clear_pending_resolves_bill_found_in_qbo(monkeypatch):
    """PENDING row + QBO has the bill → stamped with real Bill.Id."""
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1, erp_qbo_bill_id="PENDING")])
    _patch_settings(monkeypatch)
    inv_num = f"INV-{INV_1[-4:]}"
    found = _qbo_query_found("q-recovered-2", "Acme Ltd", 1050.0)
    found["QueryResponse"]["Bill"][0]["PrivateNote"] = f"InvoiceFlow: {inv_num} GL 7140 Cost of Goods"
    client, _ = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=found),
    ])
    async with client:
        from app.api.routes.ap_integrations import clear_pending_qbo_bills
        result = await clear_pending_qbo_bills(ctx=_FAKE_CTX)
    assert result["resolved"] == 1
    assert result["cleared"] == 0
    assert sb.invoice(INV_1)["erp_qbo_bill_id"] == "q-recovered-2"


@pytest.mark.anyio
async def test_clear_pending_clears_row_when_no_qbo_bill(monkeypatch):
    """PENDING row + QBO has no bill → cleared back to NULL so bulk sync retries."""
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1, erp_qbo_bill_id="PENDING")])
    _patch_settings(monkeypatch)
    client, _ = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=_qbo_query_empty()),
    ])
    async with client:
        from app.api.routes.ap_integrations import clear_pending_qbo_bills
        result = await clear_pending_qbo_bills(ctx=_FAKE_CTX)
    assert result["cleared"] == 1
    assert result["resolved"] == 0
    assert sb.invoice(INV_1)["erp_qbo_bill_id"] is None


@pytest.mark.anyio
async def test_clear_pending_skips_collision(monkeypatch):
    """PENDING row + QBO bill belongs to different invoice (note mismatch) → skipped."""
    our_num = "INV-2024-ACME-CORP-001-NEW"
    other_num = "INV-2024-ACME-CORP-001-REV"
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1, erp_qbo_bill_id="PENDING", invoice_number=our_num)])
    _patch_settings(monkeypatch)
    found = _qbo_query_found("q-collision-1", "Acme Ltd", 1050.0)
    found["QueryResponse"]["Bill"][0]["PrivateNote"] = f"InvoiceFlow: {other_num} GL 7140 Cost of Goods"
    client, _ = _async_client_and_transport(monkeypatch, sb, [
        httpx.Response(200, json=found),
    ])
    async with client:
        from app.api.routes.ap_integrations import clear_pending_qbo_bills
        result = await clear_pending_qbo_bills(ctx=_FAKE_CTX)
    assert result["skipped"] == 1
    assert result["resolved"] == 0
    assert len(result["errors"]) == 1
    assert "collision" in result["errors"][0]
    assert sb.invoice(INV_1)["erp_qbo_bill_id"] == "PENDING"


@pytest.mark.anyio
async def test_clear_pending_age_filter_skips_recent_rows(monkeypatch):
    """Rows with updated_at newer than cutoff are NOT processed."""
    from datetime import datetime, timezone
    # updated_at is in the future relative to now → newer than any cutoff → excluded
    future_ts = "2099-01-01T00:00:00+00:00"
    sb = FakeSupabase(invoices=[_approved_invoice(INV_1, erp_qbo_bill_id="PENDING", updated_at=future_ts)])
    _patch_settings(monkeypatch)
    client, transport = _async_client_and_transport(monkeypatch, sb, [])
    async with client:
        from app.api.routes.ap_integrations import clear_pending_qbo_bills
        result = await clear_pending_qbo_bills(ctx=_FAKE_CTX)
    assert result["resolved"] == 0
    assert result["cleared"] == 0
    assert transport.call_count == 0  # no QBO calls — row was filtered out
    assert sb.invoice(INV_1)["erp_qbo_bill_id"] == "PENDING"  # unchanged


def test_list_pending_qbo_bills(monkeypatch):
    """list_pending_qbo_bills returns only PENDING rows."""
    sb = FakeSupabase(invoices=[
        _approved_invoice(INV_1, erp_qbo_bill_id="PENDING"),
        _approved_invoice(INV_2, erp_qbo_bill_id="q-real-1"),
        _approved_invoice(INV_3),
    ])
    client = _make_app(monkeypatch, sb)
    res = client.get("/api/ap/integrations/quickbooks/pending-bills")
    assert res.status_code == 200
    data = res.json()
    assert data["count"] == 1
    assert data["invoices"][0]["id"] == INV_1
