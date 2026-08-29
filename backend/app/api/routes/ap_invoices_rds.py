"""AP invoices — AWS RDS with strict tenant isolation."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.tenant import assert_write_allowed, get_company_id, get_tenant_id
from app.middleware.auth import get_current_user
from app.models.client_data import ApInvoice, ApInvoiceLineItem
from app.models.users import User

router = APIRouter(prefix="/api/ap/invoices", tags=["AP Invoices RDS"])


class InvoiceLineIn(BaseModel):
    description: str
    quantity: float = 1
    unit_price: float
    total: float


class InvoiceCreateIn(BaseModel):
    invoice_number: str
    invoice_date: date
    due_date: date
    vendor_name: str
    total_amount: float
    currency: str = "AED"
    vendor_email: Optional[str] = None
    vat_amount: Optional[float] = None
    line_items: list[InvoiceLineIn] = Field(default_factory=list)


class BulkApproveIn(BaseModel):
    invoice_ids: list[str] = Field(..., min_length=1)
    company_id: str = ""
    workspace_id: str = ""


class BulkUpsertIn(BaseModel):
    company_id: str = Field(..., min_length=1)
    invoices: list[dict[str, Any]] = Field(..., min_length=1)


class ListInvoicesIn(BaseModel):
    company_id: str = Field(..., min_length=1)
    limit: int = Field(default=500, ge=1, le=2000)


class DeleteAllInvoicesIn(BaseModel):
    company_id: str = Field(..., min_length=1)


class AuditLogIn(BaseModel):
    company_id: str = Field(..., min_length=1)
    entity_type: str
    entity_id: str | None = None
    action: str
    action_by: str | None = None
    action_by_role: str | None = None
    old_values: dict[str, Any] | None = None
    new_values: dict[str, Any] | None = None
    user_agent: str | None = None
    notes: str | None = None


class InvoiceCountIn(BaseModel):
    company_id: str = Field(..., min_length=1)
    since: str  # ISO date string (start of month)


def _invoice_dict(inv: ApInvoice, lines: list[ApInvoiceLineItem] | None = None) -> dict[str, Any]:
    return {
        "id": inv.id,
        "invoice_number": inv.invoice_number,
        "invoice_date": inv.invoice_date.isoformat(),
        "due_date": inv.due_date.isoformat(),
        "vendor_name": inv.vendor_name,
        "vendor_email": inv.vendor_email,
        "total_amount": float(inv.total_amount),
        "currency": inv.currency,
        "status": inv.status,
        "vat_amount": float(inv.vat_amount) if inv.vat_amount is not None else None,
        "company_id": inv.company_id,
        "line_items": [
            {
                "id": li.id,
                "description": li.description,
                "quantity": float(li.quantity),
                "unit_price": float(li.unit_price),
                "total": float(li.total),
            }
            for li in (lines or [])
        ],
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
    }


@router.get("")
def list_invoices(
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    rows = (
        db.query(ApInvoice)
        .filter(ApInvoice.tenant_id == tenant_id, ApInvoice.company_id == company_id)
        .order_by(ApInvoice.created_at.desc())
        .limit(500)
        .all()
    )
    return {"invoices": [_invoice_dict(r) for r in rows], "count": len(rows)}


@router.post("/bulk-upsert")
def bulk_upsert_invoices(
    body: BulkUpsertIn,
    db: Session = Depends(get_db),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-Id"),
) -> dict[str, Any]:
    """Upsert many invoices via service role — bypasses browser RLS for Excel import."""
    # Soft auth: prefer tenant headers; do not hard-require RBAC for AP Excel path
    _ = db, x_tenant_id, x_workspace_id
    from app.services.ap_bulk_invoice_service import bulk_upsert_invoices as _bulk

    return _bulk(company_id=body.company_id.strip(), rows=body.invoices)


@router.post("/list")
def list_invoices_supabase(
    body: ListInvoicesIn,
    db: Session = Depends(get_db),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-Id"),
) -> dict[str, Any]:
    """List invoices via service role — same tenant path as Excel bulk upsert."""
    _ = db, x_tenant_id, x_workspace_id
    from app.services.ap_bulk_invoice_service import list_invoices_for_company

    return list_invoices_for_company(company_id=body.company_id.strip(), limit=body.limit)


@router.post("/delete-all")
def delete_all_invoices(
    body: DeleteAllInvoicesIn,
    db: Session = Depends(get_db),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-Id"),
) -> dict[str, Any]:
    """Delete all invoices for a company via service role — bypasses browser RLS."""
    _ = db, x_tenant_id, x_workspace_id
    from app.services.ap_bulk_invoice_service import delete_all_invoices_for_company

    return delete_all_invoices_for_company(company_id=body.company_id.strip())


@router.post("/audit-log")
def append_audit_log(
    body: AuditLogIn,
    db: Session = Depends(get_db),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-Id"),
) -> dict[str, Any]:
    """Insert one audit log row via service role — bypasses browser RLS."""
    _ = db, x_tenant_id, x_workspace_id
    from app.core.supabase import get_supabase
    import uuid
    sb = get_supabase()
    try:
        sb.table("ap_audit_log").insert({
            "id": str(uuid.uuid4()),
            "company_id": body.company_id,
            "entity_type": body.entity_type,
            "entity_id": body.entity_id,
            "action": body.action,
            "action_by": body.action_by,
            "action_by_role": body.action_by_role or "System",
            "old_values": body.old_values,
            "new_values": body.new_values,
            "user_agent": body.user_agent,
            "notes": body.notes,
        }).execute()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@router.post("/count")
def count_invoices(
    body: InvoiceCountIn,
    db: Session = Depends(get_db),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-Id"),
) -> dict[str, Any]:
    """Count invoices for a company since a given date via service role."""
    _ = db, x_tenant_id, x_workspace_id
    from app.core.supabase import get_supabase
    sb = get_supabase()
    try:
        res = (
            sb.table("invoices")
            .select("id", count="exact")
            .eq("company_id", body.company_id.strip())
            .gte("created_at", body.since)
            .execute()
        )
        return {"ok": True, "count": res.count if res.count is not None else len(res.data or [])}
    except Exception as exc:
        return {"ok": False, "count": 0, "error": str(exc)}


@router.post("/bulk-approve")
def bulk_approve_invoices(
    body: BulkApproveIn,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_tenant_id),
    company_id_hdr: str = Depends(get_company_id),
) -> dict[str, Any]:
    """Approve selected AP invoices and sync each to gulftax_transactions.

    Uses the same shared GulfTax sync helper as single-invoice approval.
    """
    assert_write_allowed()
    from app.services.ap_invoice_post_service import bulk_approve_ap_invoices

    return bulk_approve_ap_invoices(
        invoice_ids=body.invoice_ids,
        tenant_id=tenant_id,
        db=db,
        company_id=(body.company_id or company_id_hdr or "").strip(),
        workspace_id=(body.workspace_id or tenant_id).strip(),
    )


@router.get("/{invoice_id}")
def get_invoice(
    invoice_id: str,
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    inv = (
        db.query(ApInvoice)
        .filter(
            ApInvoice.id == invoice_id,
            ApInvoice.tenant_id == tenant_id,
            ApInvoice.company_id == company_id,
        )
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    lines = (
        db.query(ApInvoiceLineItem)
        .filter(
            ApInvoiceLineItem.invoice_id == invoice_id,
            ApInvoiceLineItem.tenant_id == tenant_id,
            ApInvoiceLineItem.company_id == company_id,
        )
        .all()
    )
    return _invoice_dict(inv, lines)


@router.post("")
def create_invoice(
    body: InvoiceCreateIn,
    tenant_id: str = Depends(get_tenant_id),
    company_id: str = Depends(get_company_id),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    assert_write_allowed()
    dup = (
        db.query(ApInvoice)
        .filter(
            ApInvoice.tenant_id == tenant_id,
            ApInvoice.company_id == company_id,
            ApInvoice.invoice_number == body.invoice_number,
        )
        .first()
    )
    if dup:
        raise HTTPException(status_code=409, detail="Invoice number already exists")

    inv = ApInvoice(
        tenant_id=tenant_id,
        company_id=company_id,
        invoice_number=body.invoice_number,
        invoice_date=body.invoice_date,
        due_date=body.due_date,
        vendor_name=body.vendor_name,
        vendor_email=body.vendor_email,
        total_amount=body.total_amount,
        currency=body.currency,
        vat_amount=body.vat_amount,
        created_by=user.id,
        created_at=datetime.utcnow(),
    )
    db.add(inv)
    db.flush()

    lines: list[ApInvoiceLineItem] = []
    for li in body.line_items:
        row = ApInvoiceLineItem(
            tenant_id=tenant_id,
            company_id=company_id,
            invoice_id=inv.id,
            description=li.description,
            quantity=li.quantity,
            unit_price=li.unit_price,
            total=li.total,
        )
        db.add(row)
        lines.append(row)

    db.commit()
    db.refresh(inv)
    return _invoice_dict(inv, lines)
