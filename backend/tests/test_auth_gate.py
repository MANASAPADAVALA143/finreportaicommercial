"""Global auth gate for requests that carry no bearer token (AUTH_GATE_MODE)."""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware.product_role_middleware import ProductRoleMiddleware, auth_gate_mode


def _client() -> TestClient:
    app = FastAPI()
    app.add_middleware(ProductRoleMiddleware)

    @app.get("/api/uae/stats")
    def stats():
        return {"ok": True}

    @app.get("/api/uae/zoho/callback")
    def zoho_callback():
        return {"ok": True}

    @app.post("/api/ap/whatsapp-intake/webhook")
    def whatsapp_webhook():
        return {"ok": True}

    @app.get("/health")
    def health():
        return {"ok": True}

    return TestClient(app)


@pytest.mark.parametrize("value,expected", [
    (None, "log"), ("", "log"), ("ENFORCE", "enforce"), ("off", "off"), ("bogus", "log"),
])
def test_mode_parsing(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv("AUTH_GATE_MODE", raising=False)
    else:
        monkeypatch.setenv("AUTH_GATE_MODE", value)
    assert auth_gate_mode() == expected


def test_log_mode_allows_and_logs_path_only(monkeypatch, caplog):
    monkeypatch.setenv("AUTH_GATE_MODE", "log")
    with caplog.at_level(logging.WARNING, logger="app.middleware.product_role_middleware"):
        res = _client().get("/api/uae/stats?company_id=secret-ish")
    assert res.status_code == 200
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("guest-access")]
    assert lines == ["guest-access GET /api/uae/stats"]


def test_off_mode_allows_without_logging(monkeypatch, caplog):
    monkeypatch.setenv("AUTH_GATE_MODE", "off")
    with caplog.at_level(logging.WARNING):
        assert _client().get("/api/uae/stats").status_code == 200
    assert not [r for r in caplog.records if "guest-access" in r.getMessage()]


def test_enforce_mode_rejects_missing_token(monkeypatch):
    monkeypatch.setenv("AUTH_GATE_MODE", "enforce")
    res = _client().get("/api/uae/stats", headers={"Origin": "https://finreportaicommercial.vercel.app"})
    assert res.status_code == 401
    assert res.json() == {"detail": "Missing bearer token"}
    assert res.headers["access-control-allow-origin"] == "https://finreportaicommercial.vercel.app"


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/uae/zoho/callback"),
    ("POST", "/api/ap/whatsapp-intake/webhook"),
    ("GET", "/health"),
])
def test_enforce_mode_keeps_public_paths_open(monkeypatch, method, path):
    monkeypatch.setenv("AUTH_GATE_MODE", "enforce")
    assert _client().request(method, path).status_code == 200


def test_enforce_mode_still_rejects_bad_tokens(monkeypatch):
    from app.middleware import product_role_middleware as mw

    def _reject(_token):
        raise ValueError("Invalid or expired token")

    monkeypatch.setenv("AUTH_GATE_MODE", "enforce")
    monkeypatch.setattr(mw, "verify_supabase_token", _reject)
    res = _client().get("/api/uae/stats", headers={"Authorization": "Bearer forged"})
    assert res.status_code == 401
