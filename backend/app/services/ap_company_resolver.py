"""Resolve and validate ap_companies.id — canonical company scope across modules."""

from __future__ import annotations

import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.client_data import ApCompany

logger = logging.getLogger(__name__)

_INVALID_COMPANY_IDS = frozenset({"", "default", "null", "none"}


def _resolve_uae_profile_to_ap_company(
    db: Session,
    tenant_id: str,
    profile_id: str,
) -> str | None:
    """Map uae_company_profiles.id (Company Setup UI) → ap_companies.id (GL/AP)."""
    from app.models.company_setup import UaeCompanyProfile
    from app.models.workspace import Workspace

    profile = (
        db.query(UaeCompanyProfile)
        .filter(
            UaeCompanyProfile.id == profile_id,
            UaeCompanyProfile.workspace_id == tenant_id,
        )
        .first()
    )
    if not profile:
        return None

    rows = list_ap_companies(db, tenant_id)
    if len(rows) == 1:
        return rows[0].id

    target = (profile.company_name or "").strip().lower()
    for row in rows:
        if (row.name or "").strip().lower() == target:
            return row.id

    ws = db.get(Workspace, tenant_id)
    if ws:
        try:
            from app.services.ap_company_sync import sync_ap_company_for_workspace, upsert_ap_company_rds

            supabase_co = sync_ap_company_for_workspace(ws)
            if supabase_co:
                ap_row = upsert_ap_company_rds(db, ws, supabase_co)
                return ap_row.id
        except Exception as exc:
            logger.warning("AP company sync for profile %s failed: %s", profile_id, exc)

    if rows:
        return rows[0].id
    return None


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
            mapped = _resolve_uae_profile_to_ap_company(db, tenant_id, cid)
            if mapped:
                return mapped
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Unknown company_id '{cid}' — complete Company Setup and sync AP companies "
                    f"(POST /api/workspaces/{{id}}/sync-ap-company), or pick a company from AP Company Setup."
                ),
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
