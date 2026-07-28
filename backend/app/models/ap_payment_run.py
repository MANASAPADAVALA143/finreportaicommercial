"""AP Payment Runs — batch payment approval and bank file generation."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, Numeric, String, Text
from sqlalchemy.types import JSON

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class ApPaymentRun(Base):
    __tablename__ = "ap_payment_runs"

    id = Column(String(36), primary_key=True, default=_uuid)
    run_number = Column(String(32), nullable=False, index=True)
    workspace_id = Column(String(36), nullable=False, index=True)
    company_id = Column(String(36), nullable=False, index=True)
    created_by = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    submitted_at = Column(DateTime, nullable=True)
    approved_by = Column(String(200), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    executed_at = Column(DateTime, nullable=True)
    status = Column(String(32), nullable=False, default="draft", index=True)
    # draft | pending_approval | approved | executed | rejected
    rejection_reason = Column(Text, nullable=True)
    total_invoices = Column(Integer, nullable=False, default=0)
    total_net_aed = Column(Numeric(15, 2), nullable=False, default=0)
    total_vat_aed = Column(Numeric(15, 2), nullable=False, default=0)
    total_gross_aed = Column(Numeric(15, 2), nullable=False, default=0)
    invoice_ids = Column(JSON, nullable=False, default=list)
    journal_entry_id = Column(String(36), nullable=True)
    extra = Column(JSON, nullable=True, default=dict)
