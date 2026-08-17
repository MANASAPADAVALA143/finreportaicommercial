"""RERA OS — UAE/India real-estate developer compliance module.

Projects, bookings, installment payments, escrow tracking, QPR filings,
risk flags and Zoho webhook events for off-plan property developers.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON

from app.core.database import Base

_json = JSON().with_variant(JSONB(), "postgresql").with_variant(SQLiteJSON(), "sqlite")


def _uuid() -> str:
    return str(uuid.uuid4())


class RERAProject(Base):
    __tablename__ = "rera_projects"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False, index=True)
    name = Column(String(256), nullable=False)
    rera_number = Column(String(64), nullable=False)
    location = Column(String(256), nullable=True)
    total_units = Column(Integer, nullable=True)
    total_project_cost = Column(Numeric(18, 2), nullable=True)
    total_collections_target = Column(Numeric(18, 2), nullable=True)
    escrow_percentage = Column(Numeric(5, 2), nullable=False, default=70.0)
    construction_progress = Column(Numeric(5, 2), nullable=False, default=0.0)
    utilization_percentage = Column(Numeric(5, 2), nullable=False, default=0.0)
    escrow_balance = Column(Numeric(18, 2), nullable=False, default=0.0)
    withdrawn = Column(Numeric(18, 2), nullable=False, default=0.0)
    total_collected = Column(Numeric(18, 2), nullable=False, default=0.0)
    start_date = Column(Date, nullable=True)
    completion_date = Column(Date, nullable=True)
    status = Column(String(32), nullable=False, default="active")
    developer_pan = Column(String(16), nullable=True)  # India: [A-Z]{5}[0-9]{4}[A-Z]
    promoter_din = Column(String(8), nullable=True)  # India: \d{8}
    gstin = Column(String(20), nullable=True)
    trn_number = Column(String(20), nullable=True)  # UAE VAT TRN
    qpr_deadline = Column(Date, nullable=True)
    currency = Column(String(3), nullable=False, default="AED")  # AED | INR
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=datetime.utcnow, nullable=False)


class RERABooking(Base):
    __tablename__ = "rera_bookings"

    id = Column(String(36), primary_key=True, default=_uuid)
    project_id = Column(String(36), ForeignKey("rera_projects.id"), nullable=False, index=True)
    unit_number = Column(String(64), nullable=True)
    customer_name = Column(String(256), nullable=True)
    customer_email = Column(String(256), nullable=True)
    customer_phone = Column(String(32), nullable=True)
    total_value = Column(Numeric(18, 2), nullable=True)
    booking_date = Column(Date, nullable=True)
    payment_schedule = Column(_json, nullable=False, default=list)  # [{milestone, amount, due_date}]
    status = Column(String(32), nullable=False, default="active")
    oqood_status = Column(String(32), nullable=False, default="pending")  # pending|registered|rejected
    spa_id = Column(String(128), nullable=True, index=True)  # Zoho SPA reference
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class RERAPayment(Base):
    __tablename__ = "rera_payments"

    id = Column(String(36), primary_key=True, default=_uuid)
    project_id = Column(String(36), ForeignKey("rera_projects.id"), nullable=False, index=True)
    booking_id = Column(String(36), ForeignKey("rera_bookings.id"), nullable=False, index=True)
    installment_number = Column(Integer, nullable=True)
    gross_amount = Column(Numeric(18, 2), nullable=False, default=0)
    gst_amount = Column(Numeric(18, 2), nullable=False, default=0)  # India: 5% under-construction
    vat_amount = Column(Numeric(18, 2), nullable=False, default=0)  # UAE: 5% commercial / 0% residential
    tds_amount = Column(Numeric(18, 2), nullable=False, default=0)  # India: 1% u/s 194-IA
    net_amount = Column(Numeric(18, 2), nullable=False, default=0)
    escrow_split = Column(Numeric(18, 2), nullable=False, default=0)
    payment_date = Column(Date, nullable=True)
    payment_mode = Column(String(32), nullable=False, default="bank_transfer")
    status = Column(String(32), nullable=False, default="received")
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class RERAEscrowTransaction(Base):
    __tablename__ = "rera_escrow_transactions"

    id = Column(String(36), primary_key=True, default=_uuid)
    project_id = Column(String(36), ForeignKey("rera_projects.id"), nullable=False, index=True)
    type = Column(String(16), nullable=False)  # deposit | withdrawal
    amount = Column(Numeric(18, 2), nullable=False, default=0)
    transaction_date = Column(Date, nullable=True)
    purpose = Column(String(256), nullable=True)
    approved_by = Column(String(256), nullable=True)  # compliance sign-off name/id
    reference_no = Column(String(128), nullable=True)
    source_payment_id = Column(String(36), ForeignKey("rera_payments.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class RERAQPRRecord(Base):
    __tablename__ = "rera_qpr_records"

    id = Column(String(36), primary_key=True, default=_uuid)
    project_id = Column(String(36), ForeignKey("rera_projects.id"), nullable=False, index=True)
    quarter = Column(String(16), nullable=False)  # e.g. Q1-2026
    total_collections = Column(Numeric(18, 2), nullable=False, default=0)
    escrow_deposited = Column(Numeric(18, 2), nullable=False, default=0)
    withdrawals = Column(Numeric(18, 2), nullable=False, default=0)
    construction_progress = Column(Numeric(5, 2), nullable=False, default=0)
    utilization = Column(Numeric(5, 2), nullable=False, default=0)
    status = Column(String(16), nullable=False, default="draft")  # draft | filed
    generated_at = Column(DateTime, server_default=func.now(), nullable=False)


class RERARiskFlag(Base):
    __tablename__ = "rera_risk_flags"

    id = Column(String(36), primary_key=True, default=_uuid)
    project_id = Column(String(36), ForeignKey("rera_projects.id"), nullable=False, index=True)
    severity = Column(String(16), nullable=False, default="medium")  # high | medium | low
    category = Column(String(32), nullable=False)  # escrow | vat | qpr | tds | ifrs15
    title = Column(String(256), nullable=False)
    description = Column(Text, nullable=True)
    resolved = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class RERAWebhookEvent(Base):
    __tablename__ = "rera_webhook_events"

    id = Column(String(36), primary_key=True, default=_uuid)
    idempotency_key = Column(String(256), unique=True, nullable=False)  # spa_id:event_type:timestamp
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=True, index=True)
    spa_id = Column(String(128), nullable=False, index=True)
    event_type = Column(String(64), nullable=True)
    event_timestamp = Column(DateTime, nullable=True)
    received_at = Column(DateTime, server_default=func.now(), nullable=False)
    source = Column(String(32), nullable=False, default="zoho_webhook")
    data = Column(_json, nullable=True)
    zoho_raw = Column(_json, nullable=True)
    is_dlq = Column(Boolean, nullable=False, default=False)
    dlq_reason = Column(Text, nullable=True)
