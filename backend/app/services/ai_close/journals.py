"""Journal proposals, approval decisions and the final close approval with period lock.

Agents only *prepare* journals: each proposal is a real uae_journal_entries row with
status 'pending_approval', created through the standard journal service. Posting happens
only when a manager approves it, through the same post_journal_entry used everywhere
else (which re-checks the period is open and the entry balances).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai_close import AiCloseJournalProposal, AiCloseRun, AiCloseTask
from app.models.company_setup import AccountingPeriod
from app.models.uae_accounting_full import UAEJournalEntry
from app.services.ai_close.context import JournalDraft, period_bounds
from app.services.audit_log_service import log_audit
from app.services.uae_controls_service import PeriodControlError
from app.services.uae_journal_service import create_journal_entry, post_journal_entry

LIVE_STATUSES = ("pending_approval", "approved")


class DecisionError(ValueError):
    pass


def prepare_proposal(db: Session, run: AiCloseRun, task: AiCloseTask, draft: JournalDraft) -> AiCloseJournalProposal | None:
    """Create the pending journal, unless the same adjustment is already pending or approved."""
    existing = db.query(AiCloseJournalProposal).filter(
        AiCloseJournalProposal.workspace_id == run.workspace_id,
        AiCloseJournalProposal.company_id == run.company_id,
        AiCloseJournalProposal.fingerprint == draft.fingerprint,
        AiCloseJournalProposal.status.in_(LIVE_STATUSES),
    ).first()
    if existing is not None:
        return None
    seq = db.query(AiCloseJournalProposal).filter(AiCloseJournalProposal.run_id == run.id).count() + 1
    je = create_journal_entry(
        run.workspace_id, draft.entry_date, draft.title[:500], draft.lines,
        reference=f"AICLOSE-{run.id}-{seq:03d}", source="manual", company_id=run.company_id,
        db=db, initial_status="pending_approval",
    )
    proposal = AiCloseJournalProposal(
        run_id=run.id, task_id=task.id, workspace_id=run.workspace_id, company_id=run.company_id,
        agent=task.agent, fingerprint=draft.fingerprint, journal_entry_id=je.id, entry_number=je.entry_number,
        title=draft.title[:300], rationale=draft.rationale, amount=draft.amount, source_refs=draft.refs,
        status="pending_approval", prepared_by=f"ai-agent:{task.agent}", requested_by=run.requested_by,
    )
    db.add(proposal)
    db.flush()
    return proposal


def journal_detail(db: Session, proposal: AiCloseJournalProposal) -> dict[str, Any]:
    je = db.get(UAEJournalEntry, proposal.journal_entry_id)
    lines = []
    if je is not None:
        lines = [
            {"account_code": ln.account_code, "account_name": ln.account_name, "description": ln.description,
             "debit": round(float(ln.debit or 0), 2), "credit": round(float(ln.credit or 0), 2)}
            for ln in je.lines
        ]
    return {
        "journal_status": je.status if je else "missing",
        "entry_date": str(je.entry_date) if je else None,
        "period": je.period if je else None,
        "description": je.description if je else None,
        "lines": lines,
        "total_debit": round(sum(ln["debit"] for ln in lines), 2),
        "total_credit": round(sum(ln["credit"] for ln in lines), 2),
        "approved_by": je.approved_by if je else None,
        "approved_at": je.approved_at.isoformat() if je and je.approved_at else None,
    }


def decide(
    db: Session, proposal: AiCloseJournalProposal, decision: str, user_email: str | None, note: str | None
) -> AiCloseJournalProposal:
    if proposal.status != "pending_approval":
        raise DecisionError(f"Journal proposal is already {proposal.status.replace('_', ' ')}")
    je = db.get(UAEJournalEntry, proposal.journal_entry_id)
    if je is None or je.status != "pending_approval":
        raise DecisionError("The journal is no longer awaiting approval")
    note = (note or "").strip() or None
    now = datetime.now(timezone.utc)
    if decision == "approved":
        try:
            post_journal_entry(je, db)
        except PeriodControlError as exc:
            db.rollback()
            raise DecisionError(str(exc)) from exc
        except ValueError as exc:
            db.rollback()
            raise DecisionError(str(exc)) from exc
        je.approved_by = (user_email or "")[:200] or None
        je.approved_at = now.replace(tzinfo=None)
    elif decision in ("rejected", "changes_requested"):
        if decision == "changes_requested" and not note:
            raise DecisionError("Say what should change")
        je.status = "rejected"
        je.rejection_reason = (("Changes requested: " if decision == "changes_requested" else "") + (note or "Rejected"))[:500]
    else:
        raise DecisionError("Unknown decision")
    proposal.status = decision
    proposal.decided_by = user_email
    proposal.decided_at = now
    proposal.decision_note = note
    log_audit(
        db, workspace_id=proposal.workspace_id, company_id=proposal.company_id,
        action={"approved": "je_approved", "rejected": "je_rejected", "changes_requested": "je_changes_requested"}[decision],
        entity_type="journal_entry", entity_id=proposal.journal_entry_id, user_email=user_email,
        details={"source": "ai_close", "proposal_id": proposal.id, "run_id": proposal.run_id,
                 "prepared_by": proposal.prepared_by, "note": note, "amount": proposal.amount},
    )
    db.commit()
    db.refresh(proposal)
    return proposal


def _period_row(db: Session, run: AiCloseRun) -> AccountingPeriod:
    start, end = period_bounds(run.period)
    row = db.query(AccountingPeriod).filter(
        AccountingPeriod.workspace_id == run.workspace_id,
        AccountingPeriod.company_id == run.company_id,
        AccountingPeriod.start_date <= start,
        AccountingPeriod.end_date >= end,
    ).first()
    if row is None:
        row = AccountingPeriod(
            workspace_id=run.workspace_id, company_id=run.company_id,
            period_number=int(run.period.replace("-", "")), period_name=run.period,
            start_date=start, end_date=end, status="open",
        )
        db.add(row)
        db.flush()
    return row


def approve_close(
    db: Session, run: AiCloseRun, *, user_email: str | None, user_id: str | None, note: str | None, open_items: int
) -> AccountingPeriod:
    if run.status != "awaiting_approval":
        raise DecisionError(f"The close is {run.status.replace('_', ' ')}, not awaiting approval")
    pending = db.query(AiCloseJournalProposal).filter(
        AiCloseJournalProposal.run_id == run.id, AiCloseJournalProposal.status == "pending_approval").count()
    if pending:
        raise DecisionError(f"{pending} proposed journal(s) still need a decision")
    note = (note or "").strip() or None
    if open_items and not note:
        raise DecisionError(f"{open_items} checklist item(s) are open; add a note explaining why the close is approved anyway")
    period = _period_row(db, run)
    if period.status != "locked":
        period.status = "locked"
        period.locked_by = (user_id or "")[:36] or None
        period.locked_at = datetime.utcnow()
    now = datetime.now(timezone.utc)
    run.status = "closed"
    run.close_approved_by = user_email
    run.close_approved_at = now
    run.close_note = note
    log_audit(
        db, workspace_id=run.workspace_id, company_id=run.company_id, action="period_locked",
        entity_type="accounting_period", entity_id=period.id, user_email=user_email,
        details={"source": "ai_close", "run_id": run.id, "period": run.period, "open_items": open_items, "note": note},
    )
    db.commit()
    return period
