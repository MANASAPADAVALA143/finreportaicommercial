"""Fail-closed CFO dashboard: never return fabricated financial metrics as HTTP 200."""

from __future__ import annotations

import os
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import cfo_dashboard
from app.core.tenant_scope import workspace_reader
from app.middleware.workspace import WorkspaceContext
from app.models.workspace import WorkspaceRole

WS = "aaaaaaaa-0000-4000-8000-000000000001"

# Signature values from the retired hard-coded mock payload — must never appear in 200 bodies.
FORBIDDEN_CASH = 562000
FORBIDDEN_HEALTH = 69
FORBIDDEN_REVENUE = 328000


def _ctx() -> WorkspaceContext:
    return WorkspaceContext(
        workspace_id=WS,
        workspace=SimpleNamespace(id=WS),
        user=SimpleNamespace(id="user-1", email="a@example.com", role="user"),
        role=WorkspaceRole("accountant"),
    )


def _client(monkeypatch, *, tb_exists: bool = False, je_exists: bool = False) -> TestClient:
    def _exists(path: str) -> bool:
        if path == cfo_dashboard.TRIAL_BALANCE_PATH:
            return tb_exists
        if path == cfo_dashboard.JOURNAL_ENTRIES_PATH:
            return je_exists
        return False

    monkeypatch.setattr(cfo_dashboard.os.path, "exists", _exists)

    app = FastAPI()
    app.include_router(cfo_dashboard.router)
    app.dependency_overrides[workspace_reader] = _ctx
    return TestClient(app, raise_server_exceptions=False)


def _assert_no_fabricated_payload(body: dict) -> None:
    cash = (body.get("cash") or {})
    health = (body.get("healthScore") or {})
    revenue = (body.get("revenue") or {})
    assert cash.get("current") != FORBIDDEN_CASH
    assert cash.get("balance") != FORBIDDEN_CASH
    assert health.get("overall") != FORBIDDEN_HEALTH
    assert revenue.get("monthly") != FORBIDDEN_REVENUE


def test_dashboard_no_source_returns_501(monkeypatch):
    client = _client(monkeypatch)
    res = client.get("/api/cfo/dashboard")
    assert res.status_code == 501
    detail = res.json()["detail"]
    assert "Fabricated metrics are never returned" in detail
    assert str(FORBIDDEN_CASH) not in str(res.json())
    assert str(FORBIDDEN_HEALTH) not in str(res.json().get("healthScore", {}))


def test_dashboard_never_returns_mock_signature_on_200(monkeypatch):
    """Even if a future code path returns 200, the retired mock figures must stay gone."""
    client = _client(monkeypatch)
    res = client.get("/api/cfo/dashboard")
    if res.status_code == 200:
        _assert_no_fabricated_payload(res.json())
    else:
        assert res.status_code == 501


def test_export_no_source_returns_501(monkeypatch):
    client = _client(monkeypatch)
    res = client.post("/api/cfo/export?format=csv&time_range=month")
    assert res.status_code == 501
    assert "Fabricated metrics are never returned" in res.json()["detail"]


def test_metrics_fail_closed(monkeypatch):
    client = _client(monkeypatch)
    res = client.get("/api/cfo/metrics")
    assert res.status_code == 501
    assert str(FORBIDDEN_CASH) not in str(res.json())


def test_insights_fail_closed(monkeypatch):
    client = _client(monkeypatch)
    res = client.get("/api/cfo/insights")
    assert res.status_code == 501


def test_chat_fail_closed(monkeypatch):
    client = _client(monkeypatch)
    res = client.post("/api/cfo/chat?query=what%20is%20our%20cash")
    assert res.status_code == 501
    assert "562K" not in str(res.json())


def test_data_sources_does_not_advertise_mock(monkeypatch):
    client = _client(monkeypatch)
    res = client.get("/api/cfo/data-sources")
    assert res.status_code == 200
    body = res.json()
    assert body.get("primary_source") is None
    assert not any(s.get("type") == "mock" for s in body.get("sources") or [])
    assert "Fabricated" in (body.get("data_notice") or "")


def test_load_dashboard_data_raises_501_without_files(monkeypatch):
    monkeypatch.setattr(cfo_dashboard.os.path, "exists", lambda _p: False)
    with pytest.raises(Exception) as exc:
        cfo_dashboard._load_dashboard_data("month")
    # FastAPI HTTPException
    assert getattr(exc.value, "status_code", None) == 501


def test_get_mock_data_helper_removed():
    assert not hasattr(cfo_dashboard, "_get_mock_data")
