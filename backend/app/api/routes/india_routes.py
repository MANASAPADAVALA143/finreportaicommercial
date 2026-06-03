"""
India Complete Accounting System — API Routes
=============================================
All endpoints under /api/india/full/
Modules: CoA · Journal Entries · Customers · Vendors · Sales Invoices (GST)
         Purchase Invoices (ITC) · TDS · GST Returns · Payroll · Fixed Assets
         Period-End Close · Dashboard
"""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.india_accounting import (
    IndiaAccount, IndiaJournalEntry, IndiaJournalLine,
    IndiaCustomer, IndiaVendor,
    IndiaSalesInvoice, IndiaSalesInvoiceLine,
    IndiaPurchaseInvoice, IndiaPurchaseInvoiceLine,
    IndiaTDSEntry, IndiaTDSCertificate,
    IndiaGSTReturn,
    IndiaEmployee, IndiaPayrollRun, IndiaPayslip,
    IndiaFixedAsset,
    IndiaPeriodClose,
)
from app.services.india_gst_service import (
    calc_gst, save_gst_return, generate_gst_narrative,
    compile_gstr1, compile_gstr3b,
)
from app.services.india_tds_service import (
    create_tds_entry, deposit_tds, generate_tds_certificate,
    tds_summary, TDS_SECTIONS, calc_tds,
)
from app.services.india_payroll_service import (
    run_payroll, post_payroll, seed_sample_employees,
)

router = APIRouter(prefix="/api/india/full", tags=["India Accounting"])


def _uuid() -> str:
    return str(uuid.uuid4())


def _tenant(request_headers) -> str:
    from fastapi import Request
    return "demo"


def get_tenant(db: Session = Depends(get_db)):
    return db


# Helper to get tenant from header
from fastapi import Header


def tenant_header(x_tenant_id: str = Header(default="demo")) -> str:
    return x_tenant_id


# ══════════════════════════════════════════════════════════════════════════════
# CHART OF ACCOUNTS
# ══════════════════════════════════════════════════════════════════════════════

INDIA_COA_SEED = [
    # Assets
    ("1000","Cash and Cash Equivalents","Asset","Current Asset",None,False,None),
    ("1010","Bank — Current Account","Asset","Current Asset",None,False,None),
    ("1100","Accounts Receivable (Trade Debtors)","Asset","Current Asset",None,False,None),
    ("1200","Inventory / Stock in Trade","Asset","Current Asset",None,False,None),
    ("1300","Advance to Suppliers","Asset","Current Asset",None,False,None),
    ("1310","GST Input Credit — CGST","Asset","Current Asset",None,True,"cgst"),
    ("1311","GST Input Credit — SGST","Asset","Current Asset",None,True,"sgst"),
    ("1312","GST Input Credit — IGST","Asset","Current Asset",None,True,"igst"),
    ("1400","Prepaid Expenses","Asset","Current Asset",None,False,None),
    ("1500","Fixed Assets — Gross Block","Asset","Non-Current Asset",None,False,None),
    ("1510","Accumulated Depreciation","Asset","Non-Current Asset",None,False,None),
    ("1600","Capital WIP","Asset","Non-Current Asset",None,False,None),
    ("1700","TDS Receivable","Asset","Current Asset",None,True,None),
    ("1800","Advance Tax Paid","Asset","Current Asset",None,False,None),
    # Liabilities
    ("2000","Accounts Payable (Trade Creditors)","Liability","Current Liability",None,False,None),
    ("2100","Advance from Customers","Liability","Current Liability",None,False,None),
    ("2200","Salary Payable","Liability","Current Liability",None,False,None),
    ("2210","PF Payable","Liability","Current Liability",None,False,None),
    ("2211","ESI Payable","Liability","Current Liability",None,False,None),
    ("2212","Professional Tax Payable","Liability","Current Liability",None,False,None),
    ("2220","Gratuity Provision","Liability","Long-Term Liability",None,False,None),
    ("2300","Short-Term Loans","Liability","Current Liability",None,False,None),
    ("2310","GST Output — CGST","Liability","Current Liability",None,True,"cgst"),
    ("2311","GST Output — SGST","Liability","Current Liability",None,True,"sgst"),
    ("2312","GST Output — IGST","Liability","Current Liability",None,True,"igst"),
    ("2400","TDS Payable","Liability","Current Liability",None,True,None),
    ("2500","Income Tax Payable","Liability","Current Liability",None,False,None),
    ("2600","Long-Term Borrowings","Liability","Non-Current Liability",None,False,None),
    # Equity
    ("3000","Share Capital","Equity","Equity",None,False,None),
    ("3100","Retained Earnings","Equity","Equity",None,False,None),
    ("3200","Other Reserves","Equity","Equity",None,False,None),
    # Revenue
    ("4000","Revenue from Operations","Revenue","Operating Revenue",None,False,None),
    ("4010","Export Revenue","Revenue","Operating Revenue",None,False,None),
    ("4100","Other Income","Revenue","Non-Operating Revenue",None,False,None),
    ("4200","Interest Income","Revenue","Non-Operating Revenue",None,False,None),
    # Expenses
    ("5000","Cost of Goods Sold","Expense","Direct Cost",None,False,None),
    ("5100","Salaries & Wages","Expense","Employee Cost",None,False,None),
    ("5110","Employer PF Contribution","Expense","Employee Cost",None,False,None),
    ("5111","Employer ESI Contribution","Expense","Employee Cost",None,False,None),
    ("5112","Gratuity Expense","Expense","Employee Cost",None,False,None),
    ("5200","Rent Expense","Expense","Operating Expense",None,False,None),
    ("5210","Electricity & Utilities","Expense","Operating Expense",None,False,None),
    ("5300","Professional Fees","Expense","Operating Expense",None,False,None),
    ("5400","Depreciation","Expense","Operating Expense",None,False,None),
    ("5500","Marketing & Advertising","Expense","Operating Expense",None,False,None),
    ("5600","Travel & Conveyance","Expense","Operating Expense",None,False,None),
    ("5700","Bank Charges","Expense","Finance Cost",None,False,None),
    ("5800","Interest on Loans","Expense","Finance Cost",None,False,None),
    ("5900","Miscellaneous Expenses","Expense","Operating Expense",None,False,None),
]


class SeedCoAResponse(BaseModel):
    seeded: int


@router.post("/coa/seed", response_model=SeedCoAResponse)
def seed_coa(
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    existing = db.query(IndiaAccount).filter_by(tenant_id=tenant).count()
    if existing:
        return {"seeded": 0}
    count = 0
    for code, name, atype, sub, parent, is_gst, gst_type in INDIA_COA_SEED:
        db.add(IndiaAccount(
            id=_uuid(), tenant_id=tenant, code=code, name=name,
            account_type=atype, sub_type=sub, parent_code=parent,
            is_gst=is_gst, gst_type=gst_type, is_active=True,
        ))
        count += 1
    db.commit()
    return {"seeded": count}


@router.get("/coa")
def list_coa(
    account_type: Optional[str] = None,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    q = db.query(IndiaAccount).filter_by(tenant_id=tenant)
    if account_type:
        q = q.filter(IndiaAccount.account_type == account_type)
    accs = q.order_by(IndiaAccount.code).all()
    return {
        "accounts": [
            {
                "id": a.id, "code": a.code, "name": a.name,
                "account_type": a.account_type, "sub_type": a.sub_type,
                "is_gst": a.is_gst, "gst_type": a.gst_type,
                "is_tds": a.is_tds, "is_active": a.is_active,
            }
            for a in accs
        ],
        "count": len(accs),
    }


# ══════════════════════════════════════════════════════════════════════════════
# JOURNAL ENTRIES
# ══════════════════════════════════════════════════════════════════════════════

class JELineIn(BaseModel):
    account_code: str
    description: Optional[str] = ""
    debit: float = 0
    credit: float = 0


class JEIn(BaseModel):
    entry_date: str
    description: str
    reference: Optional[str] = None
    source: Optional[str] = "manual"
    narration: Optional[str] = None
    auto_post: Optional[bool] = False
    lines: list[JELineIn]


@router.get("/journals")
def list_journals(
    period: Optional[str] = None,
    source: Optional[str] = None,
    status: Optional[str] = None,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    q = db.query(IndiaJournalEntry).filter_by(tenant_id=tenant)
    if period:
        q = q.filter(IndiaJournalEntry.period == period)
    if source:
        q = q.filter(IndiaJournalEntry.source == source)
    if status:
        q = q.filter(IndiaJournalEntry.status == status)
    entries = q.order_by(IndiaJournalEntry.entry_date.desc()).limit(200).all()
    return {
        "entries": [
            {
                "id": e.id, "entry_date": str(e.entry_date),
                "period": e.period, "description": e.description,
                "reference": e.reference, "source": e.source,
                "status": e.status, "total_debit": float(e.total_debit or 0),
                "narration": e.narration,
            }
            for e in entries
        ],
        "count": len(entries),
    }


@router.post("/journals")
def create_je(
    body: JEIn,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    total_dr = sum(l.debit for l in body.lines)
    total_cr = sum(l.credit for l in body.lines)
    if abs(total_dr - total_cr) > 0.01:
        raise HTTPException(400, f"Debits ({total_dr}) ≠ Credits ({total_cr})")

    entry_date = date.fromisoformat(body.entry_date)
    period = body.entry_date[:7]

    je = IndiaJournalEntry(
        id=_uuid(), tenant_id=tenant,
        entry_date=entry_date, period=period,
        description=body.description, reference=body.reference,
        source=body.source or "manual",
        narration=body.narration,
        total_debit=total_dr,
        status="posted" if body.auto_post else "draft",
        posted_at=datetime.utcnow() if body.auto_post else None,
    )
    db.add(je)
    db.flush()

    for ln in body.lines:
        db.add(IndiaJournalLine(
            id=_uuid(), entry_id=je.id,
            account_code=ln.account_code,
            description=ln.description or "",
            debit=ln.debit, credit=ln.credit,
        ))

    db.commit()
    return {"id": je.id, "status": je.status}


@router.post("/journals/{je_id}/post")
def post_je(
    je_id: str,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    je = db.query(IndiaJournalEntry).filter_by(id=je_id, tenant_id=tenant).first()
    if not je:
        raise HTTPException(404, "Journal entry not found")
    if je.status == "posted":
        raise HTTPException(400, "Already posted")
    je.status = "posted"
    je.posted_at = datetime.utcnow()
    db.commit()
    return {"id": je.id, "status": je.status}


@router.get("/journals/{je_id}")
def get_je(
    je_id: str,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    je = db.query(IndiaJournalEntry).filter_by(id=je_id, tenant_id=tenant).first()
    if not je:
        raise HTTPException(404, "Not found")
    lines = db.query(IndiaJournalLine).filter_by(entry_id=je_id).all()
    return {
        "id": je.id, "entry_date": str(je.entry_date),
        "period": je.period, "description": je.description,
        "reference": je.reference, "source": je.source,
        "status": je.status, "total_debit": float(je.total_debit or 0),
        "narration": je.narration,
        "lines": [
            {"id": l.id, "account_code": l.account_code,
             "description": l.description,
             "debit": float(l.debit or 0), "credit": float(l.credit or 0)}
            for l in lines
        ],
    }


# ══════════════════════════════════════════════════════════════════════════════
# CUSTOMERS
# ══════════════════════════════════════════════════════════════════════════════

class CustomerIn(BaseModel):
    name: str
    gstin: Optional[str] = None
    pan: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    state_code: Optional[str] = None
    state_name: Optional[str] = None
    credit_limit: Optional[float] = 0
    payment_terms_days: Optional[int] = 30


@router.get("/customers")
def list_customers(
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    customers = db.query(IndiaCustomer).filter_by(tenant_id=tenant, is_active=True).all()
    return {
        "customers": [
            {"id": c.id, "name": c.name, "gstin": c.gstin, "pan": c.pan,
             "email": c.email, "state_code": c.state_code, "state_name": c.state_name,
             "credit_limit": float(c.credit_limit or 0),
             "payment_terms_days": c.payment_terms_days}
            for c in customers
        ],
        "count": len(customers),
    }


@router.post("/customers")
def create_customer(
    body: CustomerIn,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    c = IndiaCustomer(id=_uuid(), tenant_id=tenant, **body.model_dump())
    db.add(c)
    db.commit()
    return {"id": c.id}


# ══════════════════════════════════════════════════════════════════════════════
# VENDORS
# ══════════════════════════════════════════════════════════════════════════════

class VendorIn(BaseModel):
    name: str
    gstin: Optional[str] = None
    pan: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    state_code: Optional[str] = None
    state_name: Optional[str] = None
    tds_applicable: Optional[bool] = False
    tds_section: Optional[str] = None
    payment_terms_days: Optional[int] = 30


@router.get("/vendors")
def list_vendors(
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    vendors = db.query(IndiaVendor).filter_by(tenant_id=tenant, is_active=True).all()
    return {
        "vendors": [
            {"id": v.id, "name": v.name, "gstin": v.gstin, "pan": v.pan,
             "tds_applicable": v.tds_applicable, "tds_section": v.tds_section,
             "state_code": v.state_code, "payment_terms_days": v.payment_terms_days}
            for v in vendors
        ],
        "count": len(vendors),
    }


@router.post("/vendors")
def create_vendor(
    body: VendorIn,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    v = IndiaVendor(id=_uuid(), tenant_id=tenant, **body.model_dump())
    db.add(v)
    db.commit()
    return {"id": v.id}


# ══════════════════════════════════════════════════════════════════════════════
# SALES INVOICES (GST)
# ══════════════════════════════════════════════════════════════════════════════

class SalesLineIn(BaseModel):
    description: str
    hsn_sac: Optional[str] = None
    quantity: float = 1
    unit_price: float
    gst_rate: float = 18.0


class SalesInvoiceIn(BaseModel):
    customer_id: str
    invoice_date: str
    due_date: str
    supply_type: Optional[str] = "intra"   # intra / inter
    place_of_supply: Optional[str] = None
    invoice_number: Optional[str] = None
    lines: list[SalesLineIn]


@router.get("/sales-invoices")
def list_sales_invoices(
    status: Optional[str] = None,
    customer_id: Optional[str] = None,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    q = db.query(IndiaSalesInvoice).filter_by(tenant_id=tenant)
    if status:
        q = q.filter(IndiaSalesInvoice.status == status)
    if customer_id:
        q = q.filter(IndiaSalesInvoice.customer_id == customer_id)
    invs = q.order_by(IndiaSalesInvoice.invoice_date.desc()).limit(200).all()
    return {
        "invoices": [
            {"id": i.id, "invoice_number": i.invoice_number,
             "customer_id": i.customer_id,
             "invoice_date": str(i.invoice_date),
             "due_date": str(i.due_date),
             "supply_type": i.supply_type,
             "subtotal": float(i.subtotal or 0),
             "cgst_amount": float(i.cgst_amount or 0),
             "sgst_amount": float(i.sgst_amount or 0),
             "igst_amount": float(i.igst_amount or 0),
             "total_amount": float(i.total_amount or 0),
             "outstanding": float(i.outstanding or 0),
             "status": i.status,
             "e_invoice_irn": i.e_invoice_irn}
            for i in invs
        ],
        "count": len(invs),
    }


@router.post("/sales-invoices")
def create_sales_invoice(
    body: SalesInvoiceIn,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    # Auto invoice number
    count = db.query(IndiaSalesInvoice).filter_by(tenant_id=tenant).count()
    inv_no = body.invoice_number or f"INV-{date.fromisoformat(body.invoice_date).year}-{count+1:04d}"

    subtotal = cgst_amt = sgst_amt = igst_amt = 0.0
    line_objs = []

    for ln in body.lines:
        line_sub = round(ln.quantity * ln.unit_price, 2)
        gst = calc_gst(line_sub, ln.gst_rate, body.supply_type or "intra")
        line_objs.append({
            "desc": ln.description, "hsn": ln.hsn_sac, "qty": ln.quantity,
            "price": ln.unit_price, "rate": ln.gst_rate,
            "sub": line_sub, "cgst": gst["cgst"], "sgst": gst["sgst"], "igst": gst["igst"],
            "total": gst["total_amount"],
        })
        subtotal  += line_sub
        cgst_amt  += gst["cgst"]
        sgst_amt  += gst["sgst"]
        igst_amt  += gst["igst"]

    total = subtotal + cgst_amt + sgst_amt + igst_amt

    inv = IndiaSalesInvoice(
        id=_uuid(), tenant_id=tenant,
        invoice_number=inv_no,
        customer_id=body.customer_id,
        invoice_date=date.fromisoformat(body.invoice_date),
        due_date=date.fromisoformat(body.due_date),
        supply_type=body.supply_type or "intra",
        place_of_supply=body.place_of_supply,
        subtotal=subtotal,
        cgst_amount=cgst_amt,
        sgst_amount=sgst_amt,
        igst_amount=igst_amt,
        total_amount=total,
        outstanding=total,
        status="draft",
    )
    db.add(inv)
    db.flush()

    for lo in line_objs:
        db.add(IndiaSalesInvoiceLine(
            id=_uuid(), invoice_id=inv.id,
            description=lo["desc"], hsn_sac=lo["hsn"],
            quantity=lo["qty"], unit_price=lo["price"],
            gst_rate=lo["rate"],
            line_subtotal=lo["sub"],
            line_cgst=lo["cgst"], line_sgst=lo["sgst"], line_igst=lo["igst"],
            line_total=lo["total"],
        ))

    db.commit()
    return {"id": inv.id, "invoice_number": inv_no, "total_amount": total}


@router.post("/sales-invoices/{inv_id}/post")
def post_sales_invoice(
    inv_id: str,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    inv = db.query(IndiaSalesInvoice).filter_by(id=inv_id, tenant_id=tenant).first()
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv.status == "posted":
        raise HTTPException(400, "Already posted")

    subtotal = float(inv.subtotal or 0)
    cgst     = float(inv.cgst_amount or 0)
    sgst     = float(inv.sgst_amount or 0)
    igst     = float(inv.igst_amount or 0)
    total    = float(inv.total_amount or 0)

    period = str(inv.invoice_date)[:7]
    je_id  = _uuid()
    je = IndiaJournalEntry(
        id=je_id, tenant_id=tenant,
        entry_date=inv.invoice_date, period=period,
        description=f"Sales Invoice {inv.invoice_number}",
        source="gst", status="posted",
        total_debit=total,
        posted_at=datetime.utcnow(),
    )
    db.add(je)
    db.flush()

    lines = [
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="1100",
                         description=f"AR — {inv.invoice_number}", debit=total, credit=0),
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="4000",
                         description="Revenue", debit=0, credit=subtotal),
    ]
    if cgst > 0:
        lines.append(IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2310",
                                      description="CGST Output", debit=0, credit=cgst))
        lines.append(IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2311",
                                      description="SGST Output", debit=0, credit=sgst))
    if igst > 0:
        lines.append(IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2312",
                                      description="IGST Output", debit=0, credit=igst))
    for ln in lines:
        db.add(ln)

    inv.status = "posted"
    inv.journal_entry_id = je_id
    db.commit()
    return {"id": inv.id, "status": inv.status, "je_id": je_id}


# ══════════════════════════════════════════════════════════════════════════════
# PURCHASE INVOICES (ITC)
# ══════════════════════════════════════════════════════════════════════════════

class PurchaseLineIn(BaseModel):
    description: str
    hsn_sac: Optional[str] = None
    quantity: float = 1
    unit_price: float
    gst_rate: float = 18.0
    itc_eligible: Optional[bool] = True


class PurchaseInvoiceIn(BaseModel):
    vendor_id: str
    invoice_date: str
    due_date: str
    invoice_number: str
    supply_type: Optional[str] = "intra"
    tds_section: Optional[str] = None
    lines: list[PurchaseLineIn]


@router.get("/purchase-invoices")
def list_purchase_invoices(
    status: Optional[str] = None,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    q = db.query(IndiaPurchaseInvoice).filter_by(tenant_id=tenant)
    if status:
        q = q.filter(IndiaPurchaseInvoice.status == status)
    invs = q.order_by(IndiaPurchaseInvoice.invoice_date.desc()).limit(200).all()
    return {
        "invoices": [
            {"id": i.id, "invoice_number": i.invoice_number,
             "vendor_id": i.vendor_id,
             "invoice_date": str(i.invoice_date),
             "due_date": str(i.due_date),
             "supply_type": i.supply_type,
             "subtotal": float(i.subtotal or 0),
             "cgst_amount": float(i.cgst_amount or 0),
             "sgst_amount": float(i.sgst_amount or 0),
             "igst_amount": float(i.igst_amount or 0),
             "total_amount": float(i.total_amount or 0),
             "outstanding": float(i.outstanding or 0),
             "itc_eligible": i.itc_eligible,
             "itc_claimed": float(i.itc_claimed or 0),
             "tds_deducted": float(i.tds_deducted or 0),
             "status": i.status}
            for i in invs
        ],
        "count": len(invs),
    }


@router.post("/purchase-invoices")
def create_purchase_invoice(
    body: PurchaseInvoiceIn,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    subtotal = cgst_amt = sgst_amt = igst_amt = 0.0
    line_objs = []

    for ln in body.lines:
        line_sub = round(ln.quantity * ln.unit_price, 2)
        gst = calc_gst(line_sub, ln.gst_rate, body.supply_type or "intra")
        line_objs.append({
            "desc": ln.description, "hsn": ln.hsn_sac, "qty": ln.quantity,
            "price": ln.unit_price, "rate": ln.gst_rate, "itc": ln.itc_eligible,
            "sub": line_sub, "cgst": gst["cgst"], "sgst": gst["sgst"], "igst": gst["igst"],
            "total": gst["total_amount"],
        })
        subtotal += line_sub
        cgst_amt += gst["cgst"]
        sgst_amt += gst["sgst"]
        igst_amt += gst["igst"]

    total = subtotal + cgst_amt + sgst_amt + igst_amt

    # TDS deduction if applicable
    tds_deducted = 0.0
    if body.tds_section:
        t = calc_tds(subtotal, body.tds_section)
        tds_deducted = t["net_tds"]

    inv = IndiaPurchaseInvoice(
        id=_uuid(), tenant_id=tenant,
        invoice_number=body.invoice_number,
        vendor_id=body.vendor_id,
        invoice_date=date.fromisoformat(body.invoice_date),
        due_date=date.fromisoformat(body.due_date),
        supply_type=body.supply_type or "intra",
        subtotal=subtotal,
        cgst_amount=cgst_amt,
        sgst_amount=sgst_amt,
        igst_amount=igst_amt,
        total_amount=total,
        outstanding=total - tds_deducted,
        tds_deducted=tds_deducted,
        tds_section=body.tds_section,
        status="draft",
    )
    db.add(inv)
    db.flush()

    for lo in line_objs:
        db.add(IndiaPurchaseInvoiceLine(
            id=_uuid(), invoice_id=inv.id,
            description=lo["desc"], hsn_sac=lo["hsn"],
            quantity=lo["qty"], unit_price=lo["price"],
            gst_rate=lo["rate"],
            line_subtotal=lo["sub"],
            line_cgst=lo["cgst"], line_sgst=lo["sgst"], line_igst=lo["igst"],
            line_total=lo["total"],
            itc_eligible=lo["itc"],
        ))

    db.commit()
    return {"id": inv.id, "invoice_number": inv.invoice_number, "total_amount": total, "tds_deducted": tds_deducted}


@router.post("/purchase-invoices/{inv_id}/post")
def post_purchase_invoice(
    inv_id: str,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    inv = db.query(IndiaPurchaseInvoice).filter_by(id=inv_id, tenant_id=tenant).first()
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv.status == "posted":
        raise HTTPException(400, "Already posted")

    subtotal = float(inv.subtotal or 0)
    cgst     = float(inv.cgst_amount or 0)
    sgst     = float(inv.sgst_amount or 0)
    igst     = float(inv.igst_amount or 0)
    total    = float(inv.total_amount or 0)
    tds      = float(inv.tds_deducted or 0)

    period = str(inv.invoice_date)[:7]
    je_id  = _uuid()
    je = IndiaJournalEntry(
        id=je_id, tenant_id=tenant,
        entry_date=inv.invoice_date, period=period,
        description=f"Purchase Invoice {inv.invoice_number}",
        source="gst", status="posted",
        total_debit=total,
        posted_at=datetime.utcnow(),
    )
    db.add(je)
    db.flush()

    lines = [
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="5000",
                         description=f"Purchase — {inv.invoice_number}", debit=subtotal, credit=0),
    ]
    if cgst > 0:
        lines += [
            IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="1310",
                             description="CGST Input ITC", debit=cgst, credit=0),
            IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="1311",
                             description="SGST Input ITC", debit=sgst, credit=0),
        ]
    if igst > 0:
        lines.append(IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="1312",
                                      description="IGST Input ITC", debit=igst, credit=0))
    if tds > 0:
        lines.append(IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2400",
                                      description="TDS deducted", debit=0, credit=tds))
    # AP net
    lines.append(IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2000",
                                  description="Accounts Payable", debit=0, credit=total - tds))
    for ln in lines:
        db.add(ln)

    inv.status = "posted"
    inv.journal_entry_id = je_id
    # Claim ITC
    inv.itc_claimed = cgst + sgst + igst
    db.commit()
    return {"id": inv.id, "status": inv.status, "je_id": je_id, "itc_claimed": inv.itc_claimed}


# ══════════════════════════════════════════════════════════════════════════════
# TDS
# ══════════════════════════════════════════════════════════════════════════════

class TDSEntryIn(BaseModel):
    deductee_name: str
    deductee_pan: Optional[str] = None
    section: str
    nature: str
    payment_amount: float
    deductee_type: Optional[str] = "company"
    vendor_id: Optional[str] = None


class TDSDepositIn(BaseModel):
    period: str
    challan_number: str
    deposit_date: Optional[str] = None


@router.get("/tds")
def list_tds(
    period: Optional[str] = None,
    section: Optional[str] = None,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    q = db.query(IndiaTDSEntry).filter_by(tenant_id=tenant)
    if period:
        q = q.filter(IndiaTDSEntry.period == period)
    if section:
        q = q.filter(IndiaTDSEntry.section == section)
    entries = q.order_by(IndiaTDSEntry.created_at.desc()).limit(200).all()
    return {
        "entries": [
            {"id": e.id, "period": e.period,
             "deductee_name": e.deductee_name, "deductee_pan": e.deductee_pan,
             "section": e.section, "nature": e.nature,
             "payment_amount": float(e.payment_amount or 0),
             "tds_rate": float(e.tds_rate or 0),
             "net_tds": float(e.net_tds or 0),
             "status": e.status, "challan_number": e.challan_number,
             "deposit_date": str(e.deposit_date) if e.deposit_date else None}
            for e in entries
        ],
        "count": len(entries),
    }


@router.post("/tds")
def create_tds(
    body: TDSEntryIn,
    period: str = Query(...),
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    entry = create_tds_entry(
        db, tenant, period,
        body.deductee_name, body.deductee_pan or "",
        body.section, body.nature,
        body.payment_amount, body.deductee_type or "company",
        body.vendor_id,
    )
    return {"id": entry.id, "net_tds": float(entry.net_tds or 0)}


@router.post("/tds/deposit")
def deposit_tds_route(
    body: TDSDepositIn,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    deposit_date = date.fromisoformat(body.deposit_date) if body.deposit_date else None
    result = deposit_tds(db, tenant, body.period, body.challan_number, deposit_date)
    return result


@router.get("/tds/summary")
def tds_summary_route(
    period: str = Query(...),
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    return tds_summary(db, tenant, period)


@router.get("/tds/sections")
def tds_sections():
    return {"sections": [{"code": k, "desc": v["desc"], "rate_company": v["rate_company"]} for k, v in TDS_SECTIONS.items()]}


@router.post("/tds/certificate")
def issue_tds_certificate(
    vendor_id: str = Query(...),
    financial_year: str = Query(...),
    quarter: str = Query(...),
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    cert = generate_tds_certificate(db, tenant, financial_year, quarter, vendor_id)
    return {
        "id": cert.id, "certificate_no": cert.certificate_no,
        "deductee_name": cert.deductee_name,
        "total_tds": float(cert.total_tds or 0),
    }


# ══════════════════════════════════════════════════════════════════════════════
# GST RETURNS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/gst-returns")
def list_gst_returns(
    period: Optional[str] = None,
    return_type: Optional[str] = None,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    q = db.query(IndiaGSTReturn).filter_by(tenant_id=tenant)
    if period:
        q = q.filter(IndiaGSTReturn.period == period)
    if return_type:
        q = q.filter(IndiaGSTReturn.return_type == return_type)
    returns = q.order_by(IndiaGSTReturn.created_at.desc()).limit(100).all()
    return {
        "returns": [
            {"id": r.id, "return_type": r.return_type, "period": r.period,
             "total_taxable": float(r.total_taxable or 0),
             "total_cgst": float(r.total_cgst or 0),
             "total_sgst": float(r.total_sgst or 0),
             "total_igst": float(r.total_igst or 0),
             "total_payable": float(r.total_payable or 0),
             "itc_cgst": float(r.itc_cgst or 0),
             "itc_sgst": float(r.itc_sgst or 0),
             "itc_igst": float(r.itc_igst or 0),
             "net_cgst_payable": float(r.net_cgst_payable or 0),
             "net_sgst_payable": float(r.net_sgst_payable or 0),
             "net_igst_payable": float(r.net_igst_payable or 0),
             "status": r.status, "arn": r.arn,
             "ai_summary": r.ai_summary}
            for r in returns
        ],
        "count": len(returns),
    }


@router.post("/gst-returns/compile")
def compile_gst_return(
    period: str = Query(...),
    return_type: str = Query(default="GSTR3B"),
    gstin: Optional[str] = Query(default=""),
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    rec = save_gst_return(db, tenant, period, return_type, gstin or "")
    # Generate AI narrative
    data = {
        "return_type": rec.return_type, "period": rec.period,
        "total_taxable": float(rec.total_taxable or 0),
        "total_cgst": float(rec.total_cgst or 0),
        "total_sgst": float(rec.total_sgst or 0),
        "total_igst": float(rec.total_igst or 0),
        "total_payable": float(rec.total_payable or 0),
        "itc_cgst": float(rec.itc_cgst or 0),
        "itc_sgst": float(rec.itc_sgst or 0),
        "itc_igst": float(rec.itc_igst or 0),
    }
    narrative = generate_gst_narrative(data)
    if narrative:
        rec.ai_summary = narrative
        db.commit()

    return {
        "id": rec.id, "return_type": rec.return_type, "period": rec.period,
        "total_taxable": float(rec.total_taxable or 0),
        "total_cgst": float(rec.total_cgst or 0),
        "total_sgst": float(rec.total_sgst or 0),
        "total_igst": float(rec.total_igst or 0),
        "total_payable": float(rec.total_payable or 0),
        "net_cgst_payable": float(rec.net_cgst_payable or 0),
        "net_sgst_payable": float(rec.net_sgst_payable or 0),
        "net_igst_payable": float(rec.net_igst_payable or 0),
        "ai_summary": rec.ai_summary,
        "status": rec.status,
    }


@router.post("/gst-returns/{return_id}/file")
def file_gst_return(
    return_id: str,
    arn: Optional[str] = Query(default=None),
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    rec = db.query(IndiaGSTReturn).filter_by(id=return_id, tenant_id=tenant).first()
    if not rec:
        raise HTTPException(404, "GST return not found")
    rec.status = "filed"
    rec.filed_at = datetime.utcnow()
    rec.arn = arn or f"ARN-{date.today().strftime('%Y%m%d')}-{return_id[:8].upper()}"
    db.commit()
    return {"id": rec.id, "status": rec.status, "arn": rec.arn}


# ══════════════════════════════════════════════════════════════════════════════
# PAYROLL
# ══════════════════════════════════════════════════════════════════════════════

class EmployeeIn(BaseModel):
    employee_code: str
    name: str
    pan: Optional[str] = None
    uan: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    date_of_joining: Optional[str] = None
    basic_salary: float
    hra: float = 0
    special_allowance: float = 0
    pf_applicable: Optional[bool] = True
    esi_applicable: Optional[bool] = False
    pt_applicable: Optional[bool] = True


@router.get("/employees")
def list_employees(
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    employees = db.query(IndiaEmployee).filter_by(tenant_id=tenant, status="active").all()
    return {
        "employees": [
            {"id": e.id, "employee_code": e.employee_code, "name": e.name,
             "department": e.department, "designation": e.designation,
             "basic_salary": float(e.basic_salary or 0),
             "hra": float(e.hra or 0),
             "special_allowance": float(e.special_allowance or 0),
             "gross_salary": float(e.gross_salary or 0),
             "pf_applicable": e.pf_applicable,
             "esi_applicable": e.esi_applicable,
             "status": e.status}
            for e in employees
        ],
        "count": len(employees),
    }


@router.post("/employees")
def create_employee(
    body: EmployeeIn,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    gross = body.basic_salary + body.hra + body.special_allowance
    doj = date.fromisoformat(body.date_of_joining) if body.date_of_joining else None
    emp = IndiaEmployee(
        id=_uuid(), tenant_id=tenant,
        gross_salary=gross,
        date_of_joining=doj,
        **{k: v for k, v in body.model_dump().items() if k != "date_of_joining"},
    )
    db.add(emp)
    db.commit()
    return {"id": emp.id, "employee_code": emp.employee_code}


@router.post("/employees/seed")
def seed_employees(
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    seeded = seed_sample_employees(db, tenant)
    return {"seeded": seeded}


@router.post("/payroll/run")
def run_payroll_route(
    period: str = Query(...),
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    run = run_payroll(db, tenant, period)
    return {
        "id": run.id, "period": run.period,
        "total_employees": run.total_employees,
        "total_gross": float(run.total_gross or 0),
        "total_pf_employee": float(run.total_pf_employee or 0),
        "total_pf_employer": float(run.total_pf_employer or 0),
        "total_esi_employee": float(run.total_esi_employee or 0),
        "total_esi_employer": float(run.total_esi_employer or 0),
        "total_pt": float(run.total_pt or 0),
        "total_net_pay": float(run.total_net_pay or 0),
        "total_gratuity_provision": float(run.total_gratuity_provision or 0),
        "status": run.status,
    }


@router.post("/payroll/{run_id}/post")
def post_payroll_route(
    run_id: str,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    run = post_payroll(db, tenant, run_id)
    return {"id": run.id, "status": run.status, "je_id": run.journal_entry_id}


@router.get("/payroll")
def list_payroll_runs(
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    runs = db.query(IndiaPayrollRun).filter_by(tenant_id=tenant).order_by(IndiaPayrollRun.period.desc()).all()
    return {
        "runs": [
            {"id": r.id, "period": r.period,
             "total_employees": r.total_employees,
             "total_gross": float(r.total_gross or 0),
             "total_net_pay": float(r.total_net_pay or 0),
             "total_pf_employee": float(r.total_pf_employee or 0),
             "total_pf_employer": float(r.total_pf_employer or 0),
             "total_esi_employee": float(r.total_esi_employee or 0),
             "total_esi_employer": float(r.total_esi_employer or 0),
             "total_pt": float(r.total_pt or 0),
             "total_gratuity_provision": float(r.total_gratuity_provision or 0),
             "status": r.status}
            for r in runs
        ],
        "count": len(runs),
    }


@router.get("/payroll/{run_id}/slips")
def get_payslips(
    run_id: str,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    run = db.query(IndiaPayrollRun).filter_by(id=run_id, tenant_id=tenant).first()
    if not run:
        raise HTTPException(404, "Run not found")
    slips = db.query(IndiaPayslip).filter_by(run_id=run_id).all()
    result = []
    for s in slips:
        emp = db.query(IndiaEmployee).filter_by(id=s.employee_id).first()
        result.append({
            "employee_name": emp.name if emp else "",
            "employee_code": emp.employee_code if emp else "",
            "basic": float(s.basic or 0),
            "hra": float(s.hra or 0),
            "special_allowance": float(s.special_allowance or 0),
            "gross": float(s.gross or 0),
            "pf_employee": float(s.pf_employee or 0),
            "pf_employer": float(s.pf_employer or 0),
            "esi_employee": float(s.esi_employee or 0),
            "esi_employer": float(s.esi_employer or 0),
            "professional_tax": float(s.professional_tax or 0),
            "total_deductions": float(s.total_deductions or 0),
            "net_pay": float(s.net_pay or 0),
            "gratuity_provision": float(s.gratuity_provision or 0),
        })
    return {"slips": result, "count": len(result)}


# ══════════════════════════════════════════════════════════════════════════════
# FIXED ASSETS (Ind AS 16)
# ══════════════════════════════════════════════════════════════════════════════

# Companies Act 2013 WDV rates
WDV_RATES: dict[str, float] = {
    "Computer":   63.16,  # useful life 3 years
    "Vehicle":    25.89,  # useful life 8 years
    "Furniture":  18.10,  # useful life 10 years
    "Plant":      13.91,  # useful life 15 years
    "Building":    5.0,   # useful life 30 years (factory)
    "Intangible": 25.0,   # useful life 5–10 years (software etc.)
}

SLM_RATES: dict[str, float] = {
    "Computer":   33.33,
    "Vehicle":    12.50,
    "Furniture":  10.0,
    "Plant":       6.67,
    "Building":    3.33,
    "Intangible": 20.0,
}


class AssetIn(BaseModel):
    asset_name: str
    asset_code: Optional[str] = None
    category: str
    purchase_date: str
    purchase_cost: float
    residual_value: Optional[float] = 0
    useful_life_years: Optional[int] = None
    depreciation_method: Optional[str] = "SLM"  # SLM / WDV


@router.get("/fixed-assets")
def list_assets(
    status: Optional[str] = None,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    q = db.query(IndiaFixedAsset).filter_by(tenant_id=tenant)
    if status:
        q = q.filter(IndiaFixedAsset.status == status)
    assets = q.order_by(IndiaFixedAsset.purchase_date.desc()).all()
    return {
        "assets": [
            {"id": a.id, "asset_code": a.asset_code, "name": a.name,
             "category": a.category,
             "purchase_date": str(a.purchase_date),
             "purchase_cost": float(a.purchase_cost or 0),
             "accumulated_depreciation": float(a.accumulated_depreciation or 0),
             "net_book_value": float(a.net_book_value or 0),
             "depreciation_method": a.depreciation_method,
             "useful_life_years": a.useful_life_years,
             "wdv_rate": float(a.wdv_rate or 0),
             "status": a.status}
            for a in assets
        ],
        "count": len(assets),
    }


@router.post("/fixed-assets")
def create_asset(
    body: AssetIn,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    count = db.query(IndiaFixedAsset).filter_by(tenant_id=tenant).count()
    code = body.asset_code or f"FA-{body.category[:3].upper()}-{count+1:04d}"
    wdv_rate = WDV_RATES.get(body.category, 15.0)
    useful_life = body.useful_life_years or {
        "Computer": 3, "Vehicle": 8, "Furniture": 10,
        "Plant": 15, "Building": 30, "Intangible": 5,
    }.get(body.category, 5)

    asset = IndiaFixedAsset(
        id=_uuid(), tenant_id=tenant,
        asset_code=code, name=body.asset_name,
        category=body.category,
        purchase_date=date.fromisoformat(body.purchase_date),
        purchase_cost=body.purchase_cost,
        residual_value=body.residual_value or 0,
        useful_life_years=useful_life,
        depreciation_method=body.depreciation_method or "SLM",
        wdv_rate=wdv_rate,
        accumulated_depreciation=0,
        net_book_value=body.purchase_cost,
        status="active",
    )
    db.add(asset)
    db.commit()
    return {"id": asset.id, "asset_code": code}


@router.post("/fixed-assets/run-depreciation")
def run_depreciation(
    period: str = Query(...),
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    assets = db.query(IndiaFixedAsset).filter_by(tenant_id=tenant, status="active").all()
    total_dep = 0.0

    for a in assets:
        cost = float(a.purchase_cost or 0)
        residual = float(a.residual_value or 0)
        nbv = float(a.net_book_value or 0)
        dep = 0.0

        if a.depreciation_method == "WDV":
            rate = float(a.wdv_rate or WDV_RATES.get(a.category, 15.0))
            dep = round(nbv * rate / 100 / 12, 2)
        else:  # SLM
            life = a.useful_life_years or 5
            annual = (cost - residual) / life
            dep = round(annual / 12, 2)

        dep = min(dep, max(0.0, nbv - residual))
        if dep > 0:
            a.accumulated_depreciation = float(a.accumulated_depreciation or 0) + dep
            a.net_book_value = float(a.net_book_value or 0) - dep
            total_dep += dep

    # Journal entry for depreciation
    if total_dep > 0:
        je_id = _uuid()
        je = IndiaJournalEntry(
            id=je_id, tenant_id=tenant,
            entry_date=date.today(),
            period=period,
            description=f"Depreciation run — {period} ({len(assets)} assets)",
            source="asset",
            status="posted",
            total_debit=total_dep,
            posted_at=datetime.utcnow(),
        )
        db.add(je)
        db.flush()
        db.add(IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="5400",
                                description="Depreciation expense", debit=total_dep, credit=0))
        db.add(IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="1510",
                                description="Accumulated depreciation", debit=0, credit=total_dep))

    db.commit()
    return {
        "period": period,
        "assets_processed": len(assets),
        "total_depreciation": total_dep,
    }


@router.get("/fixed-assets/{asset_id}/schedule")
def depreciation_schedule(
    asset_id: str,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    a = db.query(IndiaFixedAsset).filter_by(id=asset_id, tenant_id=tenant).first()
    if not a:
        raise HTTPException(404, "Asset not found")

    cost = float(a.purchase_cost or 0)
    residual = float(a.residual_value or 0)
    life = a.useful_life_years or 5
    method = a.depreciation_method or "SLM"
    wdv_rate = float(a.wdv_rate or WDV_RATES.get(a.category, 15.0))
    purchase_year = a.purchase_date.year if a.purchase_date else 2024

    schedule = []
    nbv = cost
    for yr in range(life):
        year = purchase_year + yr
        if method == "WDV":
            dep = round(nbv * wdv_rate / 100, 2)
        else:
            dep = round((cost - residual) / life, 2)
        dep = min(dep, max(0.0, nbv - residual))
        nbv = round(nbv - dep, 2)
        schedule.append({"year": year, "depreciation": dep, "closing_nbv": nbv})
        if nbv <= residual:
            break

    return {"asset_id": asset_id, "asset_name": a.name, "method": method, "schedule": schedule}


# ══════════════════════════════════════════════════════════════════════════════
# PERIOD-END CLOSE
# ══════════════════════════════════════════════════════════════════════════════

def _checklist(run: IndiaPeriodClose) -> dict[str, bool]:
    return {
        "gstr1_filed":              bool(run.gstr1_filed),
        "gstr3b_filed":             bool(run.gstr3b_filed),
        "tds_deposited":            bool(run.tds_deposited),
        "payroll_posted":           bool(run.payroll_posted),
        "fixed_assets_depreciated": bool(run.fixed_assets_depreciated),
        "bank_recon_done":          bool(run.bank_recon_done),
        "ar_reviewed":              bool(run.ar_reviewed),
        "ap_reviewed":              bool(run.ap_reviewed),
        "itc_reconciled":           bool(run.itc_reconciled),
        "tb_reconciled":            bool(run.tb_reconciled),
    }


_ITEM_FIELD = {
    "gstr1_filed":              "gstr1_filed",
    "gstr3b_filed":             "gstr3b_filed",
    "tds_deposited":            "tds_deposited",
    "payroll_posted":           "payroll_posted",
    "fixed_assets_depreciated": "fixed_assets_depreciated",
    "bank_recon_done":          "bank_recon_done",
    "ar_reviewed":              "ar_reviewed",
    "ap_reviewed":              "ap_reviewed",
    "itc_reconciled":           "itc_reconciled",
    "tb_reconciled":            "tb_reconciled",
}


@router.get("/period-close")
def list_period_close(
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    runs = db.query(IndiaPeriodClose).filter_by(tenant_id=tenant).order_by(IndiaPeriodClose.period.desc()).all()
    return {
        "runs": [
            {"id": r.id, "period": r.period, "status": r.status,
             "is_locked": r.status == "closed",
             "checklist": _checklist(r),
             "closed_at": str(r.closed_at) if r.closed_at else None}
            for r in runs
        ]
    }


@router.post("/period-close/start")
def start_period_close(
    period: str = Query(...),
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    existing = db.query(IndiaPeriodClose).filter_by(tenant_id=tenant, period=period).first()
    if existing:
        return {"id": existing.id, "period": period, "status": existing.status, "checklist": _checklist(existing)}

    run = IndiaPeriodClose(id=_uuid(), tenant_id=tenant, period=period, status="in_progress")
    db.add(run)
    db.commit()
    return {"id": run.id, "period": period, "status": run.status, "checklist": _checklist(run)}


@router.patch("/period-close/{run_id}/check")
def update_checklist(
    run_id: str,
    item: str = Query(...),
    done: bool = Query(...),
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    run = db.query(IndiaPeriodClose).filter_by(id=run_id, tenant_id=tenant).first()
    if not run:
        raise HTTPException(404, "Period close run not found")
    field = _ITEM_FIELD.get(item)
    if not field:
        raise HTTPException(400, f"Unknown checklist item: {item}")
    setattr(run, field, done)

    all_done = all(_checklist(run).values())
    run.status = "ready_to_close" if all_done else "in_progress"
    db.commit()
    return {"id": run.id, "checklist": _checklist(run), "status": run.status}


@router.post("/period-close/{run_id}/lock")
def lock_period(
    run_id: str,
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    run = db.query(IndiaPeriodClose).filter_by(id=run_id, tenant_id=tenant).first()
    if not run:
        raise HTTPException(404, "Not found")
    if not all(_checklist(run).values()):
        raise HTTPException(400, "Cannot lock — checklist incomplete")
    run.status = "closed"
    run.closed_at = datetime.utcnow()
    db.commit()
    return {"id": run.id, "period": run.period, "status": run.status, "is_locked": True}


# ══════════════════════════════════════════════════════════════════════════════
# MANAGEMENT ACCOUNTS + DASHBOARD
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/management-accounts")
def generate_management_accounts(
    period: str = Query(...),
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    """Generate India P&L + BS + AI commentary for the period."""
    # Revenue
    sales_invoices = db.query(IndiaSalesInvoice).filter(
        IndiaSalesInvoice.tenant_id == tenant,
        IndiaSalesInvoice.status == "posted",
    ).all()
    revenue = sum(float(i.subtotal or 0) for i in sales_invoices if str(i.invoice_date)[:7] == period)

    # Expenses from payroll
    payroll = db.query(IndiaPayrollRun).filter_by(tenant_id=tenant, period=period).first()
    payroll_cost = float(payroll.total_gross or 0) + float(payroll.total_pf_employer or 0) if payroll else 0.0

    # Depreciation
    assets = db.query(IndiaFixedAsset).filter_by(tenant_id=tenant).all()
    monthly_dep = 0.0
    for a in assets:
        cost = float(a.purchase_cost or 0)
        residual = float(a.residual_value or 0)
        life = a.useful_life_years or 5
        if a.depreciation_method == "WDV":
            rate = float(a.wdv_rate or WDV_RATES.get(a.category, 15.0))
            monthly_dep += round(float(a.net_book_value or 0) * rate / 100 / 12, 2)
        else:
            monthly_dep += round((cost - residual) / life / 12, 2)

    # GST liability
    gst3b = db.query(IndiaGSTReturn).filter_by(
        tenant_id=tenant, period=period, return_type="GSTR3B"
    ).first()
    gst_liability = float(gst3b.total_payable or 0) if gst3b else 0.0

    # TDS
    tds_sum = tds_summary(db, tenant, period)
    tds_total = tds_sum["total_tds"]

    operating_expenses = payroll_cost + monthly_dep
    ebitda = revenue - operating_expenses + monthly_dep
    ebit   = revenue - operating_expenses
    pbt    = ebit
    tax    = round(pbt * 0.25, 2) if pbt > 0 else 0.0  # 25% Corp Tax
    pat    = pbt - tax

    # Balance sheet totals
    total_assets = sum(float(a.net_book_value or 0) for a in assets)
    ar = sum(float(i.outstanding or 0) for i in sales_invoices)

    # AI narrative
    narrative = {}
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
        prompt = (
            f"You are a CA (India). Write a management accounts commentary for {period}. "
            f"Revenue ₹{revenue:,.0f}, Payroll cost ₹{payroll_cost:,.0f}, "
            f"EBITDA ₹{ebitda:,.0f}, PAT ₹{pat:,.0f}, "
            f"GST payable ₹{gst_liability:,.0f}, TDS deducted ₹{tds_total:,.0f}. "
            "Return JSON with keys: executive_summary, revenue_commentary, "
            "cost_commentary, gst_tds_note, outlook. Each value: 1-2 sentences."
        )
        msg = client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
        import json
        text = msg.content[0].text if msg.content else "{}"
        try:
            narrative = json.loads(text[text.find("{"):text.rfind("}")+1])
        except Exception:
            narrative = {"executive_summary": text}
    except Exception:
        pass

    return {
        "period": period,
        "pnl": {
            "revenue": revenue,
            "payroll_cost": payroll_cost,
            "depreciation": monthly_dep,
            "total_opex": operating_expenses,
            "ebitda": ebitda,
            "ebit": ebit,
            "pbt": pbt,
            "tax_provision": tax,
            "pat": pat,
        },
        "balance_sheet": {
            "fixed_assets_nbv": total_assets,
            "accounts_receivable": ar,
            "gst_payable": gst_liability,
            "tds_payable": tds_total,
        },
        "compliance": {
            "gst_payable": gst_liability,
            "tds_deducted": tds_total,
            "tds_pending_deposit": tds_sum["pending_deposit"],
        },
        "narrative": narrative,
        "generated_at": datetime.utcnow().isoformat(),
    }


@router.get("/dashboard")
def dashboard(
    period: str = Query(...),
    tenant: str = Depends(tenant_header),
    db: Session = Depends(get_db),
):
    coa_count    = db.query(IndiaAccount).filter_by(tenant_id=tenant).count()
    je_count     = db.query(IndiaJournalEntry).filter_by(tenant_id=tenant, period=period).count()
    asset_count  = db.query(IndiaFixedAsset).filter_by(tenant_id=tenant, status="active").count()
    emp_count    = db.query(IndiaEmployee).filter_by(tenant_id=tenant, status="active").count()
    vendor_count = db.query(IndiaVendor).filter_by(tenant_id=tenant, is_active=True).count()
    customer_count = db.query(IndiaCustomer).filter_by(tenant_id=tenant, is_active=True).count()

    sales = db.query(IndiaSalesInvoice).filter_by(tenant_id=tenant).all()
    revenue = sum(float(i.subtotal or 0) for i in sales if str(i.invoice_date)[:7] == period and i.status == "posted")
    ar_outstanding = sum(float(i.outstanding or 0) for i in sales if i.outstanding and float(i.outstanding) > 0)

    payroll = db.query(IndiaPayrollRun).filter_by(tenant_id=tenant, period=period).first()
    payroll_cost = float(payroll.total_gross or 0) if payroll else 0.0

    gst_return = db.query(IndiaGSTReturn).filter_by(tenant_id=tenant, period=period, return_type="GSTR3B").first()
    gst_payable = float(gst_return.total_payable or 0) if gst_return else 0.0

    tds_sum = tds_summary(db, tenant, period)

    return {
        "period": period,
        "coa_count": coa_count,
        "je_count": je_count,
        "asset_count": asset_count,
        "employee_count": emp_count,
        "vendor_count": vendor_count,
        "customer_count": customer_count,
        "revenue": revenue,
        "ar_outstanding": ar_outstanding,
        "payroll_cost": payroll_cost,
        "gst_payable": gst_payable,
        "tds_deducted": tds_sum["total_tds"],
        "tds_pending_deposit": tds_sum["pending_deposit"],
    }
