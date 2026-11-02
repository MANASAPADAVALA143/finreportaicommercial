"""Technical Accounting AI Assistant: ownership, history sent to the model, failure handling."""

from __future__ import annotations

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
from app.models.accounting_assistant import AccountingConversation, AccountingMessage
from app.models.workspace import WorkspaceRole
from app.routers import accounting_assistant
from app.services import llm_service

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "aaaaaaaa-1111-4000-8000-000000000001"
CO_A2 = "aaaaaaaa-1111-4000-8000-000000000003"
CO_B = "bbbbbbbb-1111-4000-8000-000000000002"
COMPANY_WORKSPACE = {CO_A: WS_A, CO_A2: WS_A, CO_B: WS_B}
BASE = "/api/accounting-assistant"


class Env:
    def __init__(self):
        self.role = "viewer"
        self.email: str | None = "auditor@example.com"

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
        self.reply = "## Executive Conclusion\nRecognise revenue over time."
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
    for m in (AccountingConversation, AccountingMessage):
        m.__table__.create(engine)
    return sessionmaker(bind=engine)


def _app(env: Env | None, session_factory) -> FastAPI:
    app = FastAPI()
    app.include_router(accounting_assistant.router)

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


def _ask(client, message, conversation_id=None, co=CO_A, **extra):
    return client.post(f"{BASE}/chat" + q(co), json={"message": message, "conversation_id": conversation_id, **extra})


@pytest.mark.parametrize("method,path", [
    ("GET", "/conversations"),
    ("GET", "/conversations/1/messages"),
    ("DELETE", "/conversations/1"),
    ("POST", "/chat"),
])
def test_routes_require_login(env, session_factory, method, path):
    res = TestClient(_app(None, session_factory)).request(
        method, BASE + path + q(), json={"message": "x"}, headers={"X-Workspace-ID": WS_A}
    )
    assert res.status_code == 401, res.text


def test_first_question_creates_titled_conversation(client, model):
    res = _ask(client, "  How do we identify a lease under IFRS 16?  ", jurisdiction="Ind AS", accounting_topic="Leases")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["answer"] == model.reply and body["structured"] is None
    assert body["conversation"]["title"] == "How do we identify a lease under IFRS 16?"
    assert body["conversation"]["jurisdiction"] == "Ind AS"
    assert body["caveats"] and body["requires_human_review"] is False
    assert [m["role"] for m in (body["user_message"], body["assistant_message"])] == ["user", "assistant"]

    call = model.calls[0]
    assert call["messages"] == [{"role": "user", "content": "How do we identify a lease under IFRS 16?"}]
    assert "(Ind AS)" in call["system"] and "Focus area for this conversation: Leases" in call["system"]

    convs = client.get(f"{BASE}/conversations" + q()).json()
    assert [c["id"] for c in convs] == [body["conversation_id"]]
    assert "user_email" in convs[0]


def test_follow_up_sends_history_once_and_starts_with_user(client, model, session_factory):
    first = _ask(client, "Q1").json()
    cid = first["conversation_id"]
    model.reply = "A2"
    _ask(client, "Q2", cid)
    assert model.calls[1]["messages"] == [
        {"role": "user", "content": "Q1"},
        {"role": "assistant", "content": "## Executive Conclusion\nRecognise revenue over time."},
        {"role": "user", "content": "Q2"},
    ]
    for i in range(3, 8):
        model.reply = f"A{i}"
        _ask(client, f"Q{i}", cid)
    sent = model.calls[-1]["messages"]
    assert sent[0]["role"] == "user" and sent[-1] == {"role": "user", "content": "Q7"}
    assert len(sent) <= accounting_assistant.HISTORY_MESSAGES + 1
    assert [m["content"] for m in sent].count("Q7") == 1

    msgs = client.get(f"{BASE}/conversations/{cid}/messages" + q()).json()
    assert [m["content"] for m in msgs][:2] == ["Q1", "## Executive Conclusion\nRecognise revenue over time."]
    assert len(msgs) == 14


def test_review_flag_and_caveat_on_stored_messages(client, model):
    model.reply = "Paragraph B34. Reference requires verification against the source standard."
    body = _ask(client, "Principal vs agent?").json()
    assert body["requires_human_review"] is True
    msgs = client.get(f"{BASE}/conversations/{body['conversation_id']}/messages" + q()).json()
    assistant = msgs[1]
    assert assistant["requires_human_review"] is True and assistant["caveats"]
    assert "requires_human_review" not in msgs[0]


@pytest.mark.parametrize("error,status", [
    (llm_service.LLMNotConfiguredError("no key"), 503),
    (llm_service.LLMRateLimitError("slow down"), 429),
    (RuntimeError("boom"), 502),
])
def test_model_failure_saves_nothing(client, model, session_factory, error, status):
    model.error = error
    assert _ask(client, "Explain IFRS 15").status_code == status
    db = session_factory()
    assert db.query(AccountingConversation).count() == 0
    assert db.query(AccountingMessage).count() == 0
    db.close()


def test_failure_in_existing_conversation_keeps_it_unchanged(client, model, session_factory):
    cid = _ask(client, "Q1").json()["conversation_id"]
    model.error = RuntimeError("boom")
    assert _ask(client, "Q2", cid).status_code == 502
    assert len(client.get(f"{BASE}/conversations/{cid}/messages" + q()).json()) == 2


def test_empty_answer_is_an_error(client, model):
    model.reply = "   "
    assert _ask(client, "Q").status_code == 502


@pytest.mark.parametrize("body", [
    {"message": ""},
    {"message": "   "},
    {"message": "x" * 8001},
    {"message": "Q", "jurisdiction": "UK GAAP"},
    {"message": "Q", "accounting_topic": "t" * 201},
])
def test_chat_validation(client, model, body):
    assert client.post(f"{BASE}/chat" + q(), json=body).status_code == 422
    assert model.calls == []


def test_conversations_are_private_to_user_and_company(client, env, model):
    cid = _ask(client, "Mine").json()["conversation_id"]

    env.email = "colleague@example.com"
    assert client.get(f"{BASE}/conversations" + q()).json() == []
    assert client.get(f"{BASE}/conversations/{cid}/messages" + q()).status_code == 404
    assert _ask(client, "hijack", cid).status_code == 404
    assert client.delete(f"{BASE}/conversations/{cid}" + q()).status_code == 404

    env.email = "auditor@example.com"
    assert client.get(f"{BASE}/conversations" + q(CO_A2)).json() == []
    assert client.get(f"{BASE}/conversations/{cid}/messages" + q(CO_A2)).status_code == 404
    assert client.get(f"{BASE}/conversations" + q(CO_B)).status_code == 403
    assert len(model.calls) == 1


def test_user_without_email_is_rejected(client, env, model):
    env.email = None
    assert client.get(f"{BASE}/conversations" + q()).status_code == 401
    assert _ask(client, "Q").status_code == 401


def test_delete_conversation_removes_messages(client, model, session_factory):
    cid = _ask(client, "Q1").json()["conversation_id"]
    assert client.delete(f"{BASE}/conversations/{cid}" + q()).status_code == 204
    assert client.get(f"{BASE}/conversations" + q()).json() == []
    db = session_factory()
    assert db.query(AccountingMessage).count() == 0
    db.close()
