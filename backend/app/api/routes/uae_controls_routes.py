"""UAE accounting controls — settings + JE approval queue."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.uae_accounting_full import UAEJournalEntry
from app.services import company_setup_service as setup_svc
from app.exceptions.period_control import PeriodControlError
from app.services.audit_log_service import log_audit
from app.services.notification_service import scan_notifications
from app.services.uae_controls_service import get_controls, validate_journal_entry
from app.services.uae_journal_service import post_journal_entry

router = APIRouter(prefix="/api/uae/controls", tags=["UAE Controls"])


def _tenant(request: Request) -> str:
    return (
        request.headers.get("x-workspace-id")
        or request.headers.get("x-tenant-id")
        or "demo"
    )


class ControlsUpdate(BaseModel):
    je_approval_threshold_aed: Optional[float] = None
    allow_backdating: Optional[bool] = None
    max_backdate_days: Optional[int] = None
    require_docs_account_ids: Optional[list[str]] = None
    dual_approval_account_ids: Optional[list[str]] = None
    company_id: Optional[str] = None


@router.get("")
def get_workspace_controls(request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request)
    controls = get_controls(db, tenant_id)
    if not controls:
        return {
            "controls": {
                "je_approval_threshold_aed": 50000,
                "allow_backdating": True,
                "max_backdate_days": 30,
                "require_docs_account_ids": [],
                "dual_approval_account_ids": [],
            }
        }
    return {"controls": setup_svc._controls_dict(controls)}


@router.patch("")
def update_workspace_controls(body: ControlsUpdate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request)
    data = body.model_dump(exclude_none=True)
    company_id = data.pop("company_id", None)
    updated = setup_svc.save_controls(db, tenant_id, company_id, data)
    return {"controls": updated}


@router.get("/pending-journals")
def pending_journals(
    request: Request,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request)
    q = db.query(UAEJournalEntry).filter_by(tenant_id=tenant_id, status="pending_approval")
    if company_id:
        q = q.filter(UAEJournalEntry.company_id == company_id)
    entries = q.order_by(UAEJournalEntry.created_at.desc()).limit(100).all()
    return {
        "entries": [
            {
                "id": e.id,
                "entry_number": e.entry_number,
                "entry_date": str(e.entry_date),
                "description": e.description,
                "source": e.source,
                "status": e.status,
                "total_debit": sum(float(l.debit or 0) for l in e.lines),
                "lines": [
                    {"account_code": l.account_code, "debit": float(l.debit or 0),
                     "credit": float(l.credit or 0), "description": l.description}
                    for l in e.lines
                ],
            }
            for e in entries
        ],
        "count": len(entries),
    }


@router.post("/journals/{je_id}/approve")
def approve_journal(je_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request)
    je = db.query(UAEJournalEntry).filter_by(id=je_id, tenant_id=tenant_id).first()
    if not je:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    if je.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Journal is not pending approval")
    approver = request.headers.get("x-user-email") or "approver"
    try:
        post_journal_entry(je, db)
    except PeriodControlError as exc:
        raise HTTPException(status_code=400, detail=exc.payload) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    from datetime import datetime
    je.approved_by = approver
    je.approved_at = datetime.utcnow()
    db.add(je)
    log_audit(
        db, workspace_id=tenant_id, company_id=je.company_id,
        action="je_approved", entity_type="journal_entry", entity_id=je.id,
        user_email=approver,
        details={"entry_number": je.entry_number},
    )
    db.commit()
    scan_notifications(db, tenant_id, je.company_id)
    return {"id": je.id, "status": je.status}


@router.post("/journals/{je_id}/reject")
def reject_journal(je_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request)
    je = db.query(UAEJournalEntry).filter_by(id=je_id, tenant_id=tenant_id).first()
    if not je:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    if je.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Journal is not pending approval")
    from datetime import datetime
    approver = request.headers.get("x-user-email") or "approver"
    je.status = "rejected"
    je.rejection_reason = "Rejected via controls queue"
    je.approved_by = approver
    je.approved_at = datetime.utcnow()
    db.add(je)
    log_audit(
        db, workspace_id=tenant_id, company_id=je.company_id,
        action="je_rejected", entity_type="journal_entry", entity_id=je.id,
        user_email=approver,
    )
    db.commit()
    return {"id": je.id, "status": je.status}


@router.post("/validate")
def validate_je_preview(body: dict[str, Any], request: Request, db: Session = Depends(get_db)):
    """Preview control checks for a JE before submit."""
    from datetime import date as dt_date
    tenant_id = _tenant(request)
    entry_date = dt_date.fromisoformat(body["entry_date"])
    lines = body.get("lines", [])
    source = body.get("source", "manual")
    return validate_journal_entry(
        entry_date=entry_date, lines=lines, source=source,
        workspace_id=tenant_id, db=db,
    )
