"""Lightweight CRM for UAE SMEs — contacts, deals, activities, quotes."""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.types import JSON

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class CRMContact(Base):
    __tablename__ = "crm_contacts"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(64), nullable=False, index=True)
    company_id = Column(String(36), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    company_name = Column(String(200))
    email = Column(String(200))
    phone = Column(String(30))
    contact_type = Column(String(20), default="Lead")  # Lead/Prospect/Customer
    source = Column(String(50))  # referral/website/cold/exhibition
    assigned_to = Column(String(200))
    notes = Column(Text)
    credit_score = Column(Numeric(5, 1), nullable=True)
    risk_category = Column(String(20), nullable=True)  # LOW/MEDIUM/HIGH/CRITICAL
    credit_limit_aed = Column(Numeric(15, 2), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class CRMDeal(Base):
    __tablename__ = "crm_deals"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(64), nullable=False, index=True)
    company_id = Column(String(36), nullable=True, index=True)
    contact_id = Column(String(36), ForeignKey("crm_contacts.id"), nullable=True)
    deal_name = Column(String(300), nullable=False)
    value_aed = Column(Numeric(15, 2), default=0)
    currency = Column(String(3), default="AED")
    stage = Column(String(30), default="New")
    expected_close_date = Column(Date)
    probability_pct = Column(Integer, default=10)
    notes = Column(Text)
    ar_invoice_id = Column(String(36), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CRMActivity(Base):
    __tablename__ = "crm_activities"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(64), nullable=False, index=True)
    deal_id = Column(String(36), ForeignKey("crm_deals.id"), nullable=True)
    contact_id = Column(String(36), ForeignKey("crm_contacts.id"), nullable=True)
    activity_type = Column(String(30), default="follow-up")
    subject = Column(String(300))
    notes = Column(Text)
    due_date = Column(Date)
    completed = Column(Boolean, default=False)
    completed_at = Column(DateTime, nullable=True)
    created_by = Column(String(200))
    created_at = Column(DateTime, default=datetime.utcnow)


class CRMQuote(Base):
    __tablename__ = "crm_quotes"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(64), nullable=False, index=True)
    company_id = Column(String(36), nullable=True, index=True)
    deal_id = Column(String(36), ForeignKey("crm_deals.id"), nullable=True)
    contact_id = Column(String(36), ForeignKey("crm_contacts.id"), nullable=True)
    quote_number = Column(String(30))
    line_items = Column(JSON, default=list)
    subtotal = Column(Numeric(15, 2), default=0)
    vat_amount = Column(Numeric(15, 2), default=0)
    total_aed = Column(Numeric(15, 2), default=0)
    status = Column(String(20), default="Draft")  # Draft/Sent/Accepted/Rejected
    valid_until = Column(Date)
    ar_invoice_id = Column(String(36), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
