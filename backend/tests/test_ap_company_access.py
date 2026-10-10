"""Access control for AP routes that use the Supabase service role.

Run from this directory so the app's settings never pick up a local .env:
    cd backend/tests && DATABASE_URL=sqlite:///:memory: python -m pytest -q
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import ap_invoice_files, ap_invoices_rds, uae_accounting
from app.core import company_access
from app.core.database import get_db
from app.middleware import auth as auth_middleware
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole
from app.services import ap_bulk_invoice_service, ap_invoice_post_service

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "aaaaaaaa-1111-4000-8000-000000000001"
CO_B = "bbbbbbbb-1111-4000-8000-000000000002"
INV_A = "aaaaaaaa-2222-4000-8000-000000000001"
INV_B = "bbbbbbbb-2222-4000-8000-000000000002"
INV_MISSING = "cccccccc-2222-4000-8000-000000000003"

COMPANY_WORKSPACE = {CO_A: WS_A, CO_B: WS_B}
INVOICE_COMPANY = {INV_A: CO_A, INV_B: CO_B}


# ── Fake Supabase ────────────────────────────────────────────────────────────


class _Query:
    def __init__(self, sb: "FakeSupabase", table: str):
        self.sb, self.table, self.filters, self.ids, self.op, self.payload = sb, table, {}, None, "select", None

    def select(self, *_a, **_k):
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def in_(self, _col, vals):
        self.ids = list(vals)
        return self

    def limit(self, _n):
        return self

    def execute(self):
        if self.table != "invoices":
            return SimpleNamespace(data=[])
        rows = [{"id": i, "company_id": c} for i, c in INVOICE_COMPANY.items()]
        if self.ids is not None:
            rows = [r for r in rows if r["id"] in self.ids]
        rows = [r for r in rows if all(r.get(k) == v for k, v in self.filters.items())]
        if self.op == "update":
            if self.sb.update_matches_nothing:
                rows = []
            self.sb.updates.append((self.filters.copy(), self.payload))
        return SimpleNamespace(data=rows)


class _Bucket:
    def __init__(self, sb: "FakeSupabase"):
        self.sb = sb

    def create_signed_url(self, path, _ttl):
        if path not in self.sb.stored_files:
            raise RuntimeError("Object not found")
        return {"signedURL": f"https://storage.test/{path}"}


class FakeSupabase:
    def __init__(self):
        self.updates: list[tuple[dict, dict]] = []
        self.stored_files: set[str] = set()
        self.update_matches_nothing = False
        self.storage = SimpleNamespace(from_=lambda _bucket: _Bucket(self))

    def table(self, name):
        return _Query(self, name)


# ── Fixtures ─────────────────────────────────────────────────────────────────


class Env:
    def __init__(self, monkeypatch):
        self.monkeypatch = monkeypatch
        self.roles: dict[str, str] = {}
        self.user_role = "accountant"
        self.calls: list[tuple[str, dict]] = []
        self.sb = FakeSupabase()

    def ctx(self) -> WorkspaceContext:
        user = SimpleNamespace(id="user-1", email="real.user@example.com", role=self.user_role)
        role = self.roles.get(WS_A)
        return WorkspaceContext(
            workspace_id=WS_A,
            workspace=SimpleNamespace(id=WS_A),
            user=user,
            role=WorkspaceRole(role) if role else None,
        )

    def recorder(self, name: str, result: Any = None):
        def _fn(**kwargs):
            self.calls.append((name, kwargs))
            return result if result is not None else {"ok": True}

        return _fn


@pytest.fixture()
def env(monkeypatch):
    e = Env(monkeypatch)
    e.roles[WS_A] = "accountant"

    monkeypatch.setattr(
        company_access, "_company_workspace_ids",
        lambda _db, cid: iter([COMPANY_WORKSPACE[cid]] if cid in COMPANY_WORKSPACE else []),
    )
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    monkeypatch.setattr(company_access, "get_supabase", lambda: e.sb)
    monkeypatch.setattr(ap_invoice_files, "get_supabase", lambda: e.sb)

    for name in (
        "bulk_upsert_invoices", "list_invoices_for_company", "delete_all_invoices_for_company",
        "get_invoice_for_match", "patch_invoice_for_match", "list_purchase_orders_for_company",
        "bulk_upsert_purchase_orders", "ensure_workspace_pos_and_relink_grns",
        "bulk_upsert_goods_receipts", "list_goods_receipts_for_company",
    ):
        monkeypatch.setattr(ap_bulk_invoice_service, name, e.recorder(name))
    monkeypatch.setattr(ap_invoice_post_service, "bulk_approve_ap_invoices", e.recorder("bulk_approve_ap_invoices"))
    monkeypatch.setattr(
        ap_invoice_post_service, "maybe_sync_ap_invoice_after_pdf_extract", e.recorder("sync_after_extract")
    )
    return e


def _app(override_auth: Env | None) -> FastAPI:
    app = FastAPI()
    for r in (ap_invoices_rds.router, ap_invoice_files.router, uae_accounting.router):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: SimpleNamespace()
    if override_auth is not None:
        app.dependency_overrides[validate_workspace] = override_auth.ctx
    return app


@pytest.fixture()
def client(env):
    return TestClient(_app(env))


# ── Unauthenticated / forged tokens ──────────────────────────────────────────

SERVICE_ROLE_ROUTES = [
    ("/api/ap/invoices/bulk-upsert", {"company_id": CO_A, "invoices": [{"invoice_number": "X"}]}),
    ("/api/ap/invoices/list", {"company_id": CO_A}),
    ("/api/ap/invoices/delete-all", {"company_id": CO_A}),
    ("/api/ap/invoices/audit-log", {"company_id": CO_A, "entity_type": "invoice", "action": "x"}),
    ("/api/ap/invoices/count", {"company_id": CO_A, "since": "2026-01-01"}),
    ("/api/uae/ap/bulk-upsert", {"company_id": CO_A, "invoices": [{"invoice_number": "X"}]}),
    ("/api/uae/ap/list-invoices", {"company_id": CO_A}),
    ("/api/uae/ap/get-invoice", {"company_id": CO_A, "invoice_id": INV_A}),
    ("/api/uae/ap/patch-invoice", {"company_id": CO_A, "invoice_id": INV_A, "fields": {}}),
    ("/api/uae/ap/list-purchase-orders", {"company_id": CO_A}),
    ("/api/uae/ap/bulk-upsert-purchase-orders", {"company_id": CO_A, "purchase_orders": [{}]}),
    ("/api/uae/ap/ensure-workspace-matches", {"company_id": CO_A}),
    ("/api/uae/ap/bulk-upsert-goods-receipts", {"company_id": CO_A, "goods_receipts": [{}]}),
    ("/api/uae/ap/list-goods-receipts", {"company_id": CO_A}),
    ("/api/uae/ap/bulk-approve", {"invoice_ids": [INV_A], "company_id": CO_A}),
    ("/api/uae/ap/post-approved-invoice", {"invoice_id": INV_A, "company_id": CO_A}),
    ("/api/uae/ap/sync-after-extract", {"invoice_id": INV_A, "company_id": CO_A}),
    ("/api/uae/ap/approve-and-post", {"invoice_number": "X", "vendor_name": "V", "total_amount": 1, "company_id": CO_A}),
    ("/api/uae/ap-bridge/invoice-approved", {"invoice_number": "X", "vendor_name": "V", "total_amount": 1, "company_id": CO_A}),
    ("/api/uae/ap/classify-invoice", {"invoice_number": "X", "vendor_name": "V", "total_amount": 1, "invoice_date": "2026-01-01"}),
    ("/api/ap/invoice-files/attach", {"invoice_id": INV_A, "path": f"{CO_A}/uploads/a.pdf"}),
    ("/api/ap/invoice-files/signed-url", {"path": f"{CO_A}/uploads/a.pdf"}),
]


@pytest.mark.parametrize("path,body", SERVICE_ROLE_ROUTES, ids=[p for p, _ in SERVICE_ROLE_ROUTES])
def test_missing_token_is_rejected(env, path, body):
    res = TestClient(_app(None)).post(path, json=body, headers={"X-Tenant-ID": WS_A, "X-Workspace-ID": WS_A})
    assert res.status_code == 401, res.text
    assert env.calls == [] and env.sb.updates == []


@pytest.mark.parametrize("path,body", SERVICE_ROLE_ROUTES, ids=[p for p, _ in SERVICE_ROLE_ROUTES])
def test_forged_token_is_rejected(env, monkeypatch, path, body):
    def _reject(_token):
        raise ValueError("Invalid or expired token")

    monkeypatch.setattr(auth_middleware, "verify_supabase_token", _reject)
    res = TestClient(_app(None)).post(
        path, json=body, headers={"Authorization": "Bearer forged.token.value", "X-Workspace-ID": WS_A}
    )
    assert res.status_code == 401, res.text
    assert env.calls == [] and env.sb.updates == []


# ── Company isolation ────────────────────────────────────────────────────────


def test_list_own_company(client, env):
    assert client.post("/api/ap/invoices/list", json={"company_id": CO_A}).status_code == 200
    assert env.calls == [("list_invoices_for_company", {"company_id": CO_A, "limit": 500})]


@pytest.mark.parametrize("path,body", [
    ("/api/ap/invoices/list", {"company_id": CO_B}),
    ("/api/ap/invoices/bulk-upsert", {"company_id": CO_B, "invoices": [{}]}),
    ("/api/ap/invoices/count", {"company_id": CO_B, "since": "2026-01-01"}),
    ("/api/uae/ap/list-invoices", {"company_id": CO_B}),
    ("/api/uae/ap/patch-invoice", {"company_id": CO_B, "invoice_id": INV_B, "fields": {"status": "Paid"}}),
    ("/api/uae/ap/bulk-upsert-purchase-orders", {"company_id": CO_B, "purchase_orders": [{}]}),
])
def test_other_company_is_forbidden(client, env, path, body):
    res = client.post(path, json=body)
    assert res.status_code == 403, res.text
    assert env.calls == []


def test_unknown_company_is_forbidden(client, env):
    res = client.post("/api/ap/invoices/list", json={"company_id": "dddddddd-1111-4000-8000-000000000009"})
    assert res.status_code == 403 and env.calls == []


def test_non_uuid_company_is_rejected(client, env):
    res = client.post("/api/ap/invoices/list", json={"company_id": "default"})
    assert res.status_code == 422 and env.calls == []


def test_member_of_second_workspace_can_access_its_company(client, env):
    env.roles[WS_B] = "finance_manager"
    assert client.post("/api/uae/ap/list-invoices", json={"company_id": CO_B}).status_code == 200


def test_super_admin_can_access_any_company(client, env):
    env.user_role = "super_admin"
    env.roles.clear()
    assert client.post("/api/ap/invoices/delete-all", json={"company_id": CO_B}).status_code == 200


# ── Roles ────────────────────────────────────────────────────────────────────


def test_delete_all_requires_manager_role(client, env):
    res = client.post("/api/ap/invoices/delete-all", json={"company_id": CO_A})
    assert res.status_code == 403 and "accountant" in res.json()["detail"]
    assert env.calls == []

    env.roles[WS_A] = "owner"
    assert client.post("/api/ap/invoices/delete-all", json={"company_id": CO_A}).status_code == 200
    assert env.calls == [("delete_all_invoices_for_company", {"company_id": CO_A})]


def test_viewer_can_read_but_not_write(client, env):
    env.roles[WS_A] = "viewer"
    assert client.post("/api/ap/invoices/list", json={"company_id": CO_A}).status_code == 200
    res = client.post("/api/ap/invoices/bulk-upsert", json={"company_id": CO_A, "invoices": [{}]})
    assert res.status_code == 403
    res = client.post("/api/uae/ap/bulk-approve", json={"invoice_ids": [INV_A]})
    assert res.status_code == 403
    assert [c[0] for c in env.calls] == ["list_invoices_for_company"]


def test_cfo_user_role_can_write_with_viewer_membership(client, env):
    env.roles[WS_A] = "viewer"
    env.user_role = "cfo"
    assert client.post("/api/ap/invoices/bulk-upsert", json={"company_id": CO_A, "invoices": [{}]}).status_code == 200


# ── Invoice-id based approvals / posting ─────────────────────────────────────


def test_bulk_approve_rejects_invoice_from_other_company(client, env):
    res = client.post("/api/uae/ap/bulk-approve", json={"invoice_ids": [INV_A, INV_B], "company_id": CO_A})
    assert res.status_code == 403 and env.calls == []


def test_bulk_approve_rejects_missing_invoice(client, env):
    res = client.post("/api/uae/ap/bulk-approve", json={"invoice_ids": [INV_MISSING]})
    assert res.status_code == 404 and env.calls == []


def test_bulk_approve_own_invoices(client, env):
    res = client.post("/api/uae/ap/bulk-approve", json={"invoice_ids": [INV_A], "company_id": CO_A})
    assert res.status_code == 200
    name, kwargs = env.calls[0]
    assert name == "bulk_approve_ap_invoices" and kwargs["invoice_ids"] == [INV_A]
    assert kwargs["workspace_id"] == WS_A


def test_bulk_approve_cannot_redirect_to_foreign_company(client, env):
    res = client.post("/api/uae/ap/bulk-approve", json={"invoice_ids": [INV_A], "company_id": CO_B})
    assert res.status_code == 403 and env.calls == []


def test_bulk_approve_cannot_post_into_foreign_workspace(client, env):
    res = client.post("/api/uae/ap/bulk-approve", json={"invoice_ids": [INV_A], "workspace_id": WS_B})
    assert res.status_code == 403 and env.calls == []


def test_sync_after_extract_checks_invoice_owner(client, env):
    assert client.post("/api/uae/ap/sync-after-extract", json={"invoice_id": INV_B}).status_code == 403
    assert client.post("/api/uae/ap/sync-after-extract", json={"invoice_id": INV_A}).status_code == 200


def test_post_approved_invoice_checks_invoice_owner(client, env):
    assert client.post("/api/uae/ap/post-approved-invoice", json={"invoice_id": INV_B}).status_code == 403


def test_approve_and_post_requires_a_scope(client, env):
    body = {"invoice_number": "X", "vendor_name": "V", "total_amount": 1}
    assert client.post("/api/uae/ap/approve-and-post", json=body).status_code == 422
    assert client.post("/api/uae/ap/approve-and-post", json={**body, "company_id": CO_B}).status_code == 403


# ── Audit log ────────────────────────────────────────────────────────────────


def test_audit_log_records_authenticated_user_not_body(client, env, monkeypatch):
    inserted: list[dict] = []

    class _Insert:
        def __init__(self, row):
            inserted.append(row)

        def execute(self):
            return SimpleNamespace(data=[])

    import app.core.supabase as supa

    monkeypatch.setattr(supa, "get_supabase", lambda: SimpleNamespace(table=lambda _n: SimpleNamespace(insert=_Insert)))
    res = client.post(
        "/api/ap/invoices/audit-log",
        json={"company_id": CO_A, "entity_type": "invoice", "action": "invoice.updated", "action_by": "ceo@victim.com"},
    )
    assert res.status_code == 200 and res.json() == {"ok": True}
    assert inserted[0]["action_by"] == "real.user@example.com"
    assert inserted[0]["company_id"] == CO_A


# ── Attach document ──────────────────────────────────────────────────────────


def _attach(client, invoice_id, path):
    return client.post("/api/ap/invoice-files/attach", json={"invoice_id": invoice_id, "path": path, "file_type": "application/pdf"})


def test_attach_valid_document(client, env):
    path = f"{CO_A}/uploads/1700000000000-ab12cd34-invoice.pdf"
    env.sb.stored_files.add(path)
    res = _attach(client, INV_A, path)
    assert res.status_code == 200 and res.json() == {"path": path}
    filters, payload = env.sb.updates[0]
    assert filters == {"id": INV_A, "company_id": CO_A}
    assert payload == {"file_url": path, "file_type": "application/pdf"}


def test_attach_file_from_another_company(client, env):
    path = f"{CO_B}/uploads/other.pdf"
    env.sb.stored_files.add(path)
    res = _attach(client, INV_A, path)
    assert res.status_code == 403 and env.sb.updates == []


def test_attach_to_inaccessible_invoice(client, env):
    path = f"{CO_B}/uploads/other.pdf"
    env.sb.stored_files.add(path)
    res = _attach(client, INV_B, path)
    assert res.status_code == 403 and env.sb.updates == []


def test_attach_to_missing_invoice(client, env):
    assert _attach(client, INV_MISSING, f"{CO_A}/uploads/a.pdf").status_code == 404


@pytest.mark.parametrize("path", [f"{CO_A}/../{CO_B}/x.pdf", "noslash.pdf", f"{CO_A}//x.pdf"])
def test_attach_invalid_path(client, env, path):
    assert _attach(client, INV_A, path).status_code == 422 and env.sb.updates == []


def test_attach_file_missing_from_storage(client, env):
    res = _attach(client, INV_A, f"{CO_A}/uploads/never-uploaded.pdf")
    assert res.status_code == 404 and env.sb.updates == []


def test_attach_reports_failed_update(client, env):
    path = f"{CO_A}/uploads/a.pdf"
    env.sb.stored_files.add(path)
    env.sb.update_matches_nothing = True
    assert _attach(client, INV_A, path).status_code == 409


def test_attach_requires_write_role(client, env):
    env.roles[WS_A] = "auditor"
    path = f"{CO_A}/uploads/a.pdf"
    env.sb.stored_files.add(path)
    assert _attach(client, INV_A, path).status_code == 403 and env.sb.updates == []


def test_upload_rejects_other_company(client, env):
    res = client.post(
        "/api/ap/invoice-files/upload",
        data={"company_id": CO_B, "prefix": "uploads"},
        files={"file": ("a.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert res.status_code == 403
