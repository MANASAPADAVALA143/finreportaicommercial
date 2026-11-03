"""Accounting Memo Generator: ownership, model output parsing, edits, regenerate and failure handling."""

from __future__ import annotations

import json
import os
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.accounting_memo import AccountingMemo
from app.models.workspace import WorkspaceRole
from app.routers import accounting_memo
from app.services import llm_service

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "aaaaaaaa-1111-4000-8000-000000000001"
CO_A2 = "aaaaaaaa-1111-4000-8000-000000000003"
CO_B = "bbbbbbbb-1111-4000-8000-000000000002"
COMPANY_WORKSPACE = {CO_A: WS_A, CO_A2: WS_A, CO_B: WS_B}
BASE = "/api/accounting-memos"

MEMO_JSON = {
    "executive_summary": "The arrangement does not contain a lease.",
    "background": "SaaS subscription with hosted software.",
    "applicable_standards": "IFRS 16; IFRS 15.",
    "accounting_analysis": "No identified asset. Para 9 — Reference requires verification against source standard.",
    "conclusion": "Account for as a service contract under IFRS 15.",
    "journal_entries": "| Account | Debit | Credit |\n|---|---|---|\n| Expense | 100 | |\n| Cash | | 100 |",
    "disclosures": "",
    "assumptions": ["Customer has no right to direct use", "No dedicated hardware"],
    "requires_partner_review": "false",
}


class Env:
    def __init__(self):
        self.role = "viewer"
        self.email: str | None = "preparer@example.com"

    def ctx(self) -> WorkspaceContext:
        return WorkspaceContext(
            workspace_id=WS_A,
            workspace=SimpleNamespace(id=WS_A),
            user=SimpleNamespace(id="user-1", email=self.email, role="accountant"),
            role=WorkspaceRole(self.role),
        )


class FakeModel:
    def __init__(self):
        self.calls: list[dict] = []
        self.reply = json.dumps(MEMO_JSON)
        self.error: Exception | None = None

    def __call__(self, messages, *, system=None, max_tokens=1000, model_id=None):
        self.calls.append({"messages": [dict(m) for m in messages], "system": system, "max_tokens": max_tokens})
        if self.error:
            raise self.error
        return self.reply


@pytest.fixture()
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(
        company_access, "_company_workspace_ids",
        lambda _db, cid: iter([COMPANY_WORKSPACE[cid]] if cid in COMPANY_WORKSPACE else []),
    )
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.role if ws == WS_A else None)
    return e


@pytest.fixture()
def model(monkeypatch):
    fake = FakeModel()
    monkeypatch.setattr(llm_service, "chat", fake)
    return fake


@pytest.fixture()
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    AccountingMemo.__table__.create(engine)
    return sessionmaker(bind=engine)


def _app(env: Env | None, session_factory) -> FastAPI:
    app = FastAPI()
    app.include_router(accounting_memo.router)

    def _db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


@pytest.fixture()
def client(env, session_factory):
    return TestClient(_app(env, session_factory))


def q(co: str = CO_A) -> str:
    return f"?company_id={co}"


def _generate(client, description="We sell SaaS subscriptions. Is there a lease?", co=CO_A, **extra):
    return client.post(f"{BASE}/generate" + q(co), json={"transaction_description": description, **extra})


@pytest.mark.parametrize("method,path", [
    ("GET", ""),
    ("GET", "/1"),
    ("PATCH", "/1"),
    ("DELETE", "/1"),
    ("POST", "/generate"),
    ("POST", "/1/regenerate"),
])
def test_routes_require_login(env, session_factory, model, method, path):
    res = TestClient(_app(None, session_factory)).request(
        method, BASE + path + q(), json={"transaction_description": "x"}, headers={"X-Workspace-ID": WS_A}
    )
    assert res.status_code == 401, res.text
    assert model.calls == []


def test_generate_creates_structured_memo(client, model):
    res = _generate(client, "  We sell SaaS subscriptions. Is there a lease?  ", jurisdiction="Ind AS", accounting_topic="Lease Accounting")
    assert res.status_code == 200, res.text
    memo = res.json()
    assert memo["title"] == "We sell SaaS subscriptions. Is there a lease?"
    assert (memo["status"], memo["jurisdiction"], memo["accounting_topic"]) == ("draft", "Ind AS", "Lease Accounting")
    assert memo["section_executive_summary"] == MEMO_JSON["executive_summary"]
    assert memo["section_journal_entries"].startswith("| Account | Debit | Credit |")
    assert memo["section_disclosures"] == ""
    assert memo["section_assumptions"] == "- Customer has no right to direct use\n- No dedicated hardware"
    assert memo["ai_generated"] is True
    # The model said "false", but a cited paragraph needs verification.
    assert memo["requires_partner_review"] is True

    call = model.calls[0]
    assert call["messages"] == [{"role": "user", "content": "We sell SaaS subscriptions. Is there a lease?"}]
    assert "Jurisdiction: Ind AS" in call["system"] and "Topic area: Lease Accounting" in call["system"]
    assert "{jurisdiction}" not in call["system"]


def test_generate_keeps_given_title_and_reads_fenced_json(client, model):
    model.reply = "Here is the memo:\n```json\n" + json.dumps({**MEMO_JSON, "accounting_analysis": "Plain.", "requires_partner_review": "true"}) + "\n```"
    memo = _generate(client, title="  SaaS lease assessment ").json()
    assert memo["title"] == "SaaS lease assessment"
    assert memo["requires_partner_review"] is True
    assert memo["section_accounting_analysis"] == "Plain."


@pytest.mark.parametrize("reply", ["not json at all", "{\"executive_summary\": ", "[1, 2]", "{}"])
def test_unreadable_model_output_is_502_and_saves_nothing(client, model, session_factory, reply):
    model.reply = reply
    res = _generate(client)
    assert res.status_code == 502
    assert "unexpected format" in res.json()["detail"]
    with session_factory() as db:
        assert db.query(AccountingMemo).count() == 0


@pytest.mark.parametrize("error,status", [
    (llm_service.LLMNotConfiguredError("no key"), 503),
    (llm_service.LLMRateLimitError("slow down"), 429),
    (RuntimeError("secret upstream detail"), 502),
])
def test_model_failures_save_nothing(client, model, session_factory, error, status):
    model.error = error
    res = _generate(client)
    assert res.status_code == status
    assert "secret" not in res.text
    with session_factory() as db:
        assert db.query(AccountingMemo).count() == 0


def test_blank_description_is_rejected(client, model):
    assert _generate(client, "   ").status_code == 422
    assert _generate(client, "").status_code == 422
    assert model.calls == []


def test_patch_updates_only_given_fields(client, model):
    memo = _generate(client).json()
    res = client.patch(f"{BASE}/{memo['id']}" + q(), json={"section_conclusion": "Edited conclusion.", "status": "under_review"})
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["section_conclusion"] == "Edited conclusion."
    assert out["status"] == "under_review"
    assert out["section_background"] == MEMO_JSON["background"]
    assert client.get(f"{BASE}/{memo['id']}" + q()).json()["section_conclusion"] == "Edited conclusion."


@pytest.mark.parametrize("body", [{"status": "approved"}, {"title": ""}])
def test_patch_rejects_invalid_values(client, model, body):
    memo = _generate(client).json()
    assert client.patch(f"{BASE}/{memo['id']}" + q(), json=body).status_code == 422


def test_regenerate_overwrites_sections_but_keeps_title_and_status(client, model):
    memo = _generate(client, title="Keep me").json()
    client.patch(f"{BASE}/{memo['id']}" + q(), json={"status": "under_review", "section_conclusion": "Mine"})
    model.reply = json.dumps({**MEMO_JSON, "conclusion": "Redrafted."})
    res = client.post(f"{BASE}/{memo['id']}/regenerate" + q())
    assert res.status_code == 200, res.text
    out = res.json()
    assert (out["title"], out["status"], out["section_conclusion"]) == ("Keep me", "under_review", "Redrafted.")
    assert model.calls[-1]["messages"] == model.calls[0]["messages"]


def test_failed_regenerate_keeps_existing_memo(client, model):
    memo = _generate(client).json()
    model.reply = "garbage"
    assert client.post(f"{BASE}/{memo['id']}/regenerate" + q()).status_code == 502
    assert client.get(f"{BASE}/{memo['id']}" + q()).json()["section_conclusion"] == MEMO_JSON["conclusion"]


def test_memos_are_private_to_the_author(client, model, env):
    memo = _generate(client).json()
    assert [m["id"] for m in client.get(BASE + q()).json()] == [memo["id"]]

    env.email = "colleague@example.com"
    assert client.get(BASE + q()).json() == []
    for method, path in (("GET", ""), ("PATCH", ""), ("DELETE", ""), ("POST", "/regenerate")):
        res = client.request(method, f"{BASE}/{memo['id']}{path}" + q(), json={"status": "finalised"})
        assert res.status_code == 404, (method, path)

    env.email = "preparer@example.com"
    assert client.get(f"{BASE}/{memo['id']}" + q()).json()["status"] == "draft"


def test_memos_stay_with_their_company(client, model):
    memo = _generate(client).json()
    assert client.get(BASE + q(CO_A2)).json() == []
    assert client.get(f"{BASE}/{memo['id']}" + q(CO_A2)).status_code == 404


def test_other_workspace_company_is_403(client, model):
    assert _generate(client, co=CO_B).status_code == 403
    assert client.get(BASE + q(CO_B)).status_code == 403
    assert model.calls == []


def test_signed_in_user_without_email_is_401(client, model, env):
    env.email = None
    assert client.get(BASE + q()).status_code == 401


def test_delete_removes_memo(client, model):
    memo = _generate(client).json()
    assert client.delete(f"{BASE}/{memo['id']}" + q()).status_code == 204
    assert client.get(f"{BASE}/{memo['id']}" + q()).status_code == 404
    assert client.get(BASE + q()).json() == []
