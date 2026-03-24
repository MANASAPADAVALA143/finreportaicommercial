# Stateful R2R: company-specific learning (MindBridge-style)
from .models import Company, JournalHistory, CompanyProfile, ScoringResult
from app.core.database import engine, Base


def init_db():
    """Create stateful R2R tables on startup (companies, journal_history, company_profiles, scoring_results)."""
    import app.db.models  # noqa: F401 - register tables on Base
    Base.metadata.create_all(bind=engine)


__all__ = ["Company", "JournalHistory", "CompanyProfile", "ScoringResult", "init_db"]
