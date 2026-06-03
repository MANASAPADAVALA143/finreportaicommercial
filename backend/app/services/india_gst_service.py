"""
India GST Service
=================
- CGST / SGST (intra-state) and IGST (inter-state) calculation
- GSTR-1 compilation (outward supplies)
- GSTR-3B computation (net tax liability after ITC)
- AI narrative via Claude
"""
from __future__ import annotations

import os
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.india_accounting import (
    IndiaAccount, IndiaGSTReturn,
    IndiaSalesInvoice, IndiaPurchaseInvoice,
    IndiaJournalEntry, IndiaJournalLine,
)

# GST rates in use
GST_RATES = [0, 5, 12, 18, 28]

# Standard CoA codes for GST
COA_CGST_OUTPUT  = "2310"
COA_SGST_OUTPUT  = "2311"
COA_IGST_OUTPUT  = "2312"
COA_CGST_INPUT   = "1310"
COA_SGST_INPUT   = "1311"
COA_IGST_INPUT   = "1312"


def _uuid() -> str:
    import uuid
    return str(uuid.uuid4())


# ─── GST Calculation helpers ──────────────────────────────────────────────────

def calc_gst(
    amount: float,
    gst_rate: float,
    supply_type: str = "intra",   # "intra" → CGST+SGST  |  "inter" → IGST
) -> dict[str, float]:
    """Return dict with cgst, sgst, igst, total_tax, total_amount."""
    rate = Decimal(str(gst_rate))
    base = Decimal(str(amount))

    if supply_type == "inter":
        igst = (base * rate / 100).quantize(Decimal("0.01"))
        return {
            "cgst": 0.0, "sgst": 0.0,
            "igst": float(igst),
            "total_tax": float(igst),
            "total_amount": float(base + igst),
        }
    else:
        half = rate / 2
        cgst = (base * half / 100).quantize(Decimal("0.01"))
        sgst = cgst
        return {
            "cgst": float(cgst), "sgst": float(sgst), "igst": 0.0,
            "total_tax": float(cgst + sgst),
            "total_amount": float(base + cgst + sgst),
        }


# ─── GSTR-1 (Outward Supplies) ────────────────────────────────────────────────

def compile_gstr1(db: Session, tenant_id: str, period: str) -> dict[str, Any]:
    """Aggregate all posted sales invoices for the period → GSTR-1 data."""
    invoices = (
        db.query(IndiaSalesInvoice)
        .filter(
            IndiaSalesInvoice.tenant_id == tenant_id,
            IndiaSalesInvoice.period == period if hasattr(IndiaSalesInvoice, "period")
            else IndiaSalesInvoice.invoice_date.like(f"{period}%"),
            IndiaSalesInvoice.status == "posted",
        )
        .all()
    )

    b2b_taxable = b2c_taxable = 0.0
    total_cgst = total_sgst = total_igst = total_cess = 0.0

    for inv in invoices:
        subtotal = float(inv.subtotal or 0)
        if inv.supply_type == "inter":
            b2b_taxable += subtotal
        else:
            b2c_taxable += subtotal
        total_cgst += float(inv.cgst_amount or 0)
        total_sgst += float(inv.sgst_amount or 0)
        total_igst += float(inv.igst_amount or 0)
        total_cess += float(inv.cess_amount or 0)

    total_taxable = b2b_taxable + b2c_taxable
    total_tax = total_cgst + total_sgst + total_igst + total_cess

    return {
        "period": period,
        "return_type": "GSTR1",
        "b2b_taxable": b2b_taxable,
        "b2c_taxable": b2c_taxable,
        "total_taxable": total_taxable,
        "total_cgst": total_cgst,
        "total_sgst": total_sgst,
        "total_igst": total_igst,
        "total_cess": total_cess,
        "total_tax": total_tax,
        "invoice_count": len(invoices),
    }


# ─── GSTR-3B (Net Liability) ──────────────────────────────────────────────────

def compile_gstr3b(db: Session, tenant_id: str, period: str) -> dict[str, Any]:
    """
    Compute net GST payable after ITC.
    outward - ITC_from_purchases = net payable
    """
    # Outward (GSTR-1 data)
    gstr1 = compile_gstr1(db, tenant_id, period)

    # ITC from eligible purchase invoices
    purchases = (
        db.query(IndiaPurchaseInvoice)
        .filter(
            IndiaPurchaseInvoice.tenant_id == tenant_id,
            IndiaPurchaseInvoice.status == "posted",
            IndiaPurchaseInvoice.itc_eligible == True,
        )
        .all()
    )

    # Filter by period using invoice_date
    def in_period(inv: IndiaPurchaseInvoice) -> bool:
        if inv.invoice_date:
            return str(inv.invoice_date)[:7] == period
        return False

    purchases = [p for p in purchases if in_period(p)]

    itc_cgst = sum(float(p.cgst_amount or 0) for p in purchases)
    itc_sgst = sum(float(p.sgst_amount or 0) for p in purchases)
    itc_igst = sum(float(p.igst_amount or 0) for p in purchases)

    net_cgst = max(0.0, gstr1["total_cgst"] - itc_cgst)
    net_sgst = max(0.0, gstr1["total_sgst"] - itc_sgst)
    net_igst = max(0.0, gstr1["total_igst"] - itc_igst)
    total_payable = net_cgst + net_sgst + net_igst + gstr1["total_cess"]

    return {
        "period": period,
        "return_type": "GSTR3B",
        "outward_taxable": gstr1["total_taxable"],
        "outward_cgst": gstr1["total_cgst"],
        "outward_sgst": gstr1["total_sgst"],
        "outward_igst": gstr1["total_igst"],
        "itc_cgst": itc_cgst,
        "itc_sgst": itc_sgst,
        "itc_igst": itc_igst,
        "net_cgst_payable": net_cgst,
        "net_sgst_payable": net_sgst,
        "net_igst_payable": net_igst,
        "total_payable": total_payable,
        "purchase_invoice_count": len(purchases),
    }


# ─── Save GST Return to DB ────────────────────────────────────────────────────

def save_gst_return(
    db: Session,
    tenant_id: str,
    period: str,
    return_type: str,   # GSTR1 / GSTR3B
    gstin: str = "",
) -> IndiaGSTReturn:
    """Compile and persist a GST return record."""
    # Remove any existing draft
    existing = (
        db.query(IndiaGSTReturn)
        .filter(
            IndiaGSTReturn.tenant_id == tenant_id,
            IndiaGSTReturn.period == period,
            IndiaGSTReturn.return_type == return_type,
            IndiaGSTReturn.status == "draft",
        )
        .first()
    )
    if existing:
        db.delete(existing)
        db.flush()

    if return_type == "GSTR1":
        data = compile_gstr1(db, tenant_id, period)
        rec = IndiaGSTReturn(
            id=_uuid(), tenant_id=tenant_id, return_type="GSTR1",
            period=period, gstin=gstin,
            b2b_taxable=data["b2b_taxable"],
            b2c_taxable=data["b2c_taxable"],
            total_taxable=data["total_taxable"],
            total_cgst=data["total_cgst"],
            total_sgst=data["total_sgst"],
            total_igst=data["total_igst"],
            total_cess=data["total_cess"],
            total_tax=data["total_tax"],
            status="draft",
        )
    else:
        data = compile_gstr3b(db, tenant_id, period)
        rec = IndiaGSTReturn(
            id=_uuid(), tenant_id=tenant_id, return_type="GSTR3B",
            period=period, gstin=gstin,
            total_taxable=data["outward_taxable"],
            total_cgst=data["outward_cgst"],
            total_sgst=data["outward_sgst"],
            total_igst=data["outward_igst"],
            total_tax=data["outward_cgst"] + data["outward_sgst"] + data["outward_igst"],
            itc_cgst=data["itc_cgst"],
            itc_sgst=data["itc_sgst"],
            itc_igst=data["itc_igst"],
            net_cgst_payable=data["net_cgst_payable"],
            net_sgst_payable=data["net_sgst_payable"],
            net_igst_payable=data["net_igst_payable"],
            total_payable=data["total_payable"],
            status="draft",
        )

    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


# ─── AI narrative for GST return ─────────────────────────────────────────────

def generate_gst_narrative(data: dict[str, Any]) -> str:
    """Generate a short Claude-powered GST filing summary."""
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
        prompt = (
            f"You are a GST consultant. Summarise this {data.get('return_type', 'GST')} return "
            f"for {data.get('period')} in 3 bullet points. Key figures: "
            f"Outward taxable ₹{data.get('total_taxable', 0):,.0f}, "
            f"CGST ₹{data.get('total_cgst', 0):,.0f}, "
            f"SGST ₹{data.get('total_sgst', 0):,.0f}, "
            f"IGST ₹{data.get('total_igst', 0):,.0f}, "
            f"Net payable ₹{data.get('total_payable', data.get('total_tax', 0)):,.0f}. "
            "Be concise — each bullet max 15 words."
        )
        msg = client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text if msg.content else ""
    except Exception:
        return ""
