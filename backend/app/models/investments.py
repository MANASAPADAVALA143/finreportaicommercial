"""Investment portfolio for the Investment Agent: holdings and month-end valuations.

A holding belongs to one workspace + company (uae_company_profiles.id). Valuations are month-end
market values in the company's reporting currency (local_value keeps the holding-currency amount).
ifrs9_category drives where fair-value movements go: fvtpl → profit or loss, fvoci → OCI reserve,
amortised_cost → carried at cost (no fair-value journal).
"""

from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class InvestmentHolding(Base):
    __tablename__ = "investment_holdings"
    __table_args__ = (UniqueConstraint("workspace_id", "company_id", "code", name="uq_investment_holding"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(String(50), nullable=False, index=True)
    company_id = Column(String(50), nullable=False, index=True)
    code = Column(String(60), nullable=False)  # ISIN, ticker or internal reference
    name = Column(String(200), nullable=False)
    asset_class = Column(String(30), nullable=False)  # equity | bond | sukuk | fund | deposit | other
    ifrs9_category = Column(String(20), nullable=False, default="fvtpl")  # fvtpl | fvoci | amortised_cost
    issuer = Column(String(200), nullable=True)
    sector = Column(String(100), nullable=True)
    country = Column(String(60), nullable=True)
    currency = Column(String(3), nullable=False, default="AED")
    quantity = Column(Float, nullable=True)
    cost = Column(Float, nullable=False, default=0.0)
    acquired_on = Column(Date, nullable=True)
    maturity_date = Column(Date, nullable=True)
    coupon_rate = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class InvestmentValuation(Base):
    __tablename__ = "investment_valuations"
    __table_args__ = (UniqueConstraint("holding_id", "as_of", name="uq_investment_valuation"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    holding_id = Column(Integer, ForeignKey("investment_holdings.id", ondelete="CASCADE"), nullable=False, index=True)
    as_of = Column(Date, nullable=False)
    price = Column(Float, nullable=True)
    market_value = Column(Float, nullable=False)  # reporting currency
    local_value = Column(Float, nullable=True)  # holding currency
    income = Column(Float, nullable=True)  # dividends / coupons received in the month
    source = Column(String(60), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
