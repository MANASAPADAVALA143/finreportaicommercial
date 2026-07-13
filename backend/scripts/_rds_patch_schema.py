"""Add missing columns/tables required for credit-notes E2E on RDS."""
from __future__ import annotations

import os

from sqlalchemy import create_engine, text

DDL = [
    # ── create_client.py onboarding (tenants, workspaces, RBAC) ───────────────
    """
    CREATE TABLE IF NOT EXISTS tenants (
        id         VARCHAR(36) PRIMARY KEY,
        name       VARCHAR(256) NOT NULL,
        plan       VARCHAR(32) NOT NULL DEFAULT 'starter',
        is_demo    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS rbac_companies (
        id         VARCHAR(36) PRIMARY KEY,
        name       VARCHAR(256) NOT NULL,
        plan       VARCHAR(32) NOT NULL DEFAULT 'starter',
        created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS workspaces (
        id                      VARCHAR(36) PRIMARY KEY,
        name                    VARCHAR(256) NOT NULL,
        legal_entity_name       VARCHAR(256) NOT NULL,
        trn_number              VARCHAR(20),
        country                 VARCHAR(64) NOT NULL DEFAULT 'UAE',
        currency                VARCHAR(3) NOT NULL DEFAULT 'AED',
        fiscal_year_start_month INTEGER NOT NULL DEFAULT 1,
        fiscal_year_end_month   INTEGER NOT NULL DEFAULT 12,
        industry                VARCHAR(128),
        is_active               BOOLEAN NOT NULL DEFAULT TRUE,
        created_at              TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
        updated_at              TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS workspace_vat_settings (
        id               VARCHAR(36) PRIMARY KEY,
        workspace_id     VARCHAR(36) NOT NULL UNIQUE REFERENCES workspaces(id),
        entity_type      VARCHAR(32) DEFAULT 'mainland',
        vat_registered   BOOLEAN DEFAULT TRUE,
        standard_rate    VARCHAR(10) DEFAULT '5',
        filing_frequency VARCHAR(20) DEFAULT 'quarterly',
        notes            TEXT,
        created_at       TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS rbac_users (
        id            VARCHAR(36) PRIMARY KEY,
        company_id    VARCHAR(36) NOT NULL REFERENCES rbac_companies(id),
        name          VARCHAR(256) NOT NULL,
        email         VARCHAR(256) NOT NULL UNIQUE,
        password_hash VARCHAR(512) NOT NULL,
        role          VARCHAR(32) NOT NULL DEFAULT 'accountant',
        product_role  VARCHAR(32) NOT NULL DEFAULT 'full_access',
        tenant_id     VARCHAR(36),
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
        last_login    TIMESTAMP
    )
    """,
    "ALTER TABLE rbac_users ADD COLUMN IF NOT EXISTS product_role VARCHAR(32) NOT NULL DEFAULT 'full_access'",
    "ALTER TABLE rbac_users ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36)",
    "CREATE INDEX IF NOT EXISTS ix_rbac_users_company_id ON rbac_users (company_id)",
    "CREATE INDEX IF NOT EXISTS ix_rbac_users_email ON rbac_users (email)",
    "CREATE INDEX IF NOT EXISTS ix_rbac_users_tenant_id ON rbac_users (tenant_id)",
    """
    CREATE TABLE IF NOT EXISTS workspace_members (
        id           VARCHAR(36) PRIMARY KEY,
        workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
        user_id      VARCHAR(36) NOT NULL REFERENCES rbac_users(id),
        role         VARCHAR(32) NOT NULL DEFAULT 'accountant',
        created_at   TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
        UNIQUE (workspace_id, user_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_workspace_members_workspace_id ON workspace_members (workspace_id)",
    "CREATE INDEX IF NOT EXISTS ix_workspace_members_user_id ON workspace_members (user_id)",
    # company_id unification + AR fields on sales invoices
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS company_id VARCHAR(36)",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS supply_type VARCHAR(30) DEFAULT 'standard'",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS journal_entry_id VARCHAR(36)",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS seller_trn VARCHAR(20)",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS buyer_trn VARCHAR(20)",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS notes TEXT",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS paid_date DATE",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100)",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMP",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS last_dunning_level INTEGER DEFAULT 0",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS last_dunning_sent_at TIMESTAMP",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS dunning_count INTEGER DEFAULT 0",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
    # journal entries — align with UAEJournalEntry model
    "ALTER TABLE uae_journal_entries ADD COLUMN IF NOT EXISTS company_id VARCHAR(36)",
    "ALTER TABLE uae_journal_entries ADD COLUMN IF NOT EXISTS source VARCHAR(50)",
    "ALTER TABLE uae_journal_entries ADD COLUMN IF NOT EXISTS reference VARCHAR(100)",
    "ALTER TABLE uae_journal_entries ADD COLUMN IF NOT EXISTS posted_at TIMESTAMP",
    "ALTER TABLE uae_journal_entries ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE",
    "ALTER TABLE uae_journal_entries ADD COLUMN IF NOT EXISTS approved_by VARCHAR(200)",
    "ALTER TABLE uae_journal_entries ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP",
    "ALTER TABLE uae_journal_entries ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500)",
    # journal lines
    "ALTER TABLE uae_journal_lines ADD COLUMN IF NOT EXISTS account_id VARCHAR(36)",
    "ALTER TABLE uae_journal_lines ADD COLUMN IF NOT EXISTS account_code VARCHAR(20)",
    "ALTER TABLE uae_journal_lines ADD COLUMN IF NOT EXISTS account_name VARCHAR(200)",
    "ALTER TABLE uae_journal_lines ADD COLUMN IF NOT EXISTS description VARCHAR(300)",
    "ALTER TABLE uae_journal_lines ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(15, 2) DEFAULT 0",
    "ALTER TABLE uae_journal_lines ADD COLUMN IF NOT EXISTS cost_center VARCHAR(50)",
    "ALTER TABLE uae_journal_lines ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'AED'",
    # accounts (optional for JE)
    "ALTER TABLE uae_accounts ADD COLUMN IF NOT EXISTS company_id VARCHAR(36)",
    # ap_companies
    """
    CREATE TABLE IF NOT EXISTS ap_companies (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(36) NOT NULL,
        name VARCHAR(256) NOT NULL,
        slug VARCHAR(128) NOT NULL,
        market VARCHAR(16) DEFAULT 'uae',
        accounting_standard VARCHAR(32) DEFAULT 'IFRS',
        created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
        updated_at TIMESTAMP
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_ap_companies_tenant_id ON ap_companies (tenant_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_company_tenant_slug ON ap_companies (tenant_id, slug)",
    # gulftax_transactions (RDS shape — no FK to invoices)
    """
    CREATE TABLE IF NOT EXISTS gulftax_transactions (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(36) NOT NULL,
        company_id VARCHAR(36) NOT NULL,
        source VARCHAR(32) DEFAULT 'ap_invoiceflow',
        ap_invoice_id VARCHAR(36),
        tax_period VARCHAR(16) NOT NULL,
        transaction_date DATE NOT NULL,
        vendor_name VARCHAR(256),
        vendor_trn VARCHAR(32),
        invoice_number VARCHAR(128),
        gross_amount NUMERIC(15, 2) NOT NULL,
        vat_amount NUMERIC(15, 2) DEFAULT 0,
        vat_category VARCHAR(64) NOT NULL,
        fta_box VARCHAR(8),
        direction VARCHAR(16) DEFAULT 'input',
        status VARCHAR(16) DEFAULT 'posted',
        created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    # uae_credit_notes
    """
    CREATE TABLE IF NOT EXISTS uae_credit_notes (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(36) NOT NULL,
        company_id VARCHAR(36),
        customer_id VARCHAR(36) REFERENCES uae_customers(id),
        parent_invoice_id VARCHAR(36) NOT NULL REFERENCES uae_sales_invoices(id),
        credit_note_number VARCHAR(30) NOT NULL,
        amount NUMERIC(15, 2) NOT NULL,
        reason TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'issued',
        issued_date DATE,
        created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    # crm_contacts — required by credit_risk_service.recalc_for_customer_name (dunning E2E)
    """
    CREATE TABLE IF NOT EXISTS crm_contacts (
        id VARCHAR(36) PRIMARY KEY,
        workspace_id VARCHAR(64) NOT NULL,
        company_id VARCHAR(36),
        name VARCHAR(200) NOT NULL,
        company_name VARCHAR(200),
        email VARCHAR(200),
        phone VARCHAR(30),
        contact_type VARCHAR(20) DEFAULT 'Lead',
        source VARCHAR(50),
        assigned_to VARCHAR(200),
        notes TEXT,
        credit_score NUMERIC(5, 1),
        risk_category VARCHAR(20),
        credit_limit_aed NUMERIC(15, 2),
        created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_crm_contacts_workspace_id ON crm_contacts (workspace_id)",
    "CREATE INDEX IF NOT EXISTS ix_crm_contacts_company_id ON crm_contacts (company_id)",
    """
    CREATE TABLE IF NOT EXISTS uae_recurring_invoices (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(36) NOT NULL,
        company_id VARCHAR(36),
        customer_id VARCHAR(36) NOT NULL REFERENCES uae_customers(id),
        description VARCHAR(500) NOT NULL,
        amount NUMERIC(15, 2) NOT NULL,
        vat_rate NUMERIC(5, 2) DEFAULT 5,
        recurrence_type VARCHAR(20) NOT NULL,
        interval INTEGER DEFAULT 1,
        start_date DATE NOT NULL,
        next_due_date DATE NOT NULL,
        end_date DATE,
        status VARCHAR(20) DEFAULT 'active',
        last_generated_at TIMESTAMP,
        generated_count INTEGER DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_uae_recurring_invoices_tenant_id ON uae_recurring_invoices (tenant_id)",
    "CREATE INDEX IF NOT EXISTS ix_uae_recurring_invoices_company_id ON uae_recurring_invoices (company_id)",
    "ALTER TABLE uae_sales_invoices ADD COLUMN IF NOT EXISTS recurring_template_id VARCHAR(36)",
    """
    CREATE TABLE IF NOT EXISTS accounting_periods (
        id VARCHAR(36) PRIMARY KEY,
        workspace_id VARCHAR(36) NOT NULL,
        company_id VARCHAR(36),
        period_number INTEGER NOT NULL,
        period_name VARCHAR(32) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        locked_by VARCHAR(36),
        locked_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    # GulfTax companies — extend legacy FinReportAI companies table for ported ORM
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_license_number VARCHAR(100)",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS trn VARCHAR(50)",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50)",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS free_zone_name VARCHAR(255)",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_qfzp BOOLEAN DEFAULT FALSE",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_registered BOOLEAN DEFAULT FALSE",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS ct_registered BOOLEAN DEFAULT FALSE",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS annual_revenue_aed DOUBLE PRECISION",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS asp_appointed BOOLEAN DEFAULT FALSE",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS country VARCHAR(50) DEFAULT 'UAE'",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS fiscal_year_start INTEGER DEFAULT 1",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_registered_date DATE",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan VARCHAR(50) DEFAULT 'starter'",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS settings JSONB",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS external_id VARCHAR(64)",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64)",
    # VAT recon — reconciliation_results extensions (ported GulfTax table)
    "ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS tax_period VARCHAR(16)",
    "ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS period_start DATE",
    "ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS period_end DATE",
    "ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS box_breakdown JSONB",
    "ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS source VARCHAR(64)",
    "ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS override_reason VARCHAR(2000)",
    """
    CREATE INDEX IF NOT EXISTS ix_reconciliation_results_tax_period
    ON reconciliation_results (company_id, tax_period)
    """,
    # Advanced VAT integration — create tables first, then column patches
    """
    CREATE TABLE IF NOT EXISTS partial_exemption_calculations (
        id                VARCHAR(36) PRIMARY KEY,
        tenant_id         VARCHAR(36) NOT NULL,
        company_id        VARCHAR(36) NOT NULL,
        period            VARCHAR(16) NOT NULL,
        period_type       VARCHAR(16) DEFAULT 'quarterly',
        taxable_supplies  NUMERIC(15, 2) NOT NULL,
        exempt_supplies   NUMERIC(15, 2) NOT NULL,
        input_vat_paid    NUMERIC(15, 2) NOT NULL,
        recovery_pct      NUMERIC(8, 4) NOT NULL,
        recoverable_vat   NUMERIC(15, 2) NOT NULL,
        irrecoverable_vat NUMERIC(15, 2) NOT NULL,
        breakdown         JSONB,
        status            VARCHAR(32) DEFAULT 'draft',
        created_at        TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
        updated_at        TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS bad_debt_relief_claims (
        id                 VARCHAR(36) PRIMARY KEY,
        tenant_id          VARCHAR(36) NOT NULL,
        company_id         VARCHAR(36) NOT NULL,
        invoice_number     VARCHAR(128) NOT NULL,
        invoice_date       DATE NOT NULL,
        due_date           DATE NOT NULL,
        invoice_amount     NUMERIC(15, 2) NOT NULL,
        vat_amount         NUMERIC(15, 2) NOT NULL,
        status             VARCHAR(32) DEFAULT 'draft',
        eligible           BOOLEAN DEFAULT FALSE,
        eligibility_reason TEXT,
        claim_period       VARCHAR(16),
        extra              JSONB DEFAULT '{}',
        created_at         TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
        updated_at         TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    "ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS designated_zone BOOLEAN DEFAULT FALSE",
    "ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS transaction_kind VARCHAR(16) DEFAULT 'goods'",
    "ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS dz_supplier_location VARCHAR(64)",
    "ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS dz_customer_location VARCHAR(64)",
    "ALTER TABLE partial_exemption_calculations ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'draft'",
    "ALTER TABLE bad_debt_relief_claims ADD COLUMN IF NOT EXISTS claim_period VARCHAR(16)",
  # gulftax_ct_returns — UAE CT return workflow on RDS (separate from ported ct_returns)
    """
    CREATE TABLE IF NOT EXISTS gulftax_ct_returns (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(36) NOT NULL,
        company_id VARCHAR(36) NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        revenue NUMERIC(15, 2),
        accounting_profit NUMERIC(15, 2),
        non_deductible_expenses NUMERIC(15, 2) DEFAULT 0,
        taxable_income NUMERIC(15, 2),
        ct_payable_aed NUMERIC(15, 2),
        sbr_eligible BOOLEAN NOT NULL DEFAULT FALSE,
        qfzp_eligible BOOLEAN NOT NULL DEFAULT FALSE,
        free_zone_status VARCHAR(32) DEFAULT 'mainland',
        free_zone_income NUMERIC(15, 2) DEFAULT 0,
        breakdown JSONB,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        override_reason TEXT,
        approved_at TIMESTAMP,
        filed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
        updated_at TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_gulftax_ct_returns_tenant_id ON gulftax_ct_returns (tenant_id)",
    "CREATE INDEX IF NOT EXISTS ix_gulftax_ct_returns_company_id ON gulftax_ct_returns (company_id)",
    "CREATE INDEX IF NOT EXISTS ix_gulftax_ct_returns_status ON gulftax_ct_returns (status)",
    """
    CREATE TABLE IF NOT EXISTS einvoicing_submissions (
        id VARCHAR(36) PRIMARY KEY,
        tenant_id VARCHAR(36) NOT NULL,
        company_id VARCHAR(36) NOT NULL,
        invoice_id VARCHAR(36),
        invoice_number VARCHAR(128) NOT NULL,
        record_type VARCHAR(32) NOT NULL DEFAULT 'outbound_ar',
        submission_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        xml_payload TEXT,
        submitted_at TIMESTAMP,
        asp_reference VARCHAR(128),
        error_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
        updated_at TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_tenant_id ON einvoicing_submissions (tenant_id)",
    "CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_company_id ON einvoicing_submissions (company_id)",
    "CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_invoice_id ON einvoicing_submissions (invoice_id)",
    "CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_status ON einvoicing_submissions (submission_status)",
    "CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_record_type ON einvoicing_submissions (record_type)",
    # workspace_audit_log — audit trail for audit export pack + UAE controls
    """
    CREATE TABLE IF NOT EXISTS workspace_audit_log (
        id            VARCHAR(36) PRIMARY KEY,
        workspace_id  VARCHAR(100) NOT NULL,
        company_id    VARCHAR(100),
        action        VARCHAR(50) NOT NULL,
        entity_type   VARCHAR(50) NOT NULL,
        entity_id     VARCHAR(100),
        user_email    VARCHAR(200),
        details       JSONB,
        created_at    TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_workspace_audit_log_workspace_id ON workspace_audit_log (workspace_id)",
    "CREATE INDEX IF NOT EXISTS ix_workspace_audit_log_company_id ON workspace_audit_log (company_id)",
    "CREATE INDEX IF NOT EXISTS ix_workspace_audit_log_action ON workspace_audit_log (action)",
    "CREATE INDEX IF NOT EXISTS ix_workspace_audit_log_created_at ON workspace_audit_log (created_at)",
    # rev_rec_leakage_snapshots — monthly revenue leakage rollup (IFRS 15 three-way match)
    """
    CREATE TABLE IF NOT EXISTS rev_rec_leakage_snapshots (
        id                      VARCHAR(36) PRIMARY KEY,
        workspace_id            VARCHAR(36) NOT NULL,
        company_id              VARCHAR(36),
        period                  VARCHAR(7) NOT NULL,
        leakage_total           DOUBLE PRECISION NOT NULL DEFAULT 0,
        leakage_pct             DOUBLE PRECISION NOT NULL DEFAULT 0,
        expected_revenue_total  DOUBLE PRECISION NOT NULL DEFAULT 0,
        item_count              INTEGER NOT NULL DEFAULT 0,
        prior_period            VARCHAR(7),
        prior_leakage_total     DOUBLE PRECISION,
        trend_amount            DOUBLE PRECISION,
        trend_direction         VARCHAR(16),
        items_json              JSONB NOT NULL DEFAULT '[]',
        created_at              TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
        updated_at              TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
        UNIQUE (workspace_id, company_id, period)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_rev_rec_leakage_workspace_id ON rev_rec_leakage_snapshots (workspace_id)",
    "CREATE INDEX IF NOT EXISTS ix_rev_rec_leakage_company_id ON rev_rec_leakage_snapshots (company_id)",
    "CREATE INDEX IF NOT EXISTS ix_rev_rec_leakage_period ON rev_rec_leakage_snapshots (period)",
]


def main() -> None:
    url = os.environ["DATABASE_URL"]
    engine = create_engine(url)
    with engine.begin() as conn:
        for stmt in DDL:
            conn.execute(text(stmt))
            print("OK:", stmt.strip().split("\n")[0][:80])
    print("Schema patch complete.")


if __name__ == "__main__":
    main()
