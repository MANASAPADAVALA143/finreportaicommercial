"""UAE Finance Suite — unified dashboard summary API."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.gulftax.ported_mount import get_ported_db
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
    cid = _company_id(request, company_id)
    if not cid:
        raise HTTPException(400, "company_id required")
    try:
        return build_uae_suite_summary(
            db,
            ported_db,
            tenant_id=tenant,
            company_id=cid,
            period=period,
        )
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
