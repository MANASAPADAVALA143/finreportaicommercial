"""Persisted FP&A 3-statement model builds."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, JSON, String

from app.core.database import Base


class FinancialModel(Base):
    __tablename__ = "financial_models"

    model_id = Column(String(36), primary_key=True)
    entity_id = Column(String(128), nullable=False, index=True)
    company_name = Column(String(256), nullable=False, default="")
    currency = Column(String(8), nullable=False, default="USD")
    base_year = Column(Integer, nullable=False)
    forecast_years = Column(Integer, nullable=False, default=3)
    status = Column(String(24), nullable=False, default="started")
    assumptions_json = Column(JSON, nullable=False, default=dict)
    model_json = Column(JSON, nullable=False, default=dict)
    checks_json = Column(JSON, nullable=False, default=dict)
    scenarios_json = Column(JSON, nullable=False, default=dict)
    audit_trail = Column(JSON, nullable=False, default=list)
    total_seconds = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    approved_by = Column(String(256), nullable=True)
    approved_at = Column(DateTime, nullable=True)
