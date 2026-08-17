"""RERA OS API — /api/rera/*.

Projects, bookings, installment payments (auto VAT/GST/TDS + escrow split),
escrow transactions, QPR generation/export, revenue-leakage scan, IFRS16
adapter (local module), Zoho webhook bridge, CFO dashboard, risk flags.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.workspace import WorkspaceContext, require_workspace_role, validate_workspace
from app.models.rera import (
    RERABooking,
    RERAEscrowTransaction,
    RERAPayment,
    RERAProject,
    RERAQPRRecord,
    RERARiskFlag,
    RERAWebhookEvent,
)
from app.models.workspace import WorkspaceRole
from app.modules.rera import ifrs16_adapter, leakage as leakage_mod, qpr_export, tax
from app.modules.rera.webhook_zoho import ingest_event, move_to_dlq, replay_dlq, verify_zoho_signature

router = APIRouter(prefix="/api/rera", tags=["RERA OS"])

WRITE_ROLES = (WorkspaceRole.owner, WorkspaceRole.finance_manager, WorkspaceRole.accountant)
ADMIN_ROLES = (WorkspaceRole.owner,)
ESCROW_ROLES = (WorkspaceRole.owner, WorkspaceRole.finance_manager)

PAN_RE = re.compile(tax.PAN_PATTERN)
DIN_RE = re.compile(tax.DIN_PATTERN)


# ── serialization helpers ────────────────────────────────────────────────────

def _num(v: Any) -> float:
    return float(v) if v is not None else 0.0


def _project_dict(p: RERAProject) -> dict[str, Any]:
    return {
        "id": p.id,
        "workspace_id": p.workspace_id,
        "name": p.name,
        "rera_number": p.rera_number,
        "location": p.location,
        "total_units": p.total_units,
        "total_project_cost": _num(p.total_project_cost),
        "total_collections_target": _num(p.total_collections_target),
        "escrow_percentage": _num(p.escrow_percentage),
        "construction_progress": _num(p.construction_progress),
        "utilization_percentage": _num(p.utilization_percentage),
        "escrow_balance": _num(p.escrow_balance),
        "withdrawn": _num(p.withdrawn),
        "total_collected": _num(p.total_collected),
        "start_date": p.start_date.isoformat() if p.start_date else None,
        "completion_date": p.completion_date.isoformat() if p.completion_date else None,
        "status": p.status,
        "developer_pan": p.developer_pan,
        "promoter_din": p.promoter_din,
        "gstin": p.gstin,
        "trn_number": p.trn_number,
        "qpr_deadline": p.qpr_deadline.isoformat() if p.qpr_deadline else None,
        "currency": p.currency,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _booking_dict(b: RERABooking) -> dict[str, Any]:
    return {
        "id": b.id,
        "project_id": b.project_id,
        "unit_number": b.unit_number,
        "customer_name": b.customer_name,
        "customer_email": b.customer_email,
        "customer_phone": b.customer_phone,
        "total_value": _num(b.total_value),
        "booking_date": b.booking_date.isoformat() if b.booking_date else None,
        "payment_schedule": b.payment_schedule or [],
        "status": b.status,
        "oqood_status": b.oqood_status,
        "spa_id": b.spa_id,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }


def _payment_dict(p: RERAPayment) -> dict[str, Any]:
    return {
        "id": p.id,
        "project_id": p.project_id,
        "booking_id": p.booking_id,
        "installment_number": p.installment_number,
        "gross_amount": _num(p.gross_amount),
        "gst_amount": _num(p.gst_amount),
        "vat_amount": _num(p.vat_amount),
        "tds_amount": _num(p.tds_amount),
        "net_amount": _num(p.net_amount),
        "escrow_split": _num(p.escrow_split),
        "payment_date": p.payment_date.isoformat() if p.payment_date else None,
        "payment_mode": p.payment_mode,
        "status": p.status,
    }


def _escrow_dict(e: RERAEscrowTransaction) -> dict[str, Any]:
    return {
        "id": e.id,
        "project_id": e.project_id,
        "type": e.type,
        "amount": _num(e.amount),
        "transaction_date": e.transaction_date.isoformat() if e.transaction_date else None,
        "purpose": e.purpose,
        "approved_by": e.approved_by,
        "reference_no": e.reference_no,
    }


def _qpr_dict(q: RERAQPRRecord) -> dict[str, Any]:
    return {
        "id": q.id,
        "project_id": q.project_id,
        "quarter": q.quarter,
        "total_collections": _num(q.total_collections),
        "escrow_deposited": _num(q.escrow_deposited),
        "withdrawals": _num(q.withdrawals),
        "construction_progress": _num(q.construction_progress),
        "utilization": _num(q.utilization),
        "status": q.status,
        "generated_at": q.generated_at.isoformat() if q.generated_at else None,
    }


def _risk_flag_dict(r: RERARiskFlag) -> dict[str, Any]:
    return {
        "id": r.id,
        "project_id": r.project_id,
        "severity": r.severity,
        "category": r.category,
        "title": r.title,
        "description": r.description,
        "resolved": r.resolved,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _webhook_event_dict(e: RERAWebhookEvent) -> dict[str, Any]:
    return {
        "id": e.id,
        "idempotency_key": e.idempotency_key,
        "spa_id": e.spa_id,
        "event_type": e.event_type,
        "event_timestamp": e.event_timestamp.isoformat() if e.event_timestamp else None,
        "received_at": e.received_at.isoformat() if e.received_at else None,
        "source": e.source,
        "data": e.data,
        "is_dlq": e.is_dlq,
        "dlq_reason": e.dlq_reason,
    }


def _get_project_or_404(db: Session, project_id: str, workspace_id: str) -> RERAProject:
    project = db.get(RERAProject, project_id)
    if project is None or project.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _get_booking_or_404(db: Session, booking_id: str, workspace_id: str) -> RERABooking:
    booking = db.get(RERABooking, booking_id)
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found")
    _get_project_or_404(db, booking.project_id, workspace_id)
    return booking


# ── request schemas ──────────────────────────────────────────────────────────

class ProjectCreateIn(BaseModel):
    name: str
    rera_number: str
    location: str | None = None
    total_units: int | None = None
    total_project_cost: float | None = None
    total_collections_target: float | None = None
    escrow_percentage: float = 70.0
    start_date: date | None = None
    completion_date: date | None = None
    developer_pan: str | None = None
    promoter_din: str | None = None
    gstin: str | None = None
    trn_number: str | None = None
    qpr_deadline: date | None = None
    currency: str = Field(default="AED", pattern="^(AED|INR)$")


class ProjectUpdateIn(BaseModel):
    name: str | None = None
    location: str | None = None
    total_units: int | None = None
    total_project_cost: float | None = None
    total_collections_target: float | None = None
    escrow_percentage: float | None = None
    construction_progress: float | None = None
    start_date: date | None = None
    completion_date: date | None = None
    status: str | None = None
    developer_pan: str | None = None
    promoter_din: str | None = None
    gstin: str | None = None
    trn_number: str | None = None
    qpr_deadline: date | None = None


class BookingCreateIn(BaseModel):
    project_id: str
    unit_number: str | None = None
    customer_name: str | None = None
    customer_email: str | None = None
    customer_phone: str | None = None
    total_value: float | None = None
    booking_date: date | None = None
    payment_schedule: list[dict[str, Any]] = Field(default_factory=list)
    spa_id: str | None = None


class PaymentCreateIn(BaseModel):
    project_id: str
    booking_id: str
    installment_number: int | None = None
    gross_amount: float
    is_commercial: bool = False
    payment_date: date | None = None
    payment_mode: str = "bank_transfer"


class EscrowWithdrawIn(BaseModel):
    project_id: str
    amount: float
    purpose: str
    approved_by: str = Field(..., min_length=1, description="Compliance sign-off name/id")
    reference_no: str | None = None
    transaction_date: date | None = None


def _recompute_utilization(project: RERAProject) -> None:
    total_ever_deposited = Decimal(str(project.escrow_balance or 0)) + Decimal(str(project.withdrawn or 0))
    if total_ever_deposited > 0:
        project.utilization_percentage = (Decimal(str(project.withdrawn or 0)) / total_ever_deposited) * Decimal("100")
    else:
        project.utilization_percentage = Decimal("0")


# ── Projects ──────────────────────────────────────────────────────────────────

@router.get("/projects")
def list_projects(ctx: WorkspaceContext = Depends(validate_workspace), db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.query(RERAProject).filter(RERAProject.workspace_id == ctx.workspace_id).order_by(RERAProject.created_at.desc()).all()
    return {"projects": [_project_dict(p) for p in rows], "count": len(rows)}


@router.post("/projects")
def create_project(
    body: ProjectCreateIn,
    ctx: WorkspaceContext = Depends(require_workspace_role(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if body.developer_pan and not PAN_RE.match(body.developer_pan):
        raise HTTPException(status_code=400, detail="Invalid developer_pan format (expected AAAAA9999A)")
    if body.promoter_din and not DIN_RE.match(body.promoter_din):
        raise HTTPException(status_code=400, detail="Invalid promoter_din format (expected 8 digits)")

    project = RERAProject(workspace_id=ctx.workspace_id, **body.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    return _project_dict(project)


@router.get("/projects/{project_id}")
def get_project(project_id: str, ctx: WorkspaceContext = Depends(validate_workspace), db: Session = Depends(get_db)) -> dict[str, Any]:
    return _project_dict(_get_project_or_404(db, project_id, ctx.workspace_id))


@router.put("/projects/{project_id}")
def update_project(
    project_id: str,
    body: ProjectUpdateIn,
    ctx: WorkspaceContext = Depends(require_workspace_role(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    project = _get_project_or_404(db, project_id, ctx.workspace_id)
    for field_name, value in body.model_dump(exclude_unset=True).items():
        setattr(project, field_name, value)
    db.commit()
    db.refresh(project)
    return _project_dict(project)


# ── Bookings ──────────────────────────────────────────────────────────────────

@router.get("/bookings")
def list_bookings(
    project_id: str = Query(...),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _get_project_or_404(db, project_id, ctx.workspace_id)
    rows = db.query(RERABooking).filter(RERABooking.project_id == project_id).order_by(RERABooking.created_at.desc()).all()
    return {"bookings": [_booking_dict(b) for b in rows], "count": len(rows)}


@router.post("/bookings")
def create_booking(
    body: BookingCreateIn,
    ctx: WorkspaceContext = Depends(require_workspace_role(*WRITE_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _get_project_or_404(db, body.project_id, ctx.workspace_id)
    booking = RERABooking(**body.model_dump())
    db.add(booking)
    db.commit()
    db.refresh(booking)
    return _booking_dict(booking)


# ── Payments ──────────────────────────────────────────────────────────────────

@router.get("/payments")
def list_payments(
    project_id: str = Query(...),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _get_project_or_404(db, project_id, ctx.workspace_id)
    rows = db.query(RERAPayment).filter(RERAPayment.project_id == project_id).order_by(RERAPayment.payment_date.desc()).all()
    return {"payments": [_payment_dict(p) for p in rows], "count": len(rows)}


@router.post("/payments")
def create_payment(
    body: PaymentCreateIn,
    ctx: WorkspaceContext = Depends(require_workspace_role(*WRITE_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    project = _get_project_or_404(db, body.project_id, ctx.workspace_id)
    booking = _get_booking_or_404(db, body.booking_id, ctx.workspace_id)
    if booking.project_id != project.id:
        raise HTTPException(status_code=400, detail="Booking does not belong to project")

    tax_result = tax.compute_payment_tax(
        currency=project.currency,
        gross_amount=Decimal(str(body.gross_amount)),
        is_commercial=body.is_commercial,
        booking_total_value=Decimal(str(booking.total_value)) if booking.total_value is not None else None,
    )
    escrow_split = tax.compute_escrow_split(
        net_amount=tax_result["net_amount"], escrow_percentage=Decimal(str(project.escrow_percentage or 0))
    )

    payment = RERAPayment(
        project_id=project.id,
        booking_id=booking.id,
        installment_number=body.installment_number,
        gross_amount=Decimal(str(body.gross_amount)),
        gst_amount=tax_result["gst_amount"],
        vat_amount=tax_result["vat_amount"],
        tds_amount=tax_result["tds_amount"],
        net_amount=tax_result["net_amount"],
        escrow_split=escrow_split,
        payment_date=body.payment_date or date.today(),
        payment_mode=body.payment_mode,
        status="received",
    )
    db.add(payment)
    db.flush()

    escrow_tx = RERAEscrowTransaction(
        project_id=project.id,
        type="deposit",
        amount=escrow_split,
        transaction_date=payment.payment_date,
        purpose=f"Auto escrow deposit — installment #{body.installment_number or '-'} for booking {booking.id}",
        source_payment_id=payment.id,
    )
    db.add(escrow_tx)

    project.escrow_balance = Decimal(str(project.escrow_balance or 0)) + escrow_split
    project.total_collected = Decimal(str(project.total_collected or 0)) + tax_result["net_amount"]
    _recompute_utilization(project)

    db.commit()
    db.refresh(payment)
    return _payment_dict(payment)


# ── Escrow ────────────────────────────────────────────────────────────────────

@router.get("/escrow/transactions")
def list_escrow_transactions(
    project_id: str = Query(...),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _get_project_or_404(db, project_id, ctx.workspace_id)
    rows = (
        db.query(RERAEscrowTransaction)
        .filter(RERAEscrowTransaction.project_id == project_id)
        .order_by(RERAEscrowTransaction.transaction_date.desc())
        .all()
    )
    return {"transactions": [_escrow_dict(e) for e in rows], "count": len(rows)}


@router.post("/escrow/withdraw")
def withdraw_escrow(
    body: EscrowWithdrawIn,
    ctx: WorkspaceContext = Depends(require_workspace_role(*ESCROW_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    project = _get_project_or_404(db, body.project_id, ctx.workspace_id)
    amount = Decimal(str(body.amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Withdrawal amount must be positive")
    if amount > Decimal(str(project.escrow_balance or 0)):
        raise HTTPException(status_code=400, detail="Withdrawal exceeds available escrow balance")

    tx = RERAEscrowTransaction(
        project_id=project.id,
        type="withdrawal",
        amount=amount,
        transaction_date=body.transaction_date or date.today(),
        purpose=body.purpose,
        approved_by=body.approved_by,
        reference_no=body.reference_no,
    )
    db.add(tx)

    project.escrow_balance = Decimal(str(project.escrow_balance or 0)) - amount
    project.withdrawn = Decimal(str(project.withdrawn or 0)) + amount
    _recompute_utilization(project)

    if Decimal(str(project.utilization_percentage or 0)) > Decimal(str(project.construction_progress or 0)) * Decimal("1.1"):
        db.add(
            RERARiskFlag(
                project_id=project.id,
                severity="high",
                category="escrow",
                title="Escrow utilization ceiling exceeded",
                description=(
                    f"Utilization {float(project.utilization_percentage):.1f}% exceeds construction "
                    f"progress {float(project.construction_progress):.1f}% by more than 10%."
                ),
            )
        )

    db.commit()
    db.refresh(tx)
    return _escrow_dict(tx)


# ── QPR ───────────────────────────────────────────────────────────────────────

@router.get("/qpr")
def list_qpr(
    project_id: str = Query(...),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _get_project_or_404(db, project_id, ctx.workspace_id)
    rows = db.query(RERAQPRRecord).filter(RERAQPRRecord.project_id == project_id).order_by(RERAQPRRecord.generated_at.desc()).all()
    return {"records": [_qpr_dict(q) for q in rows], "count": len(rows)}


def _current_quarter_label() -> str:
    today = date.today()
    q = (today.month - 1) // 3 + 1
    return f"Q{q}-{today.year}"


@router.post("/qpr/generate/{project_id}")
def generate_qpr(
    project_id: str,
    ctx: WorkspaceContext = Depends(require_workspace_role(*WRITE_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    project = _get_project_or_404(db, project_id, ctx.workspace_id)
    escrow_deposited = (
        db.query(RERAEscrowTransaction)
        .filter(RERAEscrowTransaction.project_id == project_id, RERAEscrowTransaction.type == "deposit")
        .all()
    )
    withdrawals = (
        db.query(RERAEscrowTransaction)
        .filter(RERAEscrowTransaction.project_id == project_id, RERAEscrowTransaction.type == "withdrawal")
        .all()
    )
    record = RERAQPRRecord(
        project_id=project.id,
        quarter=_current_quarter_label(),
        total_collections=project.total_collected or Decimal("0"),
        escrow_deposited=sum((Decimal(str(t.amount or 0)) for t in escrow_deposited), Decimal("0")),
        withdrawals=sum((Decimal(str(t.amount or 0)) for t in withdrawals), Decimal("0")),
        construction_progress=project.construction_progress or Decimal("0"),
        utilization=project.utilization_percentage or Decimal("0"),
        status="draft",
    )
    db.add(record)

    if project.qpr_deadline:
        days_left = (project.qpr_deadline - date.today()).days
        if 0 <= days_left <= 7:
            db.add(
                RERARiskFlag(
                    project_id=project.id, severity="medium", category="qpr",
                    title="QPR deadline approaching", description=f"{days_left} day(s) remaining to file.",
                )
            )
        elif days_left < 0:
            db.add(
                RERARiskFlag(
                    project_id=project.id, severity="high", category="qpr",
                    title="QPR overdue", description=f"Deadline was {-days_left} day(s) ago.",
                )
            )

    db.commit()
    db.refresh(record)
    return _qpr_dict(record)


@router.get("/qpr/export/{project_id}")
def export_qpr(
    project_id: str,
    format: str = Query("pdf", pattern="^(pdf|csv)$"),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(db, project_id, ctx.workspace_id)
    record = (
        db.query(RERAQPRRecord)
        .filter(RERAQPRRecord.project_id == project_id)
        .order_by(RERAQPRRecord.generated_at.desc())
        .first()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="No QPR record — generate one first")

    if format == "csv":
        csv_text = qpr_export.build_qpr_csv(project=_project_dict(project), qpr=_qpr_dict(record))
        return Response(
            content=csv_text,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="qpr_{project.rera_number}_{record.quarter}.csv"'},
        )

    pdf_bytes = qpr_export.build_qpr_pdf(project=_project_dict(project), qpr=_qpr_dict(record))
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="qpr_{project.rera_number}_{record.quarter}.pdf"'},
    )


# ── Revenue Leakage ──────────────────────────────────────────────────────────

@router.get("/leakage/scan")
def scan_leakage(
    window_days: int = Query(14, ge=1, le=90),
    spa_id: str | None = Query(None),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    result = leakage_mod.scan_leakage(db, workspace_id=ctx.workspace_id, window_days=window_days, spa_id=spa_id)
    return {
        "flagged_count": result.flagged_count,
        "total_at_risk": round(result.total_at_risk, 2),
        "window_days": result.window_days,
        "items": [item.__dict__ for item in result.items],
    }


@router.get("/leakage/scan.csv")
def scan_leakage_csv(
    window_days: int = Query(14, ge=1, le=90),
    spa_id: str | None = Query(None),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    result = leakage_mod.scan_leakage(db, workspace_id=ctx.workspace_id, window_days=window_days, spa_id=spa_id)
    csv_text = leakage_mod.leakage_to_csv(result)
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="rera_leakage_scan.csv"'},
    )


# ── IFRS 16 (local module adapter) ──────────────────────────────────────────

@router.get("/ifrs16/status")
def ifrs16_status() -> dict[str, Any]:
    return {"available": True, "source": ifrs16_adapter.SOURCE}


@router.get("/ifrs16/leases")
def ifrs16_leases(ctx: WorkspaceContext = Depends(validate_workspace), db: Session = Depends(get_db)) -> dict[str, Any]:
    project_ids = [p.id for p in db.query(RERAProject.id).filter(RERAProject.workspace_id == ctx.workspace_id).all()]
    bookings = (
        db.query(RERABooking)
        .filter(RERABooking.project_id.in_(project_ids), RERABooking.spa_id.isnot(None))
        .all()
    )
    return {"spa_ids": [b.spa_id for b in bookings if b.spa_id], "source": ifrs16_adapter.SOURCE}


@router.get("/ifrs16/leases/{spa_id}")
def ifrs16_lease_detail(
    spa_id: str, ibr: float = Query(0.065, ge=0, le=0.3), ctx: WorkspaceContext = Depends(validate_workspace), db: Session = Depends(get_db)
) -> dict[str, Any]:
    booking = db.query(RERABooking).filter(RERABooking.spa_id == spa_id).first()
    if booking is None:
        raise HTTPException(status_code=404, detail="No booking found for spa_id")
    project = _get_project_or_404(db, booking.project_id, ctx.workspace_id)

    terms = ifrs16_adapter.derive_lease_terms_from_schedule(booking.payment_schedule or [])
    if terms is None:
        raise HTTPException(status_code=422, detail="Booking has no usable payment schedule for amortization")
    monthly_payment, term_months = terms

    schedule, source = ifrs16_adapter.compute_amortization_schedule(
        lease_id=spa_id,
        monthly_payment=monthly_payment,
        term_months=term_months,
        commencement_date_iso=(booking.booking_date or date.today()).isoformat(),
        incremental_borrowing_rate=ibr,
        currency=project.currency,
    )
    return {"spa_id": spa_id, "source": source, "schedule": schedule}


# ── Zoho Webhook ─────────────────────────────────────────────────────────────

@router.post("/webhooks/zoho")
async def zoho_webhook(
    request: Request, workspace_id: str | None = Query(None), db: Session = Depends(get_db)
) -> dict[str, Any]:
    raw_body = await request.body()
    signature = request.headers.get("X-Zoho-Signature") or request.headers.get("x-zoho-signature")
    if not verify_zoho_signature(raw_body, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc

    try:
        event, created = ingest_event(db, payload=payload, raw_body=payload, workspace_id=workspace_id)
    except Exception as exc:
        move_to_dlq(db, payload=payload, raw_body=payload, reason=str(exc)[:500])
        return {"status": "dlq", "reason": str(exc)[:200]}

    if not created:
        return {"status": "duplicate_or_invalid"}
    return {"status": "accepted", "id": event.id, "idempotency_key": event.idempotency_key}


@router.get("/webhooks/events")
def list_webhook_events(
    spa_id: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    ctx: WorkspaceContext = Depends(require_workspace_role(WorkspaceRole.owner, WorkspaceRole.finance_manager, WorkspaceRole.auditor)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    q = db.query(RERAWebhookEvent).filter(RERAWebhookEvent.is_dlq.is_(False))
    if spa_id:
        q = q.filter(RERAWebhookEvent.spa_id == spa_id)
    rows = q.order_by(RERAWebhookEvent.received_at.desc()).limit(limit).all()
    return {"events": [_webhook_event_dict(e) for e in rows], "count": len(rows)}


@router.get("/webhooks/events/{spa_id}")
def get_webhook_events_for_spa(
    spa_id: str,
    ctx: WorkspaceContext = Depends(require_workspace_role(WorkspaceRole.owner, WorkspaceRole.finance_manager, WorkspaceRole.auditor)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    rows = (
        db.query(RERAWebhookEvent)
        .filter(RERAWebhookEvent.spa_id == spa_id, RERAWebhookEvent.is_dlq.is_(False))
        .order_by(RERAWebhookEvent.event_timestamp.asc())
        .all()
    )
    return {"spa_id": spa_id, "events": [_webhook_event_dict(e) for e in rows], "count": len(rows)}


@router.get("/webhooks/dlq")
def list_dlq(
    ctx: WorkspaceContext = Depends(require_workspace_role(WorkspaceRole.owner, WorkspaceRole.finance_manager, WorkspaceRole.auditor)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    rows = db.query(RERAWebhookEvent).filter(RERAWebhookEvent.is_dlq.is_(True)).order_by(RERAWebhookEvent.received_at.desc()).all()
    return {"events": [_webhook_event_dict(e) for e in rows], "count": len(rows)}


class DlqReplayIn(BaseModel):
    event_id: str


@router.post("/webhooks/dlq/replay")
def replay_dlq_event(
    body: DlqReplayIn,
    ctx: WorkspaceContext = Depends(require_workspace_role(WorkspaceRole.owner, WorkspaceRole.finance_manager)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        event = replay_dlq(db, event_id=body.event_id, workspace_id=ctx.workspace_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _webhook_event_dict(event)


# ── CFO Dashboard ────────────────────────────────────────────────────────────

@router.get("/dashboard/cfo")
def cfo_dashboard(ctx: WorkspaceContext = Depends(validate_workspace), db: Session = Depends(get_db)) -> dict[str, Any]:
    projects = db.query(RERAProject).filter(RERAProject.workspace_id == ctx.workspace_id).all()
    active_projects = [p for p in projects if p.status == "active"]

    def _avg(values: list[Decimal]) -> float:
        vals = [float(v or 0) for v in values]
        return round(sum(vals) / len(vals), 2) if vals else 0.0

    total_escrow_balance = sum((float(p.escrow_balance or 0) for p in projects), 0.0)
    total_collected = sum((float(p.total_collected or 0) for p in projects), 0.0)
    total_withdrawn = sum((float(p.withdrawn or 0) for p in projects), 0.0)
    avg_utilization = _avg([p.utilization_percentage for p in projects])
    avg_progress = _avg([p.construction_progress for p in projects])

    project_ids = [p.id for p in projects]
    open_risk_flags = (
        db.query(RERARiskFlag)
        .filter(RERARiskFlag.project_id.in_(project_ids), RERARiskFlag.resolved.is_(False))
        .count()
        if project_ids
        else 0
    )

    alerts: list[dict[str, Any]] = []
    for p in projects:
        util = float(p.utilization_percentage or 0)
        progress = float(p.construction_progress or 0)
        if progress > 0 and util > progress * 0.9:
            alerts.append(
                {"type": "escrow_ceiling", "project_id": p.id, "project_name": p.name, "utilization": util, "progress": progress}
            )
        if p.qpr_deadline:
            days_left = (p.qpr_deadline - date.today()).days
            if days_left < 0:
                alerts.append({"type": "qpr_overdue", "project_id": p.id, "project_name": p.name, "days_overdue": -days_left})
            elif days_left <= 7:
                alerts.append({"type": "qpr_deadline", "project_id": p.id, "project_name": p.name, "days_left": days_left})

    return {
        "kpis": {
            "total_escrow_balance": round(total_escrow_balance, 2),
            "total_collected": round(total_collected, 2),
            "total_withdrawn": round(total_withdrawn, 2),
            "avg_utilization": avg_utilization,
            "avg_progress": avg_progress,
            "active_projects": len(active_projects),
            "open_risk_flags": open_risk_flags,
        },
        "alerts": alerts,
        "chart_escrow_vs_withdrawal": [
            {"project": p.name, "escrow_balance": float(p.escrow_balance or 0), "withdrawn": float(p.withdrawn or 0)}
            for p in projects
        ],
        "chart_progress_vs_utilization": [
            {
                "project": p.name,
                "construction_progress": float(p.construction_progress or 0),
                "utilization": float(p.utilization_percentage or 0),
            }
            for p in projects
        ],
    }


# ── Risk Flags ───────────────────────────────────────────────────────────────

@router.get("/risk-flags")
def list_risk_flags(
    project_id: str | None = Query(None),
    resolved: bool | None = Query(None),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    project_ids = [p.id for p in db.query(RERAProject.id).filter(RERAProject.workspace_id == ctx.workspace_id).all()]
    if not project_ids:
        return {"risk_flags": [], "count": 0}
    q = db.query(RERARiskFlag).filter(RERARiskFlag.project_id.in_(project_ids))
    if project_id:
        q = q.filter(RERARiskFlag.project_id == project_id)
    if resolved is not None:
        q = q.filter(RERARiskFlag.resolved == resolved)
    rows = q.order_by(RERARiskFlag.created_at.desc()).all()
    return {"risk_flags": [_risk_flag_dict(r) for r in rows], "count": len(rows)}


@router.put("/risk-flags/{flag_id}/resolve")
def resolve_risk_flag(
    flag_id: str, ctx: WorkspaceContext = Depends(require_workspace_role(*WRITE_ROLES)), db: Session = Depends(get_db)
) -> dict[str, Any]:
    flag = db.get(RERARiskFlag, flag_id)
    if flag is None:
        raise HTTPException(status_code=404, detail="Risk flag not found")
    _get_project_or_404(db, flag.project_id, ctx.workspace_id)
    flag.resolved = True
    db.commit()
    db.refresh(flag)
    return _risk_flag_dict(flag)
