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
    import app.models.workspace  # noqa: F401 - Multi-tenant workspaces
    import app.models.uae_ap  # noqa: F401 - UAE AP vendors & purchase invoices
    import app.models.company_setup  # noqa: F401 - Company onboarding wizard
    import app.models.workspace_notification  # noqa: F401 - In-app notifications
    import app.models.workspace_audit  # noqa: F401 - Workspace audit log
    import app.models.crm  # noqa: F401 - CRM contacts/deals/quotes
    import app.models.ifrs16_lease  # noqa: F401 - IFRS 16 lease register
    import app.models.ifrs15_contract  # noqa: F401 - IFRS 15 contracts
    import app.models.ifrs9_ecl  # noqa: F401 - IFRS 9 ECL portfolios
    import app.models.uae_account_classification  # noqa: F401 - GL account FS/CIT classification
    import app.models.client_data  # noqa: F401 - AP + GulfTax client data (AWS RDS)
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
            ar_cols = {
                row[1]
                for row in conn.execute(
                    __import__("sqlalchemy").text("PRAGMA table_info(uae_sales_invoices)")
                )
            }
            for col, ddl in (
                ("sent_at", "ALTER TABLE uae_sales_invoices ADD COLUMN sent_at DATETIME"),
                ("paid_date", "ALTER TABLE uae_sales_invoices ADD COLUMN paid_date DATE"),
                ("payment_reference", "ALTER TABLE uae_sales_invoices ADD COLUMN payment_reference VARCHAR(100)"),
                ("updated_at", "ALTER TABLE uae_sales_invoices ADD COLUMN updated_at DATETIME"),
                ("overdue_notified_at", "ALTER TABLE uae_sales_invoices ADD COLUMN overdue_notified_at DATETIME"),
                ("last_dunning_level", "ALTER TABLE uae_sales_invoices ADD COLUMN last_dunning_level INTEGER DEFAULT 0"),
                ("last_dunning_sent_at", "ALTER TABLE uae_sales_invoices ADD COLUMN last_dunning_sent_at DATETIME"),
                ("dunning_count", "ALTER TABLE uae_sales_invoices ADD COLUMN dunning_count INTEGER DEFAULT 0"),
            ):
                if ar_cols and col not in ar_cols:
                    conn.execute(__import__("sqlalchemy").text(ddl))
            if ar_cols:
                conn.commit()
            je_cols = {
                row[1]
                for row in conn.execute(
                    __import__("sqlalchemy").text("PRAGMA table_info(uae_journal_entries)")
                )
            }
            for col, ddl in (
                ("approved_by", "ALTER TABLE uae_journal_entries ADD COLUMN approved_by VARCHAR(200)"),
                ("approved_at", "ALTER TABLE uae_journal_entries ADD COLUMN approved_at DATETIME"),
                ("rejection_reason", "ALTER TABLE uae_journal_entries ADD COLUMN rejection_reason VARCHAR(500)"),
            ):
                if je_cols and col not in je_cols:
                    conn.execute(__import__("sqlalchemy").text(ddl))
            if je_cols:
                conn.commit()
            crm_cols = {
                row[1]
                for row in conn.execute(
                    __import__("sqlalchemy").text("PRAGMA table_info(crm_contacts)")
                )
            }
            for col, ddl in (
                ("credit_score", "ALTER TABLE crm_contacts ADD COLUMN credit_score NUMERIC(5,1)"),
                ("risk_category", "ALTER TABLE crm_contacts ADD COLUMN risk_category VARCHAR(20)"),
                ("credit_limit_aed", "ALTER TABLE crm_contacts ADD COLUMN credit_limit_aed NUMERIC(15,2)"),
            ):
                if crm_cols and col not in crm_cols:
                    conn.execute(__import__("sqlalchemy").text(ddl))
            if crm_cols:
                conn.commit()

            pc_cols = {
                row[1]
                for row in conn.execute(
                    __import__("sqlalchemy").text("PRAGMA table_info(uae_period_closes)")
                )
            }
            for col, ddl in (
                ("multi_currency_revaluation", "ALTER TABLE uae_period_closes ADD COLUMN multi_currency_revaluation BOOLEAN DEFAULT 0"),
                ("intercompany_balances_reconciled", "ALTER TABLE uae_period_closes ADD COLUMN intercompany_balances_reconciled BOOLEAN DEFAULT 0"),
                ("ifrs_adjustments_posted", "ALTER TABLE uae_period_closes ADD COLUMN ifrs_adjustments_posted BOOLEAN DEFAULT 0"),
                ("audit_trail_exported", "ALTER TABLE uae_period_closes ADD COLUMN audit_trail_exported BOOLEAN DEFAULT 0"),
            ):
                if pc_cols and col not in pc_cols:
                    conn.execute(__import__("sqlalchemy").text(ddl))
            if pc_cols:
                conn.commit()

            mt_cols = {
                row[1]
                for row in conn.execute(
                    __import__("sqlalchemy").text("PRAGMA table_info(mapping_templates)")
                )
            }
            if mt_cols and "is_system_template" not in mt_cols:
                conn.execute(
                    __import__("sqlalchemy").text(
                        "ALTER TABLE mapping_templates ADD COLUMN is_system_template BOOLEAN DEFAULT 0"
                    )
                )
                conn.commit()

            rbac_cols = {
                row[1]
                for row in conn.execute(
                    __import__("sqlalchemy").text("PRAGMA table_info(rbac_users)")
                )
            }
            if rbac_cols and "product_role" not in rbac_cols:
                conn.execute(
                    __import__("sqlalchemy").text(
                        "ALTER TABLE rbac_users ADD COLUMN product_role VARCHAR(32) DEFAULT 'full_access'"
                    )
                )
                conn.commit()
    except Exception:
        pass  # Non-SQLite or table doesn't exist yet — create_all handles it

    db = SessionLocal()
    try:
        from app.services.seed_ifrs_master import seed_if_empty, upsert_missing_master_lines
        from app.services.seed_industry_templates import seed_industry_templates
        from app.services.auth_service import ensure_seed_data

        seed_if_empty(db)
        upsert_missing_master_lines(db)
        seed_industry_templates(db)
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
