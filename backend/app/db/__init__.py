# Stateful R2R: company-specific learning (MindBridge-style)
from .models import Company, JournalHistory, CompanyProfile, ScoringResult, IFRSLineItemLegacy, IFRSLinkLegacy
from app.core.database import engine, Base, SessionLocal


def init_db():
    """Create DB tables on startup (R2R + IFRS Week 1 + reference models)."""
    import app.db.models  # noqa: F401 - register tables on Base
    import app.models.ifrs_statement  # noqa: F401 - Week 1 TB / GL mapping
    import app.models.bank_recon  # noqa: F401 - enterprise bank reconciliation
    import app.models.bookkeeping  # noqa: F401 - bookkeeping autopilot
    import app.models.connector_client  # noqa: F401 - Tally connector API keys
    import app.models.r2r_learning  # noqa: F401 - R2R client learning loop
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        from app.services.seed_ifrs_master import seed_if_empty

        seed_if_empty(db)
    finally:
        db.close()


__all__ = [
    "Company",
    "JournalHistory",
    "CompanyProfile",
    "ScoringResult",
    "IFRSLineItemLegacy",
    "IFRSLinkLegacy",
    "engine",
    "SessionLocal",
    "init_db",
]
