"""Technical Accounting Memo Generator — AI-drafted, user-edited accounting position memos."""

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.core.database import Base


class AccountingMemo(Base):
    __tablename__ = "accounting_memos"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    user_email = Column(String(255), nullable=False, index=True)

    title = Column(String(200), nullable=False)
    status = Column(String(32), nullable=False, default="draft")  # draft | under_review | finalised

    transaction_description = Column(Text, nullable=True)
    jurisdiction = Column(String(16), nullable=True, default="IFRS")
    accounting_topic = Column(String(128), nullable=True)

    section_executive_summary = Column(Text, nullable=True)
    section_background = Column(Text, nullable=True)
    section_applicable_standards = Column(Text, nullable=True)
    section_accounting_analysis = Column(Text, nullable=True)
    section_conclusion = Column(Text, nullable=True)
    section_journal_entries = Column(Text, nullable=True)
    section_disclosures = Column(Text, nullable=True)
    section_assumptions = Column(Text, nullable=True)

    requires_partner_review = Column(Boolean, nullable=False, default=False)
    ai_generated = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
