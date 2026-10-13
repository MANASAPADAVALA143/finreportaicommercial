"""Excel add-in endpoints (/api/chat/ask, /api/excel-addin/*) call Claude on the platform key,
so they need a signed-in workspace member; viewers may use them because they only analyse
the data sent in the request."""

from __future__ import annotations

import os
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi.testclient import TestClient

from app.api.routes import chat
from app.core import company_access
from app.main import app
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"

ADDIN_POSTS = sorted(
    r.path
    for r in app.routes
    if getattr(r, "path", "").startswith("/api/excel-addin") and "POST" in (getattr(r, "methods", None) or ())
)


def test_every_addin_post_route_is_covered():
    assert ADDIN_POSTS == [
        "/api/excel-addin/analyze",
        "/api/excel-addin/budget",
        "/api/excel-addin/chat",
        "/api/excel-addin/export",
        "/api/excel-addin/forecast",
        "/api/excel-addin/kpi",
        "/api/excel-addin/reports",
        "/api/excel-addin/scenarios",
        "/api/excel-addin/variance",
    ]


@pytest.fixture()
def anon():
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize("path", ["/api/chat/ask", *ADDIN_POSTS])
def test_requires_login(anon, path):
    r = anon.post(path, json={"message": "hi"})
    assert r.status_code == 401


def test_options_preflight_still_answers(anon):
    r = anon.options("/api/excel-addin/analyze")
    assert r.status_code == 204


@pytest.fixture()
def signed_in(monkeypatch):
    state = {"role": WorkspaceRole.viewer}

    def ctx():
        return WorkspaceContext(
            workspace_id=WS_A,
            workspace=SimpleNamespace(id=WS_A),
            user=SimpleNamespace(id="user-1", email="a@example.com", role="user"),
            role=state["role"],
        )

    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, c, _ws: c.role.value if c.role else None)
    monkeypatch.setattr(chat.llm_service, "is_configured", lambda: True)
    monkeypatch.setattr(chat.llm_service, "invoke", lambda **_kw: '{"response": "Hello from the sheet."}')
    app.dependency_overrides[validate_workspace] = ctx
    try:
        yield state, TestClient(app, raise_server_exceptions=False)
    finally:
        app.dependency_overrides.pop(validate_workspace, None)


def test_viewer_can_chat(signed_in):
    _state, client = signed_in
    r = client.post("/api/chat/ask", json={"message": "hi", "context": "", "history": []})
    assert r.status_code == 200
    assert "Hello" in r.json()["response"]


def test_non_member_is_refused(signed_in):
    state, client = signed_in
    state["role"] = None
    r = client.post("/api/chat/ask", json={"message": "hi", "context": "", "history": []})
    assert r.status_code == 403


@pytest.mark.parametrize("path", ADDIN_POSTS)
def test_signed_in_member_gets_past_auth(signed_in, path):
    _state, client = signed_in
    r = client.post(path, json={})
    assert r.status_code not in (401, 403)
