"""
India TDS Service
=================
Tax Deducted at Source — all common sections:
194A  Interest                    10%
194C  Contractor  individual 1%  company 2%
194D  Insurance commission        5%
194H  Commission/brokerage        5%
194I  Rent  land/building 10%  plant 2%
194J  Professional/technical      10%
194Q  Purchase of goods           0.1%
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.india_accounting import (
    IndiaTDSEntry, IndiaTDSCertificate, IndiaVendor,
    IndiaJournalEntry, IndiaJournalLine,
)


def _uuid() -> str:
    return str(uuid.uuid4())


# ─── Section master ───────────────────────────────────────────────────────────

TDS_SECTIONS: dict[str, dict] = {
    "194A": {"desc": "Interest (other than securities)",       "rate_individual": 10.0, "rate_company": 10.0, "threshold": 40000},
    "194C": {"desc": "Payment to contractors",                 "rate_individual":  1.0, "rate_company":  2.0, "threshold": 30000},
    "194D": {"desc": "Insurance commission",                   "rate_individual":  5.0, "rate_company":  5.0, "threshold": 15000},
    "194H": {"desc": "Commission or brokerage",                "rate_individual":  5.0, "rate_company":  5.0, "threshold": 15000},
    "194I": {"desc": "Rent (land/building)",                   "rate_individual": 10.0, "rate_company": 10.0, "threshold": 240000},
    "194I(a)": {"desc": "Rent (plant & machinery)",            "rate_individual":  2.0, "rate_company":  2.0, "threshold": 240000},
    "194J": {"desc": "Professional / technical fees",          "rate_individual": 10.0, "rate_company": 10.0, "threshold": 30000},
    "194Q": {"desc": "Purchase of goods (buyer TDS)",          "rate_individual":  0.1, "rate_company":  0.1, "threshold": 5000000},
    "192":  {"desc": "Salary",                                 "rate_individual":  0.0, "rate_company":  0.0, "threshold": 0},
}


def get_tds_rate(section: str, deductee_type: str = "company") -> float:
    sec = TDS_SECTIONS.get(section)
    if not sec:
        return 10.0
    if deductee_type == "individual":
        return sec["rate_individual"]
    return sec["rate_company"]


def calc_tds(
    amount: float,
    section: str,
    deductee_type: str = "company",
    surcharge_rate: float = 0.0,
    cess_rate: float = 4.0,         # Health & Education Cess 4%
) -> dict[str, float]:
    rate = get_tds_rate(section, deductee_type)
    base_tds = round(amount * rate / 100, 2)
    surcharge = round(base_tds * surcharge_rate / 100, 2)
    cess      = round((base_tds + surcharge) * cess_rate / 100, 2)
    net_tds   = round(base_tds + surcharge + cess, 2)
    return {
        "tds_rate": rate,
        "base_tds": base_tds,
        "surcharge": surcharge,
        "cess": cess,
        "net_tds": net_tds,
        "net_payment": round(amount - net_tds, 2),
    }


# ─── Create TDS Entry ─────────────────────────────────────────────────────────

def create_tds_entry(
    db: Session,
    tenant_id: str,
    period: str,
    deductee_name: str,
    deductee_pan: str,
    section: str,
    nature: str,
    payment_amount: float,
    deductee_type: str = "company",
    vendor_id: str | None = None,
) -> IndiaTDSEntry:
    calc = calc_tds(payment_amount, section, deductee_type)

    entry = IndiaTDSEntry(
        id=_uuid(),
        tenant_id=tenant_id,
        period=period,
        vendor_id=vendor_id,
        deductee_name=deductee_name,
        deductee_pan=deductee_pan,
        section=section,
        nature=nature,
        payment_amount=payment_amount,
        tds_rate=calc["tds_rate"],
        tds_amount=calc["base_tds"],
        surcharge=calc["surcharge"],
        health_edu_cess=calc["cess"],
        net_tds=calc["net_tds"],
        status="deducted",
    )
    db.add(entry)
    db.flush()

    # Create journal entry
    je_id = _uuid()
    je = IndiaJournalEntry(
        id=je_id, tenant_id=tenant_id,
        entry_date=date.today(),
        period=period,
        description=f"TDS u/s {section} — {deductee_name}",
        source="tds",
        status="posted",
        total_debit=payment_amount,
        posted_at=datetime.utcnow(),
    )
    db.add(je)
    db.flush()

    lines = [
        # Debit: Expense / Vendor payable
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="5000",
                         description=f"{nature} — {deductee_name}",
                         debit=payment_amount, credit=0),
        # Credit: TDS Payable (liability)
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2400",
                         description=f"TDS payable u/s {section}",
                         debit=0, credit=calc["net_tds"]),
        # Credit: Vendor payment (net)
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2000",
                         description=f"Net payment to {deductee_name}",
                         debit=0, credit=calc["net_payment"]),
    ]
    for ln in lines:
        db.add(ln)

    entry.journal_entry_id = je_id
    db.commit()
    db.refresh(entry)
    return entry


# ─── Deposit TDS (mark as deposited + challan) ───────────────────────────────

def deposit_tds(
    db: Session,
    tenant_id: str,
    period: str,
    challan_number: str,
    deposit_date: date | None = None,
) -> dict[str, Any]:
    entries = (
        db.query(IndiaTDSEntry)
        .filter(
            IndiaTDSEntry.tenant_id == tenant_id,
            IndiaTDSEntry.period == period,
            IndiaTDSEntry.status == "deducted",
        )
        .all()
    )

    total = 0.0
    for e in entries:
        e.status = "deposited"
        e.challan_number = challan_number
        e.deposit_date = deposit_date or date.today()
        total += float(e.net_tds or 0)

    db.commit()
    return {
        "period": period,
        "entries_deposited": len(entries),
        "total_tds_deposited": total,
        "challan_number": challan_number,
    }


# ─── Generate TDS Certificate (Form 16A) ────────────────────────────────────

def generate_tds_certificate(
    db: Session,
    tenant_id: str,
    financial_year: str,
    quarter: str,
    vendor_id: str,
) -> IndiaTDSCertificate:
    vendor = db.query(IndiaVendor).filter_by(id=vendor_id, tenant_id=tenant_id).first()
    if not vendor:
        raise ValueError("Vendor not found")

    entries = (
        db.query(IndiaTDSEntry)
        .filter(
            IndiaTDSEntry.tenant_id == tenant_id,
            IndiaTDSEntry.vendor_id == vendor_id,
            IndiaTDSEntry.status.in_(["deposited", "certificate_issued"]),
        )
        .all()
    )

    total_payment = sum(float(e.payment_amount or 0) for e in entries)
    total_tds     = sum(float(e.net_tds or 0) for e in entries)
    section       = entries[0].section if entries else vendor.tds_section or "194J"

    cert = IndiaTDSCertificate(
        id=_uuid(),
        tenant_id=tenant_id,
        certificate_no=f"CERT-{financial_year}-{quarter}-{vendor_id[:6].upper()}",
        financial_year=financial_year,
        quarter=quarter,
        vendor_id=vendor_id,
        deductee_name=vendor.name,
        deductee_pan=vendor.pan or "",
        section=section,
        total_payment=total_payment,
        total_tds=total_tds,
        issued_date=date.today(),
    )
    db.add(cert)

    # Update entries status
    for e in entries:
        e.status = "certificate_issued"

    db.commit()
    db.refresh(cert)
    return cert


# ─── Summary ─────────────────────────────────────────────────────────────────

def tds_summary(db: Session, tenant_id: str, period: str) -> dict[str, Any]:
    entries = (
        db.query(IndiaTDSEntry)
        .filter(IndiaTDSEntry.tenant_id == tenant_id, IndiaTDSEntry.period == period)
        .all()
    )

    by_section: dict[str, dict] = {}
    for e in entries:
        s = e.section
        if s not in by_section:
            by_section[s] = {"section": s, "desc": TDS_SECTIONS.get(s, {}).get("desc", ""), "count": 0, "payment": 0.0, "tds": 0.0}
        by_section[s]["count"] += 1
        by_section[s]["payment"] += float(e.payment_amount or 0)
        by_section[s]["tds"] += float(e.net_tds or 0)

    return {
        "period": period,
        "total_entries": len(entries),
        "total_payment": sum(float(e.payment_amount or 0) for e in entries),
        "total_tds": sum(float(e.net_tds or 0) for e in entries),
        "deposited": sum(float(e.net_tds or 0) for e in entries if e.status == "deposited"),
        "pending_deposit": sum(float(e.net_tds or 0) for e in entries if e.status == "deducted"),
        "by_section": list(by_section.values()),
    }
