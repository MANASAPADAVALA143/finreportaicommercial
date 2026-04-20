"""Bookkeeping Autopilot API."""
from __future__ import annotations

import io
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.bookkeeping import (
    AccuracyMetric,
    BookkeepingReconciliationRun,
    BookkeepingTransaction,
    MissingReceiptRow,
    ReconciliationSignoff,
)
from app.services import bookkeeping_engine
from app.services.bookkeeping_parser import parse_bank_file

router = APIRouter(prefix="/api/bookkeeping", tags=["bookkeeping"])


def _tx_out(t: BookkeepingTransaction) -> dict[str, Any]:
    return {
        "id": t.id,
        "client_id": t.client_id,
        "date": t.txn_date.date().isoformat() if t.txn_date else None,
        "description": t.description,
        "amount": t.amount,
        "type": t.type,
        "category": t.category,
        "confidence": t.confidence,
        "flag_for_review": t.flag_for_review,
        "auto_approved": t.auto_approved,
        "anomaly_flags": t.anomaly_flags or [],
        "receipt_url": t.receipt_url,
        "vendor_name": t.vendor_name,
        "bank_account_id": t.bank_account_id,
    }


class CategoriseBody(BaseModel):
    transaction_ids: Optional[list[int]] = None
    client_id: str
    period_month: Optional[int] = None
    period_year: Optional[int] = None


class DetectBody(BaseModel):
    transaction_ids: Optional[list[int]] = None
    client_id: str


class ReconcileBody(BaseModel):
    client_id: str
    transaction_ids: Optional[list[int]] = None


class LearningFeedbackBody(BaseModel):
    client_id: str
    transaction_id: int
    correct_category: str
    vendor_name: Optional[str] = None
    transaction_description: Optional[str] = None


class ClientProfileBody(BaseModel):
    weekend_operations: Optional[bool] = None
    receipt_threshold: Optional[float] = None
    chart_of_accounts: Optional[list[str]] = None


class ReceiptUrlBody(BaseModel):
    receipt_url: str


class VerifyReceiptBody(BaseModel):
    transaction_id: int
    receipt_text: str


class ReminderBody(BaseModel):
    transaction_ids: Optional[list[int]] = None
    channel: str = "whatsapp"


class ReconSignoffBody(BaseModel):
    client_id: str
    period_month: int
    period_year: int
    signed_by: str
    variance_amount: float = 0.0
    notes: Optional[str] = None


class AnomalyActionBody(BaseModel):
    client_id: str
    transaction_id: int
    action: str  # approve | investigate | escalate
    anomaly_type: Optional[str] = None


@router.post("/upload-transactions")
async def upload_transactions(
    client_id: str = Form(...),
    file: UploadFile = File(...),
    period_month: Optional[int] = Form(None),
    period_year: Optional[int] = Form(None),
    db: Session = Depends(get_db),
):
    raw = await file.read()
    try:
        rows = parse_bank_file(raw, file.filename or "upload.csv")
    except ValueError as e:
        raise HTTPException(400, str(e))

    y = period_year or datetime.utcnow().year
    mo = period_month or datetime.utcnow().month
    out: list[BookkeepingTransaction] = []
    for r in rows:
        bt = BookkeepingTransaction(
            client_id=client_id,
            period_year=y,
            period_month=mo,
            txn_date=r["date"],
            description=r.get("description") or "",
            amount=float(r["amount"]),
            type=r.get("type") or "unknown",
            vendor_name=r.get("vendor_name"),
            bank_account_id=r.get("bank_account_id"),
        )
        db.add(bt)
        out.append(bt)
    db.commit()
    for t in out:
        db.refresh(t)
    return {"success": True, "count": len(out), "transactions": [_tx_out(t) for t in out]}


@router.post("/categorise")
def categorise(body: CategoriseBody, db: Session = Depends(get_db)):
    txs = bookkeeping_engine.categorise_transactions(
        db,
        body.client_id,
        body.transaction_ids,
        period_month=body.period_month,
        period_year=body.period_year,
    )
    db.commit()
    return {
        "success": True,
        "count": len(txs),
        "transactions": [_tx_out(t) for t in txs],
    }


@router.post("/detect-anomalies")
def detect_anomalies(body: DetectBody, db: Session = Depends(get_db)):
    txs = bookkeeping_engine.detect_anomalies_for_client(db, body.client_id, body.transaction_ids)
    db.commit()
    report = _build_anomaly_report(txs)
    return {"success": True, "anomaly_report": report, "transactions": [_tx_out(t) for t in txs]}


def _build_anomaly_report(txs: list[BookkeepingTransaction]) -> dict[str, Any]:
    critical: list[dict] = []
    high: list[dict] = []
    medium: list[dict] = []
    for t in txs:
        for f in t.anomaly_flags or []:
            sev = (f.get("severity") or "medium").lower()
            item = {"transaction": _tx_out(t), "flag": f}
            if sev == "critical":
                critical.append(item)
            elif sev == "high":
                high.append(item)
            else:
                medium.append(item)
    return {"critical": critical, "high": high, "medium": medium}


@router.post("/reconcile")
def reconcile(body: ReconcileBody, db: Session = Depends(get_db)):
    summary = bookkeeping_engine.reconcile_bank_to_gl(db, body.client_id, body.transaction_ids)
    db.commit()
    return {"success": True, "reconciliation_summary": summary}


@router.post("/learning-feedback")
def learning_feedback(body: LearningFeedbackBody, db: Session = Depends(get_db)):
    bookkeeping_engine.apply_learning_feedback(
        db,
        body.client_id,
        body.transaction_id,
        body.correct_category,
        vendor_name=body.vendor_name,
    )
    db.commit()
    return {"success": True}


@router.get("/review-queue")
def review_queue(client_id: str, db: Session = Depends(get_db)):
    flagged = (
        db.query(BookkeepingTransaction)
        .filter(BookkeepingTransaction.client_id == client_id)
        .filter(BookkeepingTransaction.flag_for_review.is_(True))
        .order_by(BookkeepingTransaction.txn_date.desc())
        .all()
    )
    missing = (
        db.query(MissingReceiptRow)
        .join(BookkeepingTransaction)
        .filter(BookkeepingTransaction.client_id == client_id)
        .filter(MissingReceiptRow.resolved.is_(False))
        .all()
    )
    missing_out = []
    for m in missing:
        missing_out.append(
            {
                "id": m.id,
                "transaction_id": m.transaction_id,
                "amount": m.amount,
                "vendor": m.vendor,
                "date": m.date.date().isoformat() if m.date else None,
                "reminder_sent_count": m.reminder_sent_count,
            }
        )

    recon_runs = (
        db.query(BookkeepingReconciliationRun)
        .filter(BookkeepingReconciliationRun.client_id == client_id)
        .filter(BookkeepingReconciliationRun.escalated.is_(True))
        .order_by(BookkeepingReconciliationRun.id.desc())
        .limit(10)
        .all()
    )
    recon_out = [
        {
            "id": r.id,
            "variance_amount": r.variance_amount,
            "created_at": r.created_at.isoformat(),
            "summary": r.summary_json,
        }
        for r in recon_runs
    ]

    txs_anomaly = (
        db.query(BookkeepingTransaction)
        .filter(BookkeepingTransaction.client_id == client_id)
        .all()
    )
    sev_buckets = {"critical": [], "high": [], "medium": []}
    for t in txs_anomaly:
        for f in t.anomaly_flags or []:
            sev = (f.get("severity") or "medium").lower()
            if sev in sev_buckets:
                sev_buckets[sev].append({"transaction": _tx_out(t), "flag": f})

    return {
        "flagged_for_review": [_tx_out(t) for t in flagged],
        "missing_receipts": missing_out,
        "reconciliation_variances": recon_out,
        "anomalies_by_severity": sev_buckets,
    }


@router.get("/transactions")
def list_transactions(
    client_id: str = Query(...),
    period_month: Optional[int] = None,
    period_year: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(BookkeepingTransaction).filter(BookkeepingTransaction.client_id == client_id)
    if period_month is not None:
        q = q.filter(BookkeepingTransaction.period_month == period_month)
    if period_year is not None:
        q = q.filter(BookkeepingTransaction.period_year == period_year)
    txs = q.order_by(BookkeepingTransaction.txn_date.desc()).limit(2000).all()
    return {"transactions": [_tx_out(t) for t in txs]}


class BulkApproveBody(BaseModel):
    client_id: str
    transaction_ids: list[int]


@router.post("/bulk-approve")
def bulk_approve(body: BulkApproveBody, db: Session = Depends(get_db)):
    q = (
        db.query(BookkeepingTransaction)
        .filter(BookkeepingTransaction.client_id == body.client_id)
        .filter(BookkeepingTransaction.id.in_(body.transaction_ids))
    )
    n = 0
    for t in q.all():
        c = t.confidence or 0
        if c >= 0.80 and c < 0.95:
            t.flag_for_review = False
            t.auto_approved = True
            n += 1
    db.commit()
    return {"success": True, "approved_count": n}


@router.get("/client-profile/{client_id}")
def get_client_profile(client_id: str, db: Session = Depends(get_db)):
    p = bookkeeping_engine.ensure_client_profile(db, client_id)
    db.commit()
    return {
        "client_id": p.client_id,
        "weekend_operations": p.weekend_operations,
        "receipt_threshold": p.receipt_threshold,
        "chart_of_accounts": p.chart_of_accounts or [],
    }


@router.put("/client-profile/{client_id}")
def put_client_profile(client_id: str, body: ClientProfileBody, db: Session = Depends(get_db)):
    p = bookkeeping_engine.ensure_client_profile(db, client_id)
    if body.weekend_operations is not None:
        p.weekend_operations = body.weekend_operations
    if body.receipt_threshold is not None:
        p.receipt_threshold = body.receipt_threshold
    if body.chart_of_accounts is not None:
        p.chart_of_accounts = body.chart_of_accounts
    db.commit()
    return {"success": True}


@router.post("/transactions/{transaction_id}/receipt")
def attach_receipt(
    transaction_id: int,
    body: ReceiptUrlBody,
    db: Session = Depends(get_db),
):
    t = db.query(BookkeepingTransaction).filter(BookkeepingTransaction.id == transaction_id).first()
    if not t:
        raise HTTPException(404, "Transaction not found")
    t.receipt_url = body.receipt_url
    mr = db.query(MissingReceiptRow).filter(MissingReceiptRow.transaction_id == transaction_id).first()
    if mr:
        mr.resolved = True
    db.commit()
    return {"success": True}


@router.post("/verify-receipt")
def verify_receipt(body: VerifyReceiptBody, db: Session = Depends(get_db)):
    t = db.query(BookkeepingTransaction).filter(BookkeepingTransaction.id == body.transaction_id).first()
    if not t:
        raise HTTPException(404, "Transaction not found")
    result = bookkeeping_engine.claude_verify_receipt(
        t.description or "",
        t.vendor_name or "",
        float(t.amount),
        body.receipt_text,
    )
    return {"success": True, **result}


@router.post("/receipt-reminder")
def receipt_reminder(
    body: ReminderBody,
    client_id: str = Query(...),
    db: Session = Depends(get_db),
):
    q = (
        db.query(MissingReceiptRow)
        .join(BookkeepingTransaction)
        .filter(BookkeepingTransaction.client_id == client_id)
        .filter(MissingReceiptRow.resolved.is_(False))
    )
    if body.transaction_ids:
        q = q.filter(MissingReceiptRow.transaction_id.in_(body.transaction_ids))
    rows = q.all()
    for r in rows:
        r.reminder_sent_count = (r.reminder_sent_count or 0) + 1
    db.commit()
    return {
        "success": True,
        "channel": body.channel,
        "reminders_logged": len(rows),
        "note": "Connect WhatsApp Business API to send real messages; counts updated for audit.",
    }


@router.post("/recon-sign-off")
def recon_sign_off(body: ReconSignoffBody, db: Session = Depends(get_db)):
    db.add(
        ReconciliationSignoff(
            client_id=body.client_id,
            period_month=body.period_month,
            period_year=body.period_year,
            signed_by=body.signed_by,
            variance_amount=body.variance_amount,
            notes=body.notes,
        )
    )
    db.commit()
    return {"success": True}


@router.post("/anomaly-action")
def anomaly_action(body: AnomalyActionBody, db: Session = Depends(get_db)):
    t = (
        db.query(BookkeepingTransaction)
        .filter(BookkeepingTransaction.id == body.transaction_id, BookkeepingTransaction.client_id == body.client_id)
        .first()
    )
    if not t:
        raise HTTPException(404, "Transaction not found")
    if body.action == "approve":
        t.flag_for_review = False
        acc = bookkeeping_engine.get_or_create_accuracy(
            db, body.client_id, t.period_month or datetime.utcnow().month, t.period_year or datetime.utcnow().year
        )
        acc.anomalies_false_positive = (acc.anomalies_false_positive or 0) + 1
    elif body.action == "investigate":
        t.flag_for_review = True
    elif body.action == "escalate":
        t.flag_for_review = True
        t.anomaly_flags = (t.anomaly_flags or []) + [
            {
                "type": "escalated",
                "severity": "critical",
                "message": "Manually escalated by reviewer",
                "action": "Senior review",
            }
        ]
    db.commit()
    return {"success": True, "transaction": _tx_out(t)}


@router.get("/accuracy/{client_id}")
def accuracy_history(client_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(AccuracyMetric)
        .filter(AccuracyMetric.client_id == client_id)
        .order_by(AccuracyMetric.year, AccuracyMetric.month)
        .all()
    )
    return [
        {
            "month": r.month,
            "year": r.year,
            "total_transactions": r.total_transactions,
            "auto_approved": r.auto_approved,
            "staff_corrected": r.staff_corrected,
            "flagged": r.flagged,
            "anomalies_real": r.anomalies_real,
            "anomalies_false_positive": r.anomalies_false_positive,
            "accuracy_pct": r.accuracy_pct,
        }
        for r in rows
    ]


@router.get("/monthly-report")
def monthly_report(client_id: str, month: int, year: int, db: Session = Depends(get_db)):
    return bookkeeping_engine.monthly_report_aggregate(db, client_id, month, year)


@router.get("/monthly-report/pdf")
def monthly_report_pdf(client_id: str, month: int, year: int, db: Session = Depends(get_db)):
    try:
        from fpdf import FPDF
    except ImportError:
        raise HTTPException(500, "PDF library not available")

    data = bookkeeping_engine.monthly_report_aggregate(db, client_id, month, year)
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "Bookkeeping Autopilot - Monthly Report", ln=True)
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 8, f"Client: {client_id}  |  {year}-{month:02d}", ln=True)
    pdf.ln(4)
    for k, v in data.items():
        if k == "by_category":
            pdf.set_font("Helvetica", "B", 12)
            pdf.cell(0, 8, "By category:", ln=True)
            pdf.set_font("Helvetica", "", 10)
            for ck, cv in (v or {}).items():
                try:
                    amt = float(cv)
                    line = f"  {ck}: {amt:.2f}"
                except (TypeError, ValueError):
                    line = f"  {ck}: {cv}"
                pdf.cell(0, 6, line, ln=True)
        else:
            pdf.multi_cell(0, 6, f"{k}: {v}")
    pdf_bytes = pdf.output(dest="S")
    if isinstance(pdf_bytes, str):
        pdf_bytes = pdf_bytes.encode("latin-1")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="bookkeeping-{client_id}-{year}-{month}.pdf"'},
    )
