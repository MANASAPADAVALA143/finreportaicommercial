from datetime import datetime

from sqlalchemy import Column, Date, DateTime, Float, Integer, String, Text, JSON

from app.core.database import Base


class JournalHistory(Base):
    """Stores all uploaded entries across months per company."""

    __tablename__ = "je_history"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(String(100), index=True)
    upload_month = Column(String(7))
    upload_batch = Column(String(50))
    journal_id = Column(String(100))
    posting_date = Column(Date)
    posting_hour = Column(Integer, nullable=True)
    posting_dow = Column(Integer, nullable=True)
    account = Column(String(100), index=True)
    amount = Column(Float)
    user_id = Column(String(100))
    source = Column(String(50))
    description = Column(Text, nullable=True)
    entity = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AccountBaseline(Base):
    """Per-account statistical baseline per company."""

    __tablename__ = "je_account_baseline"

    id = Column(Integer, primary_key=True)
    company_id = Column(String(100), index=True)
    account = Column(String(100), index=True)

    mean_amount = Column(Float)
    std_amount = Column(Float)
    median_amount = Column(Float)
    p25_amount = Column(Float)
    p75_amount = Column(Float)
    min_amount = Column(Float)
    max_amount = Column(Float)

    total_entries = Column(Integer)
    months_loaded = Column(Integer)
    avg_entries_month = Column(Float)

    normal_users = Column(JSON)
    normal_sources = Column(JSON)
    normal_entities = Column(JSON)
    weekend_pct = Column(Float)
    afterhours_pct = Column(Float)
    monthend_pct = Column(Float)
    manual_pct = Column(Float)
    round_num_pct = Column(Float)

    benford_chi2 = Column(Float, nullable=True)
    benford_normal = Column(Float, nullable=True)

    # FeedbackLearner stores per-client layer weights here as JSON
    meta_json = Column(JSON, nullable=True)

    updated_at = Column(DateTime, default=datetime.utcnow)


class JENarrative(Base):
    """
    Cache table for LLM-generated audit narratives.

    Keyed by (company_id, journal_id) so the same entry is never billed
    to Claude twice during the same analysis run.  Rows expire after
    `ttl_hours` hours (enforced at read time in the service layer).
    """

    __tablename__ = "je_narratives"

    id = Column(Integer, primary_key=True)
    company_id = Column(String(100), index=True, nullable=False)
    journal_id = Column(String(100), index=True, nullable=False)
    risk_level = Column(String(20), nullable=True)
    composite_score = Column(Float, nullable=True)
    narrative = Column(Text, nullable=False)
    model_used = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
