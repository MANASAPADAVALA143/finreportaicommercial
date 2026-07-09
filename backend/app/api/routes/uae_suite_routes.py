"""UAE Finance Suite — unified dashboard summary API."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import case
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.company_setup import UaeCompanyProfile
from app.modules.gulftax.ported_mount import get_ported_db
from app.services.ap_company_resolver import resolve_ap_company_id
from app.services.uae_suite_service import build_uae_suite_summary

router = APIRouter(prefix="/api/uae-suite", tags=["UAE Finance Suite"])

_SUITE_ROLES = frozenset({"uae_suite", "uae_full", "full_access"})


def _tenant(request: Request) -> str:
    return (
        request.headers.get("X-Workspace-ID")
        or request.headers.get("X-Tenant-ID")
        or "demo"
    )


def _company_id(request: Request, query_cid: Optional[str] = None) -> Optional[str]:
    return query_cid or request.headers.get("X-Company-ID")


def _require_suite_role(request: Request) -> None:
    role = getattr(request.state, "product_role", "full_access")
    if role not in _SUITE_ROLES:
        raise HTTPException(403, "UAE Finance Suite summary requires uae_suite or uae_full role")


def _resolve_company_id(
    db: Session,
    tenant_id: str,
    request: Request,
    query_cid: Optional[str] = None,
) -> Optional[str]:
    cid = _company_id(request, query_cid)
    if cid:
        return cid

    profile = (
        db.query(UaeCompanyProfile)
        .filter(UaeCompanyProfile.workspace_id == tenant_id)
        .order_by(
            case((UaeCompanyProfile.status == "active", 0), else_=1),
            UaeCompanyProfile.updated_at.desc(),
        )
        .first()
    )
    if profile:
        return profile.id

    return resolve_ap_company_id(db, tenant_id, None, required=False)


@router.get("/summary")
def uae_suite_summary(
    request: Request,
    company_id: Optional[str] = Query(None),
    period: Optional[str] = Query(None, description="VAT tax period e.g. 2026-Q1"),
    db: Session = Depends(get_db),
    ported_db: Session = Depends(get_ported_db),
) -> dict[str, Any]:
    """Aggregate AP, AR, and UAE Tax KPIs for the unified dashboard."""
    _require_suite_role(request)
    tenant = _tenant(request)
    cid = _resolve_company_id(db, tenant, request, company_id)
    try:
        payload = build_uae_suite_summary(
            db,
            ported_db,
            tenant_id=tenant,
            company_id=cid,
            period=period,
        )
        payload["setup_required"] = cid is None
        return payload
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
