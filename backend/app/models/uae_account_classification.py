"""UAE GL account classifications for FS / Cash Flow / CIT reporting."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, Numeric, String, Text, UniqueConstraint

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class UAEAccountClassification(Base):
    __tablename__ = "uae_account_classifications"
    __table_args__ = (
        UniqueConstraint("workspace_id", "company_id", "account_code", name="uq_uae_acct_class"),
    )

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(64), nullable=False, index=True)
    company_id = Column(String(36), nullable=True, index=True)
    account_id = Column(String(36), nullable=True, index=True)
    account_code = Column(String(20), nullable=False, index=True)
    account_name = Column(String(200), nullable=False, default="")
    balance = Column(Numeric(18, 2), default=0)

    bs_pl_main = Column(String(64), nullable=True)
    bs_pl_sub = Column(String(128), nullable=True)
    fs_note_number = Column(Integer, nullable=True)
    fs_note_heading = Column(Text, nullable=True)
    cash_flow_category = Column(String(32), nullable=True)
    cit_category = Column(String(64), nullable=True)
    cit_add_back = Column(Boolean, default=False)

    classification_status = Column(String(20), nullable=False, default="not_classified")
    classified_by = Column(String(16), nullable=True)  # manual | ai
    ai_confidence = Column(Numeric(5, 2), nullable=True)
    ai_reasoning = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
