"""
Enterprise bank reconciliation — SQLAlchemy models.
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON

from app.core.database import Base


class ReconWorkspaceType(str, enum.Enum):
    bank_to_gl = "bank_to_gl"
    gl_to_subledger = "gl_to_subledger"
    three_way = "three_way"
    intercompany = "intercompany"


class ReconWorkspaceStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    pending_review = "pending_review"
    approved = "approved"
    locked = "locked"


class DebitCredit(str, enum.Enum):
    D = "D"
    C = "C"


class BookTxnStatus(str, enum.Enum):
    unmatched = "unmatched"
    matched = "matched"
    manually_matched = "manually_matched"
    exception = "exception"
    in_transit = "in_transit"
    disputed = "disputed"


class BankTxnStatus(str, enum.Enum):
    unmatched = "unmatched"
    matched = "matched"
    manually_matched = "manually_matched"
    exception = "exception"
    disputed = "disputed"


class MatchTypeEnum(str, enum.Enum):
    exact = "exact"
    amount_date = "amount_date"
    fuzzy = "fuzzy"
    one_to_many = "one_to_many"
    many_to_one = "many_to_one"
    ai_suggested = "ai_suggested"
    manual = "manual"


class MatchGroupStatus(str, enum.Enum):
    auto_confirmed = "auto_confirmed"
    pending_review = "pending_review"
    disputed = "disputed"
    confirmed = "confirmed"
    rejected = "rejected"


class AdjustmentType(str, enum.Enum):
    bank_error = "bank_error"
    book_error = "book_error"
    timing_deposit_in_transit = "timing_deposit_in_transit"
    timing_outstanding_cheque = "timing_outstanding_cheque"
    bank_charges = "bank_charges"
    interest_income = "interest_income"
    nsf_cheque = "nsf_cheque"
    direct_debit = "direct_debit"
    other = "other"


class AffectsSide(str, enum.Enum):
    bank = "bank"
    book = "book"
    both = "both"


class ReconExceptionType(str, enum.Enum):
    unmatched_bank = "unmatched_bank"
    unmatched_gl = "unmatched_gl"
    amount_mismatch = "amount_mismatch"
    duplicate_detected = "duplicate_detected"
    timing_over_30_days = "timing_over_30_days"
    disputed_transaction = "disputed_transaction"
    missing_documentation = "missing_documentation"


class ExceptionSeverity(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class ReconAuditAction(str, enum.Enum):
    workspace_created = "workspace_created"
    file_uploaded = "file_uploaded"
    auto_match_run = "auto_match_run"
    match_confirmed = "match_confirmed"
    match_rejected = "match_rejected"
    manual_match_created = "manual_match_created"
    adjustment_added = "adjustment_added"
    exception_raised = "exception_raised"
    exception_resolved = "exception_resolved"
    preparer_signoff = "preparer_signoff"
    reviewer_signoff = "reviewer_signoff"
    workspace_locked = "workspace_locked"


def _enum_str(e: type[enum.Enum]) -> SAEnum:
    return SAEnum(e, values_callable=lambda x: [i.value for i in x], native_enum=False)


_json_type = JSON().with_variant(SQLiteJSON(), "sqlite")


class ReconWorkspace(Base):
    __tablename__ = "recon_workspaces"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    workspace_name = Column(String(512), nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    recon_type = Column(_enum_str(ReconWorkspaceType), nullable=False, default=ReconWorkspaceType.bank_to_gl)
    currency = Column(String(8), nullable=False, default="USD")
    status = Column(_enum_str(ReconWorkspaceStatus), nullable=False, default=ReconWorkspaceStatus.open)

    assigned_preparer_id = Column(String(256), nullable=True)
    assigned_reviewer_id = Column(String(256), nullable=True)
    due_date = Column(Date, nullable=True)
    completed_date = Column(Date, nullable=True)
    sign_off_preparer = Column(Boolean, nullable=False, default=False)
    sign_off_reviewer = Column(Boolean, nullable=False, default=False)

    total_book_balance = Column(Numeric(18, 4), nullable=True)
    total_bank_balance = Column(Numeric(18, 4), nullable=True)
    outstanding_deposits = Column(Numeric(18, 4), nullable=False, default=0)
    outstanding_cheques = Column(Numeric(18, 4), nullable=False, default=0)
    adjusted_book_balance = Column(Numeric(18, 4), nullable=True)
    adjusted_bank_balance = Column(Numeric(18, 4), nullable=True)
    variance = Column(Numeric(18, 4), nullable=False, default=0)
    is_reconciled = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    book_transactions = relationship("BookTransaction", back_populates="workspace", cascade="all, delete-orphan")
    bank_transactions = relationship("BankTransaction", back_populates="workspace", cascade="all, delete-orphan")
    subledger_transactions = relationship("SubledgerTransaction", back_populates="workspace", cascade="all, delete-orphan")
    match_groups = relationship("MatchGroup", back_populates="workspace", cascade="all, delete-orphan")
    adjustments = relationship("ReconciliationAdjustment", back_populates="workspace", cascade="all, delete-orphan")
    exceptions = relationship("ReconException", back_populates="workspace", cascade="all, delete-orphan")
    audit_entries = relationship("ReconAuditTrail", back_populates="workspace", cascade="all, delete-orphan")


class MatchGroup(Base):
    __tablename__ = "match_groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, ForeignKey("recon_workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    match_type = Column(_enum_str(MatchTypeEnum), nullable=False)
    confidence_score = Column(Float, nullable=False, default=0.0)
    amount_variance = Column(Numeric(18, 4), nullable=False, default=0)
    date_variance_days = Column(Integer, nullable=True)
    description_similarity = Column(Float, nullable=True)
    status = Column(_enum_str(MatchGroupStatus), nullable=False, default=MatchGroupStatus.pending_review)
    confirmed_by = Column(String(256), nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    ai_reasoning = Column(Text, nullable=True)
    match_metadata = Column("metadata", _json_type, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    workspace = relationship("ReconWorkspace", back_populates="match_groups")
    book_transactions = relationship(
        "BookTransaction",
        back_populates="match_group",
        foreign_keys="BookTransaction.match_id",
    )
    bank_transactions = relationship(
        "BankTransaction",
        back_populates="match_group",
        foreign_keys="BankTransaction.match_id",
    )
    subledger_transactions = relationship(
        "SubledgerTransaction",
        back_populates="match_group",
        foreign_keys="SubledgerTransaction.match_id",
    )


class BookTransaction(Base):
    __tablename__ = "book_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, ForeignKey("recon_workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    txn_date = Column(Date, nullable=False)
    value_date = Column(Date, nullable=True)
    posting_date = Column(Date, nullable=True)
    amount = Column(Numeric(18, 4), nullable=False)
    debit_credit = Column(_enum_str(DebitCredit), nullable=False, default=DebitCredit.D)
    description = Column(Text, nullable=True)
    reference = Column(String(512), nullable=True)
    gl_account = Column(String(128), nullable=True)
    cost_center = Column(String(128), nullable=True)
    document_number = Column(String(256), nullable=True)
    source_system = Column(String(64), nullable=True)
    status = Column(_enum_str(BookTxnStatus), nullable=False, default=BookTxnStatus.unmatched)
    match_id = Column(Integer, ForeignKey("match_groups.id", ondelete="SET NULL"), nullable=True, index=True)
    exception_reason = Column(Text, nullable=True)
    is_reconciling_item = Column(Boolean, nullable=False, default=False)
    reconciling_item_type = Column(String(32), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    workspace = relationship("ReconWorkspace", back_populates="book_transactions")
    match_group = relationship("MatchGroup", back_populates="book_transactions", foreign_keys=[match_id])


class BankTransaction(Base):
    __tablename__ = "bank_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, ForeignKey("recon_workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    txn_date = Column(Date, nullable=False)
    value_date = Column(Date, nullable=True)
    amount = Column(Numeric(18, 4), nullable=False)
    debit_credit = Column(_enum_str(DebitCredit), nullable=False, default=DebitCredit.D)
    description = Column(Text, nullable=True)
    bank_reference = Column(String(512), nullable=True)
    counterparty = Column(String(512), nullable=True)
    bank_account_number = Column(String(128), nullable=True)
    bank_name = Column(String(256), nullable=True)
    status = Column(_enum_str(BankTxnStatus), nullable=False, default=BankTxnStatus.unmatched)
    match_id = Column(Integer, ForeignKey("match_groups.id", ondelete="SET NULL"), nullable=True, index=True)
    exception_reason = Column(Text, nullable=True)
    is_reconciling_item = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    workspace = relationship("ReconWorkspace", back_populates="bank_transactions")
    match_group = relationship("MatchGroup", back_populates="bank_transactions", foreign_keys=[match_id])


class SubledgerTransaction(Base):
    __tablename__ = "subledger_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, ForeignKey("recon_workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    txn_date = Column(Date, nullable=False)
    amount = Column(Numeric(18, 4), nullable=False)
    debit_credit = Column(_enum_str(DebitCredit), nullable=False, default=DebitCredit.D)
    description = Column(Text, nullable=True)
    subledger_type = Column(String(32), nullable=True)
    document_reference = Column(String(512), nullable=True)
    status = Column(_enum_str(BankTxnStatus), nullable=False, default=BankTxnStatus.unmatched)
    match_id = Column(Integer, ForeignKey("match_groups.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    workspace = relationship("ReconWorkspace", back_populates="subledger_transactions")
    match_group = relationship("MatchGroup", back_populates="subledger_transactions", foreign_keys=[match_id])


class ReconciliationAdjustment(Base):
    __tablename__ = "recon_adjustments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, ForeignKey("recon_workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    adjustment_type = Column(_enum_str(AdjustmentType), nullable=False)
    description = Column(Text, nullable=True)
    amount = Column(Numeric(18, 4), nullable=False)
    affects_side = Column(_enum_str(AffectsSide), nullable=False)
    journal_entry_required = Column(Boolean, nullable=False, default=False)
    je_posted = Column(Boolean, nullable=False, default=False)
    posted_by = Column(String(256), nullable=True)
    posted_at = Column(DateTime, nullable=True)
    created_by = Column(String(256), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    workspace = relationship("ReconWorkspace", back_populates="adjustments")


class ReconException(Base):
    __tablename__ = "recon_exceptions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, ForeignKey("recon_workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    exception_type = Column(_enum_str(ReconExceptionType), nullable=False)
    severity = Column(_enum_str(ExceptionSeverity), nullable=False, default=ExceptionSeverity.medium)
    description = Column(Text, nullable=True)
    bank_txn_id = Column(Integer, ForeignKey("bank_transactions.id", ondelete="SET NULL"), nullable=True)
    book_txn_id = Column(Integer, ForeignKey("book_transactions.id", ondelete="SET NULL"), nullable=True)
    amount = Column(Numeric(18, 4), nullable=True)
    age_days = Column(Integer, nullable=True)
    assigned_to = Column(String(256), nullable=True)
    resolution_notes = Column(Text, nullable=True)
    resolved = Column(Boolean, nullable=False, default=False)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by = Column(String(256), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    workspace = relationship("ReconWorkspace", back_populates="exceptions")


class ReconAuditTrail(Base):
    __tablename__ = "recon_audit_trail"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, ForeignKey("recon_workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    action = Column(_enum_str(ReconAuditAction), nullable=False)
    performed_by = Column(String(256), nullable=True)
    performed_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    details = Column(_json_type, nullable=True)
    ip_address = Column(String(64), nullable=True)

    workspace = relationship("ReconWorkspace", back_populates="audit_entries")
