"""ERP connections (/api/connections, Supabase) and the Tally gateway (/api/erp): sign-in and workspace
membership required, connections stay with the workspace that created them, and on Render the server
refuses to dial loopback/private Tally hosts."""

from __future__ import annotations

import os
import re
import socket
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import erp_connections as conn_routes
from app.api.routes import erp_integration as erp
from app.core import company_access
from app.core.database import get_db
from app.main import app as main_app
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.connector_client import ConnectorClient
from app.models.ifrs_statement import ERPConnection, TallySyncLog
from app.models.workspace import WorkspaceRole
from app.services import tally_service

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"


def _sweep(router, prefix: str = ""):
    return sorted(
        (method, prefix + re.sub(r"\{[^}]+\}", "1", route.path))
        for route in router.routes
        for method in route.methods
    )


CONN_ENDPOINTS = _sweep(conn_routes.router)
ERP_ENDPOINTS = [(m, p) for m, p in _sweep(erp.router, "/api") if not p.endswith("/connector-sync")]


# ── fakes ─────────────────────────────────────────────────────────────────────


class FakeTable:
    """Just enough of the supabase-py query builder for erp_connections / sync_logs."""

    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.filters: list[tuple[str, str]] = []
        self.op = "select"
        self.payload: dict | None = None

    def _value(self, row: dict, col: str):
        if col.startswith("config->>"):
            return str((row.get("config") or {}).get(col.split("->>", 1)[1]))
        return row.get(col)

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def execute(self):
        if self.op == "insert":
            row = {"id": f"conn-{len(self.rows) + 1}", "api_key": "k", "is_active": True, **self.payload}
            self.rows.append(row)
            return SimpleNamespace(data=[row])
        hits = [r for r in self.rows if all(str(self._value(r, c)) == str(v) for c, v in self.filters)]
        if self.op == "update":
            for r in hits:
                r.update(self.payload)
        return SimpleNamespace(data=hits)


class FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "erp_connections": [
                {"id": "conn-a", "erp_type": "tally", "is_active": True, "tally_server_ip": "203.0.113.5",
                 "config": {"server_ip": "203.0.113.5", "workspace_id": WS_A}},
                {"id": "conn-b", "erp_type": "tally", "is_active": True, "tally_server_ip": "203.0.113.6",
                 "config": {"server_ip": "203.0.113.6", "workspace_id": WS_B}},
                {"id": "conn-legacy", "erp_type": "zoho", "is_active": True, "config": {"org_id": "1"}},
            ],
            "sync_logs": [{"connection_id": "conn-a", "status": "completed"}],
        }

    def table(self, name):
        return FakeTable(self.tables.setdefault(name, []))


class FakeTally:
    dialled: list[str] = []

    def __init__(self, host="localhost", port=9000):
        self.host = host
        FakeTally.dialled.append(host)

    def test_connection(self):
        return {"connected": True, "companies": ["Acme"], "tally_version": "TP4"}


class FakeSync:
    def __init__(self):
        self.synced: list[str] = []

    async def sync_tally(self, conn):
        self.synced.append(conn["id"])
        return {"invoices": 0}

    async def sync_zoho(self, conn):
        self.synced.append(conn["id"])
        return {"invoices": 0}


ADDRS = {
    "tally.example.com": "8.8.8.8",
    "localhost": "127.0.0.1",
    "127.0.0.1": "127.0.0.1",
    "intranet": "10.0.0.5",
    "meta": "169.254.169.254",
}


def _fake_getaddrinfo(host, *_a, **_k):
    if host not in ADDRS:
        raise socket.gaierror("unknown")
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ADDRS[host], 0))]


# ── fixtures ──────────────────────────────────────────────────────────────────


class Env:
    def __init__(self):
        self.roles = {WS_A: "accountant", WS_B: None}

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
    e.sb = FakeSupabase()
    e.sync = FakeSync()
    FakeTally.dialled = []
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    monkeypatch.setattr(company_access, "_company_workspace_ids", lambda _db, _cid: iter([]))
    monkeypatch.setattr(conn_routes, "get_supabase", lambda: e.sb)
    monkeypatch.setattr(conn_routes, "_sync", e.sync)
    monkeypatch.setattr(tally_service, "TallyService", FakeTally)
    monkeypatch.setattr(erp, "TallyService", FakeTally)
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo)
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("ALLOW_PRIVATE_ERP_HOSTS", raising=False)
    return e


@pytest.fixture()
def client(env):
    app = FastAPI()
    app.include_router(conn_routes.router)
    app.include_router(erp.router, prefix="/api")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (ERPConnection, TallySyncLog, ConnectorClient):
        model.__table__.create(engine, checkfirst=True)
    factory = sessionmaker(bind=engine)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    env.db = factory
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[validate_workspace] = env.ctx
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def on_render(monkeypatch):
    monkeypatch.setenv("RENDER", "true")


# ── sign-in and membership ────────────────────────────────────────────────────


def test_every_route_is_swept():
    assert len(CONN_ENDPOINTS) == 8
    assert len(ERP_ENDPOINTS) == 8


@pytest.mark.parametrize(("method", "path"), CONN_ENDPOINTS + ERP_ENDPOINTS)
def test_anonymous_is_401(env, method, path):
    res = TestClient(main_app, raise_server_exceptions=False).request(method, path, json={})
    assert res.status_code == 401
    assert FakeTally.dialled == [] and env.sync.synced == []


@pytest.mark.parametrize(("method", "path"), CONN_ENDPOINTS + ERP_ENDPOINTS)
def test_non_member_is_403(client, env, method, path):
    env.roles[WS_A] = None
    assert client.request(method, path, json={}).status_code == 403
    assert FakeTally.dialled == [] and env.sync.synced == []


@pytest.mark.parametrize(("method", "path"), [(m, p) for m, p in CONN_ENDPOINTS + ERP_ENDPOINTS if m != "GET"])
def test_viewer_cannot_write(client, env, method, path):
    env.roles[WS_A] = "viewer"
    assert client.request(method, path, json={}).status_code == 403


def test_viewer_can_list(client, env):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/connections/status").status_code == 200
    assert client.get("/api/erp/connections").status_code == 200


def test_foreign_tenant_header_is_refused(client):
    assert client.get("/api/erp/connections", headers={"X-Tenant-ID": WS_B}).status_code == 403


# ── /api/connections (Supabase) ───────────────────────────────────────────────


def test_status_lists_only_own_workspace(client):
    ids = [c["id"] for c in client.get("/api/connections/status").json()["connections"]]
    assert ids == ["conn-a"]


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/connections/tally/sync/conn-b"),
        ("POST", "/api/connections/zoho/sync/conn-b"),
        ("GET", "/api/connections/logs/conn-b"),
        ("DELETE", "/api/connections/conn-b"),
        ("DELETE", "/api/connections/conn-legacy"),
    ],
)
def test_other_workspace_connection_is_404(client, env, method, path):
    assert client.request(method, path).status_code == 404
    assert env.sync.synced == []
    assert all(r["is_active"] for r in env.sb.tables["erp_connections"])


def test_own_connection_sync_logs_and_delete(client, env):
    assert client.post("/api/connections/tally/sync/conn-a").status_code == 200
    assert env.sync.synced == ["conn-a"]
    assert client.get("/api/connections/logs/conn-a").json()["logs"] == [{"connection_id": "conn-a", "status": "completed"}]
    assert client.delete("/api/connections/conn-a").status_code == 200
    active = {r["id"]: r["is_active"] for r in env.sb.tables["erp_connections"]}
    assert active == {"conn-a": False, "conn-b": True, "conn-legacy": True}


def test_new_tally_connection_is_stamped_with_workspace(client, env):
    body = {"client_name": "Acme", "server_ip": "tally.example.com", "company_name": "Acme"}
    res = client.post("/api/connections/tally/connect", json=body)
    assert res.status_code == 200, res.text
    assert env.sb.tables["erp_connections"][-1]["config"]["workspace_id"] == WS_A
    assert [c["id"] for c in client.get("/api/connections/status").json()["connections"]] == ["conn-a", res.json()["connection_id"]]


# ── /api/erp (SQL) ────────────────────────────────────────────────────────────


def _seed_erp(env, tenant: str) -> int:
    db = env.db()
    row = ERPConnection(tenant_id=tenant, connection_name="x", tally_host="tally.example.com", tally_company_name="Acme")
    db.add(row)
    db.commit()
    rid = row.id
    db.close()
    return rid


def test_erp_connections_are_per_workspace(client, env):
    mine = _seed_erp(env, WS_A)
    _seed_erp(env, WS_B)
    _seed_erp(env, "default")
    assert [c["id"] for c in client.get("/api/erp/connections").json()["connections"]] == [mine]


def test_erp_other_workspace_connection_is_404(client, env):
    theirs = _seed_erp(env, WS_B)
    assert client.delete(f"/api/erp/connections/{theirs}").status_code == 404
    body = {"connection_id": theirs, "period_from": "2025-04-01", "period_to": "2026-03-31"}
    assert client.post("/api/erp/tally/import-tb", json=body).status_code == 404
    assert FakeTally.dialled == []


def test_erp_save_connection_uses_workspace_tenant(client, env):
    body = {"connection_name": "HQ", "tally_host": "tally.example.com", "tally_company_name": "Acme"}
    assert client.post("/api/erp/tally/connect", json=body).status_code == 200
    db = env.db()
    assert [r.tenant_id for r in db.query(ERPConnection).all()] == [WS_A]
    db.close()


def test_connector_sync_still_uses_api_key_without_sign_in(client, monkeypatch):
    def _anon():
        raise HTTPException(status_code=401)

    client.app.dependency_overrides[validate_workspace] = _anon
    monkeypatch.setenv("TALLY_CONNECTOR_BYPASS_KEY", "bypass-key-123")
    body = {"entity_id": "e1", "company_name": "Acme", "fiscal_year": "2025", "period_from": "2025-04-01",
            "period_to": "2026-03-31", "gl_rows": []}
    assert client.post("/api/erp/tally/connector-sync", json=body).status_code == 401
    res = client.post("/api/erp/tally/connector-sync", json=body, headers={"X-API-Key": "bypass-key-123"})
    assert res.status_code == 400 and res.json()["detail"] == "gl_rows is empty"


# ── outbound host check ───────────────────────────────────────────────────────

PRIVATE = ["localhost", "intranet", "meta", "127.0.0.1", "nope.invalid", ""]
DIAL_ROUTES = [
    ("POST", "/api/erp/tally/test-connection", lambda h: {"host": h}),
    ("POST", "/api/erp/tally/connect", lambda h: {"connection_name": "x", "tally_host": h, "tally_company_name": "A"}),
    ("POST", "/api/erp/tally/quick-import",
     lambda h: {"host": h, "company_name": "A", "period_from": "2025-04-01", "period_to": "2026-03-31"}),
    ("POST", "/api/connections/tally/connect", lambda h: {"client_name": "x", "server_ip": h, "company_name": "A"}),
    ("GET", "/api/connections/tally/companies", None),
]


def _dial(client, method, path, body, host):
    if body is None:
        return client.request(method, path, params={"server_ip": host})
    return client.request(method, path, json=body(host))


@pytest.mark.parametrize("host", PRIVATE)
@pytest.mark.parametrize(("method", "path", "body"), DIAL_ROUTES)
def test_private_tally_host_refused_on_render(client, on_render, method, path, body, host):
    assert _dial(client, method, path, body, host).status_code == 400
    assert FakeTally.dialled == []


@pytest.mark.parametrize(("method", "path", "body"), DIAL_ROUTES)
def test_public_tally_host_allowed_on_render(client, on_render, method, path, body):
    _dial(client, method, path, body, "tally.example.com")
    assert FakeTally.dialled == ["tally.example.com"]


def test_saved_private_host_refused_on_render(client, env, on_render):
    db = env.db()
    row = ERPConnection(tenant_id=WS_A, connection_name="x", tally_host="localhost", tally_company_name="Acme")
    db.add(row)
    db.commit()
    rid = row.id
    db.close()
    body = {"connection_id": rid, "period_from": "2025-04-01", "period_to": "2026-03-31"}
    assert client.post("/api/erp/tally/import-tb", json=body).status_code == 400
    env.sb.tables["erp_connections"][0]["config"]["server_ip"] = "localhost"
    assert client.post("/api/connections/tally/sync/conn-a").status_code == 400
    assert FakeTally.dialled == [] and env.sync.synced == []


def test_private_hosts_allowed_locally_and_by_override(client, monkeypatch):
    assert client.post("/api/erp/tally/test-connection", json={"host": "localhost"}).status_code == 200
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("ALLOW_PRIVATE_ERP_HOSTS", "true")
    assert client.post("/api/erp/tally/test-connection", json={"host": "localhost"}).status_code == 200
    assert FakeTally.dialled == ["localhost", "localhost"]
