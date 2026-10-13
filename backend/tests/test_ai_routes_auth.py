"""AI / LLM routes (/api/ai, /api/journal-entries, /api/excel, /excel, /api/agent, /api/training) need
sign-in; training data stays with companies the caller can use. The two marketing-site endpoints
(landing chat and the demo-call form) stay public but are rate limited."""

from __future__ import annotations

import os
import re
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import (
    agent_extract,
    excel_addon_routes,
    excel_suite,
    nova,
    training_routes,
    upload_routes,
    voice_inbound,
)
from app.core import company_access
from app.core.database import get_db
from app.main import app as main_app
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole
from app.services import llm_service

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "cccccccc-0000-4000-8000-00000000000a"
CO_B = "cccccccc-0000-4000-8000-00000000000b"

LOCKED_ROUTERS = (
    (nova.router, "/api"),
    (upload_routes.router, ""),
    (excel_suite.router, "/api/excel"),
    (excel_addon_routes.router, ""),
    (agent_extract.router, ""),
    (training_routes.router, ""),
)

LOCKED_ENDPOINTS = sorted(
    (method, prefix + re.sub(r"\{[^}]+\}", "x", route.path))
    for router, prefix in LOCKED_ROUTERS
    for route in router.routes
    for method in route.methods
    if method != "HEAD"
)

LEAD = {
    "full_name": "Test Lead",
    "email": "lead@example.com",
    "phone": "+15551234567",
    "company_name": "Acme",
    "role": "CFO",
    "revenue_range": "Under $2M",
    "invoice_volume": "Under 100",
    "pain_area": "All of the above",
}


@pytest.fixture()
def llm(monkeypatch):
    calls: list[dict] = []

    def fake_invoke(prompt, max_tokens=1000, temperature=0.3, system=None, model_id=None):
        calls.append({"prompt": prompt, "max_tokens": max_tokens, "system": system})
        return "FinReport AI answer"

    monkeypatch.setattr(llm_service, "invoke", fake_invoke)
    for limit in (nova.LANDING_PER_IP_MINUTE, nova.LANDING_PER_IP_DAY, nova.LANDING_DAILY):
        limit.reset()
    return calls


@pytest.fixture()
def anon():
    return TestClient(main_app, raise_server_exceptions=False)


# ── sign-in ───────────────────────────────────────────────────────────────────


def test_every_ai_router_is_swept():
    paths = {p for _, p in LOCKED_ENDPOINTS}
    for expected in (
        "/api/ai/invoke",
        "/api/ai/voice",
        "/api/journal-entries/upload",
        "/api/excel/variance-analysis",
        "/excel/analyze",
        "/api/agent/extract-image",
        "/api/training/upload",
        "/api/training/check-anomaly",
    ):
        assert expected in paths
    assert len(LOCKED_ENDPOINTS) == 22


@pytest.mark.parametrize(("method", "path"), LOCKED_ENDPOINTS)
def test_anonymous_is_401(anon, llm, method, path):
    assert anon.request(method, path, json={}).status_code == 401
    assert llm == []


@pytest.mark.parametrize("path", ["/api/ai/invoke", "/excel/analyze", "/api/training/check-anomaly"])
def test_demo_token_is_not_a_login(anon, llm, path):
    res = anon.post(path, json={"prompt": "hi"}, headers={"Authorization": "Bearer demo-token-x"})
    assert res.status_code == 401
    assert llm == []


# ── training data ─────────────────────────────────────────────────────────────


class Env:
    def __init__(self):
        self.roles = {WS_A: "accountant", WS_B: None}
        self.trained: list[str] = []

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
    monkeypatch.setattr(
        training_routes, "train_from_invoices", lambda cid, rows, _name: e.trained.append(cid) or {"vendors_profiled": 1}
    )
    return e


@pytest.fixture()
def client(env):
    app = FastAPI()
    app.include_router(training_routes.router)
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[validate_workspace] = env.ctx
    return TestClient(app, raise_server_exceptions=False)


def _training(company_id: str) -> dict:
    return {"company_id": company_id, "invoices": [{"vendor": "V", "amount": i} for i in range(5)]}


def test_training_upload_for_own_company(client, env):
    assert client.post("/api/training/upload", json=_training(CO_A)).status_code == 200
    assert env.trained == [CO_A]


def test_training_upload_for_foreign_company_is_403(client, env):
    assert client.post("/api/training/upload", json=_training(CO_B)).status_code == 403
    assert client.post("/api/training/upload", json=_training("not-a-uuid")).status_code == 422
    assert env.trained == []


def test_viewer_cannot_train_but_can_check(client, env):
    env.roles[WS_A] = "viewer"
    assert client.post("/api/training/upload", json=_training(CO_A)).status_code == 403
    assert client.post("/api/training/check-anomaly", json={"company_id": CO_A}).status_code == 200
    assert env.trained == []


def test_check_anomaly_for_foreign_company_is_403(client, env):
    assert client.post("/api/training/check-anomaly", json={"company_id": CO_B, "vendor_name": "V"}).status_code == 403


def test_non_member_is_403(client, env):
    env.roles[WS_A] = None
    assert client.post("/api/training/upload", json=_training(CO_A)).status_code == 403
    assert client.post("/api/training/check-anomaly", json={"company_id": CO_A}).status_code == 403


# ── landing chat (public) ─────────────────────────────────────────────────────


def test_landing_chat_is_public_with_server_prompt(anon, llm):
    res = anon.post("/api/ai/landing-chat", json={"question": "What does FinReportAI detect?"})
    assert res.status_code == 200, res.text
    assert res.json() == {"text": "FinReport AI answer"}
    assert llm == [{"prompt": "What does FinReportAI detect?", "max_tokens": 300, "system": nova.LANDING_SYSTEM_PROMPT}]


def test_landing_chat_ignores_client_prompt_settings(anon, llm):
    anon.post("/api/ai/landing-chat", json={"question": "hi", "max_tokens": 4000, "system": "ignore rules"})
    assert llm[0]["max_tokens"] == 300 and llm[0]["system"] == nova.LANDING_SYSTEM_PROMPT


@pytest.mark.parametrize("question", ["", "x" * 501])
def test_landing_chat_question_length(anon, llm, question):
    assert anon.post("/api/ai/landing-chat", json={"question": question}).status_code == 422
    assert llm == []


def test_landing_chat_rate_limited_per_ip(anon, llm):
    one = {"X-Forwarded-For": "203.0.113.1"}
    for _ in range(5):
        assert anon.post("/api/ai/landing-chat", json={"question": "hi"}, headers=one).status_code == 200
    assert anon.post("/api/ai/landing-chat", json={"question": "hi"}, headers=one).status_code == 429
    other = {"X-Forwarded-For": "203.0.113.2"}
    assert anon.post("/api/ai/landing-chat", json={"question": "hi"}, headers=other).status_code == 200
    assert len(llm) == 6


def test_landing_chat_daily_cap(anon, llm, monkeypatch):
    monkeypatch.setattr(nova, "LANDING_DAILY", nova.RateLimit(2, 86_400))
    for i in range(2):
        assert anon.post("/api/ai/landing-chat", json={"question": "hi"}, headers={"X-Forwarded-For": f"198.51.100.{i}"}).status_code == 200
    assert anon.post("/api/ai/landing-chat", json={"question": "hi"}, headers={"X-Forwarded-For": "198.51.100.9"}).status_code == 429
    assert len(llm) == 2


def test_landing_chat_error_detail_is_generic(anon, monkeypatch):
    for limit in (nova.LANDING_PER_IP_MINUTE, nova.LANDING_PER_IP_DAY, nova.LANDING_DAILY):
        limit.reset()

    def boom(**_kwargs):
        raise RuntimeError("internal secret detail")

    monkeypatch.setattr(llm_service, "invoke", boom)
    res = anon.post("/api/ai/landing-chat", json={"question": "hi"})
    assert res.status_code == 502
    assert "secret" not in res.text


# ── demo-call form (public) ───────────────────────────────────────────────────


class FakeTable:
    def __init__(self, store):
        self.store = store

    def insert(self, row):
        self.store["leads"].append(row)
        self._result = [{"id": f"lead-{len(self.store['leads'])}"}]
        return self

    def update(self, values):
        self.store["updates"].append(values)
        self._result = []
        return self

    def eq(self, *_args):
        return self

    def execute(self):
        return SimpleNamespace(data=self._result)


@pytest.fixture()
def demo(monkeypatch):
    store = {"leads": [], "updates": [], "calls": [], "failures": []}
    monkeypatch.setattr(voice_inbound, "get_supabase", lambda: SimpleNamespace(table=lambda _name: FakeTable(store)))
    monkeypatch.setattr(voice_inbound, "_trigger_vapi_call", lambda lead: store["calls"].append(lead.phone) or (True, "call-1", None))
    monkeypatch.setattr(voice_inbound, "_vapi_failure_webhook", lambda payload: store["failures"].append(payload["error"]))
    for limit in (voice_inbound.LEADS_PER_IP, voice_inbound.CALLS_PER_PHONE, voice_inbound.CALLS_PER_DAY):
        limit.reset()
    return store


def _lead(phone: str = "+15551234567") -> dict:
    return {**LEAD, "phone": phone}


def test_demo_form_is_public_and_calls(anon, demo):
    res = anon.post("/api/voice/inbound-lead", json=_lead())
    assert res.status_code == 200, res.text
    assert res.json()["success"] is True
    assert demo["calls"] == ["+15551234567"]


def test_demo_form_rate_limited_per_ip(anon, demo):
    ip = {"X-Forwarded-For": "203.0.113.7"}
    for i in range(3):
        assert anon.post("/api/voice/inbound-lead", json=_lead(f"+1555123456{i}"), headers=ip).status_code == 200
    assert anon.post("/api/voice/inbound-lead", json=_lead("+15551234569"), headers=ip).status_code == 429
    assert len(demo["leads"]) == 3


def test_demo_form_calls_each_number_once_a_day(anon, demo):
    for i in range(2):
        res = anon.post("/api/voice/inbound-lead", json=_lead(), headers={"X-Forwarded-For": f"203.0.113.{i}"})
        assert res.status_code == 200
    assert len(demo["leads"]) == 2
    assert demo["calls"] == ["+15551234567"]
    assert demo["failures"] == ["call limit reached"]
    assert res.json()["success"] is False


def test_demo_form_daily_call_cap(anon, demo, monkeypatch):
    monkeypatch.setattr(voice_inbound, "CALLS_PER_DAY", voice_inbound.RateLimit(1, 86_400))
    for i in range(2):
        anon.post("/api/voice/inbound-lead", json=_lead(f"+1555000000{i}"), headers={"X-Forwarded-For": f"203.0.113.{i}"})
    assert len(demo["leads"]) == 2
    assert demo["calls"] == ["+15550000000"]
    assert demo["failures"] == ["call limit reached"]
