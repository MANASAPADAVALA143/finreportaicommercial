"""POST /api/ap/vendor-whatsapp — Twilio WhatsApp on Approved/Paid."""
from __future__ import annotations

import logging
import re
import sys
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.company_access import require_company_access, require_invoice_access
from app.core.database import get_db
from app.core.supabase import get_supabase
from app.middleware.workspace import WorkspaceContext, validate_workspace

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ap", tags=["ap-vendor-whatsapp"])

# Import scripts/vendor_whatsapp.py (host: repo/scripts, Docker: /app/scripts)
def _scripts_dir() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "scripts"
        if (candidate / "vendor_whatsapp.py").is_file():
            return candidate
    return here.parents[4] / "scripts"


_SCRIPTS = _scripts_dir()
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
def vendor_whatsapp(
    request: Request,
    body: VendorWhatsAppRequest,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict:
    """
    Fire-and-return Twilio WhatsApp to the vendor of an invoice the caller can change.
    The phone number and invoice fields are always loaded from the DB; body copies are ignored.
    """
    invoice_id = (body.invoice_id or "").strip()
    if not invoice_id:
        raise HTTPException(status_code=422, detail="invoice_id required")
    require_invoice_access(db, ctx, [invoice_id], "write")

    try:
        from vendor_whatsapp import notify_from_invoice_id
    except ImportError as e:
        logger.error("vendor_whatsapp script import failed: %s", e)
        return {"ok": False, "error": f"script_import_failed: {e}"}

    dry_run = body.dry_run or (request.query_params.get("test") == "1")
    return notify_from_invoice_id(invoice_id, body.status, logger=logger, dry_run=dry_run)


def _phone_digits(phone: str | None) -> str:
    return re.sub(r"\D", "", phone or "")


def _require_vendor_phone_access(db: Session, ctx: WorkspaceContext, invoice_number: str, phone: str) -> None:
    """The number must be the vendor phone on that invoice, in a company the caller can change."""
    wanted = _phone_digits(phone)
    number = (invoice_number or "").strip()
    if not wanted or number in ("", "—"):
        raise HTTPException(status_code=422, detail="invoice_number and to are required")

    rows = (
        get_supabase()
        .table("invoices")
        .select("id, company_id, vendor_phone")
        .eq("invoice_number", number)
        .limit(50)
        .execute()
        .data
        or []
    )
    for row in rows:
        if _phone_digits(row.get("vendor_phone")) != wanted:
            continue
        try:
            require_company_access(db, ctx, row.get("company_id"), "write")
            return
        except HTTPException:
            continue
    raise HTTPException(status_code=403, detail="Number is not the vendor phone on an invoice you can access")


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
def vendor_whatsapp_notify(
    body: VendorWhatsAppBatchRequest,
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
) -> dict:
    """Accept frontend/n8n-shaped payload {to, status, ...}."""
    _require_vendor_phone_access(db, ctx, body.invoice_number, body.to)
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
