"""
UAE Complete Accounting System — DB Models
==========================================
All tables for the full UAE accounting suite.
Uses String(36) UUIDs for cross-DB compatibility.
"""
from __future__ import annotations

import enum
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

class UAEAccount(Base):
    __tablename__ = "uae_accounts"

    id          = Column(String(36), primary_key=True, default=_uuid)
    tenant_id   = Column(String(36), nullable=False, index=True)
    company_id  = Column(String(36), nullable=True, index=True)
    code        = Column(String(20), nullable=False)
    name        = Column(String(200), nullable=False)
    account_type = Column(String(50))   # Asset/Liability/Equity/Income/Expense
    sub_type    = Column(String(50))    # Current Asset / Fixed Asset / etc
    currency    = Column(String(3), default="AED")
    is_vat_applicable = Column(Boolean, default=False)
    vat_rate    = Column(Numeric(5, 2), default=0)
    ifrs_mapping = Column(String(100))
    is_active   = Column(Boolean, default=True)
    parent_id   = Column(String(36), ForeignKey("uae_accounts.id"), nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)

    children    = relationship("UAEAccount", back_populates="parent", lazy="dynamic")
    parent      = relationship("UAEAccount", back_populates="children", remote_side=[id])


# ══════════════════════════════════════════════════════════════════════════════
# JOURNAL ENTRIES
# ══════════════════════════════════════════════════════════════════════════════

class UAEJournalEntry(Base):
    __tablename__ = "uae_journal_entries"

    id           = Column(String(36), primary_key=True, default=_uuid)
    tenant_id    = Column(String(36), nullable=False, index=True)
    company_id   = Column(String(36), nullable=True, index=True)
    entry_number = Column(String(30))   # JE-2024-0001
    entry_date   = Column(Date, nullable=False)
    period       = Column(String(7))    # "2024-12"
    description  = Column(String(500))
    reference    = Column(String(100))
    source       = Column(String(50), default="manual")  # manual/invoiceflow/bank/accrual/accrual_reversal
    status       = Column(String(20), default="draft")   # draft/posted/reversed/scheduled/pending_approval/rejected
    is_recurring = Column(Boolean, default=False)
    posted_at    = Column(DateTime)
    approved_by  = Column(String(200), nullable=True)
    approved_at  = Column(DateTime, nullable=True)
    rejection_reason = Column(String(500), nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)

    lines = relationship("UAEJournalLine", back_populates="journal_entry", cascade="all, delete-orphan")


class UAEJournalLine(Base):
    __tablename__ = "uae_journal_lines"

    id               = Column(String(36), primary_key=True, default=_uuid)
    journal_entry_id = Column(String(36), ForeignKey("uae_journal_entries.id"), nullable=False)
    account_id       = Column(String(36), ForeignKey("uae_accounts.id"), nullable=True)
    account_code     = Column(String(20))
    account_name     = Column(String(200))
    description      = Column(String(300))
    debit            = Column(Numeric(15, 2), default=0)
    credit           = Column(Numeric(15, 2), default=0)
    vat_amount       = Column(Numeric(15, 2), default=0)
    cost_center      = Column(String(50))
    currency         = Column(String(3), default="AED")

    journal_entry = relationship("UAEJournalEntry", back_populates="lines")
    account       = relationship("UAEAccount")


# ══════════════════════════════════════════════════════════════════════════════
# AR — CUSTOMERS & SALES INVOICES
# ══════════════════════════════════════════════════════════════════════════════

class UAECustomer(Base):
    __tablename__ = "uae_customers"

    id                  = Column(String(36), primary_key=True, default=_uuid)
    tenant_id           = Column(String(64), nullable=False, index=True)
    name                = Column(String(200), nullable=False)
    trn                 = Column(String(20))   # UAE Tax Registration Number
    email               = Column(String(200))
    phone               = Column(String(30))
    address             = Column(Text)
    emirate             = Column(String(50))   # Dubai/Abu Dhabi/Sharjah/etc
    currency            = Column(String(3), default="AED")
    payment_terms_days  = Column(Integer, default=30)
    credit_limit        = Column(Numeric(15, 2))
    is_active           = Column(Boolean, default=True)
    created_at          = Column(DateTime, default=datetime.utcnow)

    invoices = relationship("UAESalesInvoice", back_populates="customer")


class UAESalesInvoice(Base):
    __tablename__ = "uae_sales_invoices"

    id              = Column(String(36), primary_key=True, default=_uuid)
    tenant_id       = Column(String(36), nullable=False, index=True)
    company_id      = Column(String(36), nullable=True, index=True)
    invoice_number  = Column(String(30))   # INV-2024-0001
    customer_id     = Column(String(36), ForeignKey("uae_customers.id"))
    invoice_date    = Column(Date)
    due_date        = Column(Date)
    period          = Column(String(7))
    subtotal        = Column(Numeric(15, 2), default=0)
    vat_amount      = Column(Numeric(15, 2), default=0)
    total_amount    = Column(Numeric(15, 2), default=0)
    paid_amount     = Column(Numeric(15, 2), default=0)
    outstanding     = Column(Numeric(15, 2), default=0)
    status          = Column(String(20), default="draft")  # draft/sent/partial/paid/overdue
    # UAE VAT mandatory fields
    seller_trn      = Column(String(20))
    buyer_trn       = Column(String(20))
    supply_type     = Column(String(30), default="standard")  # standard/zero-rated/exempt
    journal_entry_id = Column(String(36), ForeignKey("uae_journal_entries.id"), nullable=True)
    notes           = Column(Text)
    sent_at         = Column(DateTime, nullable=True)
    paid_date       = Column(Date, nullable=True)
    payment_reference = Column(String(100), nullable=True)
    overdue_notified_at = Column(DateTime, nullable=True)
    last_dunning_level = Column(Integer, default=0)
    last_dunning_sent_at = Column(DateTime, nullable=True)
    dunning_count = Column(Integer, default=0)
    recurring_template_id = Column(String(36), ForeignKey("uae_recurring_invoices.id"), nullable=True, index=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    customer = relationship("UAECustomer", back_populates="invoices")
    lines    = relationship("UAESalesInvoiceLine", back_populates="invoice", cascade="all, delete-orphan")
    credit_notes = relationship("UAECreditNote", back_populates="parent_invoice", foreign_keys="UAECreditNote.parent_invoice_id")
    recurring_template = relationship(
        "UAERecurringInvoice",
        back_populates="generated_invoices",
        foreign_keys=[recurring_template_id],
    )


class UAECreditNote(Base):
    __tablename__ = "uae_credit_notes"

    id                  = Column(String(36), primary_key=True, default=_uuid)
    tenant_id           = Column(String(36), nullable=False, index=True)
    company_id          = Column(String(36), nullable=True, index=True)
    customer_id         = Column(String(36), ForeignKey("uae_customers.id"), nullable=True)
    parent_invoice_id   = Column(String(36), ForeignKey("uae_sales_invoices.id"), nullable=False, index=True)
    credit_note_number  = Column(String(30), nullable=False)
    amount              = Column(Numeric(15, 2), nullable=False, default=0)
    reason              = Column(Text)
    status              = Column(String(20), default="draft")  # draft/issued/voided
    issued_date         = Column(Date, nullable=True)
    created_at          = Column(DateTime, default=datetime.utcnow)

    parent_invoice = relationship("UAESalesInvoice", back_populates="credit_notes", foreign_keys=[parent_invoice_id])
    customer = relationship("UAECustomer")


class UAESalesInvoiceLine(Base):
    __tablename__ = "uae_sales_invoice_lines"

    id          = Column(String(36), primary_key=True, default=_uuid)
    invoice_id  = Column(String(36), ForeignKey("uae_sales_invoices.id"), nullable=False)
    description = Column(String(300))
    quantity    = Column(Numeric(10, 3), default=1)
    unit_price  = Column(Numeric(15, 2), default=0)
    line_total  = Column(Numeric(15, 2), default=0)
    vat_rate    = Column(Numeric(5, 2), default=5)   # 5 or 0
    vat_amount  = Column(Numeric(15, 2), default=0)
    account_id  = Column(String(36), ForeignKey("uae_accounts.id"), nullable=True)

    invoice = relationship("UAESalesInvoice", back_populates="lines")


class UAERecurringInvoice(Base):
    __tablename__ = "uae_recurring_invoices"

    id                  = Column(String(36), primary_key=True, default=_uuid)
    tenant_id           = Column(String(36), nullable=False, index=True)
    company_id          = Column(String(36), nullable=True, index=True)
    customer_id         = Column(String(36), ForeignKey("uae_customers.id"), nullable=False)
    description         = Column(String(500), nullable=False)
    amount              = Column(Numeric(15, 2), nullable=False)
    vat_rate            = Column(Numeric(5, 2), default=5)
    recurrence_type     = Column(String(20), nullable=False)  # weekly/monthly/quarterly/annually
    interval            = Column(Integer, default=1)
    start_date          = Column(Date, nullable=False)
    next_due_date       = Column(Date, nullable=False)
    end_date            = Column(Date, nullable=True)
    status              = Column(String(20), default="active")  # active/paused/cancelled
    last_generated_at   = Column(DateTime, nullable=True)
    generated_count     = Column(Integer, default=0)
    created_at          = Column(DateTime, default=datetime.utcnow)

    customer = relationship("UAECustomer")
    generated_invoices = relationship(
        "UAESalesInvoice",
        back_populates="recurring_template",
        foreign_keys="UAESalesInvoice.recurring_template_id",
    )


# ══════════════════════════════════════════════════════════════════════════════
# BANK RECONCILIATION
# ══════════════════════════════════════════════════════════════════════════════

class UAEBankAccount(Base):
    __tablename__ = "uae_bank_accounts"

    id                      = Column(String(36), primary_key=True, default=_uuid)
    tenant_id               = Column(String(36), nullable=False, index=True)
    company_id              = Column(String(36), nullable=True, index=True)
    bank_name               = Column(String(100))  # ENBD/FAB/ADCB/RAKBank/DIB
    account_number          = Column(String(30))
    iban                    = Column(String(35))
    currency                = Column(String(3), default="AED")
    gl_account_id           = Column(String(36), ForeignKey("uae_accounts.id"), nullable=True)
    last_reconciled_date    = Column(Date)
    last_reconciled_balance = Column(Numeric(15, 2))
    is_active               = Column(Boolean, default=True)
    created_at              = Column(DateTime, default=datetime.utcnow)

    statements = relationship("UAEBankStatement", back_populates="bank_account")


class UAEBankStatement(Base):
    __tablename__ = "uae_bank_statements"

    id              = Column(String(36), primary_key=True, default=_uuid)
    tenant_id       = Column(String(64), nullable=False, index=True)
    bank_account_id = Column(String(36), ForeignKey("uae_bank_accounts.id"))
    statement_date  = Column(Date)
    opening_balance = Column(Numeric(15, 2), default=0)
    closing_balance = Column(Numeric(15, 2), default=0)
    uploaded_at     = Column(DateTime, default=datetime.utcnow)
    status          = Column(String(20), default="pending")  # pending/in_progress/reconciled

    bank_account = relationship("UAEBankAccount", back_populates="statements")
    lines        = relationship("UAEBankStatementLine", back_populates="statement", cascade="all, delete-orphan")


class UAEBankStatementLine(Base):
    __tablename__ = "uae_bank_statement_lines"

    id                      = Column(String(36), primary_key=True, default=_uuid)
    statement_id            = Column(String(36), ForeignKey("uae_bank_statements.id"), nullable=False)
    transaction_date        = Column(Date)
    value_date              = Column(Date)
    description             = Column(String(500))
    reference               = Column(String(100))
    debit                   = Column(Numeric(15, 2), default=0)
    credit                  = Column(Numeric(15, 2), default=0)
    balance                 = Column(Numeric(15, 2))
    matched_journal_line_id = Column(String(36), ForeignKey("uae_journal_lines.id"), nullable=True)
    match_status            = Column(String(20), default="unmatched")  # matched/unmatched/suggested
    match_confidence        = Column(Numeric(5, 2))
    ai_suggested_account    = Column(String(200))
    ai_narration            = Column(String(500))

    statement = relationship("UAEBankStatement", back_populates="lines")


# ══════════════════════════════════════════════════════════════════════════════
# FIXED ASSETS
# ══════════════════════════════════════════════════════════════════════════════

class UAEFixedAsset(Base):
    __tablename__ = "uae_fixed_assets"

    id                      = Column(String(36), primary_key=True, default=_uuid)
    tenant_id               = Column(String(36), nullable=False, index=True)
    company_id              = Column(String(36), nullable=True, index=True)
    asset_code              = Column(String(20))   # FA-2024-001
    name                    = Column(String(200))
    category                = Column(String(100))  # Computer/Vehicle/Furniture/Machinery/Building
    purchase_date           = Column(Date)
    purchase_cost           = Column(Numeric(15, 2), default=0)
    residual_value          = Column(Numeric(15, 2), default=0)
    useful_life_years       = Column(Integer, default=5)
    depreciation_method     = Column(String(30), default="straight_line")
    accumulated_depreciation = Column(Numeric(15, 2), default=0)
    net_book_value          = Column(Numeric(15, 2), default=0)
    # UAE CT depreciation (Ministerial Decision 134 of 2023)
    ct_depreciation_rate    = Column(Numeric(5, 2), default=20)  # % per year
    ct_accumulated_depreciation = Column(Numeric(15, 2), default=0)
    location                = Column(String(100))
    status                  = Column(String(20), default="active")  # active/disposed/impaired
    gl_account_id           = Column(String(36), ForeignKey("uae_accounts.id"), nullable=True)
    disposal_date           = Column(Date)
    disposal_proceeds       = Column(Numeric(15, 2))
    created_at              = Column(DateTime, default=datetime.utcnow)


# ══════════════════════════════════════════════════════════════════════════════
# ACCRUALS
# ══════════════════════════════════════════════════════════════════════════════

class UAEAccrual(Base):
    __tablename__ = "uae_accruals"

    id                  = Column(String(36), primary_key=True, default=_uuid)
    tenant_id           = Column(String(64), nullable=False, index=True)
    description         = Column(String(300))
    accrual_type        = Column(String(50))  # rent/salary/utility/professional_fee/eosb/other
    amount              = Column(Numeric(15, 2), default=0)
    period              = Column(String(7))         # "2024-12"
    reversal_period     = Column(String(7), nullable=True)  # "2025-01"
    debit_account_code  = Column(String(20))
    credit_account_code = Column(String(20))
    journal_entry_id    = Column(String(36), ForeignKey("uae_journal_entries.id"), nullable=True)
    reversal_journal_id = Column(String(36), ForeignKey("uae_journal_entries.id"), nullable=True)
    status              = Column(String(20), default="suggested")  # suggested/posted/reversed/rejected
    ai_suggested        = Column(Boolean, default=False)
    ai_basis            = Column(String(300))   # AI reasoning
    ai_confidence       = Column(Numeric(5, 2))
    mandatory           = Column(Boolean, default=False)  # EOSB is mandatory
    source_document     = Column(String(200))
    created_at          = Column(DateTime, default=datetime.utcnow)


# ══════════════════════════════════════════════════════════════════════════════
# PERIOD-END CLOSE
# ══════════════════════════════════════════════════════════════════════════════

class UAEPeriodClose(Base):
    __tablename__ = "uae_period_closes"

    id              = Column(String(36), primary_key=True, default=_uuid)
    tenant_id       = Column(String(64), nullable=False, index=True)
    period          = Column(String(7))   # "2024-12"
    status          = Column(String(20), default="open")  # open/in_progress/closed
    # 9-item checklist
    tb_reconciled           = Column(Boolean, default=False)
    bank_recon_done         = Column(Boolean, default=False)
    accruals_posted         = Column(Boolean, default=False)
    fixed_assets_depreciated = Column(Boolean, default=False)
    vat_reconciled          = Column(Boolean, default=False)
    ar_reviewed             = Column(Boolean, default=False)
    ap_reviewed             = Column(Boolean, default=False)
    ifrs_statements_generated = Column(Boolean, default=False)
    management_accounts_done = Column(Boolean, default=False)
    # 13-item checklist (added FX + intercompany + IFRS + audit trail)
    multi_currency_revaluation = Column(Boolean, default=False)
    intercompany_balances_reconciled = Column(Boolean, default=False)
    ifrs_adjustments_posted = Column(Boolean, default=False)
    audit_trail_exported = Column(Boolean, default=False)
    closed_at               = Column(DateTime)
    created_at              = Column(DateTime, default=datetime.utcnow)
