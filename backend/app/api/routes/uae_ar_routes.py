"""UAE AR — sales invoices, send, payment, aging, cash application."""
from __future__ import annotations

import io
import logging
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.exceptions.period_control import PeriodControlError
from app.models.company_setup import UaeCompanyProfile
from app.models.uae_accounting_full import (
    UAECustomer,
    UAESalesInvoice,
    UAESalesInvoiceLine,
    UAEBankAccount,
    UAEBankStatement,
    UAEBankStatementLine,
)
from app.services.credit_risk_service import recalc_for_customer_name
from app.services.dso_service import build_dso_metrics
from app.services.notification_service import get_workspace_role_email, send_notification
from app.services.payment_prediction_service import predict_payments
from app.services.credit_note_service import issue_credit_note, list_credit_notes, void_credit_note
from app.services.ar_invoice_post_service import post_sales_invoice_to_gl_and_tax
from app.services.uae_journal_service import create_journal_entry
from app.services.ar_aging_service import compute_ar_aging
from app.services.ar_customer_risk_service import compute_customer_risk, filter_by_risk_tier
from app.services.dunning_service import get_dunning_history, get_dunning_templates, run_dunning as run_dunning_service
from app.services.recurring_invoice_service import (
    cancel_template,
    create_template,
    generate_due_invoices,
    get_generated_invoices,
    list_templates,
    pause_template,
    resume_template,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/uae/ar", tags=["UAE AR"])


def _ws(request: Request, query_ws: str | None = None) -> str:
    return (
        query_ws
        or request.headers.get("x-workspace-id")
        or request.headers.get("x-tenant-id")
        or "demo"
    )


def _company_id(request: Request, query_cid: str | None = None) -> str | None:
    return query_cid or request.headers.get("x-company-id")


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _recalc_credit(db: Session, ws: str, company_id: str | None, customer_name: str) -> None:
    if customer_name:
        recalc_for_customer_name(db, ws, company_id, customer_name)


def _get_or_create_customer(
    db: Session, tenant_id: str, name: str, trn: str | None = None,
) -> UAECustomer:
    cust = (
        db.query(UAECustomer)
        .filter(UAECustomer.tenant_id == tenant_id, UAECustomer.name == name)
        .first()
    )
    if cust:
        if trn and not cust.trn:
            cust.trn = trn
            db.add(cust)
        return cust
    cust = UAECustomer(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name=name,
        trn=trn,
    )
    db.add(cust)
    db.flush()
    return cust


def _next_invoice_number(db: Session, tenant_id: str, company_id: str | None) -> str:
    year = datetime.utcnow().year
    q = db.query(UAESalesInvoice).filter(UAESalesInvoice.tenant_id == tenant_id)
    if company_id:
        q = q.filter(UAESalesInvoice.company_id == company_id)
    count = q.count()
    return f"INV-{year}-{count + 1:04d}"


def _flag_overdue(inv: UAESalesInvoice, today: date, db: Session) -> bool:
    if inv.status == "sent" and inv.due_date and inv.due_date < today:
        inv.status = "overdue"
        db.add(inv)
        cust_name = inv.customer.name if inv.customer else ""
        if cust_name:
            _recalc_credit(db, inv.tenant_id, inv.company_id, cust_name)
        email = get_workspace_role_email(db, inv.tenant_id, ["AR Manager", "CFO"])
        if email and not inv.overdue_notified_at:
            cust_name = inv.customer.name if inv.customer else "Customer"
            send_notification(
                email,
                f"Overdue invoice {inv.invoice_number}",
                f"Invoice {inv.invoice_number} for {cust_name} is overdue. "
                f"Amount: AED {_f(inv.outstanding or inv.total_amount):,.2f}",
            )
            inv.overdue_notified_at = datetime.utcnow()
            db.add(inv)
        return True
    return inv.status == "overdue"


def _invoice_dict(inv: UAESalesInvoice, today: date, db: Session, einvoicing_status: str | None = None) -> dict[str, Any]:
    is_overdue = _flag_overdue(inv, today, db)
    cust = inv.customer
    return {
        "id": inv.id,
        "invoice_number": inv.invoice_number,
        "customer_name": cust.name if cust else "Customer",
        "customer_trn": inv.buyer_trn or (cust.trn if cust else None),
        "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else None,
        "due_date": inv.due_date.isoformat() if inv.due_date else None,
        "subtotal": _f(inv.subtotal),
        "vat_amount": _f(inv.vat_amount),
        "total": _f(inv.total_amount),
        "amount_due": _f(inv.outstanding),
        "status": inv.status or "draft",
        "einvoicing_status": einvoicing_status,
        "is_overdue": is_overdue,
        "je_reference": inv.journal_entry_id,
        "sent_at": inv.sent_at.isoformat() if inv.sent_at else None,
        "paid_date": inv.paid_date.isoformat() if inv.paid_date else None,
        "payment_reference": inv.payment_reference,
        "line_items": [
            {
                "description": ln.description,
                "qty": _f(ln.quantity),
                "unit_price": _f(ln.unit_price),
                "vat_rate": _f(ln.vat_rate),
                "vat_amount": _f(ln.vat_amount),
                "line_total": _f(ln.line_total),
            }
            for ln in (inv.lines or [])
        ],
    }


def _build_pdf(inv: UAESalesInvoice, company: UaeCompanyProfile | None) -> bytes:
    try:
        from fpdf import FPDF
    except ImportError as exc:
        raise HTTPException(501, "PDF export requires fpdf2") from exc

    cust = inv.customer
    co_name = company.company_name if company else "Company"
    co_trn = company.trn if company else (inv.seller_trn or "")
    co_addr = company.address if company else ""

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, co_name, ln=1)
    pdf.set_font("Helvetica", "", 10)
    if co_addr:
        pdf.multi_cell(0, 5, co_addr)
    if co_trn:
        pdf.cell(0, 5, f"TRN: {co_trn}", ln=1)
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "TAX INVOICE", ln=1, align="C")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"Invoice: {inv.invoice_number}", ln=1)
    pdf.cell(0, 6, f"Date: {inv.invoice_date}", ln=1)
    pdf.cell(0, 6, f"Due: {inv.due_date}", ln=1)
    pdf.ln(2)
    pdf.cell(0, 6, f"Bill To: {cust.name if cust else 'Customer'}", ln=1)
    if inv.buyer_trn or (cust and cust.trn):
        pdf.cell(0, 6, f"Customer TRN: {inv.buyer_trn or cust.trn}", ln=1)
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(70, 7, "Description", 1)
    pdf.cell(15, 7, "Qty", 1, align="R")
    pdf.cell(25, 7, "Unit", 1, align="R")
    pdf.cell(15, 7, "VAT%", 1, align="R")
    pdf.cell(25, 7, "VAT", 1, align="R")
    pdf.cell(30, 7, "Total", 1, align="R", ln=1)
    pdf.set_font("Helvetica", "", 9)
    for ln in inv.lines or []:
        pdf.cell(70, 7, (ln.description or "")[:40], 1)
        pdf.cell(15, 7, f"{_f(ln.quantity):.2f}", 1, align="R")
        pdf.cell(25, 7, f"{_f(ln.unit_price):,.2f}", 1, align="R")
        pdf.cell(15, 7, f"{_f(ln.vat_rate):.0f}", 1, align="R")
        pdf.cell(25, 7, f"{_f(ln.vat_amount):,.2f}", 1, align="R")
        pdf.cell(30, 7, f"{_f(ln.line_total):,.2f}", 1, align="R", ln=1)
    pdf.ln(2)
    pdf.cell(130, 7, "Subtotal", align="R")
    pdf.cell(50, 7, f"AED {_f(inv.subtotal):,.2f}", ln=1, align="R")
    pdf.cell(130, 7, "VAT", align="R")
    pdf.cell(50, 7, f"AED {_f(inv.vat_amount):,.2f}", ln=1, align="R")
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(130, 8, "Grand Total", align="R")
    pdf.cell(50, 8, f"AED {_f(inv.total_amount):,.2f}", ln=1, align="R")
    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 8)
    pdf.multi_cell(
        0, 4,
        f"TRN: {co_trn} — VAT Invoice per UAE Federal Tax Authority",
    )
    return pdf.output()


class LineItemIn(BaseModel):
    description: str
    qty: float = 1.0
    unit_price: float
    vat_rate: float = 5.0


class CreateInvoiceIn(BaseModel):
    customer_name: str
    customer_trn: Optional[str] = None
    invoice_date: str
    due_date: str
    line_items: list[LineItemIn]
    company_id: str
    workspace_id: Optional[str] = None


class ApproveAndPostIn(BaseModel):
    invoice_id: str
    company_id: Optional[str] = None
    workspace_id: Optional[str] = None


class SendInvoiceIn(BaseModel):
    invoice_id: str
    customer_email: str


class RecordPaymentIn(BaseModel):
    invoice_id: str
    payment_date: str
    bank_account_code: str
    amount_received: float
    reference: Optional[str] = None
    company_id: str
    workspace_id: Optional[str] = None


class AutoMatchIn(BaseModel):
    company_id: str
    workspace_id: Optional[str] = None
    bank_account_code: Optional[str] = None


class RunDunningIn(BaseModel):
    company_id: str
    workspace_id: Optional[str] = None


class IssueCreditNoteIn(BaseModel):
    amount: float = Field(..., gt=0)
    reason: Optional[str] = None
    company_id: Optional[str] = None
    workspace_id: Optional[str] = None
    issued_date: Optional[str] = None


class PredictPaymentIn(BaseModel):
    invoice_id: Optional[str] = None
    company_id: str
    workspace_id: Optional[str] = None


class CreateRecurringInvoiceIn(BaseModel):
    customer_id: str
    description: str
    amount: float = Field(..., gt=0)
    vat_rate: float = Field(5.0, ge=0)
    recurrence_type: str
    interval: int = Field(1, ge=1)
    start_date: str
    end_date: Optional[str] = None
    company_id: str
    workspace_id: Optional[str] = None


class GenerateDueRecurringIn(BaseModel):
    company_id: Optional[str] = None
    workspace_id: Optional[str] = None


@router.get("/invoices")
def list_invoices(
    request: Request,
    company_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    today = date.today()
    q = db.query(UAESalesInvoice).filter(UAESalesInvoice.tenant_id == ws)
    if cid:
        q = q.filter(UAESalesInvoice.company_id == cid)
    if status:
        q = q.filter(UAESalesInvoice.status == status.lower())
    invoices = q.order_by(UAESalesInvoice.invoice_date.desc()).limit(500).all()
    from app.services.einvoicing_service_unified import get_latest_submission_status

    status_map = get_latest_submission_status(db, ws, [inv.id for inv in invoices])
    result = [_invoice_dict(inv, today, db, status_map.get(inv.id)) for inv in invoices]
    db.commit()
    return {"invoices": result, "count": len(result)}


@router.get("/aging")
def ar_aging(
    request: Request,
    company_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    today = date.today()

    # Preserve existing side effect of this endpoint: auto-flag sent invoices as
    # overdue and notify AR Manager/CFO on first detection. Kept scoped to this
    # endpoint only — uae_full_routes and ar_collections never triggered this,
    # and unifying the bucket math shouldn't spread the notification side effect
    # to callers that didn't previously have it.
    q = db.query(UAESalesInvoice).filter(
        UAESalesInvoice.tenant_id == ws,
        UAESalesInvoice.status.notin_(["paid"]),
        UAESalesInvoice.outstanding > 0,
    )
    if cid:
        q = q.filter(UAESalesInvoice.company_id == cid)
    for inv in q.all():
        _flag_overdue(inv, today, db)
    db.commit()

    report = compute_ar_aging(db, ws, cid, today)
    buckets = [
        {
            "bucket": b["label"],
            "invoice_count": b["invoice_count"],
            "total_aed": b["amount"],
            "customers": b["customers"],
        }
        for b in report["buckets"]
        if b["invoice_count"] > 0
    ]
    return {"buckets": buckets, "total_outstanding": report["total_outstanding"], "currency": "AED"}


@router.get("/customer-risk")
def ar_customer_risk(
    request: Request,
    company_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    risk_tier: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    report = compute_customer_risk(db, ws, cid, date.today())
    return filter_by_risk_tier(report, risk_tier)


@router.post("/approve-and-post", summary="Post AR sales invoice to UAE GL and GulfTax output VAT")
def approve_and_post_ar(body: ApproveAndPostIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id)
    result = post_sales_invoice_to_gl_and_tax(
        body.invoice_id,
        tenant_id=ws,
        company_id=body.company_id or _company_id(request),
        db=db,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "post_failed"))
    return result


@router.post("/create-invoice")
def create_invoice(body: CreateInvoiceIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id)
    cid = body.company_id
    if not body.line_items:
        raise HTTPException(status_code=400, detail="At least one line item required")

    customer = _get_or_create_customer(db, ws, body.customer_name.strip(), body.customer_trn)
    inv_date = date.fromisoformat(body.invoice_date)
    due_date = date.fromisoformat(body.due_date)

    subtotal = sum(li.qty * li.unit_price for li in body.line_items)
    vat_amount = sum(li.qty * li.unit_price * li.vat_rate / 100 for li in body.line_items)
    total = subtotal + vat_amount
    invoice_number = _next_invoice_number(db, ws, cid)

    inv = UAESalesInvoice(
        id=str(uuid.uuid4()),
        tenant_id=ws,
        company_id=cid,
        invoice_number=invoice_number,
        customer_id=customer.id,
        invoice_date=inv_date,
        due_date=due_date,
        period=inv_date.strftime("%Y-%m"),
        subtotal=subtotal,
        vat_amount=vat_amount,
        total_amount=total,
        paid_amount=0,
        outstanding=total,
        status="draft",
        buyer_trn=body.customer_trn,
    )
    db.add(inv)
    db.flush()

    for li in body.line_items:
        line_sub = li.qty * li.unit_price
        line_vat = line_sub * li.vat_rate / 100
        db.add(UAESalesInvoiceLine(
            id=str(uuid.uuid4()),
            invoice_id=inv.id,
            description=li.description,
            quantity=li.qty,
            unit_price=li.unit_price,
            vat_rate=li.vat_rate,
            vat_amount=line_vat,
            line_total=line_sub + line_vat,
        ))
    db.flush()

    post_result = post_sales_invoice_to_gl_and_tax(
        inv.id,
        tenant_id=ws,
        company_id=cid,
        db=db,
    )
    if not post_result.get("ok"):
        db.rollback()
        err = post_result.get("error", "post_failed")
        if "period" in str(err).lower():
            raise HTTPException(status_code=422, detail=err) from None
        raise HTTPException(status_code=400, detail=err)

    _recalc_credit(db, ws, cid, body.customer_name.strip())
    db.commit()
    db.refresh(inv)

    return {
        "invoice_id": inv.id,
        "invoice_number": invoice_number,
        "subtotal": round(subtotal, 2),
        "vat_amount": round(vat_amount, 2),
        "total": round(total, 2),
        "status": inv.status,
        "je_id": post_result.get("je_id"),
        "je_reference": post_result.get("je_reference"),
        "gulftax": post_result.get("gulftax"),
    }


@router.post("/send-invoice")
def send_invoice(body: SendInvoiceIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request)
    inv = db.query(UAESalesInvoice).filter_by(id=body.invoice_id, tenant_id=ws).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if not inv.journal_entry_id and inv.status == "draft":
        post_result = post_sales_invoice_to_gl_and_tax(
            inv.id,
            tenant_id=ws,
            company_id=inv.company_id,
            db=db,
        )
        if not post_result.get("ok"):
            raise HTTPException(status_code=400, detail=post_result.get("error", "post_failed"))
        db.refresh(inv)

    company = None
    if inv.company_id:
        company = db.query(UaeCompanyProfile).filter_by(id=inv.company_id).first()

    pdf_bytes = _build_pdf(inv, company)
    cust_name = inv.customer.name if inv.customer else "Customer"
    co_name = company.company_name if company else "Company"
    total = _f(inv.total_amount)
    subject = f"Invoice {inv.invoice_number} — {co_name}"
    email_body = (
        f"Dear {cust_name}, please find attached invoice {inv.invoice_number} "
        f"for AED {total:,.2f}. Payment due: {inv.due_date}."
    )

    warning = None
    if body.customer_email:
        sent = send_notification(
            body.customer_email,
            subject,
            email_body,
            attachment=pdf_bytes,
            attachment_filename=f"{inv.invoice_number}.pdf",
        )
        if not sent:
            warning = "Email not configured — invoice marked as sent without delivery"
    else:
        warning = "No customer email provided"

    inv.status = "sent"
    inv.sent_at = datetime.utcnow()
    db.add(inv)
    cust_name = inv.customer.name if inv.customer else ""
    _recalc_credit(db, ws, inv.company_id, cust_name)
    db.commit()

    return {"sent": True, "invoice_number": inv.invoice_number, "warning": warning}


@router.post("/record-payment")
def record_payment(body: RecordPaymentIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id)
    inv = db.query(UAESalesInvoice).filter_by(
        id=body.invoice_id, tenant_id=ws, company_id=body.company_id,
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    amount = _f(body.amount_received)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount_received must be positive")

    pay_date = date.fromisoformat(body.payment_date)
    cust_name = inv.customer.name if inv.customer else "Customer"
    je_lines = [
        {"account_code": body.bank_account_code, "account_name": "Bank",
         "debit": amount, "credit": 0, "description": f"Receipt {inv.invoice_number}"},
        {"account_code": "1200", "account_name": "Trade Receivables",
         "debit": 0, "credit": amount, "description": f"AR {inv.invoice_number}"},
    ]
    try:
        je = create_journal_entry(
            tenant_id=ws,
            entry_date=pay_date,
            description=f"Receipt: {cust_name} - {inv.invoice_number}",
            lines=je_lines,
            reference=body.reference or inv.invoice_number,
            source="AR_RECEIPT",
            company_id=body.company_id,
            db=db,
            auto_post=True,
        )
    except PeriodControlError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    inv.paid_amount = _f(inv.paid_amount) + amount
    inv.outstanding = max(0.0, _f(inv.total_amount) - _f(inv.paid_amount))
    inv.payment_reference = body.reference
    inv.paid_date = pay_date
    if inv.outstanding <= 0.01:
        inv.status = "paid"
        inv.outstanding = 0
    else:
        inv.status = "partial"
    db.add(inv)
    _recalc_credit(db, ws, body.company_id, cust_name)
    db.commit()

    return {"success": True, "receipt_je_id": je.id, "status": inv.status}


@router.get("/dso-metrics")
def dso_metrics(
    request: Request,
    company_id: str,
    workspace_id: Optional[str] = None,
    period_start: Optional[str] = None,
    period_end: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    today = date.today()
    start = period_start or today.replace(day=1).isoformat()
    if period_end:
        end = period_end
    else:
        if today.month == 12:
            end = date(today.year, 12, 31).isoformat()
        else:
            end = (date(today.year, today.month + 1, 1) - timedelta(days=1)).isoformat()
    return build_dso_metrics(db, ws, company_id, start, end)


@router.post("/predict-payment")
def predict_payment(body: PredictPaymentIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id)
    return predict_payments(db, ws, body.company_id, invoice_id=body.invoice_id)


@router.get("/invoices/{invoice_id}/pdf")
def download_invoice_pdf(
    invoice_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    ws = _ws(request)
    inv = db.query(UAESalesInvoice).filter_by(id=invoice_id, tenant_id=ws).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    company = None
    if inv.company_id:
        company = db.query(UaeCompanyProfile).filter_by(id=inv.company_id).first()
    pdf_bytes = _build_pdf(inv, company)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{inv.invoice_number}.pdf"'},
    )


@router.post("/auto-match-payment")
def auto_match_payment(body: AutoMatchIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id)
    cid = body.company_id

    open_invoices = (
        db.query(UAESalesInvoice)
        .filter(
            UAESalesInvoice.tenant_id == ws,
            UAESalesInvoice.company_id == cid,
            UAESalesInvoice.status.in_(["sent", "overdue", "partial"]),
            UAESalesInvoice.outstanding > 0,
        )
        .all()
    )

    bank_q = db.query(UAEBankStatementLine).join(UAEBankStatement).filter(
        UAEBankStatement.tenant_id == ws,
        UAEBankStatementLine.match_status.in_(["unmatched", None, ""]),
        UAEBankStatementLine.credit > 0,
    )
    if body.bank_account_code:
        acct = (
            db.query(UAEBankAccount)
            .filter(UAEBankAccount.tenant_id == ws, UAEBankAccount.company_id == cid)
            .first()
        )
        if acct:
            bank_q = bank_q.filter(UAEBankStatement.bank_account_id == acct.id)
    bank_lines = bank_q.limit(200).all()

    matched: list[dict[str, Any]] = []
    needs_review: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    used_invoices: set[str] = set()

    for bl in bank_lines:
        amt = _f(bl.credit)
        ref = (bl.description or bl.reference or "").lower()
        best = None
        best_score = 0.0
        for inv in open_invoices:
            if inv.id in used_invoices:
                continue
            out = _f(inv.outstanding)
            score = 0.0
            if abs(out - amt) < 0.01:
                score = 0.95
            elif abs(out - amt) <= 100:
                score = 0.75
            inv_ref = (inv.invoice_number or "").lower()
            if inv_ref and inv_ref in ref:
                score = min(1.0, score + 0.2)
            if score > best_score:
                best_score = score
                best = inv
        if best and best_score >= 0.9:
            matched.append({
                "invoice_id": best.id,
                "invoice_number": best.invoice_number,
                "amount": amt,
                "confidence": round(best_score, 2),
            })
            used_invoices.add(best.id)
            bl.match_status = "matched"
            bl.match_confidence = best_score
            db.add(bl)
        elif best and best_score >= 0.7:
            needs_review.append({
                "invoice_id": best.id,
                "invoice_number": best.invoice_number,
                "amount": amt,
                "confidence": round(best_score, 2),
                "reason": "Amount close but not exact",
            })
        else:
            unmatched.append({"amount": amt, "reference": bl.reference or bl.description})

    db.commit()
    matched_total = sum(m["amount"] for m in matched)
    return {
        "matched": matched,
        "matched_count": len(matched),
        "matched_total_aed": round(matched_total, 2),
        "needs_review": needs_review,
        "needs_review_count": len(needs_review),
        "unmatched": unmatched,
        "unmatched_count": len(unmatched),
    }


@router.post("/run-dunning")
def run_dunning(body: RunDunningIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id)
    today = date.today()
    overdue = (
        db.query(UAESalesInvoice)
        .filter(
            UAESalesInvoice.tenant_id == ws,
            UAESalesInvoice.company_id == body.company_id,
            UAESalesInvoice.status.in_(["sent", "overdue", "partial"]),
            UAESalesInvoice.due_date < today,
            UAESalesInvoice.outstanding > 0,
        )
        .all()
    )
    for inv in overdue:
        _flag_overdue(inv, today, db)
    db.flush()
    return run_dunning_service(db, ws, body.company_id, today)


@router.get("/dunning-history")
def dunning_history(
    request: Request,
    company_id: Optional[str] = None,
    dunning_level: Optional[int] = None,
    workspace_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    if not cid:
        raise HTTPException(status_code=400, detail="company_id required")
    return get_dunning_history(db, ws, cid, dunning_level=dunning_level)


@router.get("/dunning-templates")
def dunning_templates():
    return {"templates": get_dunning_templates()}


@router.post("/recurring-invoices")
def create_recurring_invoice(body: CreateRecurringInvoiceIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id)
    try:
        return create_template(
            db,
            tenant_id=ws,
            company_id=body.company_id,
            customer_id=body.customer_id,
            description=body.description,
            amount=body.amount,
            vat_rate=body.vat_rate,
            recurrence_type=body.recurrence_type.strip().lower(),
            interval=body.interval,
            start_date=date.fromisoformat(body.start_date),
            end_date=date.fromisoformat(body.end_date) if body.end_date else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/recurring-invoices")
def get_recurring_invoices(
    request: Request,
    company_id: Optional[str] = None,
    status: Optional[str] = None,
    workspace_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    return list_templates(db, ws, cid, status)


@router.post("/recurring-invoices/generate-due")
def generate_due_recurring(
    body: GenerateDueRecurringIn,
    request: Request,
    db: Session = Depends(get_db),
):
    ws = _ws(request, body.workspace_id)
    cid = body.company_id or _company_id(request)
    return generate_due_invoices(db, ws, date.today(), cid)


@router.get("/recurring-invoices/{template_id}/generated")
def recurring_generated_invoices(
    template_id: str,
    request: Request,
    workspace_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    try:
        return get_generated_invoices(db, template_id, ws)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/recurring-invoices/{template_id}/pause")
def pause_recurring_invoice(
    template_id: str,
    request: Request,
    workspace_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    try:
        return pause_template(db, template_id, ws)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/recurring-invoices/{template_id}/resume")
def resume_recurring_invoice(
    template_id: str,
    request: Request,
    workspace_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    try:
        return resume_template(db, template_id, ws)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/recurring-invoices/{template_id}/cancel")
def cancel_recurring_invoice(
    template_id: str,
    request: Request,
    workspace_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    try:
        return cancel_template(db, template_id, ws)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/credit-notes")
def get_credit_notes(
    request: Request,
    company_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    status: Optional[str] = None,
    parent_invoice_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    return list_credit_notes(
        db,
        ws,
        company_id=cid,
        customer_id=customer_id,
        status=status,
        parent_invoice_id=parent_invoice_id,
    )


@router.post("/credit-notes/{credit_note_id}/void")
def void_credit_note_route(
    credit_note_id: str,
    request: Request,
    workspace_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    result = void_credit_note(db, credit_note_id, tenant_id=ws)
    if not result.get("ok"):
        code = 409 if result.get("error") == "void_blocked_invoice_paid_after_credit_note" else 400
        raise HTTPException(status_code=code, detail=result)
    return result


@router.post("/{invoice_id}/credit-note")
def create_credit_note_for_invoice(
    invoice_id: str,
    body: IssueCreditNoteIn,
    request: Request,
    db: Session = Depends(get_db),
):
    ws = _ws(request, body.workspace_id)
    issued = date.fromisoformat(body.issued_date) if body.issued_date else None
    result = issue_credit_note(
        db,
        invoice_id,
        body.amount,
        body.reason or "",
        tenant_id=ws,
        company_id=body.company_id or _company_id(request),
        issued_date=issued,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result)
    cust_name = result.get("credit_note", {}).get("customer_name", "")
    if cust_name:
        _recalc_credit(db, ws, body.company_id or _company_id(request), cust_name)
        db.commit()
    return result
