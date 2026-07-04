"""Resolve and validate ap_companies.id — canonical company scope across modules."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.client_data import ApCompany

_INVALID_COMPANY_IDS = frozenset({"", "default", "null", "none"})


def resolve_ap_company_id(
    db: Session,
    tenant_id: str,
    company_id: str | None,
    *,
    required: bool = False,
) -> str | None:
    """
    Return a validated ap_companies.id for the tenant.

    When company_id is omitted, use the sole company for the tenant (if exactly one).
    """
    cid = (company_id or "").strip()
    if cid.lower() in _INVALID_COMPANY_IDS:
        cid = ""

    if cid:
        row = (
            db.query(ApCompany)
            .filter(ApCompany.id == cid, ApCompany.tenant_id == tenant_id)
            .first()
        )
        if not row:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown company_id '{cid}' — select a company from AP Company Setup.",
            )
        return row.id

    rows = db.query(ApCompany).filter(ApCompany.tenant_id == tenant_id).order_by(ApCompany.name).all()
    if len(rows) == 1:
        return rows[0].id

    if required:
        raise HTTPException(
            status_code=422,
            detail="company_id is required — pick a company from the AP companies list.",
        )
    return None


def list_ap_companies(db: Session, tenant_id: str) -> list[ApCompany]:
    return (
        db.query(ApCompany)
        .filter(ApCompany.tenant_id == tenant_id)
        .order_by(ApCompany.name)
        .all()
    )
