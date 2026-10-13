"""Industry config / cost centers (/api/config) and the notification feed (/api/notifications):
sign-in and workspace membership required, rows stay with the caller's workspace, a body/query
workspace_id or company_id must be one the caller can use, and only managers change the industry."""

from __future__ import annotations

import os
import re
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import industry_config_routes as cfg
from app.api.routes import notifications_routes as notif
from app.core import company_access
from app.core.database import get_db
from app.main import app as main_app
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.industry_config import CostCenter, IndustryConfig
from app.models.workspace import Workspace, WorkspaceRole
from app.models.workspace_notification import WorkspaceNotification

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "cccccccc-0000-4000-8000-00000000000a"
CO_B = "cccccccc-0000-4000-8000-00000000000b"


def _sweep(router):
    return sorted(
        (method, re.sub(r"\{[^}]+\}", "x", route.path))
        for route in router.routes
        for method in route.methods
    )


CFG_ENDPOINTS = _sweep(cfg.router)
NOTIF_ENDPOINTS = _sweep(notif.router)


class Env:
    def __init__(self):
        self.roles = {WS_A: "accountant", WS_B: None}
        self.scans: list[tuple[str, str | None]] = []
        self.emails: list[tuple[str, str]] = []

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
    monkeypatch.setattr(notif, "scan_notifications", lambda _db, ws, cid: e.scans.append((ws, cid)) or 0)
    monkeypatch.setattr(notif, "get_workspace_role_email", lambda _db, ws, _roles: f"approver@{ws}")
    monkeypatch.setattr(notif, "send_notification", lambda to, subject, _text: e.emails.append((to, subject)) or True)
    return e


@pytest.fixture()
def client(env, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (Workspace, IndustryConfig, CostCenter, WorkspaceNotification):
        model.__table__.create(engine)
    monkeypatch.setattr(cfg, "engine", engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    for ws, industry in ((WS_A, "retail"), (WS_B, "construction")):
        db.add(Workspace(id=ws, name=ws, legal_entity_name=ws, industry=industry))
    for ws, title in ((WS_A, "mine"), (WS_B, "theirs")):
        db.add(WorkspaceNotification(id=f"n-{title}", workspace_id=ws, type="ar_overdue", title=title))
    db.commit()
    db.close()

    app = FastAPI()
    app.include_router(cfg.router)
    app.include_router(notif.router)

    def _db():
        s = factory()
        try:
            yield s
        finally:
            s.close()

    env.db = factory
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[validate_workspace] = env.ctx
    return TestClient(app, raise_server_exceptions=False)


def _seed_cc(env, ws: str, company: str, code: str) -> str:
    db = env.db()
    row = CostCenter(id=f"cc-{code}", tenant_id=ws, company_id=company, name=code, code=code)
    db.add(row)
    db.commit()
    db.close()
    return f"cc-{code}"


# ── sign-in and membership ────────────────────────────────────────────────────


def test_every_route_is_swept():
    assert len(CFG_ENDPOINTS) == 8
    assert len(NOTIF_ENDPOINTS) == 5


@pytest.mark.parametrize(("method", "path"), CFG_ENDPOINTS + NOTIF_ENDPOINTS)
def test_anonymous_is_401(env, method, path):
    assert TestClient(main_app, raise_server_exceptions=False).request(method, path, json={}).status_code == 401
    assert env.scans == [] and env.emails == []


@pytest.mark.parametrize(("method", "path"), CFG_ENDPOINTS + NOTIF_ENDPOINTS)
def test_non_member_is_403(client, env, method, path):
    env.roles[WS_A] = None
    assert client.request(method, path, json={}).status_code == 403
    assert env.scans == [] and env.emails == []


@pytest.mark.parametrize(("method", "path"), [(m, p) for m, p in CFG_ENDPOINTS if m != "GET"])
def test_viewer_cannot_change_config(client, env, method, path):
    env.roles[WS_A] = "viewer"
    assert client.request(method, path, json={"name": "x", "industry": "retail"}).status_code == 403


def test_viewer_can_read_config_and_use_the_feed(client, env):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/config/industry").status_code == 200
    assert client.get("/api/config/cost-centers").status_code == 200
    assert client.get("/api/notifications").status_code == 200
    assert client.patch("/api/notifications/n-mine/read").json() == {"ok": True}
    assert client.post("/api/notifications/read-all").status_code == 200
    assert client.post("/api/notifications/scan").status_code == 200


# ── industry ──────────────────────────────────────────────────────────────────


def test_industry_is_read_from_own_workspace(client):
    assert client.get("/api/config/industry").json()["workspace_industry"] == "retail"
    assert client.get("/api/config/industry", params={"workspace_id": WS_B}).status_code == 403


@pytest.mark.parametrize("method", ["POST", "PATCH"])
def test_only_managers_change_industry(client, env, method):
    assert client.request(method, "/api/config/industry", json={"industry": "healthcare"}).status_code == 403
    env.roles[WS_A] = "owner"
    assert client.request(method, "/api/config/industry", json={"industry": "healthcare", "workspace_id": WS_B}).status_code == 403
    res = client.request(method, "/api/config/industry", json={"industry": "healthcare"})
    assert res.status_code == 200 and res.json()["workspace_industry"] == "healthcare"
    db = env.db()
    assert {w.id: w.industry for w in db.query(Workspace).all()} == {WS_A: "healthcare", WS_B: "construction"}
    db.close()


# ── cost centers ──────────────────────────────────────────────────────────────


def test_cost_centers_listed_per_workspace_and_company(client, env):
    _seed_cc(env, WS_A, WS_A, "HQ")
    _seed_cc(env, WS_A, CO_A, "SHOP")
    _seed_cc(env, WS_B, WS_B, "SITE")
    assert [r["code"] for r in client.get("/api/config/cost-centers").json()["items"]] == ["HQ"]
    assert [r["code"] for r in client.get("/api/config/cost-centers", params={"company_id": CO_A}).json()["items"]] == ["SHOP"]
    assert [r["code"] for r in client.get("/api/config/cost-centers", headers={"X-Company-Id": CO_A}).json()["items"]] == ["SHOP"]


@pytest.mark.parametrize(
    "kwargs",
    [{"params": {"company_id": CO_B}}, {"headers": {"X-Company-Id": CO_B}}, {"params": {"workspace_id": WS_B}}],
)
def test_cost_centers_of_another_workspace_are_refused(client, env, kwargs):
    _seed_cc(env, WS_B, CO_B, "SITE")
    assert client.get("/api/config/cost-centers", **kwargs).status_code == 403


def test_create_cost_center_scoped_to_caller(client, env):
    assert client.post("/api/config/cost-centers", json={"name": "Shop", "company_id": CO_B}).status_code == 403
    assert client.post("/api/config/cost-centers", json={"name": "Shop", "workspace_id": WS_B}).status_code == 403
    res = client.post("/api/config/cost-centers", json={"name": "Shop", "company_id": CO_A})
    assert res.status_code == 201, res.text
    assert (res.json()["tenant_id"], res.json()["company_id"]) == (WS_A, CO_A)


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
def test_cost_center_of_another_workspace_is_404(client, env, method):
    cc = _seed_cc(env, WS_B, WS_B, "SITE")
    assert client.request(method, f"/api/config/cost-centers/{cc}", json={"name": "x"}).status_code == 404
    assert client.request(method, f"/api/config/cost-centers/{cc}", params={"workspace_id": WS_B}, json={"name": "x"}).status_code == 403
    db = env.db()
    row = db.get(CostCenter, cc)
    assert (row.name, row.is_active) == ("SITE", True)
    db.close()


def test_own_cost_center_update_and_delete(client, env):
    cc = _seed_cc(env, WS_A, WS_A, "HQ")
    assert client.patch(f"/api/config/cost-centers/{cc}", json={"name": "Head office"}).json()["name"] == "Head office"
    assert client.delete(f"/api/config/cost-centers/{cc}").status_code == 200
    assert client.get("/api/config/cost-centers").json()["items"] == []


# ── notifications ─────────────────────────────────────────────────────────────


def test_feed_lists_and_scans_own_workspace_only(client, env):
    res = client.get("/api/notifications", headers={"X-Tenant-ID": WS_B, "X-Workspace-ID": WS_B})
    assert [n["title"] for n in res.json()["notifications"]] == ["mine"]
    client.post("/api/notifications/scan", params={"company_id": CO_A})
    assert env.scans == [(WS_A, None), (WS_A, CO_A)]


def test_feed_refuses_foreign_company(client, env):
    assert client.get("/api/notifications", params={"company_id": CO_B}).status_code == 403
    assert client.post("/api/notifications/scan", params={"company_id": CO_B}).status_code == 403
    assert env.scans == []


def test_marking_read_never_touches_other_workspace(client, env):
    assert client.patch("/api/notifications/n-theirs/read").json() == {"ok": False}
    assert client.post("/api/notifications/read-all").json() == {"marked_read": 1}
    db = env.db()
    assert {n.title: n.is_read for n in db.query(WorkspaceNotification).all()} == {"mine": True, "theirs": False}
    db.close()


def test_ap_upload_email_goes_to_own_approver_and_needs_write(client, env):
    body = {"vendor_name": "V", "total_amount": 10, "invoice_number": "I-1", "invoice_id": "i1"}
    env.roles[WS_A] = "viewer"
    assert client.post("/api/notifications/ap-invoice-uploaded", json=body).status_code == 403
    env.roles[WS_A] = "accountant"
    res = client.post("/api/notifications/ap-invoice-uploaded", json=body, headers={"X-Workspace-ID": WS_B})
    assert res.json()["to"] == f"approver@{WS_A}"
    assert [to for to, _ in env.emails] == [f"approver@{WS_A}"]
