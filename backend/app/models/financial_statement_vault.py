"""IAS 1 comparative support — persist generated statements for next-year vault pull."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON
from sqlalchemy.types import JSON

from app.core.database import Base

_json = JSON().with_variant(SQLiteJSON(), "sqlite")


def company_vault_key(tenant_id: str, company_name: str) -> str:
    t = (tenant_id or "default").strip().lower()
    c = (company_name or "").strip().lower()
    return f"{t}|{c}"[:512]


class FinancialStatementVault(Base):
    """
    One row per (tenant, company, fiscal year) after a successful agentic / statement run.
    Next-year NEXUS can resolve prior comparatives from here when prior TB rows are gone.
    """

    __tablename__ = "financial_statements"
    __table_args__ = (UniqueConstraint("tenant_id", "company_key", "fiscal_year", name="uq_vault_tenant_company_year"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    company_key = Column(String(512), nullable=False, index=True)
    company_name = Column(String(512), nullable=False)
    fiscal_year = Column(Integer, nullable=False, index=True)
    period_end = Column(Date, nullable=True)
    trial_balance_id = Column(Integer, nullable=True, index=True)
    status = Column(String(32), nullable=False, default="ai_generated")
    statements_payload = Column(_json, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    notes = Column(Text, nullable=True)
