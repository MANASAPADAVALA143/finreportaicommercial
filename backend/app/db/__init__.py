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
    import app.models.fpa_suite  # noqa: F401 - FP&A extended suite snapshots
    import app.models.ifrs_agentic  # noqa: F401 - multi-agent IFRS orchestration
    import app.models.financial_statement_vault  # noqa: F401 - IAS 1 comparative vault
    import app.models.cfo_command_center  # noqa: F401 - CFO Command Center agent runs / briefings
    import app.models.audit_intelligence  # noqa: F401 - Audit Intelligence agent runs
    import app.models.history_models  # noqa: F401 - Historical Intelligence baselines
    import app.models.month_end_close  # noqa: F401 - Month-end close runs
    import app.models.earnings_review  # noqa: F401 - Earnings Reviewer
    import app.models.gl_reconciliation  # noqa: F401 - GL Reconciler
    import app.models.financial_model  # noqa: F401 - FP&A Model Builder
    import app.models.users  # noqa: F401 - RBAC users/companies/audit
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        from app.services.seed_ifrs_master import seed_if_empty
        from app.services.auth_service import ensure_seed_data

        seed_if_empty(db)
        ensure_seed_data()
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
