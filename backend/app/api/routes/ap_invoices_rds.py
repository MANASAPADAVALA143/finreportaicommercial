"""AP invoices — AWS RDS with strict tenant isolation."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
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
