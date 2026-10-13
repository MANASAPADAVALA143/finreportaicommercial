"""Paths that must stay reachable without a bearer token when AUTH_GATE_MODE=enforce."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.middleware.product_role_middleware import _is_public
from app.routers import company_setup


@pytest.mark.parametrize(
    "path",
    [
        "/api/board-pack/view/0b9c7a7e-1111-4222-8333-444455556666",
        "/api/board-pack/download/0b9c7a7e-1111-4222-8333-444455556666",
        "/api/company-setup/logo/ws_abcd1234.png",
        "/api/rera/webhooks/zoho",
        "/api/uae/zoho/callback",
    ],
)
def test_public(path):
    assert _is_public(path)


@pytest.mark.parametrize(
    "path",
    [
        "/api/board-pack/view",
        "/api/board-pack/generate",
        "/api/board-pack/12/finalize",
        "/api/company-setup/logo",
        "/api/company-setup/profile",
        "/api/rera/webhooks/events",
        "/api/rera/webhooks/zoho-other",
    ],
)
def test_not_public(path):
    assert not _is_public(path)


@pytest.fixture
def enforce(monkeypatch):
    monkeypatch.setenv("AUTH_GATE_MODE", "enforce")
    return TestClient(app, raise_server_exceptions=False)


def test_enforce_lets_logo_through(enforce):
    r = enforce.get("/api/company-setup/logo/does-not-exist.png")
    assert r.status_code == 404


def test_enforce_still_blocks_logo_upload(enforce):
    r = enforce.post("/api/company-setup/logo", files={"file": ("a.png", b"x", "image/png")})
    assert r.status_code == 401


def test_enforce_lets_board_pack_link_through(enforce):
    r = enforce.get("/api/board-pack/view/0b9c7a7e-1111-4222-8333-444455556666")
    assert r.status_code != 401


def test_rera_webhook_rejects_unsigned_under_enforce(enforce):
    r = enforce.post("/api/rera/webhooks/zoho", json={"spa_id": "x"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid webhook signature"


def test_enforce_blocks_other_rera_routes(enforce):
    r = enforce.get("/api/rera/webhooks/events")
    assert r.status_code == 401
    assert r.json()["detail"] == "Missing bearer token"


def test_logo_serves_file_in_logo_dir(monkeypatch, tmp_path):
    logos = tmp_path / "logos"
    logos.mkdir()
    (logos / "ws_1.png").write_bytes(b"png")
    monkeypatch.setattr(company_setup, "_LOGO_DIR", logos)
    assert str(company_setup.serve_logo("ws_1.png").path).endswith("ws_1.png")


@pytest.mark.parametrize("name", ["..", "../secret.txt", "..\\secret.txt", "missing.png"])
def test_logo_refuses_paths_outside_logo_dir(monkeypatch, tmp_path, name):
    logos = tmp_path / "logos"
    logos.mkdir()
    (tmp_path / "secret.txt").write_text("s")
    monkeypatch.setattr(company_setup, "_LOGO_DIR", logos)
    with pytest.raises(HTTPException) as exc:
        company_setup.serve_logo(name)
    assert exc.value.status_code == 404
