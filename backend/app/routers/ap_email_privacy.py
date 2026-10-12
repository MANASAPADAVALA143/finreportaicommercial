"""AP email intake — consent and erasure (DPDP)."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.company_access import require_company_access
from app.core.database import get_db
from app.core.tenant_scope import workspace_manager, workspace_member
from app.middleware.workspace import WorkspaceContext
from app.services.ap_email_privacy_service import (
    EMAIL_INVOICE_CONSENT_VERSION,
    get_active_consent,
    purge_email_intake_data,
    record_consent,
    suggest_forwarding_address,
)

router = APIRouter(prefix="/api/ap/email-intake", tags=["ap-email-privacy"], dependencies=[Depends(workspace_member)])


class ConsentRecordBody(BaseModel):
    company_id: str
    accepted_by_user_id: Optional[str] = None  # ignored: consent is recorded for the signed-in user
    accepted_by_email: Optional[str] = None  # ignored: consent is recorded for the signed-in user
    consent_version: str = Field(default=EMAIL_INVOICE_CONSENT_VERSION)


class ErasureBody(BaseModel):
    company_id: str
    confirm: bool = False


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


@router.get("/consent")
def read_email_intake_consent(
    company_id: str,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Return active consent for company (if any) and current terms version."""
    company_id = require_company_access(db, ctx, company_id, "read")
    try:
        active = get_active_consent(company_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Consent lookup failed: {exc}") from exc
    return {
        "company_id": company_id,
        "consent_type": "email_invoice_processing",
        "current_version": EMAIL_INVOICE_CONSENT_VERSION,
        "has_active_consent": active is not None,
        "consent": active,
    }


@router.post("/consent")
def accept_email_intake_consent(
    body: ConsentRecordBody,
    request: Request,
    ctx: WorkspaceContext = Depends(workspace_member),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Record explicit consent before activating email forwarding."""
    if body.consent_version != EMAIL_INVOICE_CONSENT_VERSION:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported consent_version. Expected {EMAIL_INVOICE_CONSENT_VERSION}.",
        )
    company_id = require_company_access(db, ctx, body.company_id, "write")
    user = ctx.user
    try:
        row = record_consent(
            company_id=company_id,
            accepted_by_user_id=str(user.id) if user else None,
            accepted_by_email=getattr(user, "email", None),
            consent_version=body.consent_version,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"consent": row, "message": "Consent recorded"}


@router.get("/suggested-forwarding-address")
def suggested_forwarding_address(company_slug: str) -> dict[str, str]:
    return {"forwarding_address": suggest_forwarding_address(company_slug)}


@router.post("/erasure")
def erase_email_intake_data(
    body: ErasureBody,
    ctx: WorkspaceContext = Depends(workspace_manager),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Purge email intake data when client withdraws consent or offboards."""
    if not body.confirm:
        raise HTTPException(status_code=400, detail="Set confirm=true to execute erasure")
    company_id = require_company_access(db, ctx, body.company_id, "manage")
    try:
        counts = purge_email_intake_data(company_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"company_id": company_id, "purged": counts}