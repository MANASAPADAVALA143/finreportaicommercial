"""IFRS 16 lease register — persisted lease portfolio."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, Integer, Numeric, String, Text

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class IFRS16Lease(Base):
    __tablename__ = "ifrs16_leases"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=True, index=True)
    lease_name = Column(String(200), nullable=False)
    asset_description = Column(String(500), nullable=True)
    asset_class = Column(String(50), default="property")
    commencement_date = Column(Date, nullable=False)
    lease_term_months = Column(Integer, nullable=False)
    lease_payments_aed = Column(Numeric(15, 2), nullable=True)
    payment_frequency = Column(String(20), default="monthly")
    incremental_borrowing_rate = Column(Numeric(8, 6), nullable=True)
    rou_asset_initial = Column(Numeric(15, 2), nullable=True)
    lease_liability_initial = Column(Numeric(15, 2), nullable=True)
    rou_asset_current = Column(Numeric(15, 2), nullable=True)
    lease_liability_current = Column(Numeric(15, 2), nullable=True)
    accumulated_depreciation = Column(Numeric(15, 2), default=0)
    depreciation_ytd = Column(Numeric(15, 2), default=0)
    interest_ytd = Column(Numeric(15, 2), default=0)
    status = Column(String(20), default="active")
    next_remeasurement_date = Column(Date, nullable=True)
    contract_file_url = Column(String(512), nullable=True)
    je_posted = Column(Boolean, default=False)
    last_je_date = Column(Date, nullable=True)
    calculation_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
