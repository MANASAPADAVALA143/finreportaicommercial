"""VAT Advanced modules — AWS RDS (replaces Supabase PostgREST)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.tenant import assert_write_allowed, get_company_id, get_tenant_id
from app.models.client_data import (
    BadDebtReliefClaim,
    DesignatedZoneTransaction,
    PartialExemptionCalculation,
)

router = APIRouter(prefix="/api/gulftax/vat-advanced", tags=["VAT Advanced RDS"])


class PartialExemptionIn(BaseModel):
    period: str
    period_type: str = "quarterly"
    taxable_supplies: float
    exempt_supplies: float
    input_vat_paid: float
    recovery_pct: float
    recoverable_vat: float
    irrecoverable_vat: float
    breakdown: Optional[dict[str, Any]] = None


class BadDebtIn(BaseModel):
    invoice_number: str
    invoice_date: date
    due_date: date
    invoice_amount: float
    vat_amount: float
    status: str = "draft"
    eligible: bool = False
    eligibility_reason: Optional[str] = None
    extra: Optional[dict[str, Any]] = None


class DesignatedZoneIn(BaseModel):
    supplier_location: str
    customer_location: str
    transaction_type: str
    vat_treatment: str
    vat_rate: float = 0
    explanation: str
    warning: Optional[str] = None


@router.get("/partial-exemption")
def list_partial_exemption(
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    rows = (
        db.query(PartialExemptionCalculation)
        .filter_by(tenant_id=tenant_id, company_id=company_id)
        .order_by(PartialExemptionCalculation.created_at.desc())
        .limit(100)
        .all()
    )
    return {"items": [_row_dict(r) for r in rows]}


@router.post("/partial-exemption")
def save_partial_exemption(
    body: PartialExemptionIn,
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    assert_write_allowed()
    row = PartialExemptionCalculation(
        tenant_id=tenant_id,
        company_id=company_id,
        period=body.period,
        period_type=body.period_type,
        taxable_supplies=body.taxable_supplies,
        exempt_supplies=body.exempt_supplies,
        input_vat_paid=body.input_vat_paid,
        recovery_pct=body.recovery_pct,
        recoverable_vat=body.recoverable_vat,
        irrecoverable_vat=body.irrecoverable_vat,
        breakdown=body.breakdown,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_dict(row)


@router.get("/bad-debt")
def list_bad_debt(
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    rows = (
        db.query(BadDebtReliefClaim)
        .filter_by(tenant_id=tenant_id, company_id=company_id)
        .order_by(BadDebtReliefClaim.created_at.desc())
        .limit(200)
        .all()
    )
    return {"items": [_bad_debt_dict(r) for r in rows]}


@router.post("/bad-debt")
def save_bad_debt(
    body: BadDebtIn,
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    assert_write_allowed()
    row = BadDebtReliefClaim(
        tenant_id=tenant_id,
        company_id=company_id,
        invoice_number=body.invoice_number,
        invoice_date=body.invoice_date,
        due_date=body.due_date,
        invoice_amount=body.invoice_amount,
        vat_amount=body.vat_amount,
        status=body.status,
        eligible=body.eligible,
        eligibility_reason=body.eligibility_reason,
        extra=body.extra or {},
        created_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _bad_debt_dict(row)


@router.get("/designated-zones")
def list_dz(
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    rows = (
        db.query(DesignatedZoneTransaction)
        .filter_by(tenant_id=tenant_id, company_id=company_id)
        .order_by(DesignatedZoneTransaction.created_at.desc())
        .limit(200)
        .all()
    )
    return {"items": [_dz_dict(r) for r in rows]}


@router.post("/designated-zones")
def save_dz(
    body: DesignatedZoneIn,
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    assert_write_allowed()
    row = DesignatedZoneTransaction(
        tenant_id=tenant_id,
        company_id=company_id,
        supplier_location=body.supplier_location,
        customer_location=body.customer_location,
        transaction_type=body.transaction_type,
        vat_treatment=body.vat_treatment,
        vat_rate=body.vat_rate,
        explanation=body.explanation,
        warning=body.warning,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _dz_dict(row)


def _row_dict(r: PartialExemptionCalculation) -> dict[str, Any]:
    return {
        "id": r.id,
        "period": r.period,
        "period_type": r.period_type,
        "taxable_supplies": float(r.taxable_supplies),
        "exempt_supplies": float(r.exempt_supplies),
        "input_vat_paid": float(r.input_vat_paid),
        "recovery_pct": float(r.recovery_pct),
        "recoverable_vat": float(r.recoverable_vat),
        "irrecoverable_vat": float(r.irrecoverable_vat),
        "breakdown": r.breakdown,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _bad_debt_dict(r: BadDebtReliefClaim) -> dict[str, Any]:
    return {
        "id": r.id,
        "invoice_number": r.invoice_number,
        "invoice_date": r.invoice_date.isoformat(),
        "due_date": r.due_date.isoformat(),
        "invoice_amount": float(r.invoice_amount),
        "vat_amount": float(r.vat_amount),
        "status": r.status,
        "eligible": r.eligible,
        "eligibility_reason": r.eligibility_reason,
        "extra": r.extra,
    }


def _dz_dict(r: DesignatedZoneTransaction) -> dict[str, Any]:
    return {
        "id": r.id,
        "supplier_location": r.supplier_location,
        "customer_location": r.customer_location,
        "transaction_type": r.transaction_type,
        "vat_treatment": r.vat_treatment,
        "vat_rate": float(r.vat_rate),
        "explanation": r.explanation,
        "warning": r.warning,
    }
