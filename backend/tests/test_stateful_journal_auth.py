"""Stateful R2R (/api/companies, /api/analyze, /api/feedback, /api/companies/{id}/profile): sign-in and
workspace membership required, and companies, their journal history and learned profiles stay with
the workspace that created them."""

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

from app.api.routes import stateful_journal as sj
from app.core import company_access
from app.core.database import get_db
from app.db.models import Company, CompanyProfile, JournalHistory, ScoringResult
from app.main import app as main_app
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"

ENDPOINTS = sorted(
    (method, re.sub(r"\{[^}]+\}", "x", route.path))
    for route in sj.router.routes
    for method in route.methods
)

CSV = b"id,date,account,description,debit,credit,preparer\nJE1,2025-01-05,4000,Sale,100,0,alice\n"


class Env:
    def __init__(self):
        self.roles = {WS_A: "accountant", WS_B: None}
        self.baselines: list[str] = []

    def ctx(self) -> WorkspaceContext:
        return WorkspaceContext(
            workspace_id=WS_A,
            workspace=SimpleNamespace(id=WS_A),
            user=SimpleNamespace(id="user-1", email="a@example.com", role="user"),
            role=WorkspaceRole(self.roles[WS_A]) if self.roles[WS_A] else None,
        )


def _score(entry, company_id, _entries, _db):
    return {"journal_id": entry["journal_id"], "final_score": 10, "risk_level": "LOW", "ml_score": 0,
            "stat_score": 0, "rules_score": 0, "rule_flags": []}


@pytest.fixture()
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    monkeypatch.setattr(sj, "recalculate_company_baseline", lambda cid, _db: e.baselines.append(cid))
    monkeypatch.setattr(sj, "score_entry_against_company_baseline", _score)
    return e


@pytest.fixture()
def client(env):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (Company, CompanyProfile, JournalHistory, ScoringResult):
        model.__table__.create(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    db.add_all([
        Company(id="client_a", name="Alpha", workspace_id=WS_A),
        Company(id="client_b", name="Beta", workspace_id=WS_B),
        Company(id="client_legacy", name="Legacy", workspace_id=None),
        CompanyProfile(company_id="client_b", account="4000", avg_amount=5, p95_amount=9),
        ScoringResult(company_id="client_b", journal_id="JE9"),
    ])
    db.commit()
    db.close()

    app = FastAPI()
    app.include_router(sj.router)

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


def _analyze(client, company_id):
    return client.post("/api/analyze", data={"company_id": company_id}, files={"file": ("je.csv", CSV, "text/csv")})


def test_every_route_is_swept():
    assert len(ENDPOINTS) == 5


@pytest.mark.parametrize(("method", "path"), ENDPOINTS)
def test_anonymous_is_401(method, path):
    assert TestClient(main_app, raise_server_exceptions=False).request(method, path).status_code == 401


@pytest.mark.parametrize(("method", "path"), ENDPOINTS)
def test_non_member_is_403(client, env, method, path):
    env.roles[WS_A] = None
    assert client.request(method, path).status_code == 403


def test_viewer_reads_but_cannot_write(client, env):
    env.roles[WS_A] = "viewer"
    assert client.get("/api/companies").status_code == 200
    assert client.get("/api/companies/client_a/profile").status_code == 200
    assert client.post("/api/companies", params={"name": "X"}).status_code == 403
    assert _analyze(client, "client_a").status_code == 403
    assert client.post("/api/feedback", params={"company_id": "client_a", "journal_id": "JE1", "is_real": True}).status_code == 403


def test_companies_listed_per_workspace(client):
    assert [c["id"] for c in client.get("/api/companies").json()] == ["client_a"]
    new_id = client.post("/api/companies", params={"name": "Gamma"}).json()["company_id"]
    assert [c["id"] for c in client.get("/api/companies").json()] == ["client_a", new_id]


@pytest.mark.parametrize("company_id", ["client_b", "client_legacy", "missing"])
def test_other_workspace_company_is_404(client, env, company_id):
    assert _analyze(client, company_id).status_code == 404
    assert client.get(f"/api/companies/{company_id}/profile").status_code == 404
    fb = {"company_id": company_id, "journal_id": "JE9", "is_real": True}
    assert client.post("/api/feedback", params=fb).status_code == 404
    db = env.db()
    assert db.query(JournalHistory).count() == 0
    assert db.query(ScoringResult).filter_by(company_id="client_b").one().user_label is None
    db.close()
    assert env.baselines == []


def test_own_company_analyze_and_feedback(client, env):
    res = _analyze(client, "client_a")
    assert res.status_code == 200, res.text
    assert res.json()["total"] == 1 and env.baselines == ["client_a"]
    fb = {"company_id": "client_a", "journal_id": "JE1", "is_real": True, "reviewed_by": "someone-else"}
    assert client.post("/api/feedback", params=fb).status_code == 200
    db = env.db()
    row = db.query(ScoringResult).filter_by(company_id="client_a").one()
    assert (row.user_label, row.reviewed_by) == (True, "a@example.com")
    db.close()
