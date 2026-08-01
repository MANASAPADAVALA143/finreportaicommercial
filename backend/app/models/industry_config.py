"""Industry-aware workspace config — industry_config + cost_centers."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, String, Text, UniqueConstraint

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


# Canonical industry keys → display + default cost-center label
INDUSTRY_DEFAULTS: dict[str, dict[str, str]] = {
    "real_estate": {
        "industry_label": "Real Estate & Property",
        "cost_center_label": "Property",
    },
    "construction": {
        "industry_label": "Construction",
        "cost_center_label": "Site / Project",
    },
    "manufacturing": {
        "industry_label": "Manufacturing",
        "cost_center_label": "Plant / Division",
    },
    "healthcare": {
        "industry_label": "Healthcare",
        "cost_center_label": "Branch / Clinic",
    },
    "retail": {
        "industry_label": "Retail",
        "cost_center_label": "Store / Outlet",
    },
    "ca_firm": {
        "industry_label": "CA Firm / Accounting",
        "cost_center_label": "Client",
    },
    "general": {
        "industry_label": "General Business",
        "cost_center_label": "Cost Center",
    },
}


class IndustryConfig(Base):
    """Global (seeded) industry experience config — one row per industry key."""

    __tablename__ = "industry_config"

    id = Column(String(36), primary_key=True, default=_uuid)
    industry = Column(String(64), nullable=False, unique=True, index=True)
    industry_label = Column(String(128), nullable=False, default="General Business")
    cost_center_label = Column(String(64), nullable=False, default="Cost Center")
    cost_center_placeholder = Column(String(128), nullable=False, default="Select cost center...")
    ap_label = Column(String(128), nullable=False, default="Vendor Payments")
    ar_label = Column(String(128), nullable=False, default="Sales Invoices")
    sidebar_theme = Column(String(64), nullable=False, default="general")
    show_ifrs15 = Column(Boolean, nullable=False, default=False)
    show_ifrs16 = Column(Boolean, nullable=False, default=False)
    show_rera = Column(Boolean, nullable=False, default=False)
    show_ejari = Column(Boolean, nullable=False, default=False)
    show_property_tagging = Column(Boolean, nullable=False, default=True)
    show_site_tagging = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class CostCenter(Base):
    """Tenant cost centers (property / site / plant / client / etc.)."""

    __tablename__ = "cost_centers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "company_id", "code", name="uq_cost_center_tenant_co_code"),
    )

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(64), nullable=False, index=True)
    company_id = Column(String(64), nullable=False, index=True)
    name = Column(String(256), nullable=False)
    code = Column(String(64), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
