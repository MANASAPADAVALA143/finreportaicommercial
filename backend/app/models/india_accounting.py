"""
India Complete Accounting System — DB Models
============================================
GST (CGST/SGST/IGST), TDS, Payroll (PF/ESI/PT), Ind AS Fixed Assets,
GSTR-1 / GSTR-3B, Period-End Close.
Uses String(36) UUIDs for cross-DB compatibility.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey,
    Integer, Numeric, String, Text,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


# ══════════════════════════════════════════════════════════════════════════════
# CHART OF ACCOUNTS
# ══════════════════════════════════════════════════════════════════════════════

class IndiaAccount(Base):
    __tablename__ = "india_accounts"

    id             = Column(String(36), primary_key=True, default=_uuid)
    tenant_id      = Column(String(100), nullable=False, index=True)
    code           = Column(String(20), nullable=False)
    name           = Column(String(200), nullable=False)
    account_type   = Column(String(50), nullable=False)   # Asset/Liability/Equity/Revenue/Expense
    sub_type       = Column(String(80))
    parent_code    = Column(String(20))
    currency       = Column(String(3), default="INR")
    is_gst         = Column(Boolean, default=False)       # GST input/output account
    gst_type       = Column(String(20))                   # cgst/sgst/igst/cess
    is_tds         = Column(Boolean, default=False)
    is_active      = Column(Boolean, default=True)
    created_at     = Column(DateTime, default=datetime.utcnow)


# ══════════════════════════════════════════════════════════════════════════════
# JOURNAL ENTRIES
# ══════════════════════════════════════════════════════════════════════════════

class IndiaJournalEntry(Base):
    __tablename__ = "india_journal_entries"

    id             = Column(String(36), primary_key=True, default=_uuid)
    tenant_id      = Column(String(100), nullable=False, index=True)
    entry_date     = Column(Date, nullable=False)
    period         = Column(String(7), nullable=False)    # YYYY-MM
    description    = Column(String(500), nullable=False)
    reference      = Column(String(100))
    source         = Column(String(50), default="manual") # manual/gst/tds/payroll/asset
    status         = Column(String(20), default="draft")  # draft/posted
    total_debit    = Column(Numeric(18, 2), default=0)
    narration      = Column(Text)
    created_at     = Column(DateTime, default=datetime.utcnow)
    posted_at      = Column(DateTime)

    lines = relationship("IndiaJournalLine", back_populates="entry", cascade="all, delete-orphan")


class IndiaJournalLine(Base):
    __tablename__ = "india_journal_lines"

    id             = Column(String(36), primary_key=True, default=_uuid)
    entry_id       = Column(String(36), ForeignKey("india_journal_entries.id"), nullable=False)
    account_code   = Column(String(20), nullable=False)
    description    = Column(String(300))
    debit          = Column(Numeric(18, 2), default=0)
    credit         = Column(Numeric(18, 2), default=0)

    entry = relationship("IndiaJournalEntry", back_populates="lines")


# ══════════════════════════════════════════════════════════════════════════════
# CUSTOMERS
# ══════════════════════════════════════════════════════════════════════════════

class IndiaCustomer(Base):
    __tablename__ = "india_customers"

    id               = Column(String(36), primary_key=True, default=_uuid)
    tenant_id        = Column(String(100), nullable=False, index=True)
    name             = Column(String(200), nullable=False)
    gstin            = Column(String(15))                # 15-digit GST number
    pan              = Column(String(10))                # 10-char PAN
    email            = Column(String(200))
    phone            = Column(String(20))
    state_code       = Column(String(2))                 # 2-digit state code for IGST determination
    state_name       = Column(String(100))
    credit_limit     = Column(Numeric(18, 2), default=0)
    payment_terms_days = Column(Integer, default=30)
    is_active        = Column(Boolean, default=True)
    created_at       = Column(DateTime, default=datetime.utcnow)


# ══════════════════════════════════════════════════════════════════════════════
# VENDORS
# ══════════════════════════════════════════════════════════════════════════════

class IndiaVendor(Base):
    __tablename__ = "india_vendors"

    id               = Column(String(36), primary_key=True, default=_uuid)
    tenant_id        = Column(String(100), nullable=False, index=True)
    name             = Column(String(200), nullable=False)
    gstin            = Column(String(15))
    pan              = Column(String(10))
    email            = Column(String(200))
    phone            = Column(String(20))
    state_code       = Column(String(2))
    state_name       = Column(String(100))
    tds_applicable   = Column(Boolean, default=False)
    tds_section      = Column(String(10))               # 194C/194J/194I etc.
    payment_terms_days = Column(Integer, default=30)
    is_active        = Column(Boolean, default=True)
    created_at       = Column(DateTime, default=datetime.utcnow)


# ══════════════════════════════════════════════════════════════════════════════
# SALES INVOICES (GST)
# ══════════════════════════════════════════════════════════════════════════════

class IndiaSalesInvoice(Base):
    __tablename__ = "india_sales_invoices"

    id               = Column(String(36), primary_key=True, default=_uuid)
    tenant_id        = Column(String(100), nullable=False, index=True)
    invoice_number   = Column(String(50), nullable=False)
    customer_id      = Column(String(36), ForeignKey("india_customers.id"), nullable=False)
    invoice_date     = Column(Date, nullable=False)
    due_date         = Column(Date, nullable=False)
    supply_type      = Column(String(20), default="intra")  # intra/inter
    place_of_supply  = Column(String(2))                    # state code
    subtotal         = Column(Numeric(18, 2), default=0)
    cgst_amount      = Column(Numeric(18, 2), default=0)
    sgst_amount      = Column(Numeric(18, 2), default=0)
    igst_amount      = Column(Numeric(18, 2), default=0)
    cess_amount      = Column(Numeric(18, 2), default=0)
    total_amount     = Column(Numeric(18, 2), default=0)
    outstanding      = Column(Numeric(18, 2), default=0)
    status           = Column(String(20), default="draft")  # draft/posted/paid/cancelled
    journal_entry_id = Column(String(36), ForeignKey("india_journal_entries.id"))
    e_invoice_irn    = Column(String(100))                  # IRN for e-invoice
    created_at       = Column(DateTime, default=datetime.utcnow)

    lines    = relationship("IndiaSalesInvoiceLine", back_populates="invoice", cascade="all, delete-orphan")
    customer = relationship("IndiaCustomer")


class IndiaSalesInvoiceLine(Base):
    __tablename__ = "india_sales_invoice_lines"

    id           = Column(String(36), primary_key=True, default=_uuid)
    invoice_id   = Column(String(36), ForeignKey("india_sales_invoices.id"), nullable=False)
    description  = Column(String(300), nullable=False)
    hsn_sac      = Column(String(8))                    # HSN code (goods) / SAC (services)
    quantity     = Column(Numeric(12, 3), default=1)
    unit_price   = Column(Numeric(18, 2), nullable=False)
    gst_rate     = Column(Numeric(5, 2), default=18)    # 0/5/12/18/28
    line_subtotal = Column(Numeric(18, 2), default=0)
    line_cgst    = Column(Numeric(18, 2), default=0)
    line_sgst    = Column(Numeric(18, 2), default=0)
    line_igst    = Column(Numeric(18, 2), default=0)
    line_total   = Column(Numeric(18, 2), default=0)

    invoice = relationship("IndiaSalesInvoice", back_populates="lines")


# ══════════════════════════════════════════════════════════════════════════════
# PURCHASE INVOICES (GST ITC)
# ══════════════════════════════════════════════════════════════════════════════

class IndiaPurchaseInvoice(Base):
    __tablename__ = "india_purchase_invoices"

    id               = Column(String(36), primary_key=True, default=_uuid)
    tenant_id        = Column(String(100), nullable=False, index=True)
    invoice_number   = Column(String(50), nullable=False)
    vendor_id        = Column(String(36), ForeignKey("india_vendors.id"), nullable=False)
    invoice_date     = Column(Date, nullable=False)
    due_date         = Column(Date, nullable=False)
    supply_type      = Column(String(20), default="intra")
    subtotal         = Column(Numeric(18, 2), default=0)
    cgst_amount      = Column(Numeric(18, 2), default=0)
    sgst_amount      = Column(Numeric(18, 2), default=0)
    igst_amount      = Column(Numeric(18, 2), default=0)
    total_amount     = Column(Numeric(18, 2), default=0)
    itc_eligible     = Column(Boolean, default=True)     # Input Tax Credit eligibility
    itc_claimed      = Column(Numeric(18, 2), default=0)
    tds_deducted     = Column(Numeric(18, 2), default=0)
    tds_section      = Column(String(10))
    outstanding      = Column(Numeric(18, 2), default=0)
    status           = Column(String(20), default="draft")
    journal_entry_id = Column(String(36), ForeignKey("india_journal_entries.id"))
    created_at       = Column(DateTime, default=datetime.utcnow)

    lines  = relationship("IndiaPurchaseInvoiceLine", back_populates="invoice", cascade="all, delete-orphan")
    vendor = relationship("IndiaVendor")


class IndiaPurchaseInvoiceLine(Base):
    __tablename__ = "india_purchase_invoice_lines"

    id            = Column(String(36), primary_key=True, default=_uuid)
    invoice_id    = Column(String(36), ForeignKey("india_purchase_invoices.id"), nullable=False)
    description   = Column(String(300), nullable=False)
    hsn_sac       = Column(String(8))
    quantity      = Column(Numeric(12, 3), default=1)
    unit_price    = Column(Numeric(18, 2), nullable=False)
    gst_rate      = Column(Numeric(5, 2), default=18)
    line_subtotal = Column(Numeric(18, 2), default=0)
    line_cgst     = Column(Numeric(18, 2), default=0)
    line_sgst     = Column(Numeric(18, 2), default=0)
    line_igst     = Column(Numeric(18, 2), default=0)
    line_total    = Column(Numeric(18, 2), default=0)
    itc_eligible  = Column(Boolean, default=True)

    invoice = relationship("IndiaPurchaseInvoice", back_populates="lines")


# ══════════════════════════════════════════════════════════════════════════════
# TDS (TAX DEDUCTED AT SOURCE)
# ══════════════════════════════════════════════════════════════════════════════

class IndiaTDSEntry(Base):
    __tablename__ = "india_tds_entries"

    id              = Column(String(36), primary_key=True, default=_uuid)
    tenant_id       = Column(String(100), nullable=False, index=True)
    period          = Column(String(7), nullable=False)    # YYYY-MM
    vendor_id       = Column(String(36), ForeignKey("india_vendors.id"))
    deductee_name   = Column(String(200), nullable=False)
    deductee_pan    = Column(String(10))
    section         = Column(String(10), nullable=False)   # 194A/194C/194H/194I/194J/194Q
    nature          = Column(String(100))                  # description of payment
    payment_amount  = Column(Numeric(18, 2), nullable=False)
    tds_rate        = Column(Numeric(5, 2), nullable=False)
    tds_amount      = Column(Numeric(18, 2), nullable=False)
    surcharge       = Column(Numeric(18, 2), default=0)
    health_edu_cess = Column(Numeric(18, 2), default=0)
    net_tds         = Column(Numeric(18, 2), nullable=False)
    deposit_date    = Column(Date)
    challan_number  = Column(String(50))
    status          = Column(String(20), default="deducted")  # deducted/deposited/certificate_issued
    journal_entry_id = Column(String(36), ForeignKey("india_journal_entries.id"))
    created_at      = Column(DateTime, default=datetime.utcnow)


class IndiaTDSCertificate(Base):
    __tablename__ = "india_tds_certificates"

    id              = Column(String(36), primary_key=True, default=_uuid)
    tenant_id       = Column(String(100), nullable=False, index=True)
    certificate_no  = Column(String(50), nullable=False)
    financial_year  = Column(String(7), nullable=False)    # e.g. 2024-25
    quarter         = Column(String(2), nullable=False)    # Q1/Q2/Q3/Q4
    vendor_id       = Column(String(36), ForeignKey("india_vendors.id"))
    deductee_name   = Column(String(200), nullable=False)
    deductee_pan    = Column(String(10))
    section         = Column(String(10), nullable=False)
    total_payment   = Column(Numeric(18, 2), default=0)
    total_tds       = Column(Numeric(18, 2), default=0)
    issued_date     = Column(Date)
    created_at      = Column(DateTime, default=datetime.utcnow)


# ══════════════════════════════════════════════════════════════════════════════
# GST RETURNS
# ══════════════════════════════════════════════════════════════════════════════

class IndiaGSTReturn(Base):
    __tablename__ = "india_gst_returns"

    id               = Column(String(36), primary_key=True, default=_uuid)
    tenant_id        = Column(String(100), nullable=False, index=True)
    return_type      = Column(String(10), nullable=False)  # GSTR1/GSTR3B/GSTR2A
    period           = Column(String(7), nullable=False)   # YYYY-MM
    financial_year   = Column(String(7))                   # 2024-25
    gstin            = Column(String(15))
    # GSTR-1 / outward supplies
    b2b_taxable      = Column(Numeric(18, 2), default=0)
    b2c_taxable      = Column(Numeric(18, 2), default=0)
    total_taxable    = Column(Numeric(18, 2), default=0)
    total_cgst       = Column(Numeric(18, 2), default=0)
    total_sgst       = Column(Numeric(18, 2), default=0)
    total_igst       = Column(Numeric(18, 2), default=0)
    total_cess       = Column(Numeric(18, 2), default=0)
    total_tax        = Column(Numeric(18, 2), default=0)
    # GSTR-3B / net liability
    itc_cgst         = Column(Numeric(18, 2), default=0)
    itc_sgst         = Column(Numeric(18, 2), default=0)
    itc_igst         = Column(Numeric(18, 2), default=0)
    net_cgst_payable = Column(Numeric(18, 2), default=0)
    net_sgst_payable = Column(Numeric(18, 2), default=0)
    net_igst_payable = Column(Numeric(18, 2), default=0)
    total_payable    = Column(Numeric(18, 2), default=0)
    status           = Column(String(20), default="draft")  # draft/filed/amended
    filed_at         = Column(DateTime)
    arn              = Column(String(50))                   # Acknowledgement Reference Number
    ai_summary       = Column(Text)
    created_at       = Column(DateTime, default=datetime.utcnow)


# ══════════════════════════════════════════════════════════════════════════════
# PAYROLL
# ══════════════════════════════════════════════════════════════════════════════

class IndiaEmployee(Base):
    __tablename__ = "india_employees"

    id                 = Column(String(36), primary_key=True, default=_uuid)
    tenant_id          = Column(String(100), nullable=False, index=True)
    employee_code      = Column(String(20), nullable=False)
    name               = Column(String(200), nullable=False)
    pan                = Column(String(10))
    uan                = Column(String(12))                # UAN for PF
    esi_number         = Column(String(20))
    department         = Column(String(100))
    designation        = Column(String(100))
    date_of_joining    = Column(Date)
    basic_salary       = Column(Numeric(18, 2), default=0)
    hra                = Column(Numeric(18, 2), default=0)
    special_allowance  = Column(Numeric(18, 2), default=0)
    gross_salary       = Column(Numeric(18, 2), default=0)
    pf_applicable      = Column(Boolean, default=True)
    esi_applicable     = Column(Boolean, default=False)    # only if gross <= 21000
    pt_applicable      = Column(Boolean, default=True)     # Professional Tax
    pt_state           = Column(String(50))                # state for PT slabs
    status             = Column(String(20), default="active")
    created_at         = Column(DateTime, default=datetime.utcnow)


class IndiaPayrollRun(Base):
    __tablename__ = "india_payroll_runs"

    id                 = Column(String(36), primary_key=True, default=_uuid)
    tenant_id          = Column(String(100), nullable=False, index=True)
    period             = Column(String(7), nullable=False)  # YYYY-MM
    total_employees    = Column(Integer, default=0)
    total_gross        = Column(Numeric(18, 2), default=0)
    total_basic        = Column(Numeric(18, 2), default=0)
    total_pf_employee  = Column(Numeric(18, 2), default=0)
    total_pf_employer  = Column(Numeric(18, 2), default=0)
    total_esi_employee = Column(Numeric(18, 2), default=0)
    total_esi_employer = Column(Numeric(18, 2), default=0)
    total_pt           = Column(Numeric(18, 2), default=0)
    total_tds          = Column(Numeric(18, 2), default=0)
    total_net_pay      = Column(Numeric(18, 2), default=0)
    total_gratuity_provision = Column(Numeric(18, 2), default=0)
    status             = Column(String(20), default="draft")
    journal_entry_id   = Column(String(36), ForeignKey("india_journal_entries.id"))
    created_at         = Column(DateTime, default=datetime.utcnow)

    slips = relationship("IndiaPayslip", back_populates="run", cascade="all, delete-orphan")


class IndiaPayslip(Base):
    __tablename__ = "india_payslips"

    id                 = Column(String(36), primary_key=True, default=_uuid)
    run_id             = Column(String(36), ForeignKey("india_payroll_runs.id"), nullable=False)
    employee_id        = Column(String(36), ForeignKey("india_employees.id"), nullable=False)
    basic              = Column(Numeric(18, 2), default=0)
    hra                = Column(Numeric(18, 2), default=0)
    special_allowance  = Column(Numeric(18, 2), default=0)
    gross              = Column(Numeric(18, 2), default=0)
    pf_employee        = Column(Numeric(18, 2), default=0)   # 12% of basic
    pf_employer        = Column(Numeric(18, 2), default=0)   # 12% of basic
    esi_employee       = Column(Numeric(18, 2), default=0)   # 0.75% of gross
    esi_employer       = Column(Numeric(18, 2), default=0)   # 3.25% of gross
    professional_tax   = Column(Numeric(18, 2), default=0)
    tds_month          = Column(Numeric(18, 2), default=0)
    total_deductions   = Column(Numeric(18, 2), default=0)
    net_pay            = Column(Numeric(18, 2), default=0)
    gratuity_provision = Column(Numeric(18, 2), default=0)   # 4.81% of basic

    run      = relationship("IndiaPayrollRun", back_populates="slips")
    employee = relationship("IndiaEmployee")


# ══════════════════════════════════════════════════════════════════════════════
# FIXED ASSETS (Ind AS 16)
# ══════════════════════════════════════════════════════════════════════════════

class IndiaFixedAsset(Base):
    __tablename__ = "india_fixed_assets"

    id                       = Column(String(36), primary_key=True, default=_uuid)
    tenant_id                = Column(String(100), nullable=False, index=True)
    asset_code               = Column(String(20), nullable=False)
    name                     = Column(String(200), nullable=False)
    category                 = Column(String(50), nullable=False)  # Computer/Vehicle/Building/Plant/Furniture
    purchase_date            = Column(Date, nullable=False)
    purchase_cost            = Column(Numeric(18, 2), nullable=False)
    residual_value           = Column(Numeric(18, 2), default=0)
    useful_life_years        = Column(Integer, default=5)
    depreciation_method      = Column(String(20), default="SLM")  # SLM/WDV
    wdv_rate                 = Column(Numeric(5, 2))               # WDV % per Companies Act
    accumulated_depreciation = Column(Numeric(18, 2), default=0)
    net_book_value           = Column(Numeric(18, 2), default=0)
    status                   = Column(String(20), default="active")
    created_at               = Column(DateTime, default=datetime.utcnow)


# ══════════════════════════════════════════════════════════════════════════════
# PERIOD-END CLOSE
# ══════════════════════════════════════════════════════════════════════════════

class IndiaPeriodClose(Base):
    __tablename__ = "india_period_close"

    id                        = Column(String(36), primary_key=True, default=_uuid)
    tenant_id                 = Column(String(100), nullable=False, index=True)
    period                    = Column(String(7), nullable=False)   # YYYY-MM
    status                    = Column(String(20), default="open")  # open/in_progress/closed
    # Checklist booleans
    gstr1_filed               = Column(Boolean, default=False)
    gstr3b_filed              = Column(Boolean, default=False)
    tds_deposited             = Column(Boolean, default=False)
    payroll_posted            = Column(Boolean, default=False)
    fixed_assets_depreciated  = Column(Boolean, default=False)
    bank_recon_done           = Column(Boolean, default=False)
    ar_reviewed               = Column(Boolean, default=False)
    ap_reviewed               = Column(Boolean, default=False)
    itc_reconciled            = Column(Boolean, default=False)
    tb_reconciled             = Column(Boolean, default=False)
    # Metadata
    closed_at                 = Column(DateTime)
    created_at                = Column(DateTime, default=datetime.utcnow)
