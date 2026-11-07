"""NEXUS — coordinates the close agents for one company and month.

Tasks run in dependency waves (agents in the same wave run in parallel, each with its own
database session). A task retries once on an unexpected error. It is 'completed' only when
its output passes validation; failed blocking checks mark it failed. Later agents still run
and see what failed. The run then waits for journal decisions and a manager's close approval.
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.ai_close import AiCloseException, AiCloseJournalProposal, AiCloseRun, AiCloseTask
from app.models.uae_accounting_full import UAEBankStatement, UAEBankAccount, UAEJournalEntry, UAESalesInvoice
from app.services.ai_close import agents
from app.services.ai_close.context import CloseContext
from app.services.ai_close.journals import prepare_proposal
from app.services.uae_controls_service import PeriodControlError

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 2
SELECTABLE = ("bank_reconciliation", "ar_intelligence", "fpa")
DEPENDS_ON = {"bank_reconciliation": [], "ar_intelligence": [], "fpa": ["ar_intelligence"]}
TASK_TITLES = {
    "bank_reconciliation": "Reconcile bank statements to the ledger",
    "ar_intelligence": "Age receivables and prioritise collections",
    "fpa": "Budget variance and 30/60/90-day cash forecast",
    "close_manager": "Evaluate the close checklist",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_run(db: Session, *, workspace_id: str, company_id: str, period: str, agents_selected: list[str],
               requested_by: str | None) -> AiCloseRun:
    chosen = [a for a in SELECTABLE if a in agents_selected]
    run = AiCloseRun(workspace_id=workspace_id, company_id=company_id, period=period,
                     agents=chosen + ["close_manager"], status="queued", requested_by=requested_by)
    db.add(run)
    db.flush()
    waves: dict[str, int] = {}
    for agent in chosen:
        deps = [d for d in DEPENDS_ON[agent] if d in chosen]
        waves[agent] = 1 + max((waves[d] for d in deps), default=0)
        db.add(AiCloseTask(run_id=run.id, workspace_id=workspace_id, company_id=company_id, agent=agent,
                           title=TASK_TITLES[agent], depends_on=deps, wave=waves[agent], status="pending"))
    db.add(AiCloseTask(run_id=run.id, workspace_id=workspace_id, company_id=company_id, agent="close_manager",
                       title=TASK_TITLES["close_manager"], depends_on=chosen, wave=max(waves.values(), default=0) + 1,
                       status="pending"))
    db.commit()
    db.refresh(run)
    return run


def _persist_outcome(db: Session, run: AiCloseRun, task: AiCloseTask, outcome: agents.AgentOutcome) -> None:
    known = {fp for (fp,) in db.query(AiCloseException.fingerprint).filter(AiCloseException.run_id == run.id)}
    new_exceptions = 0
    for exc in outcome.exceptions:
        if exc.fingerprint in known:
            continue
        known.add(exc.fingerprint)
        new_exceptions += 1
        db.add(AiCloseException(
            run_id=run.id, task_id=task.id, workspace_id=run.workspace_id, company_id=run.company_id,
            agent=task.agent, fingerprint=exc.fingerprint[:200], category=exc.category, severity=exc.severity,
            title=exc.title[:300], detail=exc.detail, amount=exc.amount, source_refs=exc.refs, status="open",
        ))
    db.commit()
    prepared, skipped = 0, 0
    for draft in outcome.journals:
        try:
            if prepare_proposal(db, run, task, draft) is None:
                skipped += 1
            else:
                prepared += 1
        except PeriodControlError as err:
            db.rollback()
            db.add(AiCloseException(
                run_id=run.id, task_id=task.id, workspace_id=run.workspace_id, company_id=run.company_id,
                agent=task.agent, fingerprint=f"journal_blocked:{draft.fingerprint}"[:200], category="journal_blocked",
                severity="high", title=f"Could not prepare journal: {draft.title}"[:300], detail=str(err),
                amount=draft.amount, source_refs=draft.refs,
            ))
    messages = list(outcome.messages)
    if prepared:
        messages.append(f"Prepared {prepared} journal(s) for approval.")
    if skipped:
        messages.append(f"{skipped} adjustment(s) already proposed in an earlier run.")
    blocking_failed = [c for c in outcome.checks if c.blocking and not c.passed]
    task.records_processed = outcome.records_processed
    task.exceptions_count = new_exceptions
    task.output_json = outcome.output
    task.validation_json = [asdict(c) for c in outcome.checks]
    task.messages_json = messages
    if blocking_failed:
        task.status = "failed"
        task.error = "Output failed validation: " + "; ".join(c.detail for c in blocking_failed)
    elif new_exceptions or prepared:
        task.status = "completed_with_exceptions"
    else:
        task.status = "completed"


def _execute_task(session_factory: Callable[[], Session], task_id: int) -> None:
    db = session_factory()
    try:
        task = db.get(AiCloseTask, task_id)
        run = db.get(AiCloseRun, task.run_id)
        upstream = {
            t.agent: t.output_json or {}
            for t in db.query(AiCloseTask).filter(AiCloseTask.run_id == run.id, AiCloseTask.agent.in_(task.depends_on or []))
            if t.status in ("completed", "completed_with_exceptions")
        }
        _, fn = agents.AGENTS[task.agent]
        started = time.monotonic()
        task.started_at = _now()
        task.status = "running"
        db.commit()
        while True:
            task.attempts += 1
            db.commit()
            try:
                outcome = fn(CloseContext(db=db, workspace_id=run.workspace_id, company_id=run.company_id,
                                          period=run.period, run_id=run.id, upstream=upstream))
                _persist_outcome(db, run, task, outcome)
                break
            except Exception as exc:  # noqa: BLE001 - recorded on the task
                db.rollback()
                task = db.get(AiCloseTask, task_id)
                logger.warning("ai-close %s attempt %s failed: %s", task.agent, task.attempts, exc)
                if task.attempts >= MAX_ATTEMPTS:
                    task.status = "failed"
                    task.error = f"{type(exc).__name__}: {exc}"[:2000]
                    task.messages_json = [f"Failed after {task.attempts} attempts."]
                    break
        task.finished_at = _now()
        task.duration_ms = int((time.monotonic() - started) * 1000)
        db.commit()
    finally:
        db.close()


def refresh_status(db: Session, run: AiCloseRun) -> None:
    tasks = db.query(AiCloseTask).filter(AiCloseTask.run_id == run.id).all()
    if run.status == "closed":
        pass
    elif any(t.status in ("pending", "running") for t in tasks):
        run.status = "running"
    elif any(t.status == "failed" for t in tasks):
        run.status = "failed"
    else:
        run.status = "awaiting_approval"
    run.kpis_json = compute_kpis(db, run)


def recheck_close(db: Session, run: AiCloseRun) -> None:
    """Re-evaluate the checklist after journal decisions; the close manager task keeps its history."""
    task = db.query(AiCloseTask).filter(AiCloseTask.run_id == run.id, AiCloseTask.agent == "close_manager").first()
    if task is not None and task.status != "failed":
        task.output_json = agents.evaluate_checklist(db, run.id, run.workspace_id, run.company_id, run.period)
    refresh_status(db, run)
    db.commit()


def _freshness(db: Session, run: AiCloseRun) -> dict[str, Any]:
    last_journal = db.query(func.max(UAEJournalEntry.entry_date)).filter(
        UAEJournalEntry.tenant_id == run.workspace_id, UAEJournalEntry.company_id == run.company_id,
        UAEJournalEntry.status == "posted").scalar()
    last_statement = (
        db.query(func.max(UAEBankStatement.statement_date))
        .join(UAEBankAccount, UAEBankStatement.bank_account_id == UAEBankAccount.id)
        .filter(UAEBankAccount.tenant_id == run.workspace_id, UAEBankAccount.company_id == run.company_id).scalar()
    )
    last_invoice = db.query(func.max(UAESalesInvoice.invoice_date)).filter(
        UAESalesInvoice.tenant_id == run.workspace_id, UAESalesInvoice.company_id == run.company_id).scalar()
    return {
        "last_posted_journal": str(last_journal) if last_journal else None,
        "last_bank_statement": str(last_statement) if last_statement else None,
        "last_sales_invoice": str(last_invoice) if last_invoice else None,
        "captured_at": _now().isoformat(),
    }


def execute_run(run_id: int, session_factory: Callable[[], Session], max_workers: int = 4) -> None:
    db = session_factory()
    try:
        run = db.get(AiCloseRun, run_id)
        if run is None or run.status != "queued":
            return
        run.status, run.started_at = "running", _now()
        run.freshness_json = _freshness(db, run)
        db.commit()
        waves = sorted({t.wave for t in db.query(AiCloseTask).filter(AiCloseTask.run_id == run_id)})
        for wave in waves:
            ids = [t.id for t in db.query(AiCloseTask).filter(AiCloseTask.run_id == run_id, AiCloseTask.wave == wave)]
            if max_workers > 1 and len(ids) > 1:
                with ThreadPoolExecutor(max_workers=min(max_workers, len(ids))) as pool:
                    list(pool.map(lambda tid: _execute_task(session_factory, tid), ids))
            else:
                for tid in ids:
                    _execute_task(session_factory, tid)
            db.expire_all()
        run = db.get(AiCloseRun, run_id)
        run.finished_at = _now()
        refresh_status(db, run)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.exception("ai-close run %s crashed", run_id)
        db.rollback()
        run = db.get(AiCloseRun, run_id)
        if run is not None:
            run.status, run.error, run.finished_at = "failed", f"{type(exc).__name__}: {exc}"[:2000], _now()
            db.commit()
    finally:
        db.close()


# ── KPIs ─────────────────────────────────────────────────────────────────────


def _out(tasks: dict[str, AiCloseTask], agent: str) -> dict[str, Any] | None:
    task = tasks.get(agent)
    if task is None or task.status not in ("completed", "completed_with_exceptions"):
        return None
    return task.output_json or {}


def compute_kpis(db: Session, run: AiCloseRun) -> list[dict[str, Any]]:
    tasks = {t.agent: t for t in db.query(AiCloseTask).filter(AiCloseTask.run_id == run.id)}
    bank, ar, close = _out(tasks, "bank_reconciliation"), _out(tasks, "ar_intelligence"), _out(tasks, "close_manager")
    exceptions = db.query(AiCloseException).filter(AiCloseException.run_id == run.id)
    pending = db.query(AiCloseJournalProposal).filter(
        AiCloseJournalProposal.run_id == run.id, AiCloseJournalProposal.status == "pending_approval").count()
    open_tasks = None if close is None else sum(1 for i in close.get("items", []) if i["status"] != "done")

    def kpi(key, label, value, definition, unit=None, source=None):
        return {"key": key, "label": label, "value": value, "unit": unit, "definition": definition,
                "source": source, "available": value is not None}

    return [
        kpi("close_completion_pct", "Month-end close completion", close and close.get("completion_pct"),
            "Close checklist items done / applicable items (agents not run count as not done).", "%", "close_manager"),
        kpi("bank_transactions_processed", "Bank transactions processed", bank and bank.get("total_lines"),
            "Bank statement lines dated in the period across the company's accounts.", None, "bank_reconciliation"),
        kpi("transactions_reconciled", "Transactions reconciled", bank and bank.get("matched"),
            "Statement lines matched to a posted ledger cash line.", None, "bank_reconciliation"),
        kpi("unmatched_transactions", "Unmatched transactions",
            bank and (bank.get("unmatched_bank", 0) + bank.get("unmatched_ledger", 0)),
            "Statement lines with no ledger match plus ledger cash lines not on the statement.", None, "bank_reconciliation"),
        kpi("ap_invoices_processed", "AP invoices processed", None, "Phase B: AP agent not part of this workflow yet."),
        kpi("ap_exceptions", "AP exceptions", None, "Phase B: AP agent not part of this workflow yet."),
        kpi("ar_overdue_invoices", "AR overdue invoices", ar and ar.get("overdue_invoice_count"),
            "Open sales invoices past due at period end.", None, "ar_intelligence"),
        kpi("ifrs_checks_completed", "IFRS checks completed", None, "Phase B: IFRS agent not part of this workflow yet."),
        kpi("pending_journal_approvals", "Pending journal approvals", pending,
            "Agent-proposed journals from this run awaiting a decision.", None, "journal_proposals"),
        kpi("open_closing_tasks", "Open closing tasks", open_tasks, "Close checklist items not done.", None, "close_manager"),
        kpi("exceptions_identified", "Exceptions identified", exceptions.count(),
            "Unique issues found by agents in this run (one per source item, never double-counted).", None, "exceptions"),
        kpi("agents_executed", "Agents executed",
            sum(1 for t in tasks.values() if t.status in ("completed", "completed_with_exceptions")),
            "Agents whose output passed validation.", None, "tasks"),
    ]
