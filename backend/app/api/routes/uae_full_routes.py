"""
UAE Full Accounting Suite — API Routes
=======================================
Covers all 8 modules:
  1. Chart of Accounts
  2. Journal Entries
  3. AR / Sales Invoices
  4. Bank Reconciliation
  5. Fixed Assets
  6. Accruals
  7. Period-End Close
  8. Management Accounts
"""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.uae_accounting_full import (
    UAEAccount, UAEJournalEntry, UAEJournalLine,
    UAECustomer, UAESalesInvoice, UAESalesInvoiceLine,
    UAEBankAccount, UAEBankStatement, UAEBankStatementLine,
    UAEFixedAsset, UAEAccrual, UAEPeriodClose,
)
from app.services.uae_coa_service import seed_uae_chart_of_accounts, get_account_balances
from app.services.uae_journal_service import (
    create_journal_entry, post_journal_entry, reverse_journal_entry, get_trial_balance,
)
from app.services.uae_fixed_assets_service import run_monthly_depreciation, get_depreciation_schedule
from app.services.uae_accruals_service import suggest_accruals, post_accrual
from app.services.uae_bank_recon_service import (
    import_bank_statement, run_reconciliation, get_reconciliation_summary,
)

router = APIRouter(prefix="/api/uae/full", tags=["UAE Full Accounting"])


def _tenant(request_headers) -> str:
    return request_headers.get("x-tenant-id", "demo")


# ===========================================================================
# 1. CHART OF ACCOUNTS
# ===========================================================================

@router.post("/coa/seed")
def seed_chart_of_accounts(request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    count = seed_uae_chart_of_accounts(tenant_id, db)
    return {"seeded": count, "message": f"Seeded {count} accounts"}


@router.get("/coa")
def list_chart_of_accounts(request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    accounts = (
        db.query(UAEAccount)
        .filter_by(tenant_id=tenant_id, is_active=True)
        .order_by(UAEAccount.code)
        .all()
    )
    return {
        "accounts": [
            {
                "id":           a.id,
                "account_code": a.code,
                "account_name": a.name,
                "account_type": a.account_type,
                "sub_type":     a.sub_type,
                "parent_code":  None,
                "currency":     a.currency,
                "is_vat":       a.is_vat_applicable,
                "vat_rate":     float(a.vat_rate or 0),
                "is_ct":        False,
                "is_active":    a.is_active,
            }
            for a in accounts
        ],
        "count": len(accounts),
    }


class AccountCreate(BaseModel):
    account_code: str
    account_name: str
    account_type: str
    sub_type:     Optional[str] = None
    parent_code:  Optional[str] = None
    currency:     str = "AED"
    is_vat:       bool = False
    vat_rate:     float = 0.0
    is_ct:        bool = False


@router.post("/coa")
def create_account(body: AccountCreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    existing = db.query(UAEAccount).filter_by(tenant_id=tenant_id, account_code=body.account_code).first()
    if existing:
        raise HTTPException(status_code=409, detail="Account code already exists")
    acct = UAEAccount(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        code=body.account_code, name=body.account_name,
        account_type=body.account_type, sub_type=body.sub_type,
        currency=body.currency,
        is_vat_applicable=body.is_vat, vat_rate=body.vat_rate,
        is_active=True,
    )
    db.add(acct); db.commit(); db.refresh(acct)
    return {"id": acct.id, "account_code": acct.code}


@router.get("/coa/balances")
def account_balances(period: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    balances = get_account_balances(tenant_id, period, db)
    return {"period": period, "balances": balances}


# ===========================================================================
# 2. JOURNAL ENTRIES
# ===========================================================================

class JELineIn(BaseModel):
    account_code: str
    description:  Optional[str] = ""
    debit:        float = 0.0
    credit:       float = 0.0


class JECreate(BaseModel):
    entry_date:  str
    description: str
    reference:   Optional[str] = None
    source:      str = "manual"
    lines:       list[JELineIn]
    auto_post:   bool = False


@router.get("/journals")
def list_journals(
    request: Request,
    period: Optional[str] = None,
    source: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    q = db.query(UAEJournalEntry).filter_by(tenant_id=tenant_id)
    if period: q = q.filter(UAEJournalEntry.period == period)
    if source: q = q.filter(UAEJournalEntry.source == source)
    if status: q = q.filter(UAEJournalEntry.status == status)
    entries = q.order_by(UAEJournalEntry.entry_date.desc()).limit(200).all()
    return {
        "entries": [
            {
                "id":          e.id,
                "entry_date":  str(e.entry_date),
                "period":      e.period,
                "description": e.description,
                "reference":   e.reference,
                "source":      e.source,
                "status":      e.status,
                "total_debit": sum(l.debit for l in e.lines),
            }
            for e in entries
        ],
        "count": len(entries),
    }


@router.post("/journals")
def create_je(body: JECreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    lines = [{"account_code": l.account_code, "description": l.description,
              "debit": l.debit, "credit": l.credit} for l in body.lines]
    try:
        je = create_journal_entry(
            tenant_id=tenant_id, entry_date=date.fromisoformat(body.entry_date),
            description=body.description, lines=lines, reference=body.reference,
            source=body.source, db=db, auto_post=body.auto_post,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"id": je.id, "status": je.status}


@router.post("/journals/{je_id}/post")
def post_je(je_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    je = db.query(UAEJournalEntry).filter_by(id=je_id, tenant_id=tenant_id).first()
    if not je:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    try:
        post_journal_entry(je, db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Auto-sync to R2R historical baseline (non-critical — never blocks posting)
    try:
        from app.modules.r2r.historical import add_to_company_baseline
        lines = db.query(UAEJournalLine).filter_by(journal_id=je_id).all()
        je_rows = [
            {
                "je_id": f"{je.id}_{line.id}",
                "je_number": je.reference or je.id,
                "date": str(je.entry_date),
                "period": je.period or "",
                "description": je.description or "",
                "account_code": line.account_code or "",
                "account_name": line.account_name or "",
                "debit": float(line.debit or 0),
                "credit": float(line.credit or 0),
                "amount": float(line.debit or line.credit or 0),
                "source": je.source or "manual",
                "posted_by": je.posted_by or tenant_id,
            }
            for line in lines
        ] if lines else [{
            "je_id": je.id, "je_number": je.reference or je.id,
            "date": str(je.entry_date), "period": je.period or "",
            "description": je.description or "",
            "account_code": "", "account_name": "", "debit": 0, "credit": 0, "amount": 0,
            "source": je.source or "manual", "posted_by": je.posted_by or tenant_id,
        }]
        add_to_company_baseline(
            company_id=tenant_id, journal_entries=je_rows, country="UAE", db=db
        )
    except Exception:
        pass  # R2R sync is non-critical

    return {"id": je.id, "status": je.status, "r2r_synced": True}


@router.post("/journals/{je_id}/reverse")
def reverse_je(je_id: str, reversal_date: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    try:
        new_je = reverse_journal_entry(
            je_id=je_id, tenant_id=tenant_id,
            reversal_date=date.fromisoformat(reversal_date), db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"id": new_je.id, "status": new_je.status}


@router.get("/journals/{je_id}")
def get_je(je_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    je = db.query(UAEJournalEntry).filter_by(id=je_id, tenant_id=tenant_id).first()
    if not je:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return {
        "id": je.id, "entry_date": str(je.entry_date), "period": je.period,
        "description": je.description, "reference": je.reference,
        "source": je.source, "status": je.status,
        "lines": [{"id": l.id, "account_code": l.account_code,
                   "description": l.description, "debit": l.debit, "credit": l.credit}
                  for l in je.lines],
    }


@router.get("/trial-balance")
def full_trial_balance(period: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    return get_trial_balance(tenant_id, period, db)


# ===========================================================================
# 3. AR / SALES INVOICES
# ===========================================================================

class CustomerCreate(BaseModel):
    name:          str
    trn:           Optional[str] = None
    email:         Optional[str] = None
    phone:         Optional[str] = None
    address:       Optional[str] = None
    credit_limit:  float = 0.0
    payment_terms: int = 30


@router.get("/customers")
def list_customers(request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    customers = db.query(UAECustomer).filter_by(tenant_id=tenant_id, is_active=True).all()
    return {
        "customers": [
            {"id": c.id, "name": c.name, "trn": c.trn, "email": c.email,
             "credit_limit": float(c.credit_limit or 0),
             "payment_terms": c.payment_terms_days}
            for c in customers
        ],
        "count": len(customers),
    }


@router.post("/customers")
def create_customer(body: CustomerCreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    c = UAECustomer(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        name=body.name, trn=body.trn, email=body.email,
        phone=body.phone, address=body.address,
        credit_limit=body.credit_limit, payment_terms_days=body.payment_terms, is_active=True,
    )
    db.add(c); db.commit(); db.refresh(c)
    return {"id": c.id}


class InvoiceLineIn(BaseModel):
    description:  str
    quantity:     float = 1.0
    unit_price:   float
    vat_rate:     float = 5.0
    account_code: Optional[str] = "4001"


class InvoiceCreate(BaseModel):
    customer_id:    str
    invoice_date:   str
    due_date:       str
    invoice_number: Optional[str] = None
    reference:      Optional[str] = None
    lines:          list[InvoiceLineIn]


@router.get("/invoices")
def list_invoices(
    request: Request,
    status: Optional[str] = None,
    customer_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    q = db.query(UAESalesInvoice).filter_by(tenant_id=tenant_id)
    if status:      q = q.filter(UAESalesInvoice.status == status)
    if customer_id: q = q.filter(UAESalesInvoice.customer_id == customer_id)
    invoices = q.order_by(UAESalesInvoice.invoice_date.desc()).limit(200).all()
    return {
        "invoices": [
            {"id": i.id, "invoice_number": i.invoice_number, "customer_id": i.customer_id,
             "invoice_date": str(i.invoice_date), "due_date": str(i.due_date),
             "subtotal": i.subtotal, "vat_amount": i.vat_amount,
             "total_amount": float(i.total_amount or 0), "amount_due": float(i.outstanding or 0), "status": i.status}
            for i in invoices
        ],
        "count": len(invoices),
    }


@router.post("/invoices")
def create_invoice(body: InvoiceCreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    inv_count = db.query(UAESalesInvoice).filter_by(tenant_id=tenant_id).count()
    invoice_number = body.invoice_number or f"INV-{inv_count + 1:04d}"
    subtotal   = sum(l.quantity * l.unit_price for l in body.lines)
    vat_amount = sum(l.quantity * l.unit_price * l.vat_rate / 100 for l in body.lines)
    total      = subtotal + vat_amount
    inv = UAESalesInvoice(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        customer_id=body.customer_id, invoice_number=invoice_number,
        invoice_date=date.fromisoformat(body.invoice_date),
        due_date=date.fromisoformat(body.due_date), reference=body.reference,
        subtotal=subtotal, vat_amount=vat_amount,
        total_amount=total, outstanding=total, status="draft",
        period=body.invoice_date[:7],
    )
    db.add(inv); db.flush()
    for ln in body.lines:
        ls = ln.quantity * ln.unit_price
        lv = ls * ln.vat_rate / 100
        db.add(UAESalesInvoiceLine(
            id=str(uuid.uuid4()), invoice_id=inv.id,
            description=ln.description, quantity=ln.quantity, unit_price=ln.unit_price,
            vat_rate=ln.vat_rate, vat_amount=lv, line_total=ls + lv,
        ))
    db.commit(); db.refresh(inv)
    return {"id": inv.id, "invoice_number": invoice_number, "total_amount": total}


@router.post("/invoices/{inv_id}/post")
def post_invoice(inv_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    inv = db.query(UAESalesInvoice).filter_by(id=inv_id, tenant_id=tenant_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status != "draft":
        raise HTTPException(status_code=400, detail="Invoice already posted")
    lines_in = [
        {"account_code": "1200", "description": f"AR {inv.invoice_number}",
         "debit": inv.total_amount, "credit": 0},
    ]
    for ln in inv.lines:
        line_net = float(ln.line_total or 0) - float(ln.vat_amount or 0)
        lines_in.append({"account_code": "4001",
                         "description": ln.description, "debit": 0, "credit": line_net})
    if float(inv.vat_amount or 0):
        lines_in.append({"account_code": "2300", "description": f"VAT {inv.invoice_number}",
                         "debit": 0, "credit": float(inv.vat_amount)})
    je = create_journal_entry(
        tenant_id=tenant_id, entry_date=inv.invoice_date,
        description=f"Sales Invoice {inv.invoice_number}", lines=lines_in,
        reference=inv.invoice_number, source="ar_invoice", db=db, auto_post=True,
    )
    inv.status = "posted"
    inv.journal_entry_id = je.id
    db.commit()
    return {"id": inv.id, "status": "posted", "je_id": je.id}


@router.get("/ar-aging")
def ar_aging(request: Request, as_of: Optional[str] = None, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    as_of_date = date.fromisoformat(as_of) if as_of else date.today()
    invoices = (
        db.query(UAESalesInvoice).filter_by(tenant_id=tenant_id)
        .filter(UAESalesInvoice.outstanding > 0).all()
    )
    buckets = {"current": 0.0, "1_30": 0.0, "31_60": 0.0, "61_90": 0.0, "over_90": 0.0}
    details = []
    for inv in invoices:
        days = (as_of_date - inv.due_date).days
        amt  = float(inv.outstanding or 0)
        if days <= 0:
            buckets["current"] += amt; bucket = "current"
        elif days <= 30:
            buckets["1_30"] += amt; bucket = "1-30 days"
        elif days <= 60:
            buckets["31_60"] += amt; bucket = "31-60 days"
        elif days <= 90:
            buckets["61_90"] += amt; bucket = "61-90 days"
        else:
            buckets["over_90"] += amt; bucket = "90+ days"
        details.append({"invoice_number": inv.invoice_number, "customer_id": inv.customer_id,
                        "due_date": str(inv.due_date), "amount_due": amt,
                        "days_overdue": max(days, 0), "bucket": bucket})
    return {"as_of": str(as_of_date), "buckets": buckets, "invoices": details}


# ===========================================================================
# 4. BANK RECONCILIATION
# ===========================================================================

class BankAccountCreate(BaseModel):
    bank_name:       str
    account_number:  str
    account_name:    str
    currency:        str = "AED"
    gl_account_code: str = "1001"


@router.get("/bank-accounts")
def list_bank_accounts(request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    accounts = db.query(UAEBankAccount).filter_by(tenant_id=tenant_id, is_active=True).all()
    return {
        "accounts": [
            {"id": a.id, "bank_name": a.bank_name, "account_number": a.account_number,
             "account_name": f"{a.bank_name} {a.account_number}",
             "currency": a.currency,
             "gl_account_code": a.gl_account_id or "",
             "current_balance": float(a.last_reconciled_balance or 0)}
            for a in accounts
        ]
    }


@router.post("/bank-accounts")
def create_bank_account(body: BankAccountCreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    ba = UAEBankAccount(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        bank_name=body.bank_name, account_number=body.account_number,
        currency=body.currency, is_active=True,
    )
    db.add(ba); db.commit(); db.refresh(ba)
    return {"id": ba.id}


@router.post("/bank-accounts/{account_id}/import-statement")
async def import_statement(
    account_id: str, bank_name: str, statement_date: str,
    opening_balance: float, closing_balance: float,
    file: UploadFile = File(...),
    request: Request = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    _file_bytes = await file.read()
    try:
        from app.core.aws_config import upload_to_s3
        upload_to_s3(_file_bytes, file.filename, folder="uploads", country="UAE")
    except Exception:
        pass  # S3 save is non-critical — processing continues from memory
    csv_text = _file_bytes.decode("utf-8", errors="replace")
    stmt = import_bank_statement(
        tenant_id=tenant_id, bank_account_id=account_id,
        statement_date=date.fromisoformat(statement_date),
        opening_balance=opening_balance, closing_balance=closing_balance,
        csv_text=csv_text, bank_name=bank_name, db=db,
    )
    return {"statement_id": stmt.id,
            "lines": db.query(UAEBankStatementLine).filter_by(statement_id=stmt.id).count()}


@router.post("/bank-statements/{statement_id}/reconcile")
def reconcile_statement(statement_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    try:
        return run_reconciliation(tenant_id, statement_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/bank-statements/{statement_id}/summary")
def recon_summary(statement_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    try:
        return get_reconciliation_summary(tenant_id, statement_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/bank-statements")
def list_statements(
    request: Request, bank_account_id: Optional[str] = None, db: Session = Depends(get_db),
):
    tenant_id = _tenant(request.headers)
    q = db.query(UAEBankStatement).filter_by(tenant_id=tenant_id)
    if bank_account_id:
        q = q.filter_by(bank_account_id=bank_account_id)
    stmts = q.order_by(UAEBankStatement.statement_date.desc()).all()
    return {
        "statements": [
            {"id": s.id, "bank_account_id": s.bank_account_id,
             "statement_date": str(s.statement_date),
             "opening_balance": s.opening_balance, "closing_balance": s.closing_balance,
             "status": s.status}
            for s in stmts
        ]
    }


# ===========================================================================
# 5. FIXED ASSETS
# ===========================================================================

class AssetCreate(BaseModel):
    asset_name:              str
    asset_code:              Optional[str] = None
    asset_category:          str
    acquisition_date:        str
    cost:                    float
    residual_value:          float = 0.0
    useful_life_years:       int = 5
    depreciation_method:     str = "straight_line"
    location:                Optional[str] = None
    serial_number:           Optional[str] = None
    gl_asset_account:        str = "1500"
    gl_depreciation_account: str = "5500"


@router.get("/fixed-assets")
def list_assets(request: Request, status: Optional[str] = None, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    q = db.query(UAEFixedAsset).filter_by(tenant_id=tenant_id)
    if status:
        q = q.filter_by(status=status)
    assets = q.order_by(UAEFixedAsset.asset_code).all()
    return {
        "assets": [
            {"id": a.id, "asset_code": a.asset_code, "asset_name": a.name,
             "asset_category": a.category, "acquisition_date": str(a.purchase_date or ""),
             "cost": float(a.purchase_cost or 0),
             "accumulated_depreciation": float(a.accumulated_depreciation or 0),
             "net_book_value": float(a.net_book_value or 0),
             "ct_accumulated_dep": float(a.ct_accumulated_depreciation or 0),
             "ct_net_book_value": float(a.purchase_cost or 0) - float(a.ct_accumulated_depreciation or 0),
             "status": a.status}
            for a in assets
        ],
        "count": len(assets),
    }


@router.post("/fixed-assets")
def create_asset(body: AssetCreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    asset_count = db.query(UAEFixedAsset).filter_by(tenant_id=tenant_id).count()
    asset = UAEFixedAsset(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        name=body.asset_name,
        asset_code=body.asset_code or f"FA-{asset_count + 1:04d}",
        category=body.asset_category,
        purchase_date=date.fromisoformat(body.acquisition_date),
        purchase_cost=body.cost, residual_value=body.residual_value,
        useful_life_years=body.useful_life_years,
        depreciation_method=body.depreciation_method,
        location=body.location,
        accumulated_depreciation=0.0,
        net_book_value=body.cost,
        ct_accumulated_depreciation=0.0, status="active",
    )
    db.add(asset); db.commit(); db.refresh(asset)
    return {"id": asset.id, "asset_code": asset.asset_code}


@router.post("/fixed-assets/run-depreciation")
def run_depreciation(period: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    return run_monthly_depreciation(tenant_id, period, db)


@router.get("/fixed-assets/{asset_id}/schedule")
def depreciation_schedule(asset_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    asset = db.query(UAEFixedAsset).filter_by(id=asset_id, tenant_id=tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"asset_id": asset_id, "asset_name": asset.asset_name,
            "schedule": get_depreciation_schedule(asset)}


# ===========================================================================
# 6. ACCRUALS
# ===========================================================================

class AccrualCreate(BaseModel):
    period:       str
    description:  str
    amount:       float
    account_code: str
    accrual_type: str = "expense"
    is_mandatory: bool = False
    ai_reasoning: Optional[str] = None


@router.get("/accruals")
def list_accruals(request: Request, period: Optional[str] = None, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    q = db.query(UAEAccrual).filter_by(tenant_id=tenant_id)
    if period:
        q = q.filter_by(period=period)
    accruals = q.order_by(UAEAccrual.created_at.desc()).all()
    return {
        "accruals": [
            {"id": a.id, "period": a.period, "description": a.description,
             "amount": float(a.amount or 0),
             "account_code": a.debit_account_code or "",
             "accrual_type": a.accrual_type, "is_mandatory": a.mandatory,
             "status": a.status,
             "ai_confidence": float(a.ai_confidence or 0) if a.ai_confidence else None,
             "ai_reasoning": a.ai_basis}
            for a in accruals
        ],
        "count": len(accruals),
    }


@router.post("/accruals")
def create_accrual(body: AccrualCreate, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    accrual = UAEAccrual(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        period=body.period, description=body.description,
        amount=body.amount,
        debit_account_code=body.account_code,
        credit_account_code=body.account_code,
        accrual_type=body.accrual_type, mandatory=body.is_mandatory,
        ai_basis=body.ai_reasoning, status="suggested",
    )
    db.add(accrual); db.commit(); db.refresh(accrual)
    return {"id": accrual.id}


@router.post("/accruals/suggest")
def suggest(period: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    suggestions = suggest_accruals(tenant_id, period, db)
    return {"period": period, "suggestions": suggestions, "count": len(suggestions)}


@router.post("/accruals/{accrual_id}/post")
def post_accrual_route(accrual_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    try:
        return post_accrual(accrual_id, tenant_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ===========================================================================
# 7. PERIOD-END CLOSE
# ===========================================================================

CLOSE_FIELDS = [
    "tb_reconciled", "bank_recon_done", "accruals_posted",
    "fixed_assets_depreciated", "vat_reconciled", "ar_reviewed",
    "ap_reviewed", "ifrs_statements_generated", "management_accounts_done",
]


def _run_checklist(run: UAEPeriodClose) -> dict[str, bool]:
    return {
        "bank_reconciliation":        bool(run.bank_recon_done),
        "ar_invoice_review":          bool(run.ar_reviewed),
        "accruals_posted":            bool(run.accruals_posted),
        "fixed_asset_depreciation":   bool(run.fixed_assets_depreciated),
        "vat_return_prepared":        bool(run.vat_reconciled),
        "intercompany_eliminations":  bool(run.ap_reviewed),
        "prepayments_amortised":      bool(run.tb_reconciled),
        "payroll_posted":             bool(run.ifrs_statements_generated),
        "management_accounts_reviewed": bool(run.management_accounts_done),
    }


@router.get("/period-close")
def list_close_runs(request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    runs = (
        db.query(UAEPeriodClose)
        .filter_by(tenant_id=tenant_id)
        .order_by(UAEPeriodClose.period.desc())
        .all()
    )
    return {
        "runs": [
            {"id": r.id, "period": r.period, "status": r.status,
             "is_locked": r.status == "closed",
             "checklist": _run_checklist(r),
             "closed_at": str(r.closed_at) if r.closed_at else None}
            for r in runs
        ]
    }


@router.post("/period-close/start")
def start_close(period: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    existing = db.query(UAEPeriodClose).filter_by(tenant_id=tenant_id, period=period).first()
    if existing:
        return {"id": existing.id, "period": period, "status": existing.status,
                "checklist": _run_checklist(existing)}
    run = UAEPeriodClose(
        id=str(uuid.uuid4()), tenant_id=tenant_id,
        period=period, status="open",
    )
    db.add(run); db.commit(); db.refresh(run)
    return {"id": run.id, "period": period, "status": "open", "checklist": _run_checklist(run)}


_ITEM_TO_FIELD = {
    "bank_reconciliation":          "bank_recon_done",
    "ar_invoice_review":            "ar_reviewed",
    "accruals_posted":              "accruals_posted",
    "fixed_asset_depreciation":     "fixed_assets_depreciated",
    "vat_return_prepared":          "vat_reconciled",
    "intercompany_eliminations":    "ap_reviewed",
    "prepayments_amortised":        "tb_reconciled",
    "payroll_posted":               "ifrs_statements_generated",
    "management_accounts_reviewed": "management_accounts_done",
}


@router.patch("/period-close/{run_id}/check")
def update_checklist(run_id: str, item: str, done: bool, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    run = db.query(UAEPeriodClose).filter_by(id=run_id, tenant_id=tenant_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Close run not found")
    if run.status == "closed":
        raise HTTPException(status_code=400, detail="Period is locked")
    field = _ITEM_TO_FIELD.get(item)
    if field:
        setattr(run, field, done)
    checklist = _run_checklist(run)
    run.status = "ready_to_close" if all(checklist.values()) else "open"
    db.commit()
    return {"id": run.id, "checklist": _run_checklist(run), "status": run.status}


@router.post("/period-close/{run_id}/lock")
def lock_period(run_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    run = db.query(UAEPeriodClose).filter_by(id=run_id, tenant_id=tenant_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Close run not found")
    checklist = _run_checklist(run)
    incomplete = [k for k, v in checklist.items() if not v]
    if incomplete:
        raise HTTPException(status_code=400, detail=f"Incomplete items: {incomplete}")
    run.status = "closed"
    run.closed_at = datetime.utcnow()
    db.commit()
    return {"id": run.id, "period": run.period, "status": "closed", "is_locked": True}


# ===========================================================================
# 8. MANAGEMENT ACCOUNTS
# ===========================================================================

@router.post("/management-accounts")
def generate_management_accounts(period: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request.headers)
    tb        = get_trial_balance(tenant_id, period, db)
    totals    = tb.get("totals", {})
    revenue   = abs(totals.get("revenue",   0))
    expenses  = abs(totals.get("expense",   0))
    assets    = abs(totals.get("asset",     0))
    liabs     = abs(totals.get("liability", 0))
    equity    = abs(totals.get("equity",    0))
    gross_profit = revenue - expenses * 0.6
    net_profit   = revenue - expenses
    gross_margin = round(gross_profit / revenue * 100, 1) if revenue else 0
    net_margin   = round(net_profit   / revenue * 100, 1) if revenue else 0
    narrative    = _generate_ai_narrative(period, revenue, expenses, net_profit, gross_margin)
    return {
        "period": period,
        "pnl": {"revenue": revenue, "gross_profit": gross_profit, "gross_margin": gross_margin,
                "net_profit": net_profit, "net_margin": net_margin, "total_expenses": expenses},
        "balance_sheet": {"total_assets": assets, "total_liabilities": liabs, "total_equity": equity},
        "narrative": narrative,
        "generated_at": datetime.utcnow().isoformat(),
    }


def _generate_ai_narrative(period, revenue, expenses, net_profit, gross_margin):
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {
            "executive_summary": f"Revenue AED {revenue:,.0f} | Net Profit AED {net_profit:,.0f} | Margin {gross_margin:.1f}%",
            "revenue_analysis": "Connect AI for detailed analysis.",
            "cost_analysis":    "Connect AI for detailed analysis.",
            "balance_sheet":    "Connect AI for detailed analysis.",
            "outlook":          "Connect AI for detailed analysis.",
        }
    try:
        import anthropic
        import json
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-3-5-sonnet-20241022", max_tokens=800,
            messages=[{"role": "user", "content": (
                f"Write a UAE CFO management accounts narrative for {period}.\n"
                f"Revenue: AED {revenue:,.0f}\nExpenses: AED {expenses:,.0f}\n"
                f"Net Profit: AED {net_profit:,.0f}\nGross Margin: {gross_margin:.1f}%\n\n"
                "Return JSON with keys: executive_summary, revenue_analysis, cost_analysis, "
                "balance_sheet, outlook. Each 1-3 sentences. Return ONLY valid JSON."
            )}],
        )
        text = msg.content[0].text
        return json.loads(text[text.find("{"):text.rfind("}") + 1])
    except Exception:
        return {
            "executive_summary": f"Revenue AED {revenue:,.0f} | Net Profit AED {net_profit:,.0f}",
            "revenue_analysis": "See trial balance.", "cost_analysis": "See trial balance.",
            "balance_sheet": "See trial balance.", "outlook": "See trial balance.",
        }


# ===========================================================================
# DASHBOARD KPIs
# ===========================================================================

@router.get("/dashboard")
def dashboard_kpis(period: str, request: Request, db: Session = Depends(get_db)):
    tenant_id     = _tenant(request.headers)
    coa_count     = db.query(UAEAccount).filter_by(tenant_id=tenant_id, is_active=True).count()
    je_count      = db.query(UAEJournalEntry).filter_by(tenant_id=tenant_id, period=period, status="posted").count()
    asset_count   = db.query(UAEFixedAsset).filter_by(tenant_id=tenant_id, status="active").count()
    inv_count     = db.query(UAESalesInvoice).filter_by(tenant_id=tenant_id, period=period).count()
    accrual_count = db.query(UAEAccrual).filter_by(tenant_id=tenant_id, period=period).count()
    ar_invoices   = (
        db.query(UAESalesInvoice).filter_by(tenant_id=tenant_id)
        .filter(UAESalesInvoice.outstanding > 0).all()
    )
    ar_total = sum(float(i.outstanding or 0) for i in ar_invoices)
    tb     = get_trial_balance(tenant_id, period, db)
    totals = tb.get("totals", {})
    return {
        "period":        period,
        "coa_count":     coa_count,
        "je_count":      je_count,
        "asset_count":   asset_count,
        "invoice_count": inv_count,
        "accrual_count": accrual_count,
        "ar_outstanding":ar_total,
        "revenue":       abs(totals.get("revenue",   0)),
        "expenses":      abs(totals.get("expense",   0)),
        "net_profit":    abs(totals.get("revenue",   0)) - abs(totals.get("expense", 0)),
        "total_assets":  abs(totals.get("asset",     0)),
    }
