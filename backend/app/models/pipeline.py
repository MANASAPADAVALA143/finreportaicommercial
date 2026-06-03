"""
Connected Bookkeeping Pipeline — SQLAlchemy models.
GL Entries, GL Balances, Month-Close Checklist, Audit Log,
Accrual Suggestions, Bank Recon Matches.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, String, Text

from app.core.database import Base


class GLEntry(Base):
    __tablename__ = "gl_entries"

    id = Column(Integer, primary_key=True)
    je_id = Column(String(50))
    account_code = Column(String(20), nullable=False)
    account_name = Column(String(200))
    debit = Column(Float, default=0.0)
    credit = Column(Float, default=0.0)
    period = Column(String(7))   # YYYY-MM
    posted_at = Column(DateTime, default=datetime.utcnow)
    source = Column(String(50))  # invoice / manual / recon


class GLBalance(Base):
    __tablename__ = "gl_balances"

    id = Column(Integer, primary_key=True)
    account_code = Column(String(20), nullable=False)
    period = Column(String(7))
    opening_balance = Column(Float, default=0.0)
    debit_total = Column(Float, default=0.0)
    credit_total = Column(Float, default=0.0)
    closing_balance = Column(Float, default=0.0)


class MonthCloseChecklist(Base):
    __tablename__ = "month_close_checklist"

    id = Column(Integer, primary_key=True)
    period = Column(String(7), nullable=False)
    company_id = Column(String(50), default="default")
    step_name = Column(String(100))
    status = Column(String(20), default="pending")  # pending / complete / blocked
    completed_at = Column(DateTime, nullable=True)
    completed_by = Column(String(100), nullable=True)
    details = Column(Text, nullable=True)


class AccountingAuditLog(Base):
    __tablename__ = "accounting_audit_log"

    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    user_id = Column(String(100), default="system")
    action_type = Column(String(100))
    entity_type = Column(String(50))
    entity_id = Column(String(100))
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    s3_backup_key = Column(String(500), nullable=True)


class AccrualSuggestion(Base):
    __tablename__ = "accrual_suggestions"

    id = Column(Integer, primary_key=True)
    period = Column(String(7))
    description = Column(String(500))
    amount_aed = Column(Float)
    debit_account = Column(String(20))
    credit_account = Column(String(20))
    confidence_pct = Column(Float)
    reason = Column(String(500))
    status = Column(String(20), default="suggested")  # suggested / accepted / rejected
    created_at = Column(DateTime, default=datetime.utcnow)


class BankReconMatch(Base):
    __tablename__ = "bank_recon_matches"

    id = Column(Integer, primary_key=True)
    period = Column(String(7))
    gl_reference = Column(String(200))
    bank_reference = Column(String(200))
    amount = Column(Float)
    match_tier = Column(Integer)   # 1-4
    match_type = Column(String(50))  # auto / manual / exception
    status = Column(String(20), default="matched")
    gl_date = Column(String(20))
    bank_date = Column(String(20))
    suggested_je = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
