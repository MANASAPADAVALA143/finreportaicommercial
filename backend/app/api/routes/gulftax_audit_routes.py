"""GulfTax audit-ready period export — RDS artifacts."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.gulftax.auth_cfo import get_current_company_id
from app.modules.gulftax.ported_mount import get_ported_db
from app.services import audit_export_service as audit_svc
from app.services.vat_recon_service import get_vat_periods

router = APIRouter(prefix="/api/gulftax/audit", tags=["GulfTax Audit Export"])


def _tenant(request: Request, workspace_id: Optional[str]) -> str:
    return (
        workspace_id
        or request.headers.get("X-Workspace-ID")
        or request.headers.get("X-Tenant-ID")
        or "demo"
    )


def _user_email(request: Request) -> Optional[str]:
    return request.headers.get("X-User-Email") or request.headers.get("X-User-Id")


@router.get("/periods")
def list_audit_periods(
    request: Request,
    company_id: str = Depends(get_current_company_id),
    workspace_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Distinct tax periods from RDS gulftax_transactions."""
    tenant = _tenant(request, workspace_id)
    return {"items": get_vat_periods(db, tenant_id=tenant, company_id=company_id)}


@router.get("/manifest/{tax_period}")
def get_audit_manifest(
    tax_period: str,
    request: Request,
    company_id: str = Depends(get_current_company_id),
    workspace_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    ported_db: Session = Depends(get_ported_db),
):
    """Preview manifest (row counts) before downloading the audit pack."""
    tenant = _tenant(request, workspace_id)
    try:
        return audit_svc.preview_period_manifest(
            db,
            ported_db,
            tenant_id=tenant,
            company_id=company_id,
            tax_period=tax_period,
            generated_by=_user_email(request),
        )
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


@router.get("/pack/{tax_period}")
def download_audit_pack(
    tax_period: str,
    request: Request,
    company_id: str = Depends(get_current_company_id),
    workspace_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    ported_db: Session = Depends(get_ported_db),
):
    """Generate and stream ZIP containing Excel workbook + manifest.json."""
    tenant = _tenant(request, workspace_id)
    try:
        result = audit_svc.generate_period_audit_pack(
            db,
            ported_db,
            tenant_id=tenant,
            company_id=company_id,
            tax_period=tax_period,
            generated_by=_user_email(request),
        )
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc

    return Response(
        content=result["zip_bytes"],
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{result["zip_filename"]}"',
            "X-Audit-Pack-SHA256": result["manifest"].get("excel_sha256", ""),
        },
    )
