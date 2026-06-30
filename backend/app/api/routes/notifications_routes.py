"""In-app notification feed."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.notification_service import (
    get_workspace_role_email,
    list_notifications,
    mark_all_read,
    mark_read,
    scan_notifications,
    send_notification,
)

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


def _tenant(request: Request) -> str:
    return (
        request.headers.get("x-workspace-id")
        or request.headers.get("x-tenant-id")
        or "demo"
    )


@router.get("")
def get_notifications(
    request: Request,
    unread_only: bool = False,
    db: Session = Depends(get_db),
):
    tenant_id = _tenant(request)
    company_id = request.query_params.get("company_id")
    scan_notifications(db, tenant_id, company_id)
    items = list_notifications(db, tenant_id, unread_only=unread_only)
    unread = sum(1 for i in items if not i["is_read"])
    return {"notifications": items, "unread_count": unread}


@router.post("/scan")
def trigger_scan(request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request)
    company_id = request.query_params.get("company_id")
    count = scan_notifications(db, tenant_id, company_id)
    items = list_notifications(db, tenant_id, unread_only=True)
    return {"scanned": count, "unread_count": len(items)}


@router.patch("/{notification_id}/read")
def read_notification(notification_id: str, request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request)
    ok = mark_read(db, tenant_id, notification_id)
    return {"ok": ok}


@router.post("/read-all")
def read_all(request: Request, db: Session = Depends(get_db)):
    tenant_id = _tenant(request)
    count = mark_all_read(db, tenant_id)
    return {"marked_read": count}


class APInvoiceUploadNotifyIn(BaseModel):
    vendor_name: str
    total_amount: float
    invoice_number: str
    invoice_id: str
    currency: str = "AED"


@router.post("/ap-invoice-uploaded")
def notify_ap_invoice_uploaded(
    body: APInvoiceUploadNotifyIn,
    request: Request,
    db: Session = Depends(get_db),
):
    """Email AP approver when a new invoice is uploaded and needs approval."""
    workspace_id = _tenant(request)
    approver_email = get_workspace_role_email(
        db, workspace_id, ["AP Manager", "Approver", "CFO"]
    )
    if not approver_email:
        return {"sent": False, "reason": "no_approver_email"}

    currency = (body.currency or "AED").upper()
    amount = body.total_amount
    frontend = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    link = f"{frontend}/ap-invoices/approvals"
    subject = f"Action needed: Invoice from {body.vendor_name} {currency} {amount:,.2f}"
    text = (
        f"A new invoice requires your approval.\n\n"
        f"Vendor: {body.vendor_name}\n"
        f"Invoice #: {body.invoice_number}\n"
        f"Amount: {currency} {amount:,.2f}\n"
        f"Invoice ID: {body.invoice_id}\n\n"
        f"Review and approve: {link}"
    )
    sent = send_notification(approver_email, subject, text)
    return {"sent": sent, "to": approver_email}
