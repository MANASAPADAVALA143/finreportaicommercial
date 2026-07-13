"""Client data tables — AWS RDS only (migrated from Supabase storage).

Every row is scoped by tenant_id + company_id for isolation.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON
from sqlalchemy.types import JSON

from app.core.database import Base

_json = JSON().with_variant(JSONB(), "postgresql").with_variant(SQLiteJSON(), "sqlite")


def _uuid() -> str:
    return str(uuid.uuid4())


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(String(256), nullable=False)
    plan = Column(String(32), nullable=False, default="starter")
    is_demo = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ApCompany(Base):
    """AP tenant company (maps to Supabase `companies`)."""

    __tablename__ = "ap_companies"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    name = Column(String(256), nullable=False)
    slug = Column(String(128), nullable=False)
    market = Column(String(16), default="uae")
    accounting_standard = Column(String(32), default="IFRS")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_ap_company_tenant_slug"),)


class ApInvoice(Base):
    __tablename__ = "invoices"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    invoice_number = Column(String(128), nullable=False)
    invoice_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=False)
    vendor_name = Column(String(256), nullable=False)
    vendor_email = Column(String(256), nullable=True)
    total_amount = Column(Numeric(15, 2), nullable=False)
    subtotal_amount = Column(Numeric(15, 2), default=0)
    currency = Column(String(8), default="AED")
    status = Column(String(32), default="Processing")
    tax_amount = Column(Numeric(15, 2), default=0)
    vat_amount = Column(Numeric(15, 2), nullable=True)
    vat_rate = Column(Numeric(5, 2), nullable=True)
    vat_treatment = Column(String(64), nullable=True)
    vendor_trn = Column(String(32), nullable=True)
    po_number = Column(String(64), nullable=True)
    file_url = Column(Text, nullable=True)
    risk_score = Column(Numeric(5, 2), nullable=True)
    risk_flags = Column(_json, default=list)
    gulftax_decision = Column(String(64), nullable=True)
    extra = Column(_json, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(String(36), nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "company_id", "invoice_number", name="uq_invoice_tenant_co_num"),
    )


class ApInvoiceLineItem(Base):
    __tablename__ = "invoice_line_items"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    invoice_id = Column(String(36), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    description = Column(Text, nullable=False)
    quantity = Column(Numeric(10, 2), nullable=False, default=1)
    unit_price = Column(Numeric(15, 2), nullable=False)
    total = Column(Numeric(15, 2), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ApVendor(Base):
    __tablename__ = "vendors"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    name = Column(String(256), nullable=False)
    email = Column(String(256), nullable=True)
    trn = Column(String(32), nullable=True)
    extra = Column(_json, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ApPurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    po_number = Column(String(64), nullable=False)
    vendor_name = Column(String(256), nullable=False)
    total_amount = Column(Numeric(15, 2), nullable=False, default=0)
    status = Column(String(32), default="open")
    extra = Column(_json, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ApGoodsReceipt(Base):
    __tablename__ = "goods_receipts"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    grn_number = Column(String(64), nullable=False)
    po_id = Column(String(36), nullable=True)
    status = Column(String(32), default="received")
    extra = Column(_json, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ApCompanyConfig(Base):
    __tablename__ = "company_config"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    config = Column(_json, nullable=False, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("tenant_id", "company_id", name="uq_company_config"),)


class GulftaxTransaction(Base):
    __tablename__ = "gulftax_transactions"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    source = Column(String(32), default="ap_invoiceflow")
    ap_invoice_id = Column(String(36), nullable=True, index=True)
    tax_period = Column(String(16), nullable=False)
    transaction_date = Column(Date, nullable=False)
    vendor_name = Column(String(256), nullable=True)
    vendor_trn = Column(String(32), nullable=True)
    invoice_number = Column(String(128), nullable=True)
    gross_amount = Column(Numeric(15, 2), nullable=False)
    vat_amount = Column(Numeric(15, 2), default=0)
    vat_category = Column(String(64), nullable=False)
    fta_box = Column(String(8), nullable=True)
    direction = Column(String(16), default="input")
    status = Column(String(16), default="posted")
    designated_zone = Column(Boolean, default=False)
    transaction_kind = Column(String(16), default="goods")
    dz_supplier_location = Column(String(64), nullable=True)
    dz_customer_location = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class VatReturnEntry(Base):
    __tablename__ = "vat_return_entries"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    period = Column(String(16), nullable=False)
    source = Column(String(32), nullable=True)
    transaction_id = Column(String(64), nullable=True)
    vendor_name = Column(String(256), nullable=True)
    net_amount = Column(Numeric(15, 2), nullable=True)
    vat_amount = Column(Numeric(15, 2), nullable=True)
    vat_treatment = Column(String(64), nullable=True)
    box_number = Column(Numeric(4, 0), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class PartialExemptionCalculation(Base):
    __tablename__ = "partial_exemption_calculations"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    period = Column(String(16), nullable=False)
    period_type = Column(String(16), default="quarterly")
    taxable_supplies = Column(Numeric(15, 2), nullable=False)
    exempt_supplies = Column(Numeric(15, 2), nullable=False)
    input_vat_paid = Column(Numeric(15, 2), nullable=False)
    recovery_pct = Column(Numeric(8, 4), nullable=False)
    recoverable_vat = Column(Numeric(15, 2), nullable=False)
    irrecoverable_vat = Column(Numeric(15, 2), nullable=False)
    breakdown = Column(_json, nullable=True)
    status = Column(String(32), default="draft")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class BadDebtReliefClaim(Base):
    __tablename__ = "bad_debt_relief_claims"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    invoice_number = Column(String(128), nullable=False)
    invoice_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=False)
    invoice_amount = Column(Numeric(15, 2), nullable=False)
    vat_amount = Column(Numeric(15, 2), nullable=False)
    status = Column(String(32), default="draft")
    eligible = Column(Boolean, default=False)
    eligibility_reason = Column(Text, nullable=True)
    claim_period = Column(String(16), nullable=True)
    extra = Column(_json, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DesignatedZoneTransaction(Base):
    __tablename__ = "designated_zone_transactions"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    supplier_location = Column(String(64), nullable=False)
    customer_location = Column(String(64), nullable=False)
    transaction_type = Column(String(64), nullable=False)
    vat_treatment = Column(String(64), nullable=False)
    vat_rate = Column(Numeric(5, 2), default=0)
    explanation = Column(Text, nullable=False)
    warning = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ApAuditLog(Base):
    __tablename__ = "ap_audit_logs"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    invoice_id = Column(String(36), nullable=True, index=True)
    action = Column(String(128), nullable=False)
    user_id = Column(String(36), nullable=True)
    details = Column(_json, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class CtReturn(Base):
    """UAE Corporate Tax return — RDS persistence (draft → approved → filed)."""

    __tablename__ = "gulftax_ct_returns"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    revenue = Column(Numeric(15, 2), nullable=True)
    accounting_profit = Column(Numeric(15, 2), nullable=True)
    non_deductible_expenses = Column(Numeric(15, 2), default=0)
    taxable_income = Column(Numeric(15, 2), nullable=True)
    ct_payable_aed = Column(Numeric(15, 2), nullable=True)
    sbr_eligible = Column(Boolean, default=False, nullable=False)
    qfzp_eligible = Column(Boolean, default=False, nullable=False)
    free_zone_status = Column(String(32), default="mainland")
    free_zone_income = Column(Numeric(15, 2), default=0)
    breakdown = Column(_json, nullable=True)
    status = Column(String(20), default="draft", nullable=False)
    override_reason = Column(Text, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    filed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class EinvoicingSubmission(Base):
    """Peppol PINT AE e-invoice submission — persisted on RDS."""

    __tablename__ = "einvoicing_submissions"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    invoice_id = Column(String(36), nullable=True, index=True)
    invoice_number = Column(String(128), nullable=False)
    # outbound_ar = our issued sales invoice; internal_vendor_record = vendor-received AP archive
    record_type = Column(String(32), default="outbound_ar", nullable=False, index=True)
    submission_status = Column(String(20), default="pending", nullable=False)
    xml_payload = Column(Text, nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    asp_reference = Column(String(128), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
