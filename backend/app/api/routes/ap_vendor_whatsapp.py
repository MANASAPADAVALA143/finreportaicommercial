"""POST /api/ap/vendor-whatsapp — Twilio WhatsApp on Approved/Paid."""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ap", tags=["ap-vendor-whatsapp"])

# Import scripts/vendor_whatsapp.py helpers (repo_root/scripts)
_REPO = Path(__file__).resolve().parents[4]
_SCRIPTS = _REPO / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))


class VendorWhatsAppRequest(BaseModel):
    status: Literal["Approved", "Paid"]
    invoice_id: Optional[str] = None
    vendor_phone: Optional[str] = None
    vendor_name: Optional[str] = None
    invoice_number: Optional[str] = None
    total_amount: Optional[float] = None
    currency: Optional[str] = None
    due_date: Optional[str] = None
    dry_run: bool = False


@router.post("/vendor-whatsapp")
def vendor_whatsapp(request: Request, body: VendorWhatsAppRequest) -> dict:
    """
    Fire-and-return Twilio WhatsApp to vendor.
    Prefer invoice_id (loads phone from DB); else pass vendor_phone + invoice fields.
    """
    try:
        from vendor_whatsapp import notify_from_invoice_id, notify_vendor_status
    except ImportError as e:
        logger.error("vendor_whatsapp script import failed: %s", e)
        return {"ok": False, "error": f"script_import_failed: {e}"}

    dry_run = body.dry_run or (request.query_params.get("test") == "1")

    if body.invoice_id:
        return notify_from_invoice_id(
            body.invoice_id,
            body.status,
            logger=logger,
            dry_run=dry_run,
        )

    if not (body.vendor_phone or "").strip():
        return {"ok": False, "skipped": True, "reason": "no_vendor_phone"}

    return notify_vendor_status(
        vendor_phone=body.vendor_phone or "",
        vendor_name=body.vendor_name or "Vendor",
        invoice_number=body.invoice_number or "—",
        amount=float(body.total_amount or 0),
        currency=body.currency or "AED",
        status=body.status,
        due_date=body.due_date,
        logger=logger,
        dry_run=dry_run,
    )


class VendorWhatsAppBatchRequest(BaseModel):
    """Optional alias matching frontend payload shape (type=vendor_status)."""
    type: str = Field(default="vendor_status")
    to: str
    vendor_name: str = "Vendor"
    invoice_number: str = "—"
    amount: str | float = 0
    currency: str = "AED"
    status: Literal["Approved", "Paid"]
    due_date: Optional[str] = None
    message: Optional[str] = None
    dry_run: bool = False


@router.post("/vendor-whatsapp-notify")
def vendor_whatsapp_notify(body: VendorWhatsAppBatchRequest) -> dict:
    """Accept frontend/n8n-shaped payload {to, status, ...}."""
    try:
        from vendor_whatsapp import notify_vendor_status
    except ImportError as e:
        return {"ok": False, "error": f"script_import_failed: {e}"}

    amount = body.amount
    if isinstance(amount, str):
        try:
            amount = float(amount.replace(",", ""))
        except ValueError:
            amount = 0.0

    return notify_vendor_status(
        vendor_phone=body.to,
        vendor_name=body.vendor_name,
        invoice_number=body.invoice_number,
        amount=float(amount or 0),
        currency=body.currency,
        status=body.status,
        due_date=body.due_date,
        logger=logger,
        dry_run=body.dry_run,
    )
