"""
Inbound demo lead capture: persist to Supabase, trigger VAPI outbound call with assistant variableValues.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field

from app.core.config import settings
from app.core.supabase import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])

RoleOption = Literal[
    "CFO",
    "Financial Controller",
    "Finance Director",
    "VP Finance",
    "Finance Manager",
    "Other",
]
RevenueOption = Literal[
    "Under $2M",
    "$2M–$10M",
    "$10M–$50M",
    "$50M–$200M",
    "$200M+",
    "Prefer not to say",
]
InvoiceVolumeOption = Literal["Under 100", "100–500", "500–2000", "2000+"]
PainOption = Literal[
    "Month-end close too slow",
    "IFRS compliance is manual",
    "AP processing eats team time",
    "Journal entry errors / audit risk",
    "All of the above",
]


class InboundLeadBody(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=200)
    email: EmailStr
    phone: str = Field(
        ...,
        description="E.164, e.g. +15551234567",
        min_length=8,
        max_length=32,
    )
    company_name: str = Field(..., min_length=1, max_length=300)
    role: RoleOption
    revenue_range: RevenueOption
    invoice_volume: InvoiceVolumeOption
    pain_area: PainOption
    heard_about: str | None = Field(None, max_length=500)


def _normalize_e164(phone: str) -> str:
    p = phone.strip().replace(" ", "")
    if not p.startswith("+"):
        raise ValueError("Phone must include country code in E.164 format (start with +).")
    digits = p[1:]
    if not digits.isdigit() or len(digits) < 8 or len(digits) > 15:
        raise ValueError("Invalid phone number length after +.")
    return p


def _vapi_failure_webhook(payload: dict) -> None:
    url = (settings.INBOUND_LEAD_VAPI_FAILURE_WEBHOOK or "").strip()
    if not url:
        return
    try:
        requests.post(url, json=payload, timeout=8)
    except Exception as e:
        logger.warning("VAPI failure webhook post failed: %s", e)


def _trigger_vapi_call(body: InboundLeadBody) -> tuple[bool, str | None, str | None]:
    api_key = (settings.VAPI_API_KEY or "").strip()
    assistant_id = (settings.NOVA_ASSISTANT_ID or "").strip()
    phone_number_id = (settings.VAPI_PHONE_NUMBER_ID or "").strip()
    if not api_key or not assistant_id or not phone_number_id:
        logger.error("VAPI not fully configured (VAPI_API_KEY, NOVA_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID).")
        return False, None, "VAPI not configured on server"

    vapi_payload = {
        "assistantId": assistant_id,
        "phoneNumberId": phone_number_id,
        "customer": {
            "number": body.phone,
            "name": body.full_name,
        },
        "assistantOverrides": {
            "variableValues": {
                "PROSPECT_NAME": body.full_name,
                "COMPANY_NAME": body.company_name,
                "PROSPECT_ROLE": body.role,
                "KNOWN_PAIN": body.pain_area,
                "INVOICE_VOLUME": body.invoice_volume,
                "REVENUE_RANGE": body.revenue_range,
                "SOURCE": "web_form",
            }
        },
    }

    try:
        r = requests.post(
            "https://api.vapi.ai/call",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=vapi_payload,
            timeout=30,
        )
        if r.status_code >= 400:
            err = r.text[:500] if r.text else r.reason
            logger.error("VAPI create call failed: %s %s", r.status_code, err)
            return False, None, err

        data = r.json() if r.content else {}
        call_id = data.get("id") if isinstance(data, dict) else None
        return True, call_id if isinstance(call_id, str) else None, None
    except Exception as e:
        logger.exception("VAPI request error")
        return False, None, str(e)


@router.post("/inbound-lead")
def inbound_lead(body: InboundLeadBody):
    try:
        lead = body.model_copy(update={"phone": _normalize_e164(body.phone)})
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    row = {
        "full_name": lead.full_name,
        "email": str(lead.email),
        "phone": lead.phone,
        "company_name": lead.company_name,
        "role": lead.role,
        "revenue_range": lead.revenue_range,
        "invoice_volume": lead.invoice_volume,
        "pain_area": lead.pain_area,
        "source": "web_form",
        "heard_about": lead.heard_about,
        "call_triggered": False,
    }

    try:
        supabase = get_supabase()
    except RuntimeError as e:
        raise HTTPException(
            status_code=503,
            detail="Lead capture requires Supabase. Set SUPABASE_URL and SUPABASE_KEY in backend/.env",
        ) from e

    ins = supabase.table("inbound_leads").insert(row).execute()
    if not ins.data or not isinstance(ins.data, list) or not ins.data[0].get("id"):
        logger.error("Supabase insert returned no id: %s", ins)
        raise HTTPException(status_code=500, detail="Could not save lead.")

    lead_id = ins.data[0]["id"]

    ok, vapi_call_id, vapi_err = _trigger_vapi_call(lead)
    now = datetime.now(timezone.utc).isoformat()

    if ok:
        supabase.table("inbound_leads").update(
            {
                "call_triggered": True,
                "call_triggered_at": now,
                "vapi_call_id": vapi_call_id,
            }
        ).eq("id", lead_id).execute()
        return {
            "success": True,
            "message": "Nova will call you shortly",
            "lead_id": lead_id,
        }

    _vapi_failure_webhook(
        {
            "event": "inbound_lead_vapi_failed",
            "lead_id": lead_id,
            "error": vapi_err,
            "full_name": lead.full_name,
            "email": str(lead.email),
            "phone": lead.phone,
            "company_name": lead.company_name,
            "pain_area": lead.pain_area,
            "note": "Wire this webhook in n8n to email Manasa or alert Slack.",
        }
    )

    return {
        "success": False,
        "message": "We'll be in touch within 2 hours.",
        "lead_id": lead_id,
    }
