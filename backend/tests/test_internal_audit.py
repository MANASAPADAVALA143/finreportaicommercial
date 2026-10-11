"""Internal Audit API: login, company isolation, role limits and dashboard maths."""

from __future__ import annotations

import os
from datetime import date, timedelta
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
from app.models.internal_audit import AuditEngagement, AuditFinding, AuditUniverse
from app.models.workspace import WorkspaceRole
from app.routers import internal_audit

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "aaaaaaaa-1111-4000-8000-000000000001"
CO_A2 = "aaaaaaaa-1111-4000-8000-000000000003"
CO_B = "bbbbbbbb-1111-4000-8000-000000000002"
COMPANY_WORKSPACE = {CO_A: WS_A, CO_A2: WS_A, CO_B: WS_B}

YESTERDAY = (date.today() - timedelta(days=1)).isoformat()
TOMORROW = (date.today() + timedelta(days=1)).isoformat()


class Env:
    def __init__(self):
        self.roles = {WS_A: "accountant"}
        self.user_role = "accountant"

    def ctx(self) -> WorkspaceContext:
        role = self.roles.get(WS_A)
        return WorkspaceContext(
            workspace_id=WS_A,
            workspace=SimpleNamespace(id=WS_A),
            user=SimpleNamespace(id="user-1", email="auditor@example.com", role=self.user_role),
            role=WorkspaceRole(role) if role else None,
        )


@pytest.fixture()
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(
        company_access, "_company_workspace_ids",
        lambda _db, cid: iter([COMPANY_WORKSPACE[cid]] if cid in COMPANY_WORKSPACE else []),
    )
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    return e


@pytest.fixture()
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (AuditUniverse, AuditEngagement, AuditFinding):
        model.__table__.create(engine)
    return sessionmaker(bind=engine)


def _app(env: Env | None, session_factory) -> FastAPI:
    app = FastAPI()
    app.include_router(internal_audit.router)

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


def q(company: str = CO_A) -> str:
    return f"?company_id={company}"


# ── Login ────────────────────────────────────────────────────────────────────

ROUTES = [
    ("GET", "/api/internal-audit/dashboard"),
    ("GET", "/api/internal-audit/universe"),
    ("POST", "/api/internal-audit/universe"),
    ("PUT", "/api/internal-audit/universe/1"),
    ("DELETE", "/api/internal-audit/universe/1"),
    ("GET", "/api/internal-audit/engagements"),
    ("POST", "/api/internal-audit/engagements"),
    ("PUT", "/api/internal-audit/engagements/1"),
    ("DELETE", "/api/internal-audit/engagements/1"),
    ("GET", "/api/internal-audit/findings"),
    ("POST", "/api/internal-audit/findings"),
    ("PUT", "/api/internal-audit/findings/1"),
    ("DELETE", "/api/internal-audit/findings/1"),
]


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_require_login(env, session_factory, method, path):
    res = TestClient(_app(None, session_factory)).request(
        method, path + q(), json={"title": "x", "unit_name": "x"}, headers={"X-Workspace-ID": WS_A}
    )
    assert res.status_code == 401, res.text


# ── Company isolation ────────────────────────────────────────────────────────


def test_universe_crud_in_own_company(client, env):
    res = client.post("/api/internal-audit/universe" + q(), json={"unit_name": "Accounts Payable", "department": ""})
    assert res.status_code == 201, res.text
    unit = res.json()
    assert unit["company_id"] == CO_A and unit["workspace_id"] == WS_A and unit["department"] is None

    res = client.put(f"/api/internal-audit/universe/{unit['id']}" + q(), json={"unit_name": "AP", "residual_risk": "High"})
    assert res.status_code == 200 and res.json()["residual_risk"] == "High"
    assert [u["unit_name"] for u in client.get("/api/internal-audit/universe" + q()).json()] == ["AP"]


def test_other_workspace_company_is_forbidden(client, env):
    assert client.get("/api/internal-audit/findings" + q(CO_B)).status_code == 403
    assert client.post("/api/internal-audit/universe" + q(CO_B), json={"unit_name": "x"}).status_code == 403


def test_company_id_is_required_and_validated(client, env):
    assert client.get("/api/internal-audit/universe").status_code == 422
    assert client.get("/api/internal-audit/universe?company_id=default").status_code == 422


def test_records_are_invisible_and_untouchable_from_sibling_company(client, env):
    unit = client.post("/api/internal-audit/universe" + q(CO_A), json={"unit_name": "Treasury"}).json()
    assert client.get("/api/internal-audit/universe" + q(CO_A2)).json() == []

    env.roles[WS_A] = "owner"
    assert client.put(f"/api/internal-audit/universe/{unit['id']}" + q(CO_A2), json={"unit_name": "x"}).status_code == 404
    assert client.delete(f"/api/internal-audit/universe/{unit['id']}" + q(CO_A2)).status_code == 404
    assert client.get("/api/internal-audit/universe" + q(CO_A)).json()[0]["unit_name"] == "Treasury"


def test_finding_cannot_link_to_another_companys_engagement(client, env):
    other = client.post("/api/internal-audit/engagements" + q(CO_A2), json={"title": "Payroll audit"}).json()
    res = client.post("/api/internal-audit/findings" + q(CO_A), json={"title": "x", "engagement_id": other["id"]})
    assert res.status_code == 422
    assert client.get("/api/internal-audit/findings" + q(CO_A)).json() == []


# ── Roles ────────────────────────────────────────────────────────────────────


def test_viewer_can_read_but_not_write(client, env):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/internal-audit/dashboard" + q()).status_code == 200
    assert client.post("/api/internal-audit/findings" + q(), json={"title": "x"}).status_code == 403


def test_delete_requires_manager_role(client, env):
    finding = client.post("/api/internal-audit/findings" + q(), json={"title": "Weak segregation"}).json()
    res = client.delete(f"/api/internal-audit/findings/{finding['id']}" + q())
    assert res.status_code == 403 and "accountant" in res.json()["detail"]

    env.roles[WS_A] = "finance_manager"
    assert client.delete(f"/api/internal-audit/findings/{finding['id']}" + q()).status_code == 204
    assert client.get("/api/internal-audit/findings" + q()).json() == []


# ── Validation, references and counts ────────────────────────────────────────


def test_invalid_enum_values_rejected(client, env):
    assert client.post("/api/internal-audit/findings" + q(), json={"title": "x", "risk_rating": "Huge"}).status_code == 422
    assert client.post("/api/internal-audit/engagements" + q(), json={"title": "x", "status": "Done"}).status_code == 422
    assert client.post("/api/internal-audit/universe" + q(), json={"unit_name": ""}).status_code == 422


def test_references_are_sequential_and_survive_deletes(client, env):
    year = date.today().year
    first = client.post("/api/internal-audit/engagements" + q(), json={"title": "One"}).json()
    second = client.post("/api/internal-audit/engagements" + q(), json={"title": "Two"}).json()
    assert (first["engagement_ref"], second["engagement_ref"]) == (f"IA-{year}-001", f"IA-{year}-002")

    env.roles[WS_A] = "owner"
    client.delete(f"/api/internal-audit/engagements/{first['id']}" + q())
    third = client.post("/api/internal-audit/engagements" + q(), json={"title": "Three"}).json()
    assert third["engagement_ref"] == f"IA-{year}-003"


def test_engagement_findings_count_tracks_create_move_and_delete(client, env):
    e1 = client.post("/api/internal-audit/engagements" + q(), json={"title": "E1"}).json()
    e2 = client.post("/api/internal-audit/engagements" + q(), json={"title": "E2"}).json()
    f = client.post("/api/internal-audit/findings" + q(), json={"title": "F", "engagement_id": e1["id"]}).json()
    client.post("/api/internal-audit/findings" + q(), json={"title": "G", "engagement_id": e1["id"]})

    counts = lambda: {e["title"]: e["findings_count"] for e in client.get("/api/internal-audit/engagements" + q()).json()}  # noqa: E731
    assert counts() == {"E1": 2, "E2": 0}

    client.put(f"/api/internal-audit/findings/{f['id']}" + q(), json={"title": "F", "engagement_id": e2["id"]})
    assert counts() == {"E1": 1, "E2": 1}

    env.roles[WS_A] = "owner"
    client.delete(f"/api/internal-audit/findings/{f['id']}" + q())
    assert counts() == {"E1": 1, "E2": 0}


def test_deleting_engagement_unlinks_its_findings(client, env):
    env.roles[WS_A] = "owner"
    e = client.post("/api/internal-audit/engagements" + q(), json={"title": "E"}).json()
    client.post("/api/internal-audit/findings" + q(), json={"title": "F", "engagement_id": e["id"]})
    assert client.delete(f"/api/internal-audit/engagements/{e['id']}" + q()).status_code == 204
    assert client.get("/api/internal-audit/findings" + q()).json()[0]["engagement_id"] is None


def test_dashboard_counts(client, env):
    post = lambda body, co=CO_A: client.post("/api/internal-audit/findings" + q(co), json=body)  # noqa: E731
    post({"title": "Overdue", "risk_rating": "High", "action_due_date": YESTERDAY})
    post({"title": "Due later", "risk_rating": "High", "action_due_date": TOMORROW, "status": "In Progress"})
    post({"title": "No date", "risk_rating": "Low", "action_due_date": ""})
    post({"title": "Fixed late", "risk_rating": "Critical", "action_due_date": YESTERDAY, "status": "Verified", "is_repeat": True})
    post({"title": "Sibling company", "action_due_date": YESTERDAY}, co=CO_A2)
    client.post("/api/internal-audit/engagements" + q(), json={"title": "E", "status": "Closed"})
    client.post("/api/internal-audit/universe" + q(), json={"unit_name": "U", "residual_risk": "High"})

    d = client.get("/api/internal-audit/dashboard" + q()).json()
    assert d["open_findings"] == 3
    assert d["overdue_actions"] == 1
    assert d["repeat_findings"] == 1
    assert d["findings_by_risk"] == {"High": 2, "Low": 1, "Critical": 1}
    assert d["engagements_by_status"] == {"Closed": 1}
    assert d["universe_by_risk"] == {"High": 1}
    assert {f["title"] for f in d["recent_open_findings"]} == {"Overdue", "Due later", "No date"}
