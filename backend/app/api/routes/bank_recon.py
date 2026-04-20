"""
Enterprise bank reconciliation REST API.
"""
from __future__ import annotations

import io
import uuid
from collections import Counter
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.models.bank_recon import (
    AdjustmentType,
    AffectsSide,
    BankTransaction,
    BankTxnStatus,
    BookTransaction,
    BookTxnStatus,
    DebitCredit,
    MatchGroup,
    MatchGroupStatus,
    MatchTypeEnum,
    ReconAuditAction,
    ReconAuditTrail,
    ReconciliationAdjustment,
    ReconException,
    ReconExceptionType,
    ReconWorkspace,
    ReconWorkspaceStatus,
    ReconWorkspaceType,
    ExceptionSeverity,
)
from app.services import recon_engine
from app.services.recon_file_parser import parse_upload

router = APIRouter(prefix="/api/recon", tags=["bank-recon"])

MATCH_JOBS: dict[str, dict[str, Any]] = {}


def _tenant(tenant_id: Optional[str] = Query(default="default")) -> str:
    return tenant_id or "default"


def _log_audit(
    db: Session,
    workspace_id: int,
    action: ReconAuditAction,
    *,
    performed_by: str | None = None,
    details: dict | None = None,
    ip_address: str | None = None,
) -> None:
    db.add(
        ReconAuditTrail(
            workspace_id=workspace_id,
            action=action,
            performed_by=performed_by,
            details=details or {},
            ip_address=ip_address,
        )
    )


def _persist_duplicate_exceptions(
    db: Session,
    workspace_id: int,
    dups: list[dict[str, Any]],
    *,
    side: str,
) -> int:
    if not dups:
        return 0
    seen: set[tuple[int, int]] = set()
    n = 0
    for dup in dups:
        a, b = int(dup["txn1_id"]), int(dup["txn2_id"])
        key = (min(a, b), max(a, b))
        if key in seen:
            continue
        seen.add(key)
        desc = (
            f"Possible duplicate: {dup.get('amount')} on {dup['date1']} and {dup['date2']} "
            f"(txn ids {a}, {b}; description similarity {dup.get('similarity')})"
        )
        amt = dup.get("amount")
        ex = ReconException(
            workspace_id=workspace_id,
            exception_type=ReconExceptionType.duplicate_detected,
            severity=ExceptionSeverity.high,
            description=desc,
            amount=Decimal(str(amt)) if amt is not None else None,
            book_txn_id=a if side == "book" else None,
            bank_txn_id=a if side == "bank" else None,
        )
        db.add(ex)
        _log_audit(
            db,
            workspace_id,
            ReconAuditAction.exception_raised,
            performed_by="system",
            details={
                "type": "duplicate_detected",
                "amount": amt,
                "txn1_id": a,
                "txn2_id": b,
            },
        )
        n += 1
    return n


def _recalc_workspace(db: Session, ws: ReconWorkspace) -> None:
    book_sum = (
        db.query(func.coalesce(func.sum(BookTransaction.amount), 0))
        .filter(BookTransaction.workspace_id == ws.id)
        .scalar()
    )
    bank_sum = (
        db.query(func.coalesce(func.sum(BankTransaction.amount), 0))
        .filter(BankTransaction.workspace_id == ws.id)
        .scalar()
    )
    ws.total_book_balance = Decimal(str(book_sum or 0))
    ws.total_bank_balance = Decimal(str(bank_sum or 0))

    adj_bank = adj_book = Decimal("0")
    for adj in ws.adjustments:
        a = Decimal(str(adj.amount))
        if adj.affects_side == AffectsSide.bank:
            adj_bank += a
        elif adj.affects_side == AffectsSide.book:
            adj_book += a
        else:
            adj_bank += a / 2
            adj_book += a / 2

    out_dep = Decimal(str(ws.outstanding_deposits or 0))
    out_chq = Decimal(str(ws.outstanding_cheques or 0))
    ws.adjusted_bank_balance = ws.total_bank_balance + out_dep - out_chq + adj_bank
    ws.adjusted_book_balance = ws.total_book_balance + adj_book
    ws.variance = (ws.adjusted_book_balance or Decimal("0")) - (ws.adjusted_bank_balance or Decimal("0"))
    ws.is_reconciled = abs(ws.variance) < Decimal("0.01")
    ws.updated_at = datetime.utcnow()


class WorkspaceCreate(BaseModel):
    workspace_name: str
    period_start: date
    period_end: date
    recon_type: ReconWorkspaceType = ReconWorkspaceType.bank_to_gl
    currency: str = "USD"
    assigned_preparer_id: str | None = None
    assigned_reviewer_id: str | None = None
    due_date: date | None = None


class AdjustmentCreate(BaseModel):
    adjustment_type: AdjustmentType
    description: str | None = None
    amount: Decimal
    affects_side: AffectsSide
    journal_entry_required: bool = False


class ManualMatchBody(BaseModel):
    book_txn_ids: list[int] = Field(default_factory=list)
    bank_txn_ids: list[int] = Field(default_factory=list)


class ExceptionResolveBody(BaseModel):
    resolution_notes: str
    resolved_by: str | None = None


class ExceptionCreateBody(BaseModel):
    exception_type: ReconExceptionType
    severity: ExceptionSeverity = ExceptionSeverity.medium
    description: str | None = None
    bank_txn_id: int | None = None
    book_txn_id: int | None = None
    amount: Decimal | None = None
    assigned_to: str | None = None


class MatchRejectBody(BaseModel):
    reason: str | None = None
    performed_by: str | None = None


class MatchConfirmBody(BaseModel):
    confirmed_by: str | None = None


@router.post("/workspace")
def create_workspace(
    body: WorkspaceCreate,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
):
    ws = ReconWorkspace(
        tenant_id=tenant_id,
        workspace_name=body.workspace_name,
        period_start=body.period_start,
        period_end=body.period_end,
        recon_type=body.recon_type,
        currency=body.currency,
        assigned_preparer_id=body.assigned_preparer_id,
        assigned_reviewer_id=body.assigned_reviewer_id,
        due_date=body.due_date,
        status=ReconWorkspaceStatus.open,
    )
    db.add(ws)
    db.flush()
    _log_audit(db, ws.id, ReconAuditAction.workspace_created, details={"name": body.workspace_name})
    db.commit()
    db.refresh(ws)
    return ws


def _workspace_completion(db: Session, ws: ReconWorkspace) -> float:
    total_b = db.query(func.count(BookTransaction.id)).filter(BookTransaction.workspace_id == ws.id).scalar() or 0
    if total_b == 0:
        return 0.0
    matched = (
        db.query(func.count(BookTransaction.id))
        .filter(
            BookTransaction.workspace_id == ws.id,
            BookTransaction.status != BookTxnStatus.unmatched,
        )
        .scalar()
        or 0
    )
    return round(float(matched) / float(total_b) * 100.0, 2)


@router.get("/workspaces")
def list_workspaces(
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
    status: Optional[ReconWorkspaceStatus] = None,
    recon_type: Optional[ReconWorkspaceType] = None,
    period_start: Optional[date] = None,
    period_end: Optional[date] = None,
):
    q = db.query(ReconWorkspace).filter(ReconWorkspace.tenant_id == tenant_id)
    if status:
        q = q.filter(ReconWorkspace.status == status)
    if recon_type:
        q = q.filter(ReconWorkspace.recon_type == recon_type)
    if period_start:
        q = q.filter(ReconWorkspace.period_start >= period_start)
    if period_end:
        q = q.filter(ReconWorkspace.period_end <= period_end)
    rows = q.order_by(ReconWorkspace.created_at.desc()).all()
    today = date.today()
    out = []
    for ws in rows:
        completion = _workspace_completion(db, ws)
        due = ws.due_date
        days_until = (due - today).days if due else None
        _recalc_workspace(db, ws)
        out.append(
            {
                "id": ws.id,
                "workspace_name": ws.workspace_name,
                "period_start": ws.period_start,
                "period_end": ws.period_end,
                "recon_type": ws.recon_type.value,
                "currency": ws.currency,
                "status": ws.status.value,
                "assigned_preparer_id": ws.assigned_preparer_id,
                "assigned_reviewer_id": ws.assigned_reviewer_id,
                "due_date": ws.due_date,
                "completion_percent": completion,
                "days_until_due": days_until,
                "variance": float(ws.variance or 0),
                "is_overdue": bool(due and due < today and ws.status != ReconWorkspaceStatus.locked),
            }
        )
    db.commit()
    return out


@router.get("/workspace/{workspace_id}")
def get_workspace_detail(workspace_id: int, db: Session = Depends(get_db), tenant_id: str = Depends(_tenant)):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    _recalc_workspace(db, ws)

    total_book = db.query(func.count(BookTransaction.id)).filter(BookTransaction.workspace_id == ws.id).scalar() or 0
    matched_book = (
        db.query(func.count(BookTransaction.id))
        .filter(
            BookTransaction.workspace_id == ws.id,
            BookTransaction.status != BookTxnStatus.unmatched,
        )
        .scalar()
        or 0
    )
    ex_count = (
        db.query(func.count(ReconException.id))
        .filter(ReconException.workspace_id == ws.id, ReconException.resolved.is_(False))
        .scalar()
        or 0
    )
    critical_ex = (
        db.query(func.count(ReconException.id))
        .filter(
            ReconException.workspace_id == ws.id,
            ReconException.resolved.is_(False),
            ReconException.severity == ExceptionSeverity.critical,
        )
        .scalar()
        or 0
    )

    tiers = (
        db.query(MatchGroup.match_type, func.count(MatchGroup.id))
        .filter(MatchGroup.workspace_id == ws.id)
        .group_by(MatchGroup.match_type)
        .all()
    )
    tier_breakdown = {t.value: 0 for t in MatchTypeEnum}
    for mt, c in tiers:
        tier_breakdown[mt.value] = c

    audit = (
        db.query(ReconAuditTrail)
        .filter(ReconAuditTrail.workspace_id == ws.id)
        .order_by(ReconAuditTrail.performed_at.desc())
        .limit(10)
        .all()
    )

    match_rate_pct = _workspace_completion(db, ws)
    db.commit()

    return {
        "workspace": {
            "id": ws.id,
            "workspace_name": ws.workspace_name,
            "period_start": ws.period_start,
            "period_end": ws.period_end,
            "recon_type": ws.recon_type.value,
            "currency": ws.currency,
            "status": ws.status.value,
            "due_date": ws.due_date,
            "sign_off_preparer": ws.sign_off_preparer,
            "sign_off_reviewer": ws.sign_off_reviewer,
            "total_book_balance": float(ws.total_book_balance or 0),
            "total_bank_balance": float(ws.total_bank_balance or 0),
            "outstanding_deposits": float(ws.outstanding_deposits or 0),
            "outstanding_cheques": float(ws.outstanding_cheques or 0),
            "adjusted_book_balance": float(ws.adjusted_book_balance or 0),
            "adjusted_bank_balance": float(ws.adjusted_bank_balance or 0),
            "variance": float(ws.variance or 0),
            "is_reconciled": ws.is_reconciled,
        },
        "progress": {"matched": matched_book, "total": total_book},
        "match_rate_pct": match_rate_pct,
        "exceptions_open": ex_count,
        "critical_exceptions": critical_ex,
        "tier_breakdown": tier_breakdown,
        "adjustments": [
            {
                "id": a.id,
                "adjustment_type": a.adjustment_type.value,
                "amount": float(a.amount),
                "affects_side": a.affects_side.value,
                "je_posted": a.je_posted,
            }
            for a in ws.adjustments
        ],
        "exceptions": [
            {
                "id": e.id,
                "exception_type": e.exception_type.value,
                "severity": e.severity.value,
                "resolved": e.resolved,
                "amount": float(e.amount) if e.amount is not None else None,
            }
            for e in ws.exceptions
            if not e.resolved
        ],
        "audit_trail": [
            {
                "id": a.id,
                "action": a.action.value,
                "performed_by": a.performed_by,
                "performed_at": a.performed_at.isoformat(),
                "details": a.details,
            }
            for a in audit
        ],
    }


def _save_book_rows(db: Session, ws_id: int, rows: list[dict]) -> list[BookTransaction]:
    out = []
    for r in rows:
        dc = r.get("debit_credit", "D")
        out.append(
            BookTransaction(
                workspace_id=ws_id,
                txn_date=r["txn_date"],
                value_date=r.get("value_date"),
                posting_date=r.get("posting_date"),
                amount=r["amount"],
                debit_credit=DebitCredit(dc) if isinstance(dc, str) else dc,
                description=r.get("description"),
                reference=r.get("reference"),
                gl_account=r.get("gl_account"),
                source_system=r.get("source_system"),
                status=BookTxnStatus.unmatched,
            )
        )
    db.add_all(out)
    db.flush()
    return out


def _save_bank_rows(db: Session, ws_id: int, rows: list[dict]) -> list[BankTransaction]:
    out = []
    for r in rows:
        dc = r.get("debit_credit", "D")
        out.append(
            BankTransaction(
                workspace_id=ws_id,
                txn_date=r["txn_date"],
                value_date=r.get("value_date"),
                amount=r["amount"],
                debit_credit=DebitCredit(dc) if isinstance(dc, str) else dc,
                description=r.get("description"),
                bank_reference=r.get("bank_reference") or r.get("reference"),
                status=BankTxnStatus.unmatched,
            )
        )
    db.add_all(out)
    db.flush()
    return out


@router.post("/workspace/{workspace_id}/upload/book")
async def upload_book(
    workspace_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    content = await file.read()
    rows, meta = parse_upload(content, file.filename or "book.csv", side="book")
    saved = _save_book_rows(db, ws.id, rows)
    dups = recon_engine.detect_duplicates(saved)
    dup_n = _persist_duplicate_exceptions(db, ws.id, dups, side="book")
    _log_audit(
        db,
        ws.id,
        ReconAuditAction.file_uploaded,
        details={"side": "book", "filename": file.filename, **meta},
    )
    _recalc_workspace(db, ws)
    db.commit()
    return {
        "lines_imported": len(saved),
        "duplicates_found": dups,
        "duplicate_exceptions_created": dup_n,
    }


@router.post("/workspace/{workspace_id}/upload/bank")
async def upload_bank(
    workspace_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    content = await file.read()
    rows, meta = parse_upload(content, file.filename or "bank.csv", side="bank")
    saved = _save_bank_rows(db, ws.id, rows)
    dups = recon_engine.detect_duplicates(saved)
    dup_n = _persist_duplicate_exceptions(db, ws.id, dups, side="bank")
    _log_audit(
        db,
        ws.id,
        ReconAuditAction.file_uploaded,
        details={"side": "bank", "filename": file.filename, **meta},
    )
    _recalc_workspace(db, ws)
    db.commit()
    return {
        "lines_imported": len(saved),
        "duplicates_found": dups,
        "duplicate_exceptions_created": dup_n,
    }


async def _matching_worker(job_id: str, workspace_id: int):
    db = SessionLocal()
    try:
        MATCH_JOBS[job_id]["status"] = "running"
        result = await recon_engine.run_full_matching_engine(workspace_id, db)
        MATCH_JOBS[job_id]["status"] = "completed"
        MATCH_JOBS[job_id]["result"] = result
        db2 = SessionLocal()
        try:
            w = db2.query(ReconWorkspace).filter_by(id=workspace_id).first()
            if w:
                _log_audit(
                    db2,
                    workspace_id,
                    ReconAuditAction.auto_match_run,
                    details=result.get("stats"),
                )
                w.status = ReconWorkspaceStatus.in_progress
                db2.commit()
        finally:
            db2.close()
    except Exception as e:
        MATCH_JOBS[job_id]["status"] = "failed"
        MATCH_JOBS[job_id]["error"] = str(e)
    finally:
        db.close()


@router.post("/workspace/{workspace_id}/run-matching")
async def run_matching(
    workspace_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    job_id = str(uuid.uuid4())
    MATCH_JOBS[job_id] = {"status": "started", "workspace_id": workspace_id}
    background_tasks.add_task(_matching_worker, job_id, workspace_id)
    return {"job_id": job_id, "status": "started"}


@router.get("/workspace/{workspace_id}/match-results")
def match_results(workspace_id: int, db: Session = Depends(get_db), tenant_id: str = Depends(_tenant)):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")

    groups = db.query(MatchGroup).filter(MatchGroup.workspace_id == workspace_id).all()

    def _book_ser(b: BookTransaction) -> dict:
        return {
            "id": b.id,
            "txn_date": b.txn_date.isoformat(),
            "amount": float(b.amount),
            "description": b.description,
            "reference": b.reference,
            "gl_account": b.gl_account,
        }

    def _bank_ser(b: BankTransaction) -> dict:
        return {
            "id": b.id,
            "txn_date": b.txn_date.isoformat(),
            "amount": float(b.amount),
            "description": b.description,
            "bank_reference": b.bank_reference,
        }

    def serialize_group(g: MatchGroup) -> dict:
        books = db.query(BookTransaction).filter(BookTransaction.match_id == g.id).all()
        banks = db.query(BankTransaction).filter(BankTransaction.match_id == g.id).all()
        return {
            "id": g.id,
            "match_type": g.match_type.value,
            "confidence_score": g.confidence_score,
            "status": g.status.value,
            "amount_variance": float(g.amount_variance),
            "date_variance_days": g.date_variance_days,
            "description_similarity": g.description_similarity,
            "ai_reasoning": g.ai_reasoning,
            "book_txn_ids": [b.id for b in books],
            "bank_txn_ids": [b.id for b in banks],
            "book_transactions": [_book_ser(b) for b in books],
            "bank_transactions": [_bank_ser(b) for b in banks],
        }

    by_status: dict[str, list] = {"auto_confirmed": [], "pending_review": [], "disputed": [], "confirmed": [], "rejected": []}
    for g in groups:
        key = g.status.value if g.status.value in by_status else "pending_review"
        if key not in by_status:
            by_status["pending_review"].append(serialize_group(g))
        else:
            by_status[key].append(serialize_group(g))

    total_book = db.query(func.count(BookTransaction.id)).filter(BookTransaction.workspace_id == workspace_id).scalar() or 0
    matched = (
        db.query(func.count(BookTransaction.id))
        .filter(
            BookTransaction.workspace_id == workspace_id,
            BookTransaction.status != BookTxnStatus.unmatched,
        )
        .scalar()
        or 0
    )
    ex_c = (
        db.query(func.count(ReconException.id))
        .filter(ReconException.workspace_id == workspace_id, ReconException.resolved.is_(False))
        .scalar()
        or 0
    )
    um_book = (
        db.query(func.count(BookTransaction.id))
        .filter(
            BookTransaction.workspace_id == workspace_id,
            BookTransaction.status == BookTxnStatus.unmatched,
        )
        .scalar()
        or 0
    )
    um_bank = (
        db.query(func.count(BankTransaction.id))
        .filter(
            BankTransaction.workspace_id == workspace_id,
            BankTransaction.status == BankTxnStatus.unmatched,
        )
        .scalar()
        or 0
    )
    tier_counts = (
        db.query(MatchGroup.match_type, func.count(MatchGroup.id))
        .filter(MatchGroup.workspace_id == workspace_id)
        .group_by(MatchGroup.match_type)
        .all()
    )
    tmap = {t.value: 0 for t in MatchTypeEnum}
    for mt, c in tier_counts:
        tmap[mt.value] = c

    return {
        "stats": {
            "total_book": total_book,
            "total_bank": db.query(func.count(BankTransaction.id)).filter(BankTransaction.workspace_id == workspace_id).scalar() or 0,
            "tier1_exact": tmap.get("exact", 0),
            "tier2_fuzzy": tmap.get("fuzzy", 0),
            "tier3_composite": tmap.get("one_to_many", 0) + tmap.get("many_to_one", 0),
            "tier4_ai": tmap.get("ai_suggested", 0),
            "match_rate": round(matched / max(total_book, 1) * 100, 2),
            "auto_confirm_rate": round(
                (
                    (
                        db.query(func.count(MatchGroup.id))
                        .filter(
                            MatchGroup.workspace_id == workspace_id,
                            MatchGroup.status == MatchGroupStatus.auto_confirmed,
                        )
                        .scalar()
                        or 0
                    )
                    / max(len(groups), 1)
                    * 100
                ),
                2,
            ),
            "exceptions_count": ex_c,
            "unmatched_book": int(um_book),
            "unmatched_bank": int(um_bank),
        },
        "matches_by_status": by_status,
    }


@router.get("/workspace/{workspace_id}/unmatched")
def unmatched(workspace_id: int, db: Session = Depends(get_db), tenant_id: str = Depends(_tenant)):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    today = date.today()

    def serialize_book(b: BookTransaction) -> dict:
        age = (today - b.txn_date).days
        return {
            "id": b.id,
            "txn_date": b.txn_date.isoformat(),
            "amount": float(b.amount),
            "description": b.description,
            "reference": b.reference,
            "age_days": age,
        }

    def serialize_bank(b: BankTransaction) -> dict:
        age = (today - b.txn_date).days
        return {
            "id": b.id,
            "txn_date": b.txn_date.isoformat(),
            "amount": float(b.amount),
            "description": b.description,
            "bank_reference": b.bank_reference,
            "age_days": age,
        }

    ub = (
        db.query(BookTransaction)
        .filter(BookTransaction.workspace_id == workspace_id, BookTransaction.status == BookTxnStatus.unmatched)
        .order_by(BookTransaction.txn_date)
        .all()
    )
    uk = (
        db.query(BankTransaction)
        .filter(BankTransaction.workspace_id == workspace_id, BankTransaction.status == BankTxnStatus.unmatched)
        .order_by(BankTransaction.txn_date)
        .all()
    )
    return {"unmatched_book": [serialize_book(b) for b in ub], "unmatched_bank": [serialize_bank(b) for b in uk]}


@router.patch("/match/{match_id}/confirm")
def confirm_match(
    match_id: int,
    db: Session = Depends(get_db),
    performed_by: str | None = Query(default=None),
    tenant_id: str = Depends(_tenant),
):
    mg = db.query(MatchGroup).filter(MatchGroup.id == match_id).first()
    if not mg:
        raise HTTPException(404, "Match not found")
    ws = db.query(ReconWorkspace).filter(ReconWorkspace.id == mg.workspace_id).first()
    if not ws or ws.tenant_id != tenant_id:
        raise HTTPException(404, "Not found")
    mg.status = MatchGroupStatus.confirmed
    mg.confirmed_by = performed_by
    mg.confirmed_at = datetime.utcnow()
    _log_audit(db, ws.id, ReconAuditAction.match_confirmed, performed_by=performed_by, details={"match_id": match_id})
    db.commit()
    return {"ok": True, "match_id": match_id}


@router.patch("/workspace/{workspace_id}/match/{match_id}/confirm")
def confirm_match_workspace_path(
    workspace_id: int,
    match_id: int,
    body: MatchConfirmBody | None = None,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
):
    performed_by = body.confirmed_by if body else None
    mg = db.query(MatchGroup).filter(
        MatchGroup.id == match_id,
        MatchGroup.workspace_id == workspace_id,
    ).first()
    if not mg:
        raise HTTPException(404, "Match not found")
    ws = db.query(ReconWorkspace).filter(ReconWorkspace.id == mg.workspace_id).first()
    if not ws or ws.tenant_id != tenant_id:
        raise HTTPException(404, "Not found")
    mg.status = MatchGroupStatus.confirmed
    mg.confirmed_by = performed_by
    mg.confirmed_at = datetime.utcnow()
    _log_audit(db, ws.id, ReconAuditAction.match_confirmed, performed_by=performed_by, details={"match_id": match_id})
    db.commit()
    return {"ok": True, "match_id": match_id}


@router.patch("/match/{match_id}/reject")
def reject_match(
    match_id: int,
    body: MatchRejectBody,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
):
    mg = db.query(MatchGroup).filter(MatchGroup.id == match_id).first()
    if not mg:
        raise HTTPException(404, "Match not found")
    ws = db.query(ReconWorkspace).filter(ReconWorkspace.id == mg.workspace_id).first()
    if not ws or ws.tenant_id != tenant_id:
        raise HTTPException(404, "Not found")

    for b in db.query(BookTransaction).filter(BookTransaction.match_id == match_id).all():
        b.match_id = None
        b.status = BookTxnStatus.unmatched
    for b in db.query(BankTransaction).filter(BankTransaction.match_id == match_id).all():
        b.match_id = None
        b.status = BankTxnStatus.unmatched
    mg.status = MatchGroupStatus.rejected
    _log_audit(
        db,
        ws.id,
        ReconAuditAction.match_rejected,
        performed_by=body.performed_by,
        details={"match_id": match_id, "reason": body.reason},
    )
    db.commit()
    return {"ok": True}


@router.post("/workspace/{workspace_id}/manual-match")
def manual_match(
    workspace_id: int,
    body: ManualMatchBody,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
    performed_by: str | None = Query(default=None),
):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    if not body.book_txn_ids or not body.bank_txn_ids:
        raise HTTPException(400, "book_txn_ids and bank_txn_ids required")

    books = (
        db.query(BookTransaction)
        .filter(
            BookTransaction.workspace_id == workspace_id,
            BookTransaction.id.in_(body.book_txn_ids),
        )
        .all()
    )
    banks = (
        db.query(BankTransaction)
        .filter(
            BankTransaction.workspace_id == workspace_id,
            BankTransaction.id.in_(body.bank_txn_ids),
        )
        .all()
    )
    if len(books) != len(body.book_txn_ids) or len(banks) != len(body.bank_txn_ids):
        raise HTTPException(400, "Invalid transaction ids")
    if any(b.status != BookTxnStatus.unmatched for b in books) or any(b.status != BankTxnStatus.unmatched for b in banks):
        raise HTTPException(400, "Transactions must be unmatched")

    sum_b = sum(float(b.amount) for b in books)
    sum_k = sum(float(b.amount) for b in banks)
    if abs(sum_b - sum_k) > 0.05:
        raise HTTPException(400, f"Amounts do not balance: {sum_b} vs {sum_k}")

    mtype = (
        MatchTypeEnum.one_to_many
        if len(banks) == 1 and len(books) > 1
        else MatchTypeEnum.many_to_one
        if len(books) == 1 and len(banks) > 1
        else MatchTypeEnum.manual
    )
    mg = MatchGroup(
        workspace_id=workspace_id,
        match_type=mtype,
        confidence_score=1.0,
        amount_variance=Decimal("0"),
        status=MatchGroupStatus.confirmed,
        confirmed_by=performed_by,
        confirmed_at=datetime.utcnow(),
    )
    db.add(mg)
    db.flush()
    for b in books:
        b.match_id = mg.id
        b.status = BookTxnStatus.manually_matched
    for b in banks:
        b.match_id = mg.id
        b.status = BankTxnStatus.manually_matched
    _log_audit(db, workspace_id, ReconAuditAction.manual_match_created, performed_by=performed_by, details={"match_id": mg.id})
    db.commit()
    return {"match_id": mg.id}


@router.post("/workspace/{workspace_id}/ai-suggest/{book_txn_id}")
async def ai_suggest_one(
    workspace_id: int,
    book_txn_id: int,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    book = (
        db.query(BookTransaction)
        .filter(BookTransaction.id == book_txn_id, BookTransaction.workspace_id == workspace_id)
        .first()
    )
    if not book:
        raise HTTPException(404, "Book txn not found")
    banks = (
        db.query(BankTransaction)
        .filter(
            BankTransaction.workspace_id == workspace_id,
            BankTransaction.status == BankTxnStatus.unmatched,
        )
        .limit(50)
        .all()
    )
    out = await recon_engine.ai_match_exceptions(
        [book],
        banks,
        {
            "workspace_name": ws.workspace_name,
            "period_start": str(ws.period_start),
            "period_end": str(ws.period_end),
            "currency": ws.currency,
        },
    )
    matches = out.get("matches", [])[:3]
    return {"suggestions": matches}


@router.post("/workspace/{workspace_id}/adjustment")
def add_adjustment(
    workspace_id: int,
    body: AdjustmentCreate,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
    created_by: str | None = Query(default=None),
):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    adj = ReconciliationAdjustment(
        workspace_id=workspace_id,
        adjustment_type=body.adjustment_type,
        description=body.description,
        amount=body.amount,
        affects_side=body.affects_side,
        journal_entry_required=body.journal_entry_required,
        created_by=created_by,
    )
    db.add(adj)
    _log_audit(db, workspace_id, ReconAuditAction.adjustment_added, performed_by=created_by, details={"type": body.adjustment_type.value})
    _recalc_workspace(db, ws)
    db.commit()
    db.refresh(adj)
    return adj


@router.get("/workspace/{workspace_id}/adjustments")
def list_adjustments(workspace_id: int, db: Session = Depends(get_db), tenant_id: str = Depends(_tenant)):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    _recalc_workspace(db, ws)
    db.commit()
    return {
        "adjustments": [
            {
                "id": a.id,
                "adjustment_type": a.adjustment_type.value,
                "description": a.description,
                "amount": float(a.amount),
                "affects_side": a.affects_side.value,
                "journal_entry_required": a.journal_entry_required,
                "je_posted": a.je_posted,
            }
            for a in ws.adjustments
        ],
        "variance": float(ws.variance or 0),
    }


@router.post("/workspace/{workspace_id}/exception")
def raise_exception(
    workspace_id: int,
    body: ExceptionCreateBody,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
    performed_by: str | None = Query(default=None),
):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    ex = ReconException(
        workspace_id=workspace_id,
        exception_type=body.exception_type,
        severity=body.severity,
        description=body.description,
        bank_txn_id=body.bank_txn_id,
        book_txn_id=body.book_txn_id,
        amount=body.amount,
        assigned_to=body.assigned_to,
    )
    db.add(ex)
    _log_audit(db, workspace_id, ReconAuditAction.exception_raised, performed_by=performed_by, details={"type": body.exception_type.value})
    db.commit()
    db.refresh(ex)
    return {"id": ex.id}


@router.get("/workspace/{workspace_id}/exceptions")
def list_exceptions(workspace_id: int, db: Session = Depends(get_db), tenant_id: str = Depends(_tenant)):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    rows = db.query(ReconException).filter(ReconException.workspace_id == workspace_id).all()
    grouped: dict[str, list] = {s.value: [] for s in ExceptionSeverity}
    for e in rows:
        grouped[e.severity.value].append(
            {
                "id": e.id,
                "exception_type": e.exception_type.value,
                "description": e.description,
                "amount": float(e.amount) if e.amount else None,
                "age_days": e.age_days,
                "assigned_to": e.assigned_to,
                "resolved": e.resolved,
            }
        )
    return {"by_severity": grouped}


@router.patch("/exception/{exception_id}/resolve")
def resolve_exception(
    exception_id: int,
    body: ExceptionResolveBody,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
):
    ex = db.query(ReconException).filter(ReconException.id == exception_id).first()
    if not ex:
        raise HTTPException(404, "Exception not found")
    ws = db.query(ReconWorkspace).filter(ReconWorkspace.id == ex.workspace_id).first()
    if not ws or ws.tenant_id != tenant_id:
        raise HTTPException(404, "Not found")
    ex.resolved = True
    ex.resolution_notes = body.resolution_notes
    ex.resolved_at = datetime.utcnow()
    ex.resolved_by = body.resolved_by
    _log_audit(db, ws.id, ReconAuditAction.exception_resolved, performed_by=body.resolved_by, details={"exception_id": exception_id})
    db.commit()
    return {"ok": True}


@router.post("/workspace/{workspace_id}/preparer-signoff")
def preparer_signoff(
    workspace_id: int,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
    preparer_id: str | None = Query(default=None),
):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    _recalc_workspace(db, ws)
    if abs(ws.variance or 0) >= Decimal("0.01"):
        raise HTTPException(400, "Variance must be zero before preparer sign-off")
    crit = (
        db.query(func.count(ReconException.id))
        .filter(
            ReconException.workspace_id == workspace_id,
            ReconException.resolved.is_(False),
            ReconException.severity == ExceptionSeverity.critical,
        )
        .scalar()
        or 0
    )
    if crit:
        raise HTTPException(400, "Unresolved critical exceptions")
    ws.sign_off_preparer = True
    ws.status = ReconWorkspaceStatus.pending_review
    _log_audit(db, workspace_id, ReconAuditAction.preparer_signoff, performed_by=preparer_id)
    db.commit()
    return {"ok": True}


@router.post("/workspace/{workspace_id}/reviewer-signoff")
def reviewer_signoff(
    workspace_id: int,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
    reviewer_id: str | None = Query(default=None),
):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    if not ws.sign_off_preparer:
        raise HTTPException(400, "Preparer sign-off required first")
    _recalc_workspace(db, ws)
    if abs(ws.variance or 0) >= Decimal("0.01"):
        raise HTTPException(400, "Variance must be zero")
    ws.sign_off_reviewer = True
    ws.status = ReconWorkspaceStatus.locked
    ws.completed_date = date.today()
    _log_audit(db, workspace_id, ReconAuditAction.reviewer_signoff, performed_by=reviewer_id)
    _log_audit(db, workspace_id, ReconAuditAction.workspace_locked, performed_by=reviewer_id)
    db.commit()
    return {"ok": True}


@router.get("/workspace/{workspace_id}/reconciliation-statement")
def reconciliation_statement(
    workspace_id: int,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(_tenant),
    format: str = Query(default="json"),
):
    ws = (
        db.query(ReconWorkspace)
        .filter(ReconWorkspace.id == workspace_id, ReconWorkspace.tenant_id == tenant_id)
        .first()
    )
    if not ws:
        raise HTTPException(404, "Workspace not found")
    _recalc_workspace(db, ws)
    db.commit()

    payload = {
        "bank_balance_per_statement": float(ws.total_bank_balance or 0),
        "add_deposits_in_transit": float(ws.outstanding_deposits or 0),
        "less_outstanding_cheques": float(ws.outstanding_cheques or 0),
        "adjusted_bank_balance": float(ws.adjusted_bank_balance or 0),
        "gl_book_balance": float(ws.total_book_balance or 0),
        "adjustments_net": float(
            sum(float(a.amount) for a in ws.adjustments if a.affects_side != AffectsSide.bank)
        ),
        "adjusted_book_balance": float(ws.adjusted_book_balance or 0),
        "variance": float(ws.variance or 0),
    }
    if format != "pdf":
        return payload

    try:
        from fpdf import FPDF
    except ImportError:
        raise HTTPException(501, "PDF export requires fpdf2; install fpdf2")

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "Bank Reconciliation Statement", ln=True)
    pdf.set_font("Helvetica", "", 10)
    for k, v in payload.items():
        pdf.cell(0, 8, f"{k}: {v}", ln=True)
    out_pdf = pdf.output(dest="S")
    if isinstance(out_pdf, str):
        out_pdf = out_pdf.encode("latin-1")
    buf = io.BytesIO(out_pdf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="recon-{workspace_id}.pdf"'},
    )


@router.get("/analytics")
def analytics(db: Session = Depends(get_db), tenant_id: str = Depends(_tenant)):
    workspaces = db.query(ReconWorkspace).filter(ReconWorkspace.tenant_id == tenant_id).all()
    ws_ids = [w.id for w in workspaces]
    if not workspaces:
        return {
            "avg_match_rate": 0,
            "avg_days_to_close": 0,
            "exceptions_this_month": 0,
            "auto_confirm_rate": 0,
            "match_trend": [],
            "exceptions_by_type": {},
            "preparer_leaderboard": [],
        }

    rates = []
    days_close = []
    for ws in workspaces:
        rates.append(_workspace_completion(db, ws))
        if ws.completed_date and ws.created_at:
            days_close.append((ws.completed_date - ws.created_at.date()).days)
    month_start = date.today().replace(day=1)
    month_floor = datetime.combine(month_start, datetime.min.time())
    ex_month = (
        db.query(func.count(ReconException.id))
        .filter(
            ReconException.workspace_id.in_(ws_ids),
            ReconException.created_at >= month_floor,
        )
        .scalar()
        or 0
    )
    ex_types = (
        db.query(ReconException.exception_type, func.count(ReconException.id))
        .filter(ReconException.workspace_id.in_(ws_ids))
        .group_by(ReconException.exception_type)
        .all()
    )

    preparer_counts: Counter[str] = Counter()
    preparer_rates: dict[str, list[float]] = {}
    for ws in workspaces:
        p = ws.assigned_preparer_id or "unassigned"
        preparer_counts[p] += 1
        preparer_rates.setdefault(p, []).append(_workspace_completion(db, ws))

    leaderboard = []
    for prep, n in preparer_counts.most_common(20):
        rs = preparer_rates.get(prep, [0])
        leaderboard.append(
            {
                "preparer": prep,
                "workspaces": n,
                "avg_match_rate": round(sum(rs) / len(rs), 2),
                "avg_days": round(sum(days_close) / max(len(days_close), 1), 1) if days_close else 0,
                "exceptions": ex_month,
            }
        )

    match_trend = []
    for ws in sorted(workspaces, key=lambda w: w.period_end or date.min)[-12:]:
        match_trend.append(
            {
                "period_end": str(ws.period_end),
                "match_rate": _workspace_completion(db, ws),
            }
        )

    return {
        "avg_match_rate": round(sum(rates) / max(len(rates), 1), 2),
        "avg_days_to_close": round(sum(days_close) / max(len(days_close), 1), 1) if days_close else 0,
        "exceptions_this_month": ex_month,
        "auto_confirm_rate": round(
            (
                db.query(func.count(MatchGroup.id))
                .filter(
                    MatchGroup.workspace_id.in_(ws_ids),
                    MatchGroup.status == MatchGroupStatus.auto_confirmed,
                )
                .scalar()
                or 0
            )
            / max(
                db.query(func.count(MatchGroup.id))
                .filter(MatchGroup.workspace_id.in_(ws_ids))
                .scalar()
                or 1,
                1,
            )
            * 100,
            2,
        ),
        "match_trend": match_trend,
        "exceptions_by_type": {t.value: c for t, c in ex_types},
        "preparer_leaderboard": leaderboard,
        "recurring_unmatched": [],
    }
