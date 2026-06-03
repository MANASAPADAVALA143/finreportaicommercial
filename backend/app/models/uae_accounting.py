"""
UAE Accounting models
=====================
Isolated new tables — zero changes to existing models.

Tables created:
  uae_connected_accounts   — Zoho / QBO OAuth connections per tenant
  uae_trial_balances       — Synced trial balances
  uae_trial_balance_lines  — Individual GL lines from Zoho/QBO
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON

from app.core.database import Base


_json_type = JSON().with_variant(SQLiteJSON(), "sqlite")


class AccountingSource(str, enum.Enum):
    zoho = "zoho"
    quickbooks = "quickbooks"
    manual_csv = "manual_csv"


def _enum_str(e: type[enum.Enum]) -> SAEnum:
    return SAEnum(e, values_callable=lambda x: [i.value for i in x], native_enum=False)


class ConnectedAccount(Base):
    """An authenticated Zoho Books or QuickBooks connection for a tenant."""

    __tablename__ = "uae_connected_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    source = Column(_enum_str(AccountingSource), nullable=False)

    # Company details from Zoho/QBO
    company_name = Column(String(512), nullable=False, default="")
    company_id_external = Column(String(256), nullable=True)   # Zoho org_id / QBO realm_id
    currency_code = Column(String(8), nullable=False, default="AED")
    country = Column(String(64), nullable=True)

    # OAuth tokens (store as-is; add encryption in production via settings.SECRET_KEY)
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime, nullable=True)
    api_domain = Column(String(256), nullable=True)  # Zoho: returned by token exchange

    # Status
    is_active = Column(Boolean, nullable=False, default=True)
    last_synced_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    trial_balances = relationship(
        "UAETrialBalance",
        back_populates="connected_account",
        cascade="all, delete-orphan",
    )


class UAETrialBalance(Base):
    """A trial balance synced from Zoho Books or QuickBooks."""

    __tablename__ = "uae_trial_balances"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    connected_account_id = Column(Integer, ForeignKey("uae_connected_accounts.id"), nullable=False, index=True)
    source = Column(_enum_str(AccountingSource), nullable=False)
    company_name = Column(String(512), nullable=False, default="")

    # Period
    period_start = Column(String(16), nullable=False)   # "2024-01-01"
    period_end = Column(String(16), nullable=False)     # "2024-12-31"
    currency = Column(String(8), nullable=False, default="AED")

    # Metadata
    account_count = Column(Integer, nullable=False, default=0)
    total_debits = Column(Numeric(18, 2), nullable=True)
    total_credits = Column(Numeric(18, 2), nullable=True)
    is_balanced = Column(Boolean, nullable=True)

    # Link to IFRS Statement Generator (set after generate-ifrs)
    ifrs_trial_balance_id = Column(Integer, nullable=True)   # FK to trial_balances.id

    # Raw API response for debugging
    raw_data_json = Column(_json_type, nullable=True)

    synced_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    connected_account = relationship("ConnectedAccount", back_populates="trial_balances")
    lines = relationship(
        "UAETrialBalanceLine",
        back_populates="trial_balance",
        cascade="all, delete-orphan",
        order_by="UAETrialBalanceLine.account_type, UAETrialBalanceLine.account_name",
    )


class UAETrialBalanceLine(Base):
    """Individual GL account line from a synced trial balance."""

    __tablename__ = "uae_trial_balance_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trial_balance_id = Column(Integer, ForeignKey("uae_trial_balances.id"), nullable=False, index=True)

    account_code = Column(String(64), nullable=False, default="")
    account_name = Column(String(512), nullable=False)
    account_type = Column(String(128), nullable=False, default="")   # Asset/Liability/Equity/Income/Expense

    debit = Column(Numeric(18, 2), nullable=False, default=0)
    credit = Column(Numeric(18, 2), nullable=False, default=0)
    net_balance = Column(Numeric(18, 2), nullable=False, default=0)  # debit - credit

    trial_balance = relationship("UAETrialBalance", back_populates="lines")
