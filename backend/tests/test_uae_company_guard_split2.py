"""UAE full accounting, FX revaluation, FS validation, controls, account classification and CIT
return: a company_id in the query, X-Company-ID header or body must belong to a workspace the
caller can use, so nobody can read or tag rows with another tenant's company."""

from __future__ import annotations

import io
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

from app.api.routes import cit_return as cit
from app.api.routes import uae_account_classification as accounts
from app.api.routes import uae_controls_routes as controls
from app.api.routes import uae_fs_routes as fs
from app.api.routes import uae_full_routes as full
from app.core import company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "cccccccc-0000-4000-8000-00000000000a"
CO_B = "cccccccc-0000-4000-8000-00000000000b"

PERIOD = {"period_start": "2026-01-01", "period_end": "2026-12-31"}
ROUTERS = [full.router, full.fx_router, fs.router, controls.router, accounts.router, cit.router]


def _endpoints():
    for router in ROUTERS:
        for route in router.routes:
            path = re.sub(r"\{[^}]+\}", "x", route.path)
            for method in sorted(route.methods):
                yield method, path


ENDPOINTS = sorted(set(_endpoints()))


class Env:
    def __init__(self):
        self.roles = {WS_A: "owner", WS_B: None}

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
    return e


@pytest.fixture()
def calls(monkeypatch):
    seen: list[tuple] = []
    monkeypatch.setattr(fs, "validate_financial_statements", lambda _db, ws, cid, *_a: seen.append(("fs", cid)) or {"ok": True})
    monkeypatch.setattr(accounts, "classification_summary", lambda _db, ws, cid: seen.append(("summary", cid)) or {"total": 0})
    monkeypatch.setattr(controls.setup_svc, "save_controls", lambda _db, t, cid, data: seen.append(("controls", cid)) or data)
    monkeypatch.setattr(
        full,
        "import_journals_from_csv",
        lambda t, text, _db, company_id=None, auto_post=True: seen.append(("import", company_id))
        or {"imported": 1, "skipped": 0, "errors": [], "total_parsed": 1},
    )
    return seen


@pytest.fixture()
def client(env):
    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    factory = sessionmaker(bind=engine)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[validate_workspace] = env.ctx
    return TestClient(app, raise_server_exceptions=False)


def test_sweep_covers_every_module():
    prefixes = {p.split("/")[2] + "/" + p.split("/")[3] for _m, p in ENDPOINTS}
    assert prefixes == {"uae/full", "uae/fx", "uae/fs", "uae/controls", "uae/accounts", "gulftax/cit-return"}
    assert len(ENDPOINTS) >= 55


@pytest.mark.parametrize(("method", "path"), ENDPOINTS)
def test_foreign_company_in_query_is_refused(client, calls, method, path):
    assert client.request(method, path, params={"company_id": CO_B}).status_code == 403
    assert calls == []


@pytest.mark.parametrize(("method", "path"), ENDPOINTS)
def test_foreign_company_in_header_is_refused(client, calls, method, path):
    assert client.request(method, path, headers={"X-Company-ID": CO_B}).status_code == 403
    assert calls == []


@pytest.mark.parametrize(("method", "path"), [(m, p) for m, p in ENDPOINTS if m not in ("GET", "HEAD")])
def test_foreign_company_in_body_is_refused(client, calls, method, path):
    assert client.request(method, path, json={"company_id": CO_B}).status_code == 403
    assert calls == []


def test_fs_validate_own_company(client, calls):
    res = client.get("/api/uae/fs/validate", params={"company_id": CO_A, **PERIOD})
    assert res.status_code == 200, res.text
    assert calls == [("fs", CO_A)]


def test_classification_summary_own_company(client, calls):
    res = client.get("/api/uae/accounts/classification-summary", params={"company_id": CO_A})
    assert res.status_code == 200, res.text
    assert calls == [("summary", CO_A)]


def test_controls_update_own_company(client, calls):
    res = client.patch("/api/uae/controls", json={"company_id": CO_A, "allow_backdating": False})
    assert res.status_code == 200, res.text
    assert calls == [("controls", CO_A)]


def test_journal_csv_import_checks_query_company(client, calls):
    def upload(cid):
        files = {"file": ("je.csv", io.BytesIO(b"date,account,debit,credit\n"), "text/csv")}
        return client.post("/api/uae/full/journals/import", params={"company_id": cid}, files=files)

    assert upload(CO_B).status_code == 403
    assert calls == []
    res = upload(CO_A)
    assert res.status_code == 200, res.text
    assert calls == [("import", CO_A)]


def test_malformed_company_id_is_rejected(client, calls):
    assert client.get("/api/uae/accounts/classification-summary", params={"company_id": "demo"}).status_code == 422
    assert calls == []


def test_viewer_can_read_but_not_write(client, env, calls):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/uae/accounts/classification-summary", params={"company_id": CO_A}).status_code == 200
    assert client.patch("/api/uae/controls", json={"company_id": CO_A}).status_code == 403
    assert calls == [("summary", CO_A)]


def test_non_member_is_refused(client, env, calls):
    env.roles[WS_A] = None
    assert client.get("/api/uae/fs/validate", params=PERIOD).status_code == 403
    assert calls == []
