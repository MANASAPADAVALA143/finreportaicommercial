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
    import app.models.uae_accounting  # noqa: F401 - UAE Accounting (Zoho/QBO integration)
    import app.models.uae_accounting_full  # noqa: F401 - UAE Full Accounting Suite
    import app.models.fpa_master  # noqa: F401 - FP&A Master Upload (one file → all modules)
    import app.models.pipeline  # noqa: F401 - Connected bookkeeping pipeline (GL, accruals, recon)
    # R2RHistoricalEntry is already in r2r_learning (imported above) — no extra import needed
    Base.metadata.create_all(bind=engine)

    # ── Safe column / table additions for SQLite (create_all skips existing tables)
    try:
        with engine.connect() as conn:
            # meta_json column on je_account_baseline
            existing_cols = {
                row[1]
                for row in conn.execute(
                    __import__("sqlalchemy").text("PRAGMA table_info(je_account_baseline)")
                )
            }
            if "meta_json" not in existing_cols:
                conn.execute(
                    __import__("sqlalchemy").text(
                        "ALTER TABLE je_account_baseline ADD COLUMN meta_json TEXT"
                    )
                )
                conn.commit()
    except Exception:
        pass  # Non-SQLite or table doesn't exist yet — create_all handles it

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
