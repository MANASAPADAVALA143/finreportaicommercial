"""Bookkeeping Autopilot — transactional storage and learning tables."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class BookkeepingClientProfile(Base):
    """Per-client autopilot settings (weekend ops, receipt threshold, COA hints)."""

    __tablename__ = "bookkeeping_client_profiles"

    client_id = Column(String(64), primary_key=True)
    weekend_operations = Column(Boolean, default=False, nullable=False)
    receipt_threshold = Column(Float, default=100.0, nullable=False)
    chart_of_accounts = Column(JSON, default=list)  # list of account/category strings
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class BookkeepingTransaction(Base):
    __tablename__ = "bookkeeping_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String(64), nullable=False, index=True)
    period_year = Column(Integer, nullable=True)
    period_month = Column(Integer, nullable=True)
    txn_date = Column(DateTime, nullable=False)
    description = Column(Text, default="")
    amount = Column(Float, nullable=False)
    type = Column(String(32), default="unknown")  # debit, credit, unknown
    category = Column(String(256), nullable=True)
    confidence = Column(Float, nullable=True)
    flag_for_review = Column(Boolean, default=False, nullable=False)
    auto_approved = Column(Boolean, default=False, nullable=False)
    anomaly_flags = Column(JSON, default=list)
    receipt_url = Column(String(1024), nullable=True)
    vendor_name = Column(String(512), nullable=True)
    bank_account_id = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    categories = relationship(
        "TransactionCategoryRow",
        back_populates="transaction",
        cascade="all, delete-orphan",
    )
    missing_receipt_row = relationship(
        "MissingReceiptRow",
        back_populates="transaction",
        uselist=False,
        cascade="all, delete-orphan",
    )


class ClientVendor(Base):
    __tablename__ = "client_vendors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String(64), nullable=False, index=True)
    vendor_name = Column(String(512), nullable=False)
    category = Column(String(256), nullable=True)
    avg_amount = Column(Float, default=0.0)
    last_seen = Column(DateTime, default=datetime.utcnow)
    transaction_count = Column(Integer, default=0)

    __table_args__ = (UniqueConstraint("client_id", "vendor_name", name="uq_client_vendor"),)


class ClientRule(Base):
    __tablename__ = "client_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String(64), nullable=False, index=True)
    vendor_pattern = Column(String(512), nullable=False)
    category = Column(String(256), nullable=False)
    confidence_boost = Column(Float, default=0.05)
    source = Column(String(64), default="learned")  # learned | seed
    created_at = Column(DateTime, default=datetime.utcnow)


class TransactionCategoryRow(Base):
    __tablename__ = "transaction_categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    transaction_id = Column(
        Integer, ForeignKey("bookkeeping_transactions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category = Column(String(256), nullable=False)
    confidence = Column(Float, nullable=False)
    method = Column(String(32), nullable=False)  # rules | claude | staff
    claude_reason = Column(Text, nullable=True)
    staff_corrected = Column(Boolean, default=False, nullable=False)
    corrected_to = Column(String(256), nullable=True)
    corrected_at = Column(DateTime, nullable=True)

    transaction = relationship("BookkeepingTransaction", back_populates="categories")


class MissingReceiptRow(Base):
    __tablename__ = "missing_receipts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    transaction_id = Column(
        Integer, ForeignKey("bookkeeping_transactions.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    amount = Column(Float, nullable=False)
    vendor = Column(String(512), nullable=True)
    date = Column(DateTime, nullable=True)
    reminder_sent_count = Column(Integer, default=0)
    resolved = Column(Boolean, default=False, nullable=False)

    transaction = relationship("BookkeepingTransaction", back_populates="missing_receipt_row")


class AccuracyMetric(Base):
    __tablename__ = "accuracy_metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String(64), nullable=False, index=True)
    month = Column(Integer, nullable=False)
    year = Column(Integer, nullable=False)
    total_transactions = Column(Integer, default=0)
    auto_approved = Column(Integer, default=0)
    staff_corrected = Column(Integer, default=0)
    flagged = Column(Integer, default=0)
    anomalies_real = Column(Integer, default=0)
    anomalies_false_positive = Column(Integer, default=0)
    accuracy_pct = Column(Float, nullable=True)

    __table_args__ = (UniqueConstraint("client_id", "month", "year", name="uq_accuracy_client_period"),)


class BookkeepingReconciliationRun(Base):
    """Last reconcile summary for review queue & variance escalation."""

    __tablename__ = "bookkeeping_reconciliation_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String(64), nullable=False, index=True)
    variance_amount = Column(Float, nullable=False)
    escalated = Column(Boolean, default=False, nullable=False)
    summary_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)


class ReconciliationSignoff(Base):
    __tablename__ = "reconciliation_signoffs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String(64), nullable=False, index=True)
    period_month = Column(Integer, nullable=False)
    period_year = Column(Integer, nullable=False)
    signed_by = Column(String(256), nullable=False)
    signed_at = Column(DateTime, default=datetime.utcnow)
    variance_amount = Column(Float, default=0.0)
    notes = Column(Text, nullable=True)
