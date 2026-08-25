"""UAE AP — Vendors and Purchase Invoices."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class UAEVendor(Base):
    __tablename__ = "uae_vendors"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(64), nullable=False, index=True)
    workspace_id = Column(String(36), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    trn = Column(String(20))
    email = Column(String(200))
    phone = Column(String(30))
    address = Column(Text)
    emirate = Column(String(50))
    currency = Column(String(3), default="AED")
    payment_terms_days = Column(Integer, default=30)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    invoices = relationship("UAEPurchaseInvoice", back_populates="vendor")


class UAEPurchaseInvoice(Base):
    __tablename__ = "uae_purchase_invoices"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(64), nullable=False, index=True)
    workspace_id = Column(String(36), nullable=True, index=True)
    company_id = Column(String(36), ForeignKey("ap_companies.id"), nullable=True, index=True)
    invoice_number = Column(String(50), nullable=False)
    vendor_id = Column(String(36), ForeignKey("uae_vendors.id"), nullable=False)
    invoice_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=False)
    subtotal = Column(Numeric(15, 2), default=0)
    vat_amount = Column(Numeric(15, 2), default=0)
    total_amount = Column(Numeric(15, 2), default=0)
    outstanding = Column(Numeric(15, 2), default=0)
    status = Column(String(20), default="draft")  # draft/approved/posted/paid
    vat_treatment = Column(String(30), default="standard_rated")
    journal_entry_id = Column(String(36), ForeignKey("uae_journal_entries.id"), nullable=True)
    source = Column(String(30), default="manual")  # manual/ocr/ap_upload
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    vendor = relationship("UAEVendor", back_populates="invoices")
    lines = relationship("UAEPurchaseInvoiceLine", back_populates="invoice", cascade="all, delete-orphan")


class UAEPurchaseInvoiceLine(Base):
    __tablename__ = "uae_purchase_invoice_lines"

    id = Column(String(36), primary_key=True, default=_uuid)
    invoice_id = Column(String(36), ForeignKey("uae_purchase_invoices.id"), nullable=False)
    description = Column(String(300), nullable=False)
    quantity = Column(Numeric(10, 3), default=1)
    unit_price = Column(Numeric(15, 2), nullable=False)
    line_total = Column(Numeric(15, 2), default=0)
    vat_rate = Column(Numeric(5, 2), default=5)
    vat_amount = Column(Numeric(15, 2), default=0)
    account_code = Column(String(20))

    invoice = relationship("UAEPurchaseInvoice", back_populates="lines")
