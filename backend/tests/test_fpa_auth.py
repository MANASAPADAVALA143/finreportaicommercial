"""FP&A calculators, variance, board pack, CFO dashboard, entity health, covenants, GL summary,
earnings reviewer and model builder: login + workspace membership; results are attributed to the
signed-in user, reviews and models stay inside the workspace that created them, CFO uploads never
replace the shared dashboard file, and connecting accounting software is platform-admin only."""

from __future__ import annotations

import io
import os
import re
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import (
    cfo_dashboard,
    covenant_tracker,
    entity_health,
    fpa_arr,
    fpa_headcount,
    fpa_monte_carlo,
    fpa_pvm,
    fpa_sensitivity,
    fpa_three_statement,
    fpa_variance,
    gl_summary,
    reports_board_pack,
)
from app.core import company_access
from app.core.database import Base, get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.earnings_review import EarningsReview
from app.models.financial_model import FinancialModel
from app.models.workspace import WorkspaceRole
from app.routers import earnings_review, model_builder

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"


class Env:
    def __init__(self):
        self.workspace = WS_A
        self.roles = {WS_A: "accountant", WS_B: None}
        self.platform_role = "user"

    def ctx(self) -> WorkspaceContext:
        role = self.roles.get(self.workspace)
        return WorkspaceContext(
            workspace_id=self.workspace,
            workspace=SimpleNamespace(id=self.workspace),
            user=SimpleNamespace(id="user-1", email="a@example.com", role=self.platform_role),
            role=WorkspaceRole(role) if role else None,
        )


@pytest.fixture()
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    monkeypatch.setattr(company_access, "_company_workspace_ids", lambda _db, cid: iter([]))
    return e


@pytest.fixture()
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[EarningsReview.__table__, FinancialModel.__table__])
    return sessionmaker(bind=engine)


PREFIXED = [
    (fpa_pvm.router, "/api/fpa"),
    (fpa_three_statement.router, "/api/fpa"),
    (fpa_monte_carlo.router, "/api/fpa"),
    (fpa_arr.router, "/api/fpa"),
    (fpa_headcount.router, "/api/fpa"),
    (fpa_sensitivity.router, "/api/fpa"),
    (fpa_variance.router, ""),
    (reports_board_pack.router, ""),
    (cfo_dashboard.router, ""),
    (entity_health.router, ""),
    (covenant_tracker.router, ""),
    (gl_summary.router, ""),
    (earnings_review.router, ""),
    (model_builder.router, ""),
]


def _app(factory, env: Env | None) -> FastAPI:
    app = FastAPI()
    for router, prefix in PREFIXED:
        app.include_router(router, prefix=prefix)

    def _db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


@pytest.fixture()
def client(factory, env):
    return TestClient(_app(factory, env))


ROUTES = [
    (method, prefix + re.sub(r"\{[^}]+\}", "1", route.path))
    for router, prefix in PREFIXED
    for route in router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
]


def test_every_route_is_covered():
    assert len(ROUTES) == 45


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(factory, method, path):
    res = TestClient(_app(factory, None)).request(method, path, json={})
    assert res.status_code == 401, res.text


# ─── FP&A calculators ──────────────────────────────────────────────────────────


@pytest.fixture()
def arr_store(monkeypatch):
    stored = []
    monkeypatch.setattr(fpa_arr, "store_fpa_result", lambda _db, module, _out, user_id=None: stored.append(user_id))
    monkeypatch.setattr(fpa_arr, "fpa_commentary", lambda *a, **k: "ok")
    return stored


def test_calculator_rejects_non_members(client, env, arr_store):
    env.workspace = WS_B
    res = client.post("/api/fpa/arr-dashboard", json={})
    assert res.status_code == 403
    assert arr_store == []


def test_calculator_allows_viewers_and_attributes_result_to_signed_in_user(client, env, arr_store):
    env.roles[WS_A] = "viewer"
    res = client.post("/api/fpa/arr-dashboard", json={"user_id": "someone-else"})
    assert res.status_code == 200, res.text
    assert arr_store == ["user-1"]


# ─── CFO dashboard ─────────────────────────────────────────────────────────────


def test_trial_balance_upload_does_not_replace_shared_dashboard_file(client, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    seen = []

    class _Parser:
        def __init__(self, path):
            seen.append(path)

        def calculate_dashboard_metrics(self):
            return {"revenue": 1}

    monkeypatch.setattr(cfo_dashboard, "TrialBalanceParser", _Parser)
    files = {"file": ("../trial_balance.csv", io.BytesIO(b"a,b\n1,2\n"), "text/csv")}
    res = client.post("/api/cfo/upload/trial-balance", files=files)
    assert res.status_code == 200, res.text
    assert res.json()["data"] == {"revenue": 1}
    assert list(tmp_path.iterdir()) == []
    assert not (tmp_path.parent / "trial_balance.csv").exists()
    assert seen and not os.path.exists(seen[0])


def test_financial_summary_csv_upload_works(client):
    csv = b"metric,value,date\nrevenue,100,2026-01-01\n"
    res = client.post("/api/cfo/upload/financial-summary", files={"file": ("s.csv", io.BytesIO(csv), "text/csv")})
    assert res.status_code == 200, res.text


def test_connect_accounting_software_is_platform_admin_only(client, env, monkeypatch):
    monkeypatch.delenv("XERO_ACCESS_TOKEN", raising=False)
    env.roles[WS_A] = "owner"
    res = client.post("/api/cfo/connect/accounting-software", params={"platform": "xero", "access_token": "tok"})
    assert res.status_code == 403
    assert "XERO_ACCESS_TOKEN" not in os.environ


# ─── Workspace comes from the validated context, not the raw header ───────────


def test_gl_summary_uses_validated_workspace(client, monkeypatch):
    seen = {}
    monkeypatch.setattr(gl_summary, "build_gl_summary", lambda _db, **kw: seen.update(kw) or {"ok": True})
    res = client.get("/api/integration/gl-summary", params={"company_id": "c1"}, headers={"X-Workspace-ID": WS_B})
    assert res.status_code == 200, res.text
    assert seen["workspace_id"] == WS_A


def test_gl_summary_rejects_other_workspace_id(client, monkeypatch):
    monkeypatch.setattr(gl_summary, "build_gl_summary", lambda _db, **kw: pytest.fail("must not run"))
    res = client.get("/api/integration/gl-summary", params={"company_id": "c1", "workspace_id": WS_B})
    assert res.status_code == 403


def test_entity_health_uses_validated_workspace(client, monkeypatch):
    from app.services import cfo_uae_data_service as uae_cfo

    seen = []
    monkeypatch.setattr(uae_cfo, "has_uae_data", lambda _db, ws: seen.append(ws) or False)
    res = client.get("/api/entity-health/summary", headers={"X-Workspace-ID": WS_B, "X-Tenant-ID": WS_B})
    assert res.status_code == 200, res.text
    assert seen == [WS_A]


# ─── Earnings reviewer ─────────────────────────────────────────────────────────


def _review(factory, ws: str | None, status: str = "started") -> str:
    db = factory()
    try:
        rid = f"rev-{ws or 'legacy'}"
        snap = {"current": {"revenue": 1}, "prior": {"revenue": 1}}
        if ws:
            snap["workspace_id"] = ws
        db.add(EarningsReview(review_id=rid, entity_id="e1", period="Q1", status=status, snapshot_json=snap))
        db.commit()
        return rid
    finally:
        db.close()


@pytest.fixture()
def no_s3(monkeypatch):
    try:
        import app.core.aws_config as aws
    except Exception:
        return
    monkeypatch.setattr(aws, "upload_to_s3", lambda *a, **k: None, raising=False)


def test_earnings_start_stamps_validated_workspace(client, factory, monkeypatch, no_s3):
    monkeypatch.setattr(earnings_review.LineItemParser, "parse_pl_to_metrics", staticmethod(lambda raw, fn: {"revenue": 1}))
    files = {
        "current_period_file": ("c.csv", io.BytesIO(b"x"), "text/csv"),
        "prior_period_file": ("p.csv", io.BytesIO(b"x"), "text/csv"),
    }
    res = client.post("/api/earnings/start", data={"entity_id": "e1", "period": "Q1"}, files=files,
                      headers={"X-Workspace-ID": WS_B})
    assert res.status_code == 200, res.text
    db = factory()
    try:
        assert db.get(EarningsReview, res.json()["review_id"]).snapshot_json["workspace_id"] == WS_A
    finally:
        db.close()


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/earnings/status/{rid}"),
    ("POST", "/api/earnings/run/{rid}"),
    ("POST", "/api/earnings/approve/{rid}"),
    ("GET", "/api/earnings/report/{rid}/pdf"),
])
def test_earnings_review_of_other_workspace_is_not_found(client, factory, method, path):
    rid = _review(factory, WS_B)
    res = client.request(method, path.format(rid=rid), json={"approver": "x"})
    assert res.status_code == 404


def test_earnings_review_without_owner_is_not_found(client, factory):
    rid = _review(factory, None)
    assert client.get(f"/api/earnings/status/{rid}").status_code == 404


def test_earnings_history_only_lists_own_workspace(client, factory):
    own = _review(factory, WS_A)
    _review(factory, WS_B)
    _review(factory, None)
    res = client.get("/api/earnings/history")
    assert res.status_code == 200
    assert [r["review_id"] for r in res.json()["reviews"]] == [own]


def test_earnings_approver_is_signed_in_user(client, factory):
    rid = _review(factory, WS_A)
    res = client.post(f"/api/earnings/approve/{rid}", json={"approver": "Someone Else"})
    assert res.status_code == 200, res.text
    assert res.json()["approved_by"] == "a@example.com"


def test_earnings_viewer_can_read_but_not_run(client, env, factory):
    rid = _review(factory, WS_A)
    env.roles[WS_A] = "viewer"
    assert client.get(f"/api/earnings/status/{rid}").status_code == 200
    assert client.post(f"/api/earnings/run/{rid}").status_code == 403


# ─── Model builder ─────────────────────────────────────────────────────────────


def _model(factory, ws: str | None, status: str = "started") -> str:
    db = factory()
    try:
        mid = f"mdl-{ws or 'legacy'}"
        trail = [{"at": "t", "action": "started", "detail": {"model_id": mid, **({"workspace_id": ws} if ws else {})}}]
        db.add(FinancialModel(model_id=mid, entity_id="e1", company_name="Co", base_year=2024, status=status,
                              model_json={"_inputs": {}}, audit_trail=trail))
        db.commit()
        return mid
    finally:
        db.close()


def test_model_start_stamps_validated_workspace(client, factory, monkeypatch, no_s3):
    monkeypatch.setattr(model_builder.eng, "parse_historical_pl", lambda raw, fn: {"rows": []})
    monkeypatch.setattr(model_builder.eng, "parse_historical_bs", lambda raw, fn: {"rows": []})
    files = {
        "historical_pl_file": ("pl.csv", io.BytesIO(b"x"), "text/csv"),
        "historical_bs_file": ("bs.csv", io.BytesIO(b"x"), "text/csv"),
    }
    res = client.post("/api/model/start", data={"entity_id": "e1", "company_name": "Co", "assumptions_json": "{}"},
                      files=files, headers={"X-Workspace-ID": WS_B})
    assert res.status_code == 200, res.text
    mid = res.json()["model_id"]
    db = factory()
    try:
        assert model_builder._model_workspace(db.get(FinancialModel, mid)) == WS_A
    finally:
        db.close()
    assert client.get(f"/api/model/status/{mid}").status_code == 200


@pytest.mark.parametrize("method,path", [
    ("POST", "/api/model/build/{mid}"),
    ("GET", "/api/model/status/{mid}"),
    ("GET", "/api/model/output/{mid}"),
    ("POST", "/api/model/approve/{mid}"),
    ("GET", "/api/model/report/{mid}/pdf"),
    ("GET", "/api/model/export/{mid}/excel"),
])
def test_model_of_other_workspace_is_not_found(client, factory, method, path):
    mid = _model(factory, WS_B, status="complete")
    res = client.request(method, path.format(mid=mid), json={"approver": "x"})
    assert res.status_code == 404


def test_model_without_owner_is_not_found(client, factory):
    mid = _model(factory, None)
    assert client.get(f"/api/model/status/{mid}").status_code == 404


def test_model_owner_survives_build_and_history_is_scoped(client, factory):
    own = _model(factory, WS_A)
    _model(factory, WS_B)
    res = client.post(f"/api/model/build/{own}")
    assert res.status_code == 400  # inputs missing, but ownership check passed
    res = client.get("/api/model/history")
    assert [r["model_id"] for r in res.json()["items"]] == [own]


def test_model_approver_is_signed_in_user(client, factory):
    mid = _model(factory, WS_A)
    res = client.post(f"/api/model/approve/{mid}", json={"approver": "Someone Else"})
    assert res.status_code == 200, res.text
    assert res.json()["approved_by"] == "a@example.com"
