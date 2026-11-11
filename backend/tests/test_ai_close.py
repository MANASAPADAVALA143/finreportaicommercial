"""Month-end close: agents, NEXUS orchestration (entity and group), KPIs, approvals, lock, reports."""

from __future__ import annotations

import os
import uuid
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

import app.core.supabase as supabase_mod
from app.core import company_access
from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.models.ai_cfo import AiCfoApprovalRequest, AiCfoFinding, AiCfoInvestigation, AiCfoToolCall
from app.models.ai_close import (
    AiCloseControls, AiCloseException, AiCloseFxRate, AiCloseFxSettings, AiCloseJournalProposal, AiCloseRun, AiCloseSchedule,
    AiCloseTask,
)
from app.models.client_data import ApCompany
from app.models.company_setup import AccountingPeriod, UaeCompanyProfile
from app.models.fpa_master import FpaMasterRow
from app.models.ifrs16_lease import IFRS16Lease
from app.models.investments import InvestmentHolding, InvestmentValuation
from app.models.uae_accounting_full import (
    UAEAccount, UAEBankAccount, UAEBankStatement, UAEBankStatementLine, UAECreditNote, UAECustomer,
    UAEJournalEntry, UAEJournalLine, UAESalesInvoice,
)
from app.models.workspace import WorkspaceRole
from app.models.workspace_audit import WorkspaceAuditLog
from app.models.workspace_notification import WorkspaceNotification
from app.routers import ai_close as ai_close_router
from app.services import llm_service
from app.services.ai_cfo import ledger
from app.services.ai_cfo.ledger import LedgerScope
from app.services.ai_close import agents, orchestrator
from app.services.ai_close.cfo_agent import unverified_numbers
from app.services.ai_close.context import AgentOutcome, Check
from app.services.ai_close.demo_group import seed_demo_group
from app.services.uae_bank_recon_service import run_reconciliation
from app.services.uae_controls_service import PeriodControlError
from app.services.uae_journal_service import create_journal_entry

WS_A = "aaaaaaaa-0000-4000-8000-000000000001"
WS_B = "bbbbbbbb-0000-4000-8000-000000000002"
TODAY = date(2026, 11, 4)
LAST = "2026-10"
BASE = "/api/ai-close"
PHASE_A = ["bank_reconciliation", "ar_intelligence", "fpa"]
TABLES = (
    UAEAccount, UAEJournalEntry, UAEJournalLine, UaeCompanyProfile, ApCompany, FpaMasterRow, AccountingPeriod,
    UAEBankAccount, UAEBankStatement, UAEBankStatementLine, UAECustomer, UAESalesInvoice, UAECreditNote, IFRS16Lease,
    AiCfoFinding, AiCfoInvestigation, AiCfoToolCall, AiCfoApprovalRequest,
    AiCloseRun, AiCloseTask, AiCloseException, AiCloseJournalProposal, AiCloseSchedule, WorkspaceAuditLog,
    WorkspaceNotification, InvestmentHolding, InvestmentValuation, AiCloseControls, AiCloseFxRate, AiCloseFxSettings,
)


class FakeSupabase:
    """In-memory stand-in for the Supabase client: select/insert/update/delete with eq/neq/in_/is_ filters."""

    def __init__(self):
        self.tables: dict[str, list[dict]] = {}

    def table(self, name: str) -> "_Query":
        return _Query(self, name)


class _Query:
    def __init__(self, sb: FakeSupabase, name: str):
        self.sb, self.name, self.filters, self.op, self.payload, self.n = sb, name, [], "select", None, None

    def select(self, *_a, **_k):
        return self

    def insert(self, rows):
        self.op, self.payload = "insert", rows
        return self

    def update(self, patch):
        self.op, self.payload = "update", patch
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, k, v):
        self.filters.append(lambda r: str(r.get(k)) == str(v))
        return self

    def neq(self, k, v):
        self.filters.append(lambda r: str(r.get(k)) != str(v))
        return self

    def in_(self, k, vs):
        vals = {str(v) for v in vs}
        self.filters.append(lambda r: str(r.get(k)) in vals)
        return self

    def is_(self, k, _v):
        self.filters.append(lambda r: r.get(k) is None)
        return self

    def limit(self, n):
        self.n = n
        return self

    def range(self, start, end):
        self.offset, self.n = start, end - start + 1
        return self

    def order(self, *_a, **_k):
        return self

    def execute(self):
        rows = self.sb.tables.setdefault(self.name, [])
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "insert":
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            data = [{"id": str(uuid.uuid4()), **dict(i)} for i in items]
            rows.extend(data)
        elif self.op == "update":
            for r in hit:
                r.update(self.payload)
            data = hit
        elif self.op == "delete":
            self.sb.tables[self.name] = [r for r in rows if r not in hit]
            data = hit
        else:
            start = getattr(self, "offset", 0)
            data = [dict(r) for r in hit][start: start + self.n if self.n else None]
        return SimpleNamespace(data=data)


class Env:
    def __init__(self):
        self.roles = {WS_A: "accountant"}
        self.email = "controller@example.com"

    def ctx(self) -> WorkspaceContext:
        role = self.roles.get(WS_A)
        return WorkspaceContext(
            workspace_id=WS_A, workspace=SimpleNamespace(id=WS_A),
            user=SimpleNamespace(id="user-1", email=self.email, role="accountant"),
            role=WorkspaceRole(role) if role else None,
        )


@pytest.fixture()
def sb(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(supabase_mod, "get_supabase", lambda: fake)
    monkeypatch.setattr(llm_service, "is_configured", lambda: False)
    return fake


@pytest.fixture()
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in TABLES:
        model.__table__.create(engine)
    return sessionmaker(bind=engine)


@pytest.fixture()
def demo(session_factory, sb):
    db = session_factory()
    a = seed_demo_group(db, WS_A, today=TODAY, scale="compact")
    b = seed_demo_group(db, WS_B, today=TODAY, scale="compact")
    db.close()
    ids = [e["id"] for e in a["entities"]]
    return SimpleNamespace(a=a["company_id"], b=b["company_id"], services=ids[1], logistics=ids[2], group=ids, info=a)


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


def _group(client, demo, **body):
    return _start(client, demo.a, scope="group", entity_ids=demo.group[1:], **body)


def _kpi(run, key):
    return next(k for k in run["kpis"] if k["key"] == key)["value"]


def _task(client, run, agent, cid):
    return client.get(f"{BASE}/runs/{run['id']}/tasks/{agent}" + q(cid)).json()


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


# ── Single-entity close (phase A agents) ─────────────────────────────────────


def test_close_run_executes_agents_and_kpis_reconcile_to_records(client, env, demo, session_factory):
    run = _start(client, demo.a, agents=PHASE_A)
    assert run["status"] == "awaiting_approval" and run["period"] == LAST and run["scope"] == "entity"
    statuses = {t["agent"]: t["status"] for t in run["tasks"]}
    assert statuses == {"bank_reconciliation": "completed_with_exceptions", "ar_intelligence": "completed_with_exceptions",
                        "fpa": "completed_with_exceptions", "close_manager": "completed", "cfo_intelligence": "completed"}
    waves = {t["agent"]: t["wave"] for t in run["tasks"]}
    assert waves["bank_reconciliation"] == waves["ar_intelligence"] < waves["fpa"] < waves["close_manager"] < waves["cfo_intelligence"]

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
    assert _kpi(run, "agents_executed") == 5
    assert _kpi(run, "ap_invoices_processed") is None and _kpi(run, "ifrs_checks_completed") is None
    assert all(k["definition"] for k in run["kpis"])
    assert _kpi(run, "exceptions_identified") == run["exceptions_total"] == len({e["fingerprint"] for e in run["exceptions"]})
    assert _kpi(run, "unresolved_exceptions") == run["exceptions_total"]

    cats = {e["category"] for e in run["exceptions"]}
    assert {"unmatched_bank", "unmatched_ledger", "overdue_receivable", "budget_variance"} <= cats
    assert "control_account_difference" not in cats and "unexplained_difference" not in cats
    assert any(e["fingerprint"].startswith("budget_variance:2026-10:7140") for e in run["exceptions"])

    charge = next(p for p in run["proposals"] if "charges" in p["title"])
    assert charge["journal_status"] == "pending_approval" and charge["total_debit"] == charge["total_credit"] == 450
    assert {l["account_code"] for l in charge["lines"]} == {"7160", "1002"} and charge["prepared_by"] == "ai-agent:bank_reconciliation"

    checklist = {i["key"]: i["status"] for i in run["checklist"]["items"]}
    assert checklist["ap_reviewed"] == "not_run" and checklist["ledger_balanced"] == "done"
    assert checklist["consolidated"] == "n/a" and checklist["journals_approved"] == "done"
    assert checklist["proposals_decided"] == "open" and run["checklist"]["completion_pct"] < 100
    ready = {d["key"]: d["status"] for d in run["deliverables"]}
    assert ready == {"bank_reconciliation": "ready", "ap_processing": "not_run", "ar_collections": "ready", "ifrs_pack": "not_run",
                     "fpa_intelligence": "ready", "investment_review": "not_run", "close_pack": "ready", "cfo_summary": "ready"}


def test_journal_approval_controls_resolution_and_rerun(client, env, demo, session_factory):
    run = _start(client, demo.a, agents=PHASE_A)
    charge = next(p for p in run["proposals"] if "charges" in p["title"])
    interest = next(p for p in run["proposals"] if "interest" in p["title"])
    url = lambda pid: f"{BASE}/journals/{pid}/decision" + q(demo.a)  # noqa: E731

    assert client.post(url(charge["id"]), json={"decision": "approved"}).status_code == 403
    env.roles[WS_A] = "owner"
    approved = client.post(url(charge["id"]), json={"decision": "approved", "note": "Agreed to statement"}).json()
    assert approved["status"] == "approved" and approved["journal_status"] == "posted"
    assert approved["approved_by"] == "controller@example.com"
    assert client.post(url(charge["id"]), json={"decision": "rejected"}).status_code == 409
    assert client.post(url(interest["id"]), json={"decision": "changes_requested"}).status_code == 409
    changed = client.post(url(interest["id"]), json={"decision": "changes_requested", "note": "Use 6020 Other Income"}).json()
    assert changed["status"] == "changes_requested" and changed["journal_status"] == "rejected"

    after = client.get(f"{BASE}/runs/{run['id']}" + q(demo.a)).json()
    resolved = next(e for e in after["exceptions"] if e["fingerprint"] == charge["fingerprint"])
    assert resolved["status"] == "resolved"
    assert _kpi(after, "unresolved_exceptions") == after["exceptions_total"] - 1
    assert _kpi(after, "pending_journal_approvals") == 0
    assert {i["key"]: i["status"] for i in after["checklist"]["items"]}["proposals_decided"] == "done"
    db = session_factory()
    actions = [a.action for a in db.query(WorkspaceAuditLog).filter_by(company_id=demo.a)]
    assert actions.count("je_approved") == 1 and actions.count("je_changes_requested") == 1
    db.close()

    rerun = _start(client, demo.a, agents=PHASE_A)
    assert _kpi(rerun, "transactions_reconciled") == _kpi(after, "transactions_reconciled") + 1
    assert [p["title"] for p in rerun["proposals"]] == [interest["title"]]


def test_close_approval_locks_period(client, env, demo, session_factory):
    run = _start(client, demo.a, agents=PHASE_A)
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
    create_journal_entry(WS_A, date(2026, 10, 15), "subsidiary still open", [
        {"account_code": "7160", "debit": 10, "credit": 0}, {"account_code": "1002", "debit": 0, "credit": 10}],
        company_id=demo.services, db=db)
    db.close()


def test_close_approval_blocked_while_journals_pending(client, env, demo):
    run = _start(client, demo.a, agents=PHASE_A)
    env.roles[WS_A] = "owner"
    res = client.post(f"{BASE}/runs/{run['id']}/approve-close" + q(demo.a), json={"note": "x"})
    assert res.status_code == 409 and "proposed journal" in res.json()["detail"]


def test_failed_agent_is_reported_and_others_continue(client, env, demo, monkeypatch):
    calls = {"n": 0}

    def boom(ctx):
        calls["n"] += 1
        raise RuntimeError("AR source unavailable")

    monkeypatch.setitem(agents.AGENTS, "ar_intelligence", ("AR Intelligence Agent", boom))
    run = _start(client, demo.a, agents=PHASE_A)
    tasks = {t["agent"]: t for t in run["tasks"]}
    assert calls["n"] == orchestrator.MAX_ATTEMPTS
    assert tasks["ar_intelligence"]["status"] == "failed" and "AR source unavailable" in tasks["ar_intelligence"]["error"]
    assert tasks["fpa"]["status"] == "completed_with_exceptions" and tasks["cfo_intelligence"]["status"] == "completed"
    assert run["status"] == "failed" and _kpi(run, "ar_overdue_invoices") is None
    assert {d["key"]: d["status"] for d in run["deliverables"]}["ar_collections"] == "failed"
    assert client.get(f"{BASE}/runs/{run['id']}/reports/ar_collections.pdf" + q(demo.a)).status_code == 404
    fpa = _task(client, run, "fpa", demo.a)
    assert any("Receivables ageing not available" in l for l in fpa["output_json"]["limitations"])
    env.roles[WS_A] = "owner"
    assert client.post(f"{BASE}/runs/{run['id']}/approve-close" + q(demo.a), json={"note": "x"}).status_code == 409


def test_blocking_validation_failure_marks_task_failed(client, env, demo, monkeypatch):
    monkeypatch.setitem(agents.AGENTS, "fpa", ("FP&A Agent", lambda ctx: AgentOutcome(
        records_processed=1, output={}, checks=[Check("totals_tie", False, "Totals do not tie", blocking=True)])))
    run = _start(client, demo.a, agents=PHASE_A)
    fpa = next(t for t in run["tasks"] if t["agent"] == "fpa")
    assert fpa["status"] == "failed" and "Totals do not tie" in fpa["error"]


# ── AP agent ─────────────────────────────────────────────────────────────────


def test_ap_agent_matches_flags_and_accrues(client, env, demo, sb):
    run = _start(client, demo.a, agents=["ap_processing"])
    ap = _task(client, run, "ap_processing", demo.a)["output_json"]
    october = [i for i in sb.tables["invoices"] if i["company_id"] == demo.a and i["invoice_date"].startswith(LAST)]
    assert ap["invoices_processed"] == len(october) == _kpi(run, "ap_invoices_processed") == 47
    assert ap["match_summary"] == {"three_way_matched": 40, "matched": 1, "partial": 0, "mismatch": 3, "no_po": 3}
    assert [d["ref"].split("-", 1)[1] for d in ap["duplicates"]] == ["GIT 4471"]
    assert [d["ref"].split("-", 1)[1] for d in ap["possible_duplicates"]] == ["DW-7714"]
    by_cat = {}
    for e in run["exceptions"]:
        by_cat.setdefault(e["category"], []).append(e["title"])
    assert len(by_cat["ap_match_exception"]) == 1 and "GIT-4471" in by_cat["ap_match_exception"][0]
    assert len(by_cat["vendor_exception"]) == 1 and "Gulf Tech Trading" in by_cat["vendor_exception"][0]
    assert len(by_cat["ap_no_po"]) == 1 and "Prime Events" in by_cat["ap_no_po"][0]
    assert len(by_cat["duplicate_invoice"]) == 2 and len(by_cat["ap_awaiting_grn"]) == 1
    assert len(by_cat["goods_received_not_invoiced"]) == 1
    assert _kpi(run, "ap_exceptions") == sum(len(v) for v in by_cat.values()) == 7

    held = {h["id"] for h in ap["held"]}
    assert held and not held & {p["id"] for p in ap["payment_proposals"]}
    assert any(p["reason"] == "Overdue" for p in ap["payment_proposals"])
    grni = next(p for p in run["proposals"] if p["agent"] == "ap_processing")
    assert grni["total_debit"] == grni["total_credit"] == 50000 and grni["journal_status"] == "pending_approval"
    assert {(l["account_code"], l["debit"], l["credit"]) for l in grni["lines"]} == {("7180", 50000, 0), ("3020", 0, 50000)}
    assert grni["fingerprint"].startswith("grni:") and grni["source_refs"][0]["type"] == "goods_receipt"


def test_ap_source_unavailable_is_a_data_gap(client, env, demo, monkeypatch):
    def down():
        raise RuntimeError("Supabase is not configured")

    monkeypatch.setattr(supabase_mod, "get_supabase", down)
    run = _start(client, demo.a, agents=["ap_processing"])
    task = next(t for t in run["tasks"] if t["agent"] == "ap_processing")
    assert task["status"] == "completed_with_exceptions"
    assert any(e["category"] == "data_gap" and "AP invoices could not be read" in e["title"] for e in run["exceptions"])


# ── Group close: IFRS, consolidation, CFO ────────────────────────────────────


def test_group_close_runs_every_agent_per_entity(client, env, demo, session_factory):
    run = _group(client, demo)
    assert run["scope"] == "group" and [e["id"] for e in run["entities"]] == demo.group
    statuses = {t["agent"]: t["status"] for t in run["tasks"]}
    assert set(statuses) == set(agents.AGENTS) and "failed" not in statuses.values(), statuses
    waves = {t["agent"]: t["wave"] for t in run["tasks"]}
    assert waves["ifrs"] > waves["ar_intelligence"] and waves["consolidation"] > max(waves[a] for a in agents.ENTITY_AGENTS)
    assert waves["close_manager"] > waves["consolidation"] and waves["cfo_intelligence"] > waves["close_manager"]

    bank = _task(client, run, "bank_reconciliation", demo.a)["output_json"]
    assert [e["entity_id"] for e in bank["entities"]] == demo.group
    assert bank["total_lines"] == sum(e["total_lines"] for e in bank["entities"]) == _kpi(run, "bank_transactions_processed")
    assert bank["entities"][1]["unmatched_bank"] == bank["entities"][2]["unmatched_bank"] == 0

    names = {e["id"]: e["name"] for e in run["entities"]}
    proposals = run["proposals"]
    by_entity = {}
    for p in proposals:
        by_entity.setdefault(names[p["company_id"]], []).append(p["title"])
    services, logistics = names[demo.services], names[demo.logistics]
    assert any("Depreciation" in t for t in by_entity[services]) and any("Interest" in t for t in by_entity[services])
    assert not any("Payment" in t for t in by_entity[services])
    assert any(t.startswith("Accrue Office Rent 18,000.00") for t in by_entity[logistics])
    assert sum("end-of-service" in t for t in sum(by_entity.values(), [])) == 2

    db = session_factory()
    rent = next(p for p in proposals if p["title"].startswith("Accrue Office Rent"))
    je = db.get(UAEJournalEntry, rent["journal_entry_id"])
    assert je.company_id == demo.logistics and je.status == "pending_approval"
    assert {(l.account_code, float(l.debit), float(l.credit)) for l in je.lines} == {("7110", 18000, 0), ("3022", 0, 18000)}
    db.close()

    ifrs_out = _task(client, run, "ifrs", demo.a)["output_json"]
    per_entity = {e["entity_name"]: e["checks_evaluated"] for e in ifrs_out["entities"]}
    assert per_entity == {names[demo.a]: 7, services: 8, logistics: 7}
    assert _kpi(run, "ifrs_checks_completed") == 22
    assert all(c["status"] == "passed" for c in ifrs_out["checks"] if c["id"] in ("tb_balanced", "bs_balances", "coa_complete"))
    assert _kpi(run, "exceptions_identified") == len({(e["entity_id"], e["fingerprint"]) for e in run["exceptions"]})


def test_consolidation_eliminates_intercompany_and_flags_mismatch(client, env, demo, session_factory):
    run = _group(client, demo, agents=PHASE_A)
    consol = _task(client, run, "consolidation", demo.a)["output_json"]
    assert [r["status"] for r in consol["eliminations"]] == ["mismatch"]
    elim = consol["eliminations"][0]
    assert (elim["seller_revenue"], elim["buyer_expense"], elim["eliminated"], elim["difference"]) == (25000, 24000, 24000, 1000)
    ic = [e for e in run["exceptions"] if e["category"] == "intercompany_mismatch"]
    assert len(ic) == 1 and "IC-2026-10-01" in ic[0]["title"]

    db = session_factory()
    revenue = sum(m["net"] for cid in demo.group
                  for m in ledger.monthly_movements(db, LedgerScope(WS_A, cid), LAST, LAST) if m["account_type"] == "Income")
    db.close()
    assert consol["consolidated_revenue"] == pytest.approx(revenue - 24000, abs=0.01)
    assert consol["group_bs_balanced"] and all(e["bs_balanced"] for e in consol["entities"])
    assert consol["intercompany_balances"] == {"receivable": 25000, "payable": 24000, "eliminated": 24000}
    assert len(consol["comparison"]) == 3 and consol["eliminated_revenue"] == consol["eliminated_costs"] == 24000


def test_cfo_summary_is_built_from_records(client, env, demo, session_factory):
    run = _group(client, demo, agents=PHASE_A)
    cfo = run["cfo_summary"]
    assert cfo["headline"]["pending_approvals"] == _kpi(run, "pending_journal_approvals")
    assert cfo["headline"]["open_exceptions"] == _kpi(run, "unresolved_exceptions")
    db = session_factory()
    revenue = sum(m["net"] for cid in demo.group
                  for m in ledger.monthly_movements(db, LedgerScope(WS_A, cid), LAST, LAST) if m["account_type"] == "Income")
    db.close()
    assert cfo["performance"]["revenue"] == pytest.approx(revenue, abs=0.01)
    assert cfo["group"]["consolidated_revenue"] == pytest.approx(revenue - 24000, abs=0.01)
    assert cfo["narrative"]["source"] == "template" and f"{cfo['performance']['revenue']:,.2f}" in cfo["narrative"]["text"]
    assert len(cfo["subsidiary_comparison"]) == 3 and cfo["root_causes"] and cfo["risks"]
    assert len(cfo["approval_requirements"]) == _kpi(run, "pending_journal_approvals")


def test_cfo_ai_commentary_is_verified(client, env, demo, monkeypatch):
    monkeypatch.setattr(llm_service, "is_configured", lambda: True)
    monkeypatch.setattr(llm_service, "chat", lambda *a, **k: "Revenue rose to 9,999,999.00 on strong demand.")
    run = _start(client, demo.a, agents=PHASE_A)
    assert run["cfo_summary"]["narrative"]["source"] == "template"
    assert "9,999,999.00" in run["cfo_summary"]["narrative"]["note"]

    def honest(messages, **_k):
        import json

        facts = json.loads(messages[0]["content"].split("\n\n", 1)[1])
        return f"Revenue was {facts['performance']['revenue']:,.2f} with 2 journals awaiting approval."

    monkeypatch.setattr(llm_service, "chat", honest)
    run = _start(client, demo.a, agents=PHASE_A)
    assert run["cfo_summary"]["narrative"]["source"] == "ai"


def test_unverified_numbers_helper():
    facts = {"a": 1234.5, "b": [{"c": 25000}], "d": "Due 2026-10-31"}
    assert unverified_numbers("Revenue 1,234.50 and fee 25,000.00 over 3 items in 90 days", facts) == []
    assert unverified_numbers("Profit 4,321.00", facts) == ["4,321.00"]


def test_group_approvals_post_to_entities_and_lock_all(client, env, demo, session_factory):
    run = _group(client, demo, agents=PHASE_A + ["ifrs"])
    env.roles[WS_A] = "owner"
    for p in run["proposals"]:
        res = client.post(f"{BASE}/journals/{p['id']}/decision" + q(demo.a), json={"decision": "approved"})
        assert res.status_code == 200, res.text
    db = session_factory()
    lease = db.query(IFRS16Lease).filter_by(company_id=demo.services).one()
    dep = next(p for p in run["proposals"] if "Depreciation" in p["title"])
    interest = next(p for p in run["proposals"] if p["title"].startswith("IFRS 16 Interest"))
    assert float(lease.accumulated_depreciation) == pytest.approx(round(float(lease.rou_asset_initial) / 36, 2) * 7, abs=0.05)
    posted = {p["company_id"] for p in run["proposals"]}
    assert posted == set(demo.group)
    db.close()
    after = client.get(f"{BASE}/runs/{run['id']}" + q(demo.a)).json()
    lease_exc = next(e for e in after["exceptions"] if e["category"] == "missing_lease_entries")
    assert lease_exc["status"] == "resolved" and dep["amount"] and interest["amount"]

    closed = client.post(f"{BASE}/runs/{run['id']}/approve-close" + q(demo.a), json={"note": "AP reviewed manually"}).json()
    assert closed["status"] == "closed" and len(closed["locked_periods"]) == 3
    db = session_factory()
    for cid in demo.group:
        with pytest.raises(PeriodControlError):
            create_journal_entry(WS_A, date(2026, 10, 20), "late", [
                {"account_code": "7160", "debit": 1, "credit": 0}, {"account_code": "1002", "debit": 0, "credit": 1}],
                company_id=cid, db=db)
    db.close()


def test_group_start_validation(client, env, demo):
    res = client.post(BASE + "/runs" + q(demo.a), json={"scope": "group", "entity_ids": [demo.b]})
    assert res.status_code == 422 and "workspace" in res.json()["detail"]
    assert client.post(BASE + "/runs" + q(demo.a), json={"scope": "group", "entity_ids": []}).status_code == 422
    env.roles[WS_A] = "viewer"
    assert client.post(BASE + "/runs" + q(demo.a), json={"scope": "group", "entity_ids": demo.group[1:]}).status_code == 403


# ── Reports ──────────────────────────────────────────────────────────────────


def test_all_seven_deliverables_download(client, env, demo):
    from openpyxl import load_workbook

    run = _group(client, demo)
    assert all(d["status"] == "ready" for d in run["deliverables"]), run["deliverables"]
    for d in run["deliverables"]:
        url = f"{BASE}/runs/{run['id']}/reports/{d['key']}"
        if "xlsx" in d["formats"]:
            xlsx = client.get(url + ".xlsx" + q(demo.a))
            assert xlsx.status_code == 200 and d["key"] in xlsx.headers["content-disposition"]
            wb = load_workbook(BytesIO(xlsx.content))
            summary = {r[0].value: r[1].value for r in wb["Summary"].iter_rows(min_row=3) if r[0].value}
            assert summary["Period"] == LAST and summary["Entity"].startswith("Group:") and summary["Responsible agent"]
            assert "awaiting close approval" in summary["Approval status"]
        else:
            assert client.get(url + ".xlsx" + q(demo.a)).status_code == 404
        pdf = client.get(url + ".pdf" + q(demo.a))
        assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"
        view = client.get(url + ".json" + q(demo.a)).json()
        assert view["title"] == d["title"] and view["sections"] and view["meta"]
    ap_view = client.get(f"{BASE}/runs/{run['id']}/reports/ap_processing.json" + q(demo.a)).json()
    titles = [s["title"] for s in ap_view["sections"]]
    assert {"Invoice register", "PO and GRN matching", "Duplicate invoices", "Vendor exceptions",
            "Payment proposals (not executed)", "Goods received not invoiced"} <= set(titles)
    assert ap_view["sections"][0]["columns"][0] == "Entity"
    cfo_view = client.get(f"{BASE}/runs/{run['id']}/reports/cfo_summary.json" + q(demo.a)).json()
    assert cfo_view["narrative"] and "Subsidiary comparison" in [s["title"] for s in cfo_view["sections"]]
    assert client.get(f"{BASE}/runs/{run['id']}/reports/unknown.pdf" + q(demo.a)).status_code == 404


# ── Scoping, validation, demo ────────────────────────────────────────────────


def test_scoping_roles_and_input_validation(client, env, demo):
    run = _start(client, demo.a, agents=PHASE_A)
    assert client.get(f"{BASE}/runs/{run['id']}" + q(demo.b)).status_code == 403
    env.roles[WS_A] = "viewer"
    assert client.get(f"{BASE}/runs/{run['id']}" + q(demo.a)).status_code == 200
    assert client.post(BASE + "/runs" + q(demo.a), json={}).status_code == 403
    assert client.post(BASE + "/demo/seed" + q(demo.a)).status_code == 403
    env.roles[WS_A] = "accountant"
    assert client.post(BASE + "/runs" + q(demo.a), json={"period": "2026-13"}).status_code == 422
    assert client.post(BASE + "/runs" + q(demo.a), json={"agents": ["payroll"]}).status_code == 422
    assert [r["id"] for r in client.get(BASE + "/runs" + q(demo.a)).json()] == [run["id"]]
    assert client.get(BASE + "/runs/latest" + q(demo.a)).json()["id"] == run["id"]
    assert client.get(f"{BASE}/runs/{run['id']}" + q(demo.services)).status_code == 404


def test_selected_agents_only_and_no_data_company(client, env, demo, session_factory):
    run = _start(client, demo.a, agents=["bank_reconciliation"])
    assert sorted(t["agent"] for t in run["tasks"]) == ["bank_reconciliation", "cfo_intelligence", "close_manager"]
    assert {d["key"]: d["status"] for d in run["deliverables"]}["fpa_intelligence"] == "not_run"

    db = session_factory()
    empty = UaeCompanyProfile(workspace_id=WS_A, company_name="Empty Co")
    db.add(empty)
    db.commit()
    empty_id = empty.id
    db.close()
    assert client.post(BASE + "/runs" + q(empty_id), json={}).status_code == 422
    blank = _start(client, empty_id, period=LAST, agents=PHASE_A)
    bank = next(t for t in blank["tasks"] if t["agent"] == "bank_reconciliation")
    assert bank["status"] == "completed_with_exceptions"
    assert any(e["category"] == "data_gap" for e in blank["exceptions"])


def test_demo_seed_endpoint_rebuilds_group_and_ap(client, env, demo, sb):
    res = client.post(BASE + "/demo/seed" + q(demo.a)).json()
    assert [e["id"] for e in res["entities"]] == demo.group and res["ap_note"] is None
    invoices = sb.tables["invoices"]
    assert {i["company_id"] for i in invoices} == set(demo.group) | {demo.b, *(e for e in _ws_b_entities(sb, demo))}
    again = client.post(BASE + "/demo/seed" + q(demo.a)).json()
    assert again["ap"][demo.a] == res["ap"][demo.a]
    assert sum(1 for i in sb.tables["invoices"] if i["company_id"] == demo.a) == res["ap"][demo.a]["invoices"] == 3 * 250 + 7
    assert all(r["workspace_id"] == WS_A for r in sb.tables["companies"] if r["id"] in demo.group)


def _ws_b_entities(sb, demo):
    return [r["id"] for r in sb.tables["companies"] if r["workspace_id"] == WS_B]
