"""AP email intake — consent and erasure (DPDP)."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.services.ap_email_privacy_service import (
    EMAIL_INVOICE_CONSENT_VERSION,
    assert_company_member_access,
    get_active_consent,
    purge_email_intake_data,
    record_consent,
    suggest_forwarding_address,
)

router = APIRouter(prefix="/api/ap/email-intake", tags=["ap-email-privacy"])


class ConsentRecordBody(BaseModel):
    company_id: str
    accepted_by_user_id: Optional[str] = None
    accepted_by_email: Optional[str] = None
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


def _actor(request: Request) -> tuple[str | None, str | None, bool]:
    user_id = getattr(request.state, "user_id", None) or None
    role = getattr(request.state, "user_role", None) or ""
    return user_id, None, role == "super_admin"


@router.get("/consent")
def read_email_intake_consent(company_id: str, request: Request) -> dict[str, Any]:
    """Return active consent for company (if any) and current terms version."""
    user_id, _, is_super = _actor(request)
    try:
        assert_company_member_access(company_id, user_id=user_id, user_email=None, is_super_admin=is_super)
        active = get_active_consent(company_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
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
def accept_email_intake_consent(body: ConsentRecordBody, request: Request) -> dict[str, Any]:
    """Record explicit consent before activating email forwarding."""
    if body.consent_version != EMAIL_INVOICE_CONSENT_VERSION:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported consent_version. Expected {EMAIL_INVOICE_CONSENT_VERSION}.",
        )
    user_id, _, is_super = _actor(request)
    try:
        assert_company_member_access(
            body.company_id,
            user_id=user_id or body.accepted_by_user_id,
            user_email=body.accepted_by_email,
            is_super_admin=is_super,
        )
        row = record_consent(
            company_id=body.company_id,
            accepted_by_user_id=body.accepted_by_user_id or user_id,
            accepted_by_email=body.accepted_by_email,
            consent_version=body.consent_version,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"consent": row, "message": "Consent recorded"}


@router.get("/suggested-forwarding-address")
def suggested_forwarding_address(company_slug: str) -> dict[str, str]:
    return {"forwarding_address": suggest_forwarding_address(company_slug)}


@router.post("/erasure")
def erase_email_intake_data(body: ErasureBody, request: Request) -> dict[str, Any]:
    """Purge email intake data when client withdraws consent or offboards."""
    if not body.confirm:
        raise HTTPException(status_code=400, detail="Set confirm=true to execute erasure")
    user_id, _, is_super = _actor(request)
    try:
        assert_company_member_access(body.company_id, user_id=user_id, user_email=None, is_super_admin=is_super)
        counts = purge_email_intake_data(body.company_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"company_id": body.company_id, "purged": counts}
