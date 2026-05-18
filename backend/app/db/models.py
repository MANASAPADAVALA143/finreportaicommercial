from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, JSON, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base


class Company(Base):
    """Each CA firm client = one company"""
    __tablename__ = "companies"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    industry = Column(String, default="General")
    currency = Column(String, default="INR")
    created_at = Column(DateTime, default=datetime.utcnow)
    total_uploads = Column(Integer, default=0)
    last_upload = Column(DateTime, nullable=True)


class JournalHistory(Base):
    """All uploaded journal entries — never deleted, keeps growing"""
    __tablename__ = "journal_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(String, nullable=False, index=True)
    journal_id = Column(String, nullable=True)
    posting_date = Column(DateTime, nullable=True)
    amount = Column(Float, nullable=False)
    account = Column(String, nullable=False)
    vendor = Column(String, default="Unknown")
    user_id = Column(String, default="Unknown")
    source = Column(String, default="Unknown")
    description = Column(String, default="")
    entity = Column(String, default="")
    upload_batch = Column(String, nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)


class CompanyProfile(Base):
    """
    Per-company, per-account learned baseline.
    Recalculated on every upload using ALL historical data.
    """
    __tablename__ = "company_profiles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(String, nullable=False, index=True)
    account = Column(String, nullable=False)

    avg_amount = Column(Float, default=0)
    std_amount = Column(Float, default=1)
    median_amount = Column(Float, default=0)
    p75_amount = Column(Float, default=0)
    p90_amount = Column(Float, default=0)
    p95_amount = Column(Float, default=0)
    min_amount = Column(Float, default=0)
    max_amount = Column(Float, default=0)
    entry_count = Column(Integer, default=0)

    weekend_rate = Column(Float, default=0)
    manual_rate = Column(Float, default=0)
    month_end_rate = Column(Float, default=0)
    common_users = Column(JSON, default=list)
    monthly_avg = Column(JSON, default=dict)
    last_updated = Column(DateTime, default=datetime.utcnow)


class ScoringResult(Base):
    """Store all scoring results — for audit trail + retraining"""
    __tablename__ = "scoring_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(String, nullable=False, index=True)
    journal_id = Column(String, nullable=True)
    upload_batch = Column(String, nullable=True)

    final_score = Column(Float, default=0)
    risk_level = Column(String, default="LOW")
    ml_score = Column(Float, default=0)
    stat_score = Column(Float, default=0)
    rules_score = Column(Float, default=0)
    ai_score = Column(Float, default=0)
    rule_flags = Column(JSON, default=list)
    ai_explanation = Column(Text, default="")

    user_label = Column(Boolean, nullable=True)
    reviewed_by = Column(String, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AccountBaseline(Base):
    """
    Per-client, per-account statistical baseline built from historical data.
    Used by the scoring engine to suppress false positives for known-normal behaviour.
    """
    __tablename__ = "account_baselines"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    client_id      = Column(String, nullable=False, index=True)
    account        = Column(String, nullable=False)

    mean_amount    = Column(Float, nullable=True)
    std_amount     = Column(Float, nullable=True)
    median_amount  = Column(Float, nullable=True)
    p10_amount     = Column(Float, nullable=True)   # 10th percentile
    p90_amount     = Column(Float, nullable=True)   # 90th percentile
    lower_fence    = Column(Float, nullable=True)   # Q1 - 1.5*IQR
    upper_fence    = Column(Float, nullable=True)   # Q3 + 3.0*IQR

    weekend_rate   = Column(Float, nullable=True)   # fraction of entries on weekends
    known_users    = Column(JSON,  nullable=True)   # list of ALL user_id strings seen in history
    entry_count    = Column(Integer, nullable=True)
    months_covered = Column(Integer, nullable=True)

    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("client_id", "account", name="uq_account_baseline_client_account"),
    )


class ClientCOA(Base):
    """
    Per-client Chart of Accounts — Tally ledger names uploaded by the CA firm.
    Used to constrain AI categorisation prompts to client-specific ledgers.
    """
    __tablename__ = "client_coa"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    client_id    = Column(String, nullable=False, index=True)
    ledger_name  = Column(String, nullable=False)
    ledger_group = Column(String, nullable=True)   # e.g. "Indirect Expenses", "Current Liabilities"
    created_at   = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("client_id", "ledger_name", name="uq_client_coa_ledger"),
    )


class IFRSLineItemLegacy(Base):
    """Master reference table: canonical IFRS statement line definitions."""

    __tablename__ = "ifrs_line_items_legacy"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(512), nullable=False)
    statement = Column(String(128), nullable=False)
    section = Column(String(256), nullable=True)
    sub_section = Column(String(256), nullable=True)
    standard = Column(String(128), nullable=True)
    is_calculated = Column(Boolean, default=False, nullable=False)

    links = relationship("IFRSLinkLegacy", back_populates="ifrs_line_item")


class IFRSLinkLegacy(Base):
    """Maps a trial balance line to an IFRS line item (per statement type)."""

    __tablename__ = "ifrs_links_legacy"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trial_balance_line_id = Column(Integer, nullable=False, index=True)
    ifrs_line_item_id = Column(Integer, ForeignKey("ifrs_line_items_legacy.id"), nullable=False, index=True)
    statement_type = Column(String(64), nullable=False)

    ifrs_line_item = relationship("IFRSLineItemLegacy", back_populates="links")
