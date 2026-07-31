"""VAT Advanced modules — AWS RDS primary, Supabase (026) fallback."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional
from uuid import uuid4

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


def _supabase():
    try:
        from app.core.supabase import get_supabase

        return get_supabase()
    except Exception:
        return None


def _sb_insert(table: str, payload: dict[str, Any]) -> dict[str, Any]:
    sb = _supabase()
    if sb is None:
        raise HTTPException(
            503,
            "VAT advanced storage unavailable (RDS table missing and Supabase not configured). "
            "Apply supabase/migrations/026_vat_advanced.sql and 042_vat_advanced_status.sql.",
        )
    res = sb.table(table).insert(payload).execute()
    rows = res.data or []
    if not rows:
        raise HTTPException(500, f"Supabase insert into {table} returned no row")
    return rows[0]


def _sb_list(table: str, workspace_id: str, limit: int = 100) -> list[dict[str, Any]]:
    sb = _supabase()
    if sb is None:
        return []
    res = (
        sb.table(table)
        .select("*")
        .eq("workspace_id", workspace_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return list(res.data or [])


@router.get("/partial-exemption")
def list_partial_exemption(
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        rows = (
            db.query(PartialExemptionCalculation)
            .filter_by(tenant_id=tenant_id, company_id=company_id)
            .order_by(PartialExemptionCalculation.created_at.desc())
            .limit(100)
            .all()
        )
        if rows:
            return {"items": [_row_dict(r) for r in rows]}
    except Exception:
        db.rollback()

    items = []
    for r in _sb_list("partial_exemption_calculations", tenant_id):
        items.append(
            {
                "id": r.get("id"),
                "period": r.get("period"),
                "period_type": r.get("period_type"),
                "taxable_supplies": float(r.get("taxable_supplies") or 0),
                "exempt_supplies": float(r.get("exempt_supplies") or 0),
                "input_vat_paid": float(r.get("input_vat_paid") or 0),
                "recovery_pct": float(r.get("recovery_pct") or 0),
                "recoverable_vat": float(r.get("recoverable_vat") or 0),
                "irrecoverable_vat": float(r.get("irrecoverable_vat") or 0),
                "breakdown": r.get("breakdown"),
                "status": r.get("status") or "draft",
                "created_at": r.get("created_at"),
            }
        )
    return {"items": items}


@router.post("/partial-exemption")
def save_partial_exemption(
    body: PartialExemptionIn,
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    assert_write_allowed()
    try:
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
            status="draft",
            created_at=datetime.utcnow(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _row_dict(row)
    except Exception:
        db.rollback()

    # Fallback: Supabase tables from 026_vat_advanced.sql (service role bypasses RLS)
    sb_row = _sb_insert(
        "partial_exemption_calculations",
        {
            "id": str(uuid4()),
            "workspace_id": tenant_id,
            "company_id": company_id,
            "period": body.period,
            "period_type": body.period_type,
            "taxable_supplies": body.taxable_supplies,
            "exempt_supplies": body.exempt_supplies,
            "input_vat_paid": body.input_vat_paid,
            "recovery_pct": body.recovery_pct,
            "recoverable_vat": body.recoverable_vat,
            "irrecoverable_vat": body.irrecoverable_vat,
            "breakdown": body.breakdown,
        },
    )
    return {
        "id": sb_row.get("id"),
        "period": sb_row.get("period"),
        "period_type": sb_row.get("period_type"),
        "taxable_supplies": float(sb_row.get("taxable_supplies") or 0),
        "exempt_supplies": float(sb_row.get("exempt_supplies") or 0),
        "input_vat_paid": float(sb_row.get("input_vat_paid") or 0),
        "recovery_pct": float(sb_row.get("recovery_pct") or 0),
        "recoverable_vat": float(sb_row.get("recoverable_vat") or 0),
        "irrecoverable_vat": float(sb_row.get("irrecoverable_vat") or 0),
        "breakdown": sb_row.get("breakdown"),
        "status": sb_row.get("status") or "draft",
        "created_at": sb_row.get("created_at"),
    }


@router.patch("/partial-exemption/{record_id}/approve")
def approve_partial_exemption(
    record_id: str,
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Approve a saved partial exemption — only approved calcs adjust Box 11 on the VAT return."""
    assert_write_allowed()
    try:
        row = (
            db.query(PartialExemptionCalculation)
            .filter_by(id=record_id, tenant_id=tenant_id, company_id=company_id)
            .first()
        )
        if row:
            if row.status != "approved":
                row.status = "approved"
                row.updated_at = datetime.utcnow()
                db.commit()
                db.refresh(row)
            return _row_dict(row)
    except Exception:
        db.rollback()

    sb = _supabase()
    if sb is None:
        raise HTTPException(404, "Partial exemption calculation not found")
    res = (
        sb.table("partial_exemption_calculations")
        .update({"status": "approved"})
        .eq("id", record_id)
        .eq("workspace_id", tenant_id)
        .execute()
    )
    rows = res.data or []
    if not rows:
        # status column may be missing until 042 — still return found row
        found = (
            sb.table("partial_exemption_calculations")
            .select("*")
            .eq("id", record_id)
            .eq("workspace_id", tenant_id)
            .limit(1)
            .execute()
        )
        rows = found.data or []
    if not rows:
        raise HTTPException(404, "Partial exemption calculation not found")
    r = rows[0]
    return {
        "id": r.get("id"),
        "period": r.get("period"),
        "period_type": r.get("period_type"),
        "taxable_supplies": float(r.get("taxable_supplies") or 0),
        "exempt_supplies": float(r.get("exempt_supplies") or 0),
        "input_vat_paid": float(r.get("input_vat_paid") or 0),
        "recovery_pct": float(r.get("recovery_pct") or 0),
        "recoverable_vat": float(r.get("recoverable_vat") or 0),
        "irrecoverable_vat": float(r.get("irrecoverable_vat") or 0),
        "breakdown": r.get("breakdown"),
        "status": r.get("status") or "approved",
        "created_at": r.get("created_at"),
    }


@router.get("/bad-debt")
def list_bad_debt(
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        rows = (
            db.query(BadDebtReliefClaim)
            .filter_by(tenant_id=tenant_id, company_id=company_id)
            .order_by(BadDebtReliefClaim.created_at.desc())
            .limit(200)
            .all()
        )
        if rows:
            return {"items": [_bad_debt_dict(r) for r in rows]}
    except Exception:
        db.rollback()
    items = []
    for r in _sb_list("bad_debt_relief_claims", tenant_id, 200):
        items.append(
            {
                "id": r.get("id"),
                "invoice_number": r.get("invoice_number"),
                "invoice_date": r.get("invoice_date"),
                "due_date": r.get("due_date"),
                "invoice_amount": float(r.get("invoice_amount") or 0),
                "vat_amount": float(r.get("vat_amount") or 0),
                "status": r.get("status"),
                "eligible": bool(r.get("eligible")),
                "eligibility_reason": r.get("eligibility_reason"),
                "claim_period": r.get("claim_period"),
                "extra": {},
                "created_at": r.get("created_at"),
            }
        )
    return {"items": items}


@router.post("/bad-debt")
def save_bad_debt(
    body: BadDebtIn,
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    assert_write_allowed()
    try:
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
            claim_period=(body.extra or {}).get("claim_period") if body.extra else None,
            extra=body.extra or {},
            created_at=datetime.utcnow(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _bad_debt_dict(row)
    except Exception:
        db.rollback()

    extra = body.extra or {}
    sb_row = _sb_insert(
        "bad_debt_relief_claims",
        {
            "id": str(uuid4()),
            "workspace_id": tenant_id,
            "company_id": company_id,
            "invoice_number": body.invoice_number,
            "invoice_date": body.invoice_date.isoformat(),
            "due_date": body.due_date.isoformat(),
            "invoice_amount": body.invoice_amount,
            "vat_amount": body.vat_amount,
            "vat_return_period": extra.get("vat_return_period"),
            "written_off_date": extra.get("written_off_date"),
            "recovery_steps": extra.get("recovery_steps"),
            "connected_party": bool(extra.get("connected_party")),
            "eligible": body.eligible,
            "eligibility_reason": body.eligibility_reason,
            "claim_period": extra.get("claim_period"),
            "status": body.status,
        },
    )
    return {
        "id": sb_row.get("id"),
        "invoice_number": sb_row.get("invoice_number"),
        "invoice_date": sb_row.get("invoice_date"),
        "due_date": sb_row.get("due_date"),
        "invoice_amount": float(sb_row.get("invoice_amount") or 0),
        "vat_amount": float(sb_row.get("vat_amount") or 0),
        "status": sb_row.get("status"),
        "eligible": bool(sb_row.get("eligible")),
        "eligibility_reason": sb_row.get("eligibility_reason"),
        "claim_period": sb_row.get("claim_period"),
        "extra": extra,
        "created_at": sb_row.get("created_at"),
    }


@router.patch("/bad-debt/{record_id}/approve")
def approve_bad_debt(
    record_id: str,
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Approve a bad debt claim — only approved eligible claims adjust Box 7 on the VAT return."""
    assert_write_allowed()
    try:
        row = (
            db.query(BadDebtReliefClaim)
            .filter_by(id=record_id, tenant_id=tenant_id, company_id=company_id)
            .first()
        )
        if row:
            if not row.eligible:
                raise HTTPException(400, "Only eligible claims can be approved")
            if row.status != "approved":
                row.status = "approved"
                row.updated_at = datetime.utcnow()
                db.commit()
                db.refresh(row)
            return _bad_debt_dict(row)
    except HTTPException:
        raise
    except Exception:
        db.rollback()

    sb = _supabase()
    if sb is None:
        raise HTTPException(404, "Bad debt claim not found")
    res = (
        sb.table("bad_debt_relief_claims")
        .update({"status": "approved"})
        .eq("id", record_id)
        .eq("workspace_id", tenant_id)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(404, "Bad debt claim not found")
    r = rows[0]
    if not r.get("eligible"):
        raise HTTPException(400, "Only eligible claims can be approved")
    return {
        "id": r.get("id"),
        "invoice_number": r.get("invoice_number"),
        "invoice_date": r.get("invoice_date"),
        "due_date": r.get("due_date"),
        "invoice_amount": float(r.get("invoice_amount") or 0),
        "vat_amount": float(r.get("vat_amount") or 0),
        "status": r.get("status"),
        "eligible": bool(r.get("eligible")),
        "eligibility_reason": r.get("eligibility_reason"),
        "claim_period": r.get("claim_period"),
        "extra": {},
        "created_at": r.get("created_at"),
    }


@router.get("/designated-zones")
def list_dz(
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        rows = (
            db.query(DesignatedZoneTransaction)
            .filter_by(tenant_id=tenant_id, company_id=company_id)
            .order_by(DesignatedZoneTransaction.created_at.desc())
            .limit(200)
            .all()
        )
        if rows:
            return {"items": [_dz_dict(r) for r in rows]}
    except Exception:
        db.rollback()
    items = [_dz_dict_sb(r) for r in _sb_list("designated_zone_transactions", tenant_id, 200)]
    return {"items": items}


@router.post("/designated-zones")
def save_dz(
    body: DesignatedZoneIn,
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    assert_write_allowed()
    try:
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
    except Exception:
        db.rollback()

    sb_row = _sb_insert(
        "designated_zone_transactions",
        {
            "id": str(uuid4()),
            "workspace_id": tenant_id,
            "company_id": company_id,
            "supplier_location": body.supplier_location,
            "customer_location": body.customer_location,
            "transaction_type": body.transaction_type,
            "vat_treatment": body.vat_treatment,
            "vat_rate": body.vat_rate,
            "explanation": body.explanation,
            "warning": body.warning,
        },
    )
    return _dz_dict_sb(sb_row)


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
        "status": r.status or "draft",
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
        "claim_period": r.claim_period,
        "extra": r.extra,
        "created_at": r.created_at.isoformat() if r.created_at else None,
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


def _dz_dict_sb(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r.get("id"),
        "supplier_location": r.get("supplier_location"),
        "customer_location": r.get("customer_location"),
        "transaction_type": r.get("transaction_type"),
        "vat_treatment": r.get("vat_treatment"),
        "vat_rate": float(r.get("vat_rate") or 0),
        "explanation": r.get("explanation"),
        "warning": r.get("warning"),
    }
