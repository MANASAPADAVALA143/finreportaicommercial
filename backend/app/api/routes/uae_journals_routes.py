"""JE approval endpoint — POST /api/uae/journals/approve-je"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.exceptions.period_control import PeriodControlError
from app.models.uae_accounting_full import UAEJournalEntry
from app.services.audit_log_service import log_audit
from app.services.notification_service import scan_notifications
from app.services.uae_journal_service import post_journal_entry

router = APIRouter(prefix="/api/uae/journals", tags=["UAE Journals"])


def _tenant(request: Request) -> str:
    return (
        request.headers.get("x-workspace-id")
        or request.headers.get("x-tenant-id")
        or "demo"
    )


class ApproveJEIn(BaseModel):
    je_id: str
    action: str  # approved | rejected
    reason: Optional[str] = None
    approved_by: Optional[str] = None


@router.post("/approve-je")
def approve_je(body: ApproveJEIn, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request)
    je = db.query(UAEJournalEntry).filter_by(id=body.je_id, tenant_id=tenant_id).first()
    if not je:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    if je.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Journal is not pending approval")

    approver = body.approved_by or request.headers.get("x-user-email") or "approver"
    action = (body.action or "").lower()

    if action == "approved":
        try:
            post_journal_entry(je, db)
        except PeriodControlError as exc:
            raise HTTPException(status_code=400, detail=exc.payload) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        je.approved_by = approver
        je.approved_at = datetime.utcnow()
        db.add(je)
        db.commit()
        log_audit(
            db,
            workspace_id=tenant_id,
            company_id=je.company_id,
            action="je_approved",
            entity_type="journal_entry",
            entity_id=je.id,
            user_email=approver,
            details={"entry_number": je.entry_number, "description": je.description},
        )
        db.commit()
        scan_notifications(db, tenant_id, je.company_id)
        return {"success": True, "je_id": je.id, "status": je.status}

    if action == "rejected":
        je.status = "rejected"
        je.rejection_reason = body.reason
        je.approved_by = approver
        je.approved_at = datetime.utcnow()
        db.add(je)
        db.commit()
        log_audit(
            db,
            workspace_id=tenant_id,
            company_id=je.company_id,
            action="je_rejected",
            entity_type="journal_entry",
            entity_id=je.id,
            user_email=approver,
            details={"reason": body.reason, "entry_number": je.entry_number},
        )
        db.commit()
        scan_notifications(db, tenant_id, je.company_id)
        return {"success": True, "je_id": je.id, "status": je.status}

    raise HTTPException(status_code=400, detail="action must be 'approved' or 'rejected'")
