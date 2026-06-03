"""
FP&A Master Data Model
=======================
One upload → all modules. Stores parsed rows from the master CSV/Excel file.
Each row carries a `section` tag (PL / BS / HC / ARR) that routes it to the
correct module's data loader.
"""
from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, String, Text, Index
from app.core.database import Base


class FpaMasterRow(Base):
    """One data row from a master FP&A upload."""
    __tablename__ = "fpa_master_data"

    id              = Column(Integer, primary_key=True, autoincrement=True)

    # Upload session — groups all rows from one upload
    upload_id       = Column(String(64), nullable=False, index=True)
    uploaded_at     = Column(DateTime, default=datetime.utcnow)

    # Routing
    section         = Column(String(16), nullable=False, index=True)  # PL | BS | HC | ARR
    currency        = Column(String(8),  nullable=False, default="AED")
    fiscal_year     = Column(String(16), default="FY2025")

    # Account identity
    account_code    = Column(String(32),  nullable=True)
    account_name    = Column(String(255), nullable=False)
    account_type    = Column(String(32),  nullable=True)   # income | expense | asset | liability | equity
    category        = Column(String(128), nullable=True)
    department      = Column(String(128), nullable=True)
    owner           = Column(String(128), nullable=True)

    # Financials (stored as JSON arrays — 12 months)
    monthly_actuals  = Column(Text, nullable=True)   # JSON [jan, feb, ..., dec]
    monthly_budgets  = Column(Text, nullable=True)   # JSON [jan, feb, ..., dec]

    fy_prior_actual  = Column(Float, default=0.0)   # FY2024 actual total
    opening_cash     = Column(Float, default=0.0)   # BS only

    notes           = Column(Text, nullable=True)

    # Company / tenant
    company_id      = Column(String(64), default="default", index=True)

    __table_args__ = (
        Index("ix_fpa_master_upload_section", "upload_id", "section"),
        Index("ix_fpa_master_company_section", "company_id", "section", "currency"),
    )

    def actuals_list(self) -> list[float]:
        try:
            return json.loads(self.monthly_actuals or "[]")
        except Exception:
            return [0.0] * 12

    def budgets_list(self) -> list[float]:
        try:
            return json.loads(self.monthly_budgets or "[]")
        except Exception:
            return [0.0] * 12

    @property
    def annual_actual(self) -> float:
        return sum(self.actuals_list())

    @property
    def annual_budget(self) -> float:
        return sum(self.budgets_list())

    def to_dict(self) -> dict:
        return {
            "id":             self.id,
            "upload_id":      self.upload_id,
            "section":        self.section,
            "currency":       self.currency,
            "fiscal_year":    self.fiscal_year,
            "account_code":   self.account_code,
            "account_name":   self.account_name,
            "account_type":   self.account_type,
            "category":       self.category,
            "department":     self.department,
            "owner":          self.owner,
            "monthly_actuals": self.actuals_list(),
            "monthly_budgets": self.budgets_list(),
            "annual_actual":  self.annual_actual,
            "annual_budget":  self.annual_budget,
            "fy_prior_actual": self.fy_prior_actual,
            "opening_cash":   self.opening_cash,
            "notes":          self.notes,
        }
