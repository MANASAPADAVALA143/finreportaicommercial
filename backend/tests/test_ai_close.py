"""Month-end close: bank-recon fixes, agents, NEXUS orchestration, KPIs, approvals, lock, reports."""

from __future__ import annotations

import os
from datetime import date
from io import BytesIO
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
from app.models.ai_close import AiCloseException, AiCloseJournalProposal, AiCloseRun, AiCloseTask
from app.models.client_data import ApCompany
from app.models.company_setup import AccountingPeriod, UaeCompanyProfile
from app.models.fpa_master import FpaMasterRow
from app.models.uae_accounting_full import (
    UAEAccount, UAEBankAccount, UAEBankStatement, UAEBankStatementLine, UAECreditNote, UAECustomer,
    UAEJournalEntry, UAEJournalLine, UAESalesInvoice,
)
from app.models.workspace import WorkspaceRole
from app.models.workspace_audit import WorkspaceAuditLog
from app.routers import ai_close as ai_close_router
from app.services.ai_cfo.demo import seed_demo_company
from app.services.ai_close import agents, orchestrator
from app.services.ai_close.context import AgentOutcome, Check
from app.services.uae_bank_recon_service import run_reconciliation
from app.services.uae_controls_service import PeriodControlError
from app.services.uae_journal_service import create_journal_entry

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
TODAY = date(2026, 11, 4)
LAST = "2026-10"
BASE = "/api/ai-close"
TABLES = (
    UAEAccount, UAEJournalEntry, UAEJournalLine, UaeCompanyProfile, ApCompany, FpaMasterRow, AccountingPeriod,
    UAEBankAccount, UAEBankStatement, UAEBankStatementLine, UAECustomer, UAESalesInvoice, UAECreditNote,
    AiCfoFinding, AiCfoInvestigation, AiCfoToolCall, AiCfoApprovalRequest,
    AiCloseRun, AiCloseTask, AiCloseException, AiCloseJournalProposal, WorkspaceAuditLog,
)


class Env:
    def __init__(self):
        self.roles = {WS_A: "accountant"}

    def ctx(self) -> WorkspaceContext:
        role = self.roles.get(WS_A)
        return WorkspaceContext(
            workspace_id=WS_A, workspace=SimpleNamespace(id=WS_A),
            user=SimpleNamespace(id="user-1", email="controller@example.com", role="accountant"),
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
    app.include_router(ai_close_router.router)

    def _db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[validate_workspace] = env.ctx
    monkeypatch.setattr(ai_close_router, "session_factory", session_factory)
    monkeypatch.setattr(ai_close_router, "MAX_WORKERS", 1)
    return TestClient(app)


def q(cid: str) -> str:
    return f"?company_id={cid}"


def _start(client, cid, **body):
    res = client.post(BASE + "/runs" + q(cid), json=body)
    assert res.status_code == 202, res.text
    return client.get(f"{BASE}/runs/{res.json()['id']}" + q(cid)).json()


def _kpi(run, key):
    return next(k for k in run["kpis"] if k["key"] == key)["value"]


# ── Bank reconciliation fixes ────────────────────────────────────────────────


def test_bank_recon_no_longer_crashes_and_stays_in_company(session_factory, demo):
    db = session_factory()
    stmt = (
        db.query(UAEBankStatement).join(UAEBankAccount, UAEBankStatement.bank_account_id == UAEBankAccount.id)
        .filter(UAEBankAccount.company_id == demo.a, UAEBankStatement.statement_date == date(2026, 10, 31)).one()
    )
    res = run_reconciliation(WS_A, stmt.id, db, use_ai=False)
    assert res["unmatched"] == 3 and res["total"] > 40
    matched_lines = {
        l.matched_journal_line_id for l in db.query(UAEBankStatementLine).filter_by(statement_id=stmt.id) if l.matched_journal_line_id
    }
    owners = {e.company_id for l, e in db.query(UAEJournalLine, UAEJournalEntry)
              .join(UAEJournalEntry, UAEJournalLine.journal_entry_id == UAEJournalEntry.id)
              .filter(UAEJournalLine.id.in_(matched_lines))}
    assert owners == {demo.a}
    again = run_reconciliation(WS_A, stmt.id, db, use_ai=False)
    assert again["total"] == 3 and again["unmatched"] == 3
    db.close()


# ── End-to-end close ─────────────────────────────────────────────────────────


def test_close_run_executes_agents_and_kpis_reconcile_to_records(client, env, demo, session_factory):
    run = _start(client, demo.a)
    assert run["status"] == "awaiting_approval" and run["period"] == LAST
    statuses = {t["agent"]: t["status"] for t in run["tasks"]}
    assert statuses == {"bank_reconciliation": "completed_with_exceptions", "ar_intelligence": "completed_with_exceptions",
                        "fpa": "completed_with_exceptions", "close_manager": "completed"}
    waves = {t["agent"]: t["wave"] for t in run["tasks"]}
    assert waves["bank_reconciliation"] == waves["ar_intelligence"] < waves["fpa"] < waves["close_manager"]

    db = session_factory()
    lines = (
        db.query(UAEBankStatementLine).join(UAEBankStatement).join(UAEBankAccount, UAEBankStatement.bank_account_id == UAEBankAccount.id)
        .filter(UAEBankAccount.company_id == demo.a, UAEBankStatement.statement_date == date(2026, 10, 31)).all()
    )
    matched = sum(1 for l in lines if l.match_status == "matched")
    overdue = db.query(UAESalesInvoice).filter(
        UAESalesInvoice.company_id == demo.a, UAESalesInvoice.outstanding > 0, UAESalesInvoice.due_date < date(2026, 10, 31)).count()
    db.close()
    assert _kpi(run, "bank_transactions_processed") == len(lines)
    assert _kpi(run, "transactions_reconciled") == matched == len(lines) - 3
    assert _kpi(run, "unmatched_transactions") == 3 + 2
    assert _kpi(run, "ar_overdue_invoices") == overdue > 0
    assert _kpi(run, "pending_journal_approvals") == 2
    assert _kpi(run, "agents_executed") == 4
    assert _kpi(run, "ap_invoices_processed") is None and _kpi(run, "ifrs_checks_completed") is None
    assert all(k["definition"] for k in run["kpis"])
    assert _kpi(run, "exceptions_identified") == run["exceptions_total"] == len({e["fingerprint"] for e in run["exceptions"]})

    cats = {e["category"] for e in run["exceptions"]}
    assert {"unmatched_bank", "unmatched_ledger", "overdue_receivable", "budget_variance"} <= cats
    assert "control_account_difference" not in cats and "unexplained_difference" not in cats
    titles = " ".join(e["title"] for e in run["exceptions"])
    assert "Northgate Contracting" in titles and "Meridian" not in titles
    assert any(e["fingerprint"].startswith("budget_variance:2026-10:7140") for e in run["exceptions"])

    props = run["proposals"]
    assert sorted(p["title"].split(" ")[1] for p in props) == ["bank", "bank"]
    charge = next(p for p in props if "charges" in p["title"])
    assert charge["journal_status"] == "pending_approval" and charge["total_debit"] == charge["total_credit"] == 450
    assert {l["account_code"] for l in charge["lines"]} == {"7160", "1002"} and charge["prepared_by"] == "ai-agent:bank_reconciliation"

    checklist = {i["key"]: i["status"] for i in run["checklist"]["items"]}
    assert checklist["ap_reviewed"] == "not_run" and checklist["ledger_balanced"] == "done"
    assert checklist["journals_approved"] == "done"
    assert checklist["proposals_decided"] == "open" and run["checklist"]["completion_pct"] < 100
    assert [d["status"] for d in run["deliverables"]] == ["ready"] * 4


def test_journal_approval_controls_and_checklist_updates(client, env, demo, session_factory):
    run = _start(client, demo.a)
    charge = next(p for p in run["proposals"] if "charges" in p["title"])
    interest = next(p for p in run["proposals"] if "interest" in p["title"])
    url = lambda pid: f"{BASE}/journals/{pid}/decision" + q(demo.a)  # noqa: E731

    assert client.post(url(charge["id"]), json={"decision": "approved"}).status_code == 403
    env.roles[WS_A] = "owner"
    approved = client.post(url(charge["id"]), json={"decision": "approved", "note": "Agreed to statement"}).json()
    assert approved["status"] == "approved" and approved["journal_status"] == "posted"
    assert approved["approved_by"] == "controller@example.com" and approved["decided_by"] == "controller@example.com"
    assert client.post(url(charge["id"]), json={"decision": "rejected"}).status_code == 409
    assert client.post(url(interest["id"]), json={"decision": "changes_requested"}).status_code == 409
    changed = client.post(url(interest["id"]), json={"decision": "changes_requested", "note": "Use 6020 Other Income"}).json()
    assert changed["status"] == "changes_requested" and changed["journal_status"] == "rejected"

    after = client.get(f"{BASE}/runs/{run['id']}" + q(demo.a)).json()
    assert _kpi(after, "pending_journal_approvals") == 0
    assert {i["key"]: i["status"] for i in after["checklist"]["items"]}["proposals_decided"] == "done"
    db = session_factory()
    actions = [a.action for a in db.query(WorkspaceAuditLog).filter_by(company_id=demo.a)]
    assert actions.count("je_approved") == 1 and actions.count("je_changes_requested") == 1
    db.close()

    rerun = _start(client, demo.a)
    assert _kpi(rerun, "transactions_reconciled") == _kpi(after, "transactions_reconciled") + 1
    assert [p["title"] for p in rerun["proposals"]] == [interest["title"]]


def test_close_approval_locks_period(client, env, demo, session_factory):
    run = _start(client, demo.a)
    env.roles[WS_A] = "owner"
    for p in run["proposals"]:
        client.post(f"{BASE}/journals/{p['id']}/decision" + q(demo.a), json={"decision": "approved"})
    url = f"{BASE}/runs/{run['id']}/approve-close" + q(demo.a)
    assert "note" in client.post(url, json={}).json()["detail"]
    closed = client.post(url, json={"note": "AP and IFRS reviewed manually this month"}).json()
    assert closed["status"] == "closed" and closed["locked_period"]["status"] == "locked"
    assert closed["locked_period"]["locked_by"] == "user-1" and closed["close_approved_by"] == "controller@example.com"
    assert client.post(url, json={"note": "again"}).status_code == 409

    db = session_factory()
    with pytest.raises(PeriodControlError):
        create_journal_entry(WS_A, date(2026, 10, 15), "late entry", [
            {"account_code": "7160", "debit": 10, "credit": 0}, {"account_code": "1002", "debit": 0, "credit": 10}],
            company_id=demo.a, db=db)
    create_journal_entry(WS_B, date(2026, 10, 15), "other company still open", [
        {"account_code": "7160", "debit": 10, "credit": 0}, {"account_code": "1002", "debit": 0, "credit": 10}],
        company_id=demo.b, db=db)
    db.close()


def test_close_approval_blocked_while_journals_pending(client, env, demo):
    run = _start(client, demo.a)
    env.roles[WS_A] = "owner"
    res = client.post(f"{BASE}/runs/{run['id']}/approve-close" + q(demo.a), json={"note": "x"})
    assert res.status_code == 409 and "proposed journal" in res.json()["detail"]


# ── Failure handling ─────────────────────────────────────────────────────────


def test_failed_agent_is_reported_and_others_continue(client, env, demo, monkeypatch):
    calls = {"n": 0}

    def boom(ctx):
        calls["n"] += 1
        raise RuntimeError("AR source unavailable")

    monkeypatch.setitem(agents.AGENTS, "ar_intelligence", ("AR Intelligence Agent", boom))
    run = _start(client, demo.a)
    tasks = {t["agent"]: t for t in run["tasks"]}
    assert calls["n"] == orchestrator.MAX_ATTEMPTS
    assert tasks["ar_intelligence"]["status"] == "failed" and "AR source unavailable" in tasks["ar_intelligence"]["error"]
    assert tasks["fpa"]["status"] == "completed_with_exceptions" and tasks["close_manager"]["status"] == "completed"
    assert run["status"] == "failed" and _kpi(run, "ar_overdue_invoices") is None
    assert {d["key"]: d["status"] for d in run["deliverables"]}["ar_collections"] == "failed"
    assert client.get(f"{BASE}/runs/{run['id']}/reports/ar_collections.pdf" + q(demo.a)).status_code == 404
    fpa = client.get(f"{BASE}/runs/{run['id']}/tasks/fpa" + q(demo.a)).json()
    assert any("Receivables ageing not available" in l for l in fpa["output_json"]["limitations"])
    env.roles[WS_A] = "owner"
    assert client.post(f"{BASE}/runs/{run['id']}/approve-close" + q(demo.a), json={"note": "x"}).status_code == 409


def test_blocking_validation_failure_marks_task_failed(client, env, demo, monkeypatch):
    monkeypatch.setitem(agents.AGENTS, "fpa", ("FP&A Agent", lambda ctx: AgentOutcome(
        records_processed=1, output={}, checks=[Check("totals_tie", False, "Totals do not tie", blocking=True)])))
    run = _start(client, demo.a)
    fpa = next(t for t in run["tasks"] if t["agent"] == "fpa")
    assert fpa["status"] == "failed" and "Totals do not tie" in fpa["error"]


# ── Reports ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("key", ["bank_reconciliation", "ar_collections", "fpa_intelligence", "close_pack"])
def test_reports_download_in_excel_and_pdf(client, env, demo, key):
    from openpyxl import load_workbook

    run = _start(client, demo.a)
    xlsx = client.get(f"{BASE}/runs/{run['id']}/reports/{key}.xlsx" + q(demo.a))
    assert xlsx.status_code == 200 and key in xlsx.headers["content-disposition"]
    wb = load_workbook(BytesIO(xlsx.content))
    summary = {r[0].value: r[1].value for r in wb["Summary"].iter_rows(min_row=3) if r[0].value}
    assert summary["Period"] == LAST and "synthetic data" in summary["Entity"] and summary["Responsible agent"]
    assert len(wb.sheetnames) > 1
    pdf = client.get(f"{BASE}/runs/{run['id']}/reports/{key}.pdf" + q(demo.a))
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"
    assert client.get(f"{BASE}/runs/{run['id']}/reports/unknown.pdf" + q(demo.a)).status_code == 404


# ── Scoping and validation ───────────────────────────────────────────────────


def test_scoping_roles_and_input_validation(client, env, demo):
    run = _start(client, demo.a)
    assert client.get(f"{BASE}/runs/{run['id']}" + q(demo.b)).status_code == 403
    env.roles[WS_A] = "viewer"
    assert client.get(f"{BASE}/runs/{run['id']}" + q(demo.a)).status_code == 200
    assert client.post(BASE + "/runs" + q(demo.a), json={}).status_code == 403
    env.roles[WS_A] = "accountant"
    assert client.post(BASE + "/runs" + q(demo.a), json={"period": "2026-13"}).status_code == 422
    assert client.post(BASE + "/runs" + q(demo.a), json={"agents": ["ifrs"]}).status_code == 422
    assert [r["id"] for r in client.get(BASE + "/runs" + q(demo.a)).json()] == [run["id"]]
    assert client.get(BASE + "/runs/latest" + q(demo.a)).json()["id"] == run["id"]


def test_selected_agents_only_and_no_data_company(client, env, demo, session_factory):
    run = _start(client, demo.a, agents=["bank_reconciliation"])
    assert sorted(t["agent"] for t in run["tasks"]) == ["bank_reconciliation", "close_manager"]
    assert {d["key"]: d["status"] for d in run["deliverables"]}["fpa_intelligence"] == "not_run"

    db = session_factory()
    empty = UaeCompanyProfile(workspace_id=WS_A, company_name="Empty Co")
    db.add(empty)
    db.commit()
    empty_id = empty.id
    db.close()
    assert client.post(BASE + "/runs" + q(empty_id), json={}).status_code == 422
    blank = _start(client, empty_id, period=LAST)
    bank = next(t for t in blank["tasks"] if t["agent"] == "bank_reconciliation")
    assert bank["status"] == "completed_with_exceptions"
    assert any(e["category"] == "data_gap" for e in blank["exceptions"])
