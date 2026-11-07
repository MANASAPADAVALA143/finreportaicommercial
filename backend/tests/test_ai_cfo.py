"""AI CFO agentic layer: ledger maths, detection, tools, agent loop, API scoping and approvals."""

from __future__ import annotations

import os
from datetime import date
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
from app.models.ai_cfo import AiCfoApprovalRequest, AiCfoFinding, AiCfoInvestigation, AiCfoToolCall
from app.models.client_data import ApCompany
from app.models.company_setup import UaeCompanyProfile
from app.models.fpa_master import FpaMasterRow
from app.models.uae_accounting_full import UAEAccount, UAEJournalEntry, UAEJournalLine
from app.models.workspace import WorkspaceRole
from app.models.workspace_audit import WorkspaceAuditLog
from app.routers import ai_cfo as ai_cfo_router
from app.services import llm_service
from app.services.ai_cfo import agent as ai_agent
from app.services.ai_cfo import ledger, tools
from app.services.ai_cfo.demo import seed_demo_company
from app.services.ai_cfo.detection import run_detection
from app.services.ai_cfo.forecast import months_to_fiscal_year_end, project_expense_impact
from app.services.ai_cfo.ledger import LedgerScope

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
TODAY = date(2026, 11, 4)
LAST = "2026-10"
LAST_FACTOR = 0.97  # demo.VARIATION repeats every six months; the seventh month uses its first value
BASE = "/api/ai-cfo"
TABLES = (
    UAEAccount, UAEJournalEntry, UAEJournalLine, UaeCompanyProfile, ApCompany, FpaMasterRow,
    AiCfoFinding, AiCfoInvestigation, AiCfoToolCall, AiCfoApprovalRequest, WorkspaceAuditLog,
)


class Env:
    def __init__(self):
        self.roles = {WS_A: "accountant"}

    def ctx(self) -> WorkspaceContext:
        role = self.roles.get(WS_A)
        return WorkspaceContext(
            workspace_id=WS_A,
            workspace=SimpleNamespace(id=WS_A),
            user=SimpleNamespace(id="user-1", email="cfo@example.com", role="accountant"),
            role=WorkspaceRole(role) if role else None,
        )


@pytest.fixture()
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in TABLES:
        model.__table__.create(engine)
    return sessionmaker(bind=engine)


@pytest.fixture()
def demo(session_factory):
    db = session_factory()
    a = seed_demo_company(db, WS_A, today=TODAY)
    b = seed_demo_company(db, WS_B, today=TODAY)
    db.close()
    return SimpleNamespace(a=a["company_id"], b=b["company_id"], info=a)


@pytest.fixture()
def env(monkeypatch):
    e = Env()

    def workspaces(db, cid):
        profile = db.get(UaeCompanyProfile, cid)
        return iter([profile.workspace_id] if profile else [])

    monkeypatch.setattr(company_access, "_company_workspace_ids", workspaces)
    monkeypatch.setattr(company_access, "_workspace_role", lambda _db, _ctx, ws: e.roles.get(ws))
    return e


@pytest.fixture()
def client(env, session_factory, monkeypatch):
    app = FastAPI()
    app.include_router(ai_cfo_router.router)

    def _db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[validate_workspace] = env.ctx
    monkeypatch.setattr(ai_cfo_router, "session_factory", session_factory)
    return TestClient(app)


def q(cid: str) -> str:
    return f"?company_id={cid}"


# ── Ledger maths ─────────────────────────────────────────────────────────────


def test_balances_are_cumulative_and_monthly_movements_are_not(session_factory, demo):
    db = session_factory()
    scope = LedgerScope(WS_A, demo.a)
    rent_month = [m for m in ledger.monthly_movements(db, scope, LAST, LAST) if m["account_code"] == "7110"]
    rent_total = [b for b in ledger.balances_as_of(db, scope, LAST) if b["account_code"] == "7110"]
    assert rent_month[0]["net"] == pytest.approx(35000 * LAST_FACTOR)
    assert rent_total[0]["balance"] == pytest.approx(35000 * sum([0.97, 1.02, 0.99, 1.03, 0.98, 1.01, 0.97]), abs=0.05)
    revenue = [b for b in ledger.balances_as_of(db, scope, LAST, account_type="Income")]
    assert revenue and revenue[0]["balance"] > 0
    bank = [b for b in ledger.balances_as_of(db, scope, LAST) if b["account_code"] == "1002"][0]
    expenses = sum(b["balance"] for b in ledger.balances_as_of(db, scope, LAST, account_type="Expense"))
    assert bank["balance"] == pytest.approx(revenue[0]["balance"] - expenses, abs=0.05)
    db.close()


def test_ledger_reads_only_the_exact_company(session_factory, demo):
    db = session_factory()
    db.add(UAEJournalEntry(
        tenant_id=WS_A, company_id=None, period=LAST, entry_date=date(2026, 10, 3), status="posted",
        source="manual", lines=[UAEJournalLine(account_code="7140", debit=999999, credit=0)],
    ))
    db.commit()
    scope = LedgerScope(WS_A, demo.a)
    fees = [m for m in ledger.monthly_movements(db, scope, LAST, LAST) if m["account_code"] == "7140"][0]
    assert fees["net"] == pytest.approx(9500 * LAST_FACTOR + 68000)
    cov = ledger.coverage(db, scope)
    assert cov["unassigned_workspace_lines"] == 1 and any("no company" in m for m in cov["limitations"])
    assert ledger.coverage(db, LedgerScope(WS_A, demo.b))["posted_lines"] == 0
    db.close()


def test_forecast_projection():
    hist = {"2026-07": 10000.0, "2026-08": 10000.0, "2026-09": 10000.0, "2026-10": 40000.0}
    r = project_expense_impact(hist, "2026-10", 2)
    assert r["baseline_monthly"] == 10000 and r["increase_this_month"] == 30000
    assert r["scenarios"]["one_time"]["operating_profit_impact_this_year"] == -30000
    assert r["scenarios"]["recurring"]["additional_cost_over_horizon"] == 60000
    assert r["scenarios"]["recurring"]["operating_profit_impact_this_year"] == -90000
    assert months_to_fiscal_year_end("2026-10", 1) == 2
    assert months_to_fiscal_year_end("2026-03", 4) == 0
    assert months_to_fiscal_year_end("2026-04", 4) == 11


# ── Detection ────────────────────────────────────────────────────────────────


def test_detection_finds_planted_anomalies_and_reruns_idempotently(session_factory, demo):
    db = session_factory()
    scope = LedgerScope(WS_A, demo.a)
    result = run_detection(db, scope)
    assert result["period"] == LAST and len(result["history_periods"]) == 6
    kinds = {(f.kind, f.account_code) for f in result["findings"]}
    assert ("expense_spike", "7140") in kinds
    assert ("duplicate_entry", "7120") in kinds
    assert ("budget_overrun", "7150") in kinds
    assert ("expense_spike", "7110") not in kinds
    spike = next(f for f in result["findings"] if f.kind == "expense_spike" and f.account_code == "7140")
    assert spike.severity == "high" and spike.amount > 60000
    assert spike.evidence_refs[0]["ref"] == f"DEMO-JE-{LAST}-20"

    spike.status = "dismissed"
    db.commit()
    again = run_detection(db, scope)
    assert again["created"] == 0
    assert db.query(AiCfoFinding).filter_by(workspace_id=WS_A).count() == len(result["findings"])
    assert db.get(AiCfoFinding, spike.id).status == "dismissed"
    db.close()


def test_detection_without_data_reports_limitation(session_factory):
    db = session_factory()
    result = run_detection(db, LedgerScope(WS_A, "00000000-0000-4000-8000-0000000000ff"))
    assert result["period"] is None and result["findings"] == [] and result["limitations"]
    db.close()


# ── Tools ────────────────────────────────────────────────────────────────────


def _ctx(db, company: str, workspace: str = WS_A) -> tools.ToolContext:
    inv = AiCfoInvestigation(workspace_id=workspace, company_id=company, agent="cfo_analyst", question="q", status="running")
    db.add(inv)
    db.flush()
    return tools.ToolContext(db=db, scope=LedgerScope(workspace, company), investigation=inv, user_email="cfo@example.com")


def test_tools_validate_input_and_stay_in_scope(session_factory, demo):
    db = session_factory()
    ctx = _ctx(db, demo.a)
    for name, args in [
        ("get_transactions", {"account_code": "7140", "period": "2026-13"}),
        ("get_transactions", {"period": LAST}),
        ("compare_periods", {"period": LAST, "lookback_months": 40}),
        ("get_account_movements", {"period_from": "2020-01", "period_to": LAST}),
        ("prepare_approval_request", {"action_type": "pay_vendor", "title": "x", "rationale": "y"}),
    ]:
        with pytest.raises(tools.ToolInputError):
            tools.TOOLS[name].handler(ctx, args)
    tx = tools.TOOLS["get_transactions"].handler(ctx, {"account_code": "7140", "period": LAST, "limit": 3})
    assert tx["transactions"][0]["ref"] == f"DEMO-JE-{LAST}-20" and tx["account_total"] == pytest.approx(9500 * LAST_FACTOR + 68000)
    other = _ctx(db, demo.a, workspace=WS_B)
    assert tools.TOOLS["get_transactions"].handler(other, {"account_code": "7140", "period": LAST})["transactions"] == []
    db.close()


def test_recurrence_and_budget_tools(session_factory, demo):
    db = session_factory()
    ctx = _ctx(db, demo.a)
    rec = tools.TOOLS["check_recurrence"].handler(ctx, {"account_code": "7140", "period": LAST})
    by_desc = {t["description"]: t["classification"] for t in rec["transactions"]}
    assert by_desc["Strategy consulting - Meridian Advisory (one-off market entry study)"] == "new_or_one_time"
    assert by_desc["Monthly bookkeeping and payroll retainer"] == "recurring"
    budget = tools.TOOLS["get_budget_vs_actual"].handler(ctx, {"period": LAST})
    travel = next(r for r in budget["accounts"] if r["account_code"] == "7150")
    assert travel["budget"] == pytest.approx(7350) and travel["variance"] > 15000
    assert tools.TOOLS["get_budget_vs_actual"].handler(_ctx(db, demo.a), {"period": "2020-01"})["budget_available"] is False
    db.close()


def test_approval_tool_caps_requests_and_never_executes(session_factory, demo):
    db = session_factory()
    ctx = _ctx(db, demo.a)
    for i in range(tools.MAX_APPROVALS_PER_RUN):
        out = tools.TOOLS["prepare_approval_request"].handler(
            ctx, {"action_type": "review_contract", "title": f"Review {i}", "rationale": "why"})
        assert out["status"] == "pending"
    with pytest.raises(tools.ToolInputError):
        tools.TOOLS["prepare_approval_request"].handler(ctx, {"action_type": "review_contract", "title": "x", "rationale": "y"})
    assert all(t.action_class != tools.EXECUTE for t in tools.TOOLS.values())
    db.close()


# ── Agent loop ───────────────────────────────────────────────────────────────


class ScriptedModel:
    """Fake llm_service.chat_with_tools: plays back tool calls, records what it received."""

    def __init__(self, turns):
        self.turns = list(turns)
        self.calls = []

    def __call__(self, messages, tools_spec, *, system=None, max_tokens=2000, model_id=None):
        self.calls.append({"messages": messages, "tools": [t["name"] for t in tools_spec], "system": system})
        content = self.turns.pop(0) if self.turns else []
        return {"stop_reason": "tool_use" if content else "end_turn", "content": content, "model": "fake-model"}


def _use(i, name, args):
    return {"type": "tool_use", "id": f"call-{i}", "name": name, "input": args}


def _good_script(cited_extra="DEMO-JE-FAKE-99"):
    return [
        [_use(1, "compare_periods", {"period": LAST})],
        [_use(2, "get_transactions", {"account_code": "7140", "period": LAST}),
         _use(3, "check_recurrence", {"account_code": "7140", "period": LAST})],
        [_use(4, "forecast_impact", {"account_code": "7140", "period": LAST})],
        [_use(5, "prepare_approval_request", {"action_type": "review_contract", "title": "Confirm Meridian study scope",
                                              "rationale": "One-off 68,000 engagement", "amount": 68000})],
        [_use(6, "submit_findings", {
            "conclusion": "Professional fees rose because of a one-off consulting study.",
            "answer_markdown": "## Conclusion\nOne-off Meridian study (DEMO-JE-2026-10-20).",
            "drivers": [{"account_code": "7140", "amount": 68000, "explanation": "Meridian study",
                         "refs": [f"DEMO-JE-{LAST}-20", cited_extra]}],
            "nature": "one_time", "confidence": "high", "recommendations": ["Confirm scope"]})],
    ]


def _investigation(db, finding_id=None, company=None):
    inv = AiCfoInvestigation(workspace_id=WS_A, company_id=company, finding_id=finding_id,
                             agent="anomaly_investigator", question="Explain", status="queued", requested_by="cfo@example.com")
    db.add(inv)
    db.commit()
    return inv


def test_agent_investigates_with_tools_and_flags_unverified_refs(session_factory, demo, monkeypatch):
    db = session_factory()
    finding = next(f for f in run_detection(db, LedgerScope(WS_A, demo.a))["findings"]
                   if f.kind == "expense_spike" and f.account_code == "7140")
    model = ScriptedModel(_good_script())
    monkeypatch.setattr(llm_service, "chat_with_tools", model)
    inv = ai_agent.run_investigation(db, _investigation(db, finding.id, demo.a))

    assert inv.status == "completed" and inv.steps == 6
    assert inv.result_json["nature"] == "one_time" and len(inv.result_json["approval_request_ids"]) == 1
    assert inv.unverified_refs == ["DEMO-JE-FAKE-99"]
    assert db.get(AiCfoFinding, finding.id).status == "investigated"
    calls = db.query(AiCfoToolCall).filter_by(investigation_id=inv.id).order_by(AiCfoToolCall.step).all()
    assert [c.tool_name for c in calls] == ["compare_periods", "get_transactions", "check_recurrence",
                                            "forecast_impact", "prepare_approval_request", "submit_findings"]
    assert calls[4].action_class == "prepare" and not any(c.is_error for c in calls)
    assert f"DEMO-JE-{LAST}-20" in calls[1].refs
    approval = db.query(AiCfoApprovalRequest).one()
    assert approval.status == "pending" and approval.company_id == demo.a

    opening = model.calls[0]["messages"][0]["content"]
    assert "Professional Fees" in opening and "Detection:" in opening
    assert "submit_findings" in model.calls[0]["tools"]
    assert "Gnanova Demo Trading" in model.calls[0]["system"]
    second_turn = model.calls[1]["messages"]
    assert second_turn[-1]["content"][0]["type"] == "tool_result"
    db.close()


def test_agent_reports_bad_tool_and_fails_without_submit(session_factory, demo, monkeypatch):
    db = session_factory()
    monkeypatch.setattr(llm_service, "chat_with_tools", ScriptedModel([
        [_use(1, "post_journal_entry", {"amount": 1})],
        [_use(2, "get_transactions", {"account_code": "7140", "period": "bad"})],
        [],
        [],
    ]))
    inv = ai_agent.run_investigation(db, _investigation(db, None, demo.a))
    assert inv.status == "failed" and "did not finish" in inv.error
    calls = db.query(AiCfoToolCall).filter_by(investigation_id=inv.id).all()
    assert len(calls) == 2 and all(c.is_error for c in calls)
    db.close()


def test_agent_model_not_configured(session_factory, demo, monkeypatch):
    db = session_factory()

    def boom(*a, **k):
        raise llm_service.LLMNotConfiguredError("no key")

    monkeypatch.setattr(llm_service, "chat_with_tools", boom)
    inv = ai_agent.run_investigation(db, _investigation(db, None, demo.a))
    assert inv.status == "failed" and "not configured" in inv.error
    db.close()


# ── API ──────────────────────────────────────────────────────────────────────


def test_routes_require_login(session_factory):
    app = FastAPI()
    app.include_router(ai_cfo_router.router)

    def _db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    c = TestClient(app)
    for method, path in [("GET", "/overview"), ("POST", "/detect"), ("GET", "/findings"),
                         ("POST", "/investigations"), ("POST", "/approvals/1/decision"), ("POST", "/demo/seed")]:
        res = c.request(method, BASE + path + q(WS_A), json={}, headers={"X-Workspace-ID": WS_A})
        assert res.status_code == 401, (method, path, res.text)


def test_end_to_end_flow_through_api(client, env, demo, monkeypatch):
    model = ScriptedModel(_good_script(cited_extra=f"DEMO-JE-{LAST}-20"))
    monkeypatch.setattr(llm_service, "chat_with_tools", model)
    monkeypatch.setattr(llm_service, "is_configured", lambda: True)

    detected = client.post(BASE + "/detect" + q(demo.a), json={}).json()
    spike = next(f for f in detected["findings"] if f["kind"] == "expense_spike" and f["account_code"] == "7140")

    started = client.post(BASE + "/investigations" + q(demo.a), json={"finding_id": spike["id"]})
    assert started.status_code == 202, started.text
    inv = client.get(f"{BASE}/investigations/{started.json()['id']}" + q(demo.a)).json()
    assert inv["status"] == "completed" and inv["unverified_refs"] == []
    assert len(inv["tool_calls"]) == 6 and inv["approval_requests"][0]["status"] == "pending"

    overview = client.get(BASE + "/overview" + q(demo.a)).json()
    assert overview["pending_approvals"] == 1 and overview["coverage"]["last_period"] == LAST

    aid = inv["approval_requests"][0]["id"]
    assert client.post(f"{BASE}/approvals/{aid}/decision" + q(demo.a), json={"decision": "approved"}).status_code == 403
    env.roles[WS_A] = "owner"
    decided = client.post(f"{BASE}/approvals/{aid}/decision" + q(demo.a), json={"decision": "approved", "note": "ok"})
    assert decided.status_code == 200 and decided.json()["executed"] is False
    assert decided.json()["decided_by"] == "cfo@example.com"
    assert client.post(f"{BASE}/approvals/{aid}/decision" + q(demo.a), json={"decision": "rejected"}).status_code == 409
    assert len(client.get(BASE + "/activity" + q(demo.a)).json()) == 6


def test_api_roles_and_company_isolation(client, env, demo, monkeypatch):
    monkeypatch.setattr(llm_service, "is_configured", lambda: True)
    env.roles[WS_A] = "viewer"
    assert client.get(BASE + "/findings" + q(demo.a)).status_code == 200
    assert client.post(BASE + "/detect" + q(demo.a), json={}).status_code == 403
    assert client.post(BASE + "/investigations" + q(demo.a), json={"question": "Why?"}).status_code == 403

    env.roles[WS_A] = "accountant"
    fid = client.post(BASE + "/detect" + q(demo.a), json={}).json()["findings"][0]["id"]
    assert client.get(BASE + "/findings" + q(demo.b)).status_code == 403
    assert client.post(BASE + "/demo/seed" + q(demo.a)).status_code == 403
    assert client.post(BASE + "/investigations" + q(demo.a), json={}).status_code == 422
    assert client.post(BASE + "/investigations" + q(demo.a), json={"finding_id": 99999}).status_code == 404
    assert client.patch(f"{BASE}/findings/{fid}" + q(demo.a), json={"status": "dismissed", "note": "known"}).json()["status"] == "dismissed"
    assert client.post(BASE + "/detect" + q(demo.a), json={"period": "2026-13"}).status_code == 422


def test_investigation_needs_configured_model(client, env, demo, monkeypatch):
    monkeypatch.setattr(llm_service, "is_configured", lambda: False)
    assert client.post(BASE + "/investigations" + q(demo.a), json={"question": "Why?"}).status_code == 503


def test_demo_seed_rebuilds_only_demo_rows(client, env, demo, session_factory):
    db = session_factory()
    real = UaeCompanyProfile(workspace_id=WS_A, company_name="Real Co")
    db.add(real)
    db.flush()
    db.add(UAEJournalEntry(tenant_id=WS_A, company_id=demo.a, period=LAST, entry_date=date(2026, 10, 1),
                           status="posted", source="manual", lines=[UAEJournalLine(account_code="7140", debit=5, credit=0)]))
    db.commit()
    db.close()
    env.roles[WS_A] = "owner"
    res = client.post(BASE + "/demo/seed" + q(demo.a)).json()
    assert res["company_id"] == demo.a and "synthetic" in res["company_name"]
    db = session_factory()
    assert db.query(UAEJournalEntry).filter_by(company_id=demo.a, source="manual").count() == 1
    assert db.query(UaeCompanyProfile).filter_by(workspace_id=WS_A).count() == 2
    db.close()
