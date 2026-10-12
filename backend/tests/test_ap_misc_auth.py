"""AP aging, anomaly, CFO daily, PO/GRN bulk, integrations, settings, email privacy, WhatsApp intake and
payment calendar: login + company access required; shared settings are platform-admin only; server-to-server
hooks (n8n cron, Meta webhook, OAuth callbacks) are verified by signature or signed state."""

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

from app.api.routes import (
    ap_aging,
    ap_anomaly,
    ap_cfo_daily,
    ap_goods_receipts,
    ap_integrations,
    ap_purchase_orders,
    payment_calendar,
)
from app.core import company_access
from app.core.database import get_db
from app.middleware import product_role_middleware as gate
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole
from app.routers import ap_email_privacy, ap_settings, ap_whatsapp_intake
from app.services import ap_bulk_invoice_service

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "cccccccc-0000-4000-8000-00000000000a"
CO_B = "cccccccc-0000-4000-8000-00000000000b"
COMPANY_WS = {CO_A: WS_A, CO_B: WS_B}

GUARDED = [
    ap_aging.router, ap_anomaly.router, ap_cfo_daily.router, ap_goods_receipts.router,
    ap_purchase_orders.router, ap_integrations.router, payment_calendar.router,
    ap_settings.router, ap_email_privacy.router,
]
OPEN = [ap_cfo_daily.n8n_router, ap_integrations.callback_router, ap_whatsapp_intake.router]


class Env:
    def __init__(self):
        self.workspace = WS_A
        self.roles = {WS_A: "accountant", WS_B: None}
        self.user_role = "user"

    def ctx(self) -> WorkspaceContext:
        role = self.roles.get(self.workspace)
        return WorkspaceContext(
            workspace_id=self.workspace,
            workspace=SimpleNamespace(id=self.workspace),
            user=SimpleNamespace(id="user-1", email="a@example.com", role=self.user_role),
            role=WorkspaceRole(role) if role else None,
        )


@pytest.fixture()
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    monkeypatch.setattr(company_access, "_company_workspace_ids",
                        lambda _db, cid: iter([COMPANY_WS[cid]] if cid in COMPANY_WS else []))
    return e


def _app(env: Env | None) -> FastAPI:
    app = FastAPI()
    for router in GUARDED + OPEN:
        app.include_router(router)
    app.dependency_overrides[get_db] = lambda: None
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


@pytest.fixture()
def client(env):
    return TestClient(_app(env))


ROUTES = sorted({
    (method, re.sub(r"\{[^}]+\}", "x", route.path))
    for router in GUARDED
    for route in router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
})


def test_every_guarded_route_is_covered():
    assert len(ROUTES) == 24


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(method, path):
    res = TestClient(_app(None)).request(method, path, params={"company_id": CO_A, "company_slug": "a"},
                                         json={"company_id": CO_A, "invoice": {}, "confirm": True,
                                               "purchase_orders": [{}], "goods_receipts": [{}]})
    assert res.status_code == 401, res.text


def test_gate_lets_signed_hooks_through_but_not_app_settings():
    for path in ("/api/ap/n8n/cfo-daily-summary", "/api/gulftax/einvoicing/asp/inbound",
                 "/api/vat/n8n/inbound/vat_assessed", "/api/ap/whatsapp-intake/webhook",
                 "/api/ap/integrations/zoho/callback"):
        assert gate._is_public(path), path
    assert not gate._is_public("/api/ap/app-settings")
    assert not gate._is_public("/api/ap/cfo-daily-summary")


# ── aging ────────────────────────────────────────────────────────────────────

def test_aging_needs_an_accessible_company(client, monkeypatch):
    seen = []
    monkeypatch.setattr(ap_aging, "compute_ap_aging", lambda company_id, as_of: seen.append(company_id) or {})
    assert client.get("/api/ap/aging").status_code == 400
    assert client.get("/api/ap/aging", params={"company_id": CO_B}).status_code == 403
    assert client.get("/api/ap/aging", headers={"X-Company-ID": CO_A}).status_code == 200
    assert seen == [CO_A]


# ── CFO daily summary ────────────────────────────────────────────────────────

@pytest.fixture()
def summary(monkeypatch):
    calls = {"built": [], "emails": []}
    monkeypatch.setattr(ap_cfo_daily, "build_cfo_daily_summary",
                        lambda company_id, days, market: calls["built"].append(company_id) or {"company": company_id})
    monkeypatch.setattr(ap_cfo_daily, "send_cfo_daily_email",
                        lambda s, to_email=None: calls["emails"].append(to_email) or {"sent": True})
    return calls


def test_cfo_summary_is_company_scoped_and_only_emails_the_caller(client, summary):
    assert client.get("/api/ap/cfo-daily-summary").status_code == 400
    assert client.post("/api/ap/cfo-daily-summary", json={"company_id": CO_B}).status_code == 403
    res = client.post("/api/ap/cfo-daily-summary",
                      json={"company_id": CO_A, "send_email": True, "to_email": "attacker@example.com"})
    assert res.status_code == 200, res.text
    assert summary["built"] == [CO_A]
    assert summary["emails"] == ["a@example.com"]


def test_n8n_cfo_summary_requires_the_shared_secret(env, summary, monkeypatch):
    client = TestClient(_app(None))
    body = json.dumps({"company_id": CO_A, "send_email": True, "to_email": "attacker@example.com"})
    url = "/api/ap/n8n/cfo-daily-summary"
    monkeypatch.delenv("N8N_WEBHOOK_SECRET", raising=False)
    assert client.post(url, content=body, headers={"X-N8N-Signature": "x"}).status_code == 500
    monkeypatch.setenv("N8N_WEBHOOK_SECRET", "s3cret")
    assert client.post(url, content=body).status_code == 401
    assert client.post(url, content=body, headers={"X-N8N-Signature": "wrong"}).status_code == 401
    assert summary["built"] == []
    signed = hmac.new(b"s3cret", body.encode(), hashlib.sha256).hexdigest()
    for sig in ("s3cret", signed):
        assert client.post(url, content=body, headers={"X-N8N-Signature": sig}).status_code == 200
    assert summary["built"] == [CO_A, CO_A]
    assert summary["emails"] == [None, None]


# ── PO / GRN bulk (service-role writes) ─────────────────────────────────────

@pytest.mark.parametrize("path,fn,key", [
    ("/api/ap/purchase-orders/bulk", "bulk_upsert_purchase_orders", "purchase_orders"),
    ("/api/ap/goods-receipts/bulk", "bulk_upsert_goods_receipts", "goods_receipts"),
    ("/api/ap/purchase-orders/ensure-workspace-matches", "ensure_workspace_pos_and_relink_grns", None),
])
def test_bulk_writes_need_write_access_to_the_company(client, env, monkeypatch, path, fn, key):
    seen = []
    monkeypatch.setattr(ap_bulk_invoice_service, fn, lambda company_id, rows=None: seen.append(company_id) or {"ok": True})
    body = {key: [{"po_number": "1"}]} if key else {}
    assert client.post(path, json={**body, "company_id": CO_B}).status_code == 403
    env.roles[WS_A] = "viewer"
    assert client.post(path, json={**body, "company_id": CO_A}).status_code == 403
    env.roles[WS_A] = "accountant"
    assert client.post(path, json={**body, "company_id": CO_A}).status_code == 200
    assert seen == [CO_A]


# ── shared AP accounting connection ─────────────────────────────────────────

@pytest.fixture()
def settings_store(monkeypatch):
    store = {"zoho_client_id": "cid", "zoho_client_secret": "csecret", "zoho_refresh_token": "rt",
             "zoho_organization_id": "org", "qb_client_id": "qid", "qb_client_secret": "qsecret"}
    writes = []
    monkeypatch.setattr(ap_integrations, "get_app_setting", store.get)
    monkeypatch.setattr(ap_integrations, "upsert_app_setting", lambda k, v: writes.append(k))
    return writes


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/ap/integrations/zoho/auth-url"), ("GET", "/api/ap/integrations/qbo/auth-url"),
    ("POST", "/api/ap/integrations/zoho/sync"), ("POST", "/api/ap/integrations/quickbooks/sync"),
    ("POST", "/api/ap/bootstrap-supabase-tables"), ("POST", "/api/ap/bootstrap-training-tables"),
])
def test_shared_settings_are_platform_admin_only(client, env, settings_store, method, path):
    env.roles[WS_A] = "owner"
    assert client.request(method, path).status_code == 403
    assert settings_store == []


def test_integration_status_is_readable_by_members(client, settings_store):
    res = client.get("/api/ap/integrations/status")
    assert res.status_code == 200, res.text
    assert "csecret" not in res.text and "rt" not in json.dumps([i.get("message") for i in res.json()["integrations"]])


@pytest.mark.parametrize("provider,path", [("zoho", "/api/ap/integrations/zoho/callback"),
                                           ("qbo", "/api/ap/integrations/qbo/callback")])
def test_oauth_callbacks_need_a_signed_state(env, settings_store, provider, path):
    client = TestClient(_app(None))
    other = "qbo" if provider == "zoho" else "zoho"
    for state in (None, "ap", ap_integrations._oauth_state(other, env.ctx())):
        params = {"code": "attacker-code", **({"state": state} if state else {})}
        res = client.get(path, params=params, follow_redirects=False)
        assert res.status_code == 400, (state, res.text)
    assert settings_store == []


def test_admin_issued_state_is_accepted_but_zoho_domain_is_pinned(env, settings_store):
    env.user_role = "super_admin"
    admin = TestClient(_app(env))
    url = admin.get("/api/ap/integrations/zoho/auth-url").json()["auth_url"]
    state = re.search(r"state=([^&]+)", url).group(1)
    res = TestClient(_app(None)).get("/api/ap/integrations/zoho/callback",
                                     params={"code": "c", "state": state, "location": "evil.example"},
                                     follow_redirects=False)
    assert res.status_code == 400 and "data centre" in res.text
    assert settings_store == []


# ── AP settings ──────────────────────────────────────────────────────────────

def test_company_settings_never_falls_back_to_another_company(client, monkeypatch):
    seen = []
    monkeypatch.setattr(ap_settings, "get_company_settings", lambda cid: seen.append(cid) or {"country": "AE"})
    assert client.get("/api/ap/company-settings").json() == {}
    assert client.get("/api/ap/company-settings", params={"company_id": CO_B}).status_code == 403
    assert client.get("/api/ap/company-settings", params={"company_id": CO_A}).json() == {"country": "AE"}
    assert seen == [CO_A]


# ── email intake consent / erasure ──────────────────────────────────────────

@pytest.fixture()
def privacy(monkeypatch):
    calls = {"consent": [], "purge": []}
    monkeypatch.setattr(ap_email_privacy, "get_active_consent", lambda cid: None)
    monkeypatch.setattr(ap_email_privacy, "record_consent", lambda **kw: calls["consent"].append(kw) or {"id": 1})
    monkeypatch.setattr(ap_email_privacy, "purge_email_intake_data", lambda cid: calls["purge"].append(cid) or {})
    return calls


def test_consent_is_company_scoped_and_recorded_for_the_caller(client, privacy):
    assert client.get("/api/ap/email-intake/consent", params={"company_id": CO_B}).status_code == 403
    res = client.post("/api/ap/email-intake/consent",
                      json={"company_id": CO_B, "accepted_by_email": "member@b.example"})
    assert res.status_code == 403
    res = client.post("/api/ap/email-intake/consent",
                      json={"company_id": CO_A, "accepted_by_user_id": "someone", "accepted_by_email": "x@y.z"})
    assert res.status_code == 200, res.text
    assert len(privacy["consent"]) == 1
    rec = privacy["consent"][0]
    assert (rec["company_id"], rec["accepted_by_user_id"], rec["accepted_by_email"]) == (CO_A, "user-1", "a@example.com")


def test_erasure_needs_a_manager(client, env, privacy):
    body = {"company_id": CO_A, "confirm": True}
    assert client.post("/api/ap/email-intake/erasure", json=body).status_code == 403
    env.roles[WS_A] = "finance_manager"
    assert client.post("/api/ap/email-intake/erasure", json={**body, "company_id": CO_B}).status_code == 403
    assert client.post("/api/ap/email-intake/erasure", json=body).status_code == 200
    assert privacy["purge"] == [CO_A]


# ── WhatsApp webhook ─────────────────────────────────────────────────────────

def test_whatsapp_webhook_requires_meta_signature(monkeypatch):
    handled = []

    async def _handle(body):
        handled.append(body)

    monkeypatch.setattr(ap_whatsapp_intake, "_handle_payload", _handle)
    client = TestClient(_app(None))
    url = "/api/ap/whatsapp-intake/webhook"
    raw = json.dumps({"entry": []}).encode()
    monkeypatch.delenv("WHATSAPP_APP_SECRET", raising=False)
    assert client.post(url, content=raw).status_code == 503
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "app-secret")
    assert client.post(url, content=raw).status_code == 401
    assert client.post(url, content=raw, headers={"X-Hub-Signature-256": "sha256=00"}).status_code == 401
    assert handled == []
    sig = "sha256=" + hmac.new(b"app-secret", raw, hashlib.sha256).hexdigest()
    assert client.post(url, content=raw, headers={"X-Hub-Signature-256": sig}).status_code == 200
    assert handled == [{"entry": []}]


# ── payment calendar ─────────────────────────────────────────────────────────

def test_payment_calendar_uses_the_validated_workspace(client, monkeypatch):
    seen = []
    monkeypatch.setattr(payment_calendar.uae_cfo, "has_uae_transactions",
                        lambda db, ws, cid: seen.append(ws) or False)
    res = client.get("/api/payment-calendar/weeks", headers={"X-Workspace-ID": WS_B, "X-Tenant-ID": WS_B})
    assert res.status_code == 200, res.text
    assert seen == [WS_A]
