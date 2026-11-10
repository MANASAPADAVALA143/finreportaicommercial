"""Approval controls for the close: segregation of duties and approval limits by amount."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.ai_close import AiCloseControls, AiCloseJournalProposal, AiCloseRun

OWNER_ROLES = {"owner"}


class ControlViolation(PermissionError):
    pass


def get(db: Session, workspace_id: str, company_id: str) -> AiCloseControls | None:
    return db.query(AiCloseControls).filter(
        AiCloseControls.workspace_id == workspace_id, AiCloseControls.company_id == company_id).first()


def describe(c: AiCloseControls | None) -> dict[str, Any]:
    return {"require_segregation": bool(c and c.require_segregation),
            "manager_limit": c.manager_limit if c else None, "updated_by": c.updated_by if c else None}


def _same_person(a: str | None, b: str | None) -> bool:
    return bool(a and b and a.strip().lower() == b.strip().lower())


def check_journal(db: Session, proposal: AiCloseJournalProposal, run: AiCloseRun | None, *, user_email: str | None,
                  role: str | None, unrestricted: bool, decision: str) -> None:
    """Raise ControlViolation if this user may not take this decision on this journal."""
    controls = get(db, proposal.workspace_id, run.company_id if run else proposal.company_id)
    if controls is None or unrestricted:
        return
    if controls.require_segregation and _same_person(user_email, run.requested_by if run else proposal.requested_by):
        raise ControlViolation("Segregation of duties: you started this close, so another approver must decide its journals")
    if (decision == "approved" and controls.manager_limit is not None and (role or "") not in OWNER_ROLES
            and (proposal.amount or 0) > controls.manager_limit):
        raise ControlViolation(
            f"Above your approval limit of {controls.manager_limit:,.2f}: an owner must approve this {proposal.amount:,.2f} journal")


def check_close(db: Session, run: AiCloseRun, *, user_email: str | None, unrestricted: bool) -> None:
    controls = get(db, run.workspace_id, run.company_id)
    if controls is None or unrestricted:
        return
    if controls.require_segregation and _same_person(user_email, run.requested_by):
        raise ControlViolation("Segregation of duties: you started this close, so another approver must approve it")
