"""AP payment runs: login + workspace membership required on both mounts, the workspace comes from
the validated context, and approve/reject need an owner or finance manager (never a role header)."""

from __future__ import annotations

import os
import re
from datetime import date
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.api.routes import ap_payment_run_routes, ap_payment_runs_alias
from app.core import company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.workspace import WorkspaceRole
from app.services import ap_payment_run_service as svc

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
CO_A = "cccccccc-0000-4000-8000-00000000000a"
ROUTERS = [ap_payment_run_routes.router, ap_payment_runs_alias.router]
BASES = ["/api/ap-invoices/payment-run", "/api/ap/payment-runs"]


class Env:
    def __init__(self):
        self.workspace = WS_A
        self.roles = {WS_A: "accountant", WS_B: "owner"}

    def ctx(self) -> WorkspaceContext:
        role = self.roles.get(self.workspace)
        return WorkspaceContext(
            workspace_id=self.workspace,
            workspace=SimpleNamespace(id=self.workspace),
            user=SimpleNamespace(id="user-1", email="a@example.com", role="user"),
            role=WorkspaceRole(role) if role else None,
        )


class FakeService:
    """Stand-in for the service layer: one run per workspace, every call records its workspace."""

    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.runs = {
            "run-a": SimpleNamespace(id="run-a", workspace_id=WS_A, company_id=CO_A, status="pending_approval",
                                     run_number="PR-A", created_by="maker@example.com"),
            "run-b": SimpleNamespace(id="run-b", workspace_id=WS_B, company_id=CO_A, status="pending_approval",
                                     run_number="PR-B", created_by="maker@example.com"),
        }

    def install(self, monkeypatch):
        def record(name):
            def fn(db=None, **kw):
                self.calls.append((name, kw.get("workspace_id")))
                return getattr(self, name)(**kw)
            return fn

        for name in ("list_runs", "list_eligible_invoices", "monthly_dashboard_stats",
                     "create_payment_run", "get_run"):
            monkeypatch.setattr(svc, name, record(name))
        monkeypatch.setattr(svc, "invoices_for_run", lambda db, run: [])
        monkeypatch.setattr(svc, "run_to_dict", lambda run, invs: dict(vars(run)))
        monkeypatch.setattr(svc, "default_due_window", lambda: (date(2026, 1, 1), date(2026, 12, 31)))
        monkeypatch.setattr(svc, "build_bank_file_csv", lambda db, run: "bank")
        monkeypatch.setattr(svc, "build_remittance_csv", lambda db, run: "remit")

        def transition(status, **fields):
            def fn(db, run, **kw):
                run.status = status
                for key, src in fields.items():
                    setattr(run, key, kw.get(src))
                return run
            return fn

        monkeypatch.setattr(svc, "submit_run", transition("pending_approval"))
        monkeypatch.setattr(svc, "approve_run", transition("approved", approved_by="approved_by"))
        monkeypatch.setattr(svc, "reject_run", transition("rejected", rejected_by="rejected_by"))
        monkeypatch.setattr(svc, "cancel_run", transition("cancelled", cancelled_by="cancelled_by"))
        monkeypatch.setattr(svc, "execute_run", transition("executed"))

    def list_runs(self, workspace_id, company_id, **_):
        return [r for r in self.runs.values() if r.workspace_id == workspace_id and r.company_id == company_id]

    def list_eligible_invoices(self, **_):
        return []

    def monthly_dashboard_stats(self, workspace_id, **_):
        return {"workspace_id": workspace_id}

    def create_payment_run(self, workspace_id, company_id, created_by, **_):
        run = SimpleNamespace(id="run-new", workspace_id=workspace_id, company_id=company_id,
                              status="draft", run_number="PR-N", created_by=created_by)
        self.runs[run.id] = run
        return run

    def get_run(self, run_id, workspace_id, company_id=None):
        run = self.runs.get(run_id)
        if run is None or run.workspace_id != workspace_id or (company_id and run.company_id != company_id):
            return None
        return run


@pytest.fixture()
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    return e


@pytest.fixture()
def fake(monkeypatch):
    f = FakeService()
    f.install(monkeypatch)
    return f


def _app(env: Env | None) -> FastAPI:
    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router)
    app.dependency_overrides[get_db] = lambda: None
    if env is not None:
        app.dependency_overrides[validate_workspace] = env.ctx
    return app


@pytest.fixture()
def client(env, fake):
    return TestClient(_app(env))


ROUTES = sorted({
    (method, re.sub(r"\{[^}]+\}", "run-a", route.path))
    for router in ROUTERS
    for route in router.routes
    if isinstance(route, APIRoute)
    for method in route.methods
})


def test_every_payment_run_route_is_covered():
    assert len(ROUTES) == 24


@pytest.mark.parametrize("method,path", ROUTES, ids=[f"{m} {p}" for m, p in ROUTES])
def test_routes_reject_requests_without_login(fake, method, path):
    res = TestClient(_app(None)).request(method, path, json={"reason": "x", "invoice_ids": ["i"], "company_id": CO_A})
    assert res.status_code == 401, res.text
    assert fake.calls == []


@pytest.mark.parametrize("base", BASES)
def test_non_members_get_403(client, env, base):
    env.roles[WS_A] = None
    assert client.get(base, params={"company_id": CO_A}).status_code == 403


@pytest.mark.parametrize("base", BASES)
def test_reads_use_the_validated_workspace_not_headers(client, fake, base):
    res = client.get(base, params={"company_id": CO_A},
                     headers={"X-Workspace-Id": WS_B, "X-Tenant-ID": WS_B})
    assert res.status_code == 200, res.text
    assert [r["id"] for r in res.json()["runs"]] == ["run-a"]
    assert client.get(f"{base}/run-b", headers={"X-Workspace-Id": WS_B}).status_code == 404
    assert {ws for _, ws in fake.calls} == {WS_A}


@pytest.mark.parametrize("path", ["", "/eligible", "/stats/monthly", "/run-a", "/run-a/bank-file"])
def test_query_workspace_of_another_tenant_is_refused(client, fake, path):
    res = client.get(BASES[0] + path, params={"workspace_id": WS_B, "company_id": CO_A})
    assert res.status_code == 403, res.text
    assert fake.calls == []


def test_create_ignores_body_workspace_and_header_actor(client, fake):
    body = {"invoice_ids": ["inv-1"], "company_id": CO_A}
    assert client.post(BASES[0], json={**body, "workspace_id": WS_B}).status_code == 403
    res = client.post(BASES[0], json=body, headers={"X-User-Email": "boss@example.com"})
    assert res.status_code == 200, res.text
    assert res.json()["workspace_id"] == WS_A
    assert res.json()["created_by"] == "a@example.com"


@pytest.mark.parametrize("action,body", [("approve", None), ("reject", {"reason": "no"})])
def test_role_header_does_not_let_accountants_approve(client, fake, action, body):
    res = client.post(f"{BASES[1]}/run-a/{action}", json=body,
                      headers={"X-User-Role": "cfo", "X-Product-Role": "full_access"})
    assert res.status_code == 403, res.text
    assert fake.runs["run-a"].status == "pending_approval"


def test_managers_approve_only_their_own_runs_as_themselves(client, env, fake):
    env.roles[WS_A] = "finance_manager"
    assert client.post(f"{BASES[0]}/run-b/approve", headers={"X-Workspace-Id": WS_B}).status_code == 404
    assert fake.runs["run-b"].status == "pending_approval"
    res = client.post(f"{BASES[0]}/run-a/approve", headers={"X-User-Email": "maker@example.com"})
    assert res.status_code == 200, res.text
    assert res.json()["approved_by"] == "a@example.com"


@pytest.mark.parametrize("action", ["submit", "cancel", "execute"])
def test_other_tenants_runs_cannot_be_actioned(client, fake, action):
    assert client.post(f"{BASES[0]}/run-b/{action}").status_code == 404
    assert fake.runs["run-b"].status == "pending_approval"
