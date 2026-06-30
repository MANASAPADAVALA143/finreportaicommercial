"""IFRS 9 ECL portfolios and assets."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Numeric, String

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class IFRS9Portfolio(Base):
    __tablename__ = "ifrs9_portfolios"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=True, index=True)
    portfolio_name = Column(String(200), nullable=False)
    asset_class = Column(String(50), default="trade_receivables")
    total_exposure_aed = Column(Numeric(15, 2), default=0)
    stage1_aed = Column(Numeric(15, 2), default=0)
    stage2_aed = Column(Numeric(15, 2), default=0)
    stage3_aed = Column(Numeric(15, 2), default=0)
    ecl_stage1_aed = Column(Numeric(15, 2), default=0)
    ecl_stage2_aed = Column(Numeric(15, 2), default=0)
    ecl_stage3_aed = Column(Numeric(15, 2), default=0)
    total_ecl_aed = Column(Numeric(15, 2), default=0)
    calculation_date = Column(String(10), nullable=True)
    je_posted = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class IFRS9Asset(Base):
    __tablename__ = "ifrs9_assets"

    id = Column(String(36), primary_key=True, default=_uuid)
    portfolio_id = Column(String(36), ForeignKey("ifrs9_portfolios.id"), nullable=False, index=True)
    workspace_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=True, index=True)
    asset_name = Column(String(200), nullable=False)
    counterparty = Column(String(200), nullable=True)
    exposure_aed = Column(Numeric(15, 2), default=0)
    origination_date = Column(String(10), nullable=True)
    maturity_date = Column(String(10), nullable=True)
    credit_rating = Column(String(20), nullable=True)
    days_past_due = Column(Numeric(6, 0), default=0)
    stage = Column(String(10), default="1")
    pd_12month = Column(Numeric(10, 6), default=0)
    pd_lifetime = Column(Numeric(10, 6), default=0)
    lgd = Column(Numeric(6, 4), default=0)
    ead = Column(Numeric(15, 2), default=0)
    ecl_12month_aed = Column(Numeric(15, 2), default=0)
    ecl_lifetime_aed = Column(Numeric(15, 2), default=0)
    ecl_recognised_aed = Column(Numeric(15, 2), default=0)
    significant_increase_in_credit_risk = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
