"""Add missing columns/tables required for credit-notes E2E on RDS."""
from __future__ import annotations

import os

from sqlalchemy import create_engine, text

DDL = [
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
    # Advanced VAT integration
    "ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS designated_zone BOOLEAN DEFAULT FALSE",
    "ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS transaction_kind VARCHAR(16) DEFAULT 'goods'",
    "ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS dz_supplier_location VARCHAR(64)",
    "ALTER TABLE gulftax_transactions ADD COLUMN IF NOT EXISTS dz_customer_location VARCHAR(64)",
    "ALTER TABLE partial_exemption_calculations ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'draft'",
    "ALTER TABLE bad_debt_relief_claims ADD COLUMN IF NOT EXISTS claim_period VARCHAR(16)",
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
