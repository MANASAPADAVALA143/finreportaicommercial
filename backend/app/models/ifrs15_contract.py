"""IFRS 15 revenue contracts — performance obligations register."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Numeric, String, Text

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class IFRS15Contract(Base):
    __tablename__ = "ifrs15_contracts"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=True, index=True)
    contract_number = Column(String(64), nullable=False)
    customer_name = Column(String(200), nullable=False)
    contract_date = Column(String(10), nullable=True)
    contract_value_aed = Column(Numeric(15, 2), default=0)
    performance_obligations = Column(Text, nullable=True)
    total_recognised_aed = Column(Numeric(15, 2), default=0)
    total_remaining_aed = Column(Numeric(15, 2), default=0)
    contract_liability_aed = Column(Numeric(15, 2), default=0)
    contract_asset_aed = Column(Numeric(15, 2), default=0)
    calculation_json = Column(Text, nullable=True)
    status = Column(String(20), default="active")
    je_posted = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
