"""Industry config + cost centers + workspace industry columns.

Revision ID: 031_industry_aware_workspace
Revises: 030_ap_payment_run_items
Create Date: 2026-08-01
"""

from __future__ import annotations

from alembic import op

revision = "031_industry_aware_workspace"
down_revision = "030_ap_payment_run_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS industry_label VARCHAR(128) DEFAULT 'Cost Center'
        """
    )
    # Keep industry default general when null
    op.execute(
        """
        UPDATE workspaces SET industry = 'general' WHERE industry IS NULL OR industry = ''
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS industry_config (
            id VARCHAR(36) PRIMARY KEY,
            industry VARCHAR(64) NOT NULL UNIQUE,
            industry_label VARCHAR(128) NOT NULL DEFAULT 'General Business',
            cost_center_label VARCHAR(64) NOT NULL DEFAULT 'Cost Center',
            cost_center_placeholder VARCHAR(128) NOT NULL DEFAULT 'Select cost center...',
            ap_label VARCHAR(128) NOT NULL DEFAULT 'Vendor Payments',
            ar_label VARCHAR(128) NOT NULL DEFAULT 'Sales Invoices',
            sidebar_theme VARCHAR(64) NOT NULL DEFAULT 'general',
            show_ifrs15 BOOLEAN NOT NULL DEFAULT FALSE,
            show_ifrs16 BOOLEAN NOT NULL DEFAULT FALSE,
            show_rera BOOLEAN NOT NULL DEFAULT FALSE,
            show_ejari BOOLEAN NOT NULL DEFAULT FALSE,
            show_property_tagging BOOLEAN NOT NULL DEFAULT TRUE,
            show_site_tagging BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_industry_config_industry ON industry_config (industry)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS cost_centers (
            id VARCHAR(36) PRIMARY KEY,
            tenant_id VARCHAR(64) NOT NULL,
            company_id VARCHAR(64) NOT NULL,
            name VARCHAR(256) NOT NULL,
            code VARCHAR(64) NOT NULL,
            description TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_cost_centers_tenant_id ON cost_centers (tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_cost_centers_company_id ON cost_centers (company_id)"
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_center_tenant_co_code
        ON cost_centers (tenant_id, company_id, code)
        """
    )

    # Seed industry_config (idempotent — explicit UUIDs work on Postgres + SQLite)
    seeds = [
        (
            "a1000001-0001-4000-8000-000000000001",
            "real_estate",
            "Real Estate & Property",
            "Property",
            "Select property...",
            "Vendor Payments",
            "Rent & Sales Invoices",
            "real_estate",
            "TRUE",
            "TRUE",
            "TRUE",
            "TRUE",
            "TRUE",
            "FALSE",
        ),
        (
            "a1000001-0001-4000-8000-000000000002",
            "construction",
            "Construction",
            "Site / Project",
            "Select site...",
            "Subcontractor Invoices",
            "Progress Claims",
            "construction",
            "FALSE",
            "FALSE",
            "FALSE",
            "FALSE",
            "TRUE",
            "TRUE",
        ),
        (
            "a1000001-0001-4000-8000-000000000003",
            "manufacturing",
            "Manufacturing",
            "Plant / Division",
            "Select plant...",
            "Supplier Invoices",
            "Customer Invoices",
            "manufacturing",
            "FALSE",
            "FALSE",
            "FALSE",
            "FALSE",
            "TRUE",
            "FALSE",
        ),
        (
            "a1000001-0001-4000-8000-000000000004",
            "healthcare",
            "Healthcare",
            "Branch / Clinic",
            "Select branch...",
            "Supplier Invoices",
            "Patient Billing",
            "healthcare",
            "FALSE",
            "TRUE",
            "FALSE",
            "FALSE",
            "TRUE",
            "FALSE",
        ),
        (
            "a1000001-0001-4000-8000-000000000005",
            "retail",
            "Retail",
            "Store / Outlet",
            "Select store...",
            "Supplier Invoices",
            "Sales Invoices",
            "retail",
            "FALSE",
            "TRUE",
            "FALSE",
            "FALSE",
            "TRUE",
            "FALSE",
        ),
        (
            "a1000001-0001-4000-8000-000000000006",
            "ca_firm",
            "CA Firm / Accounting",
            "Client",
            "Select client...",
            "Vendor Invoices",
            "Client Billing",
            "ca_firm",
            "TRUE",
            "TRUE",
            "FALSE",
            "FALSE",
            "TRUE",
            "FALSE",
        ),
        (
            "a1000001-0001-4000-8000-000000000007",
            "general",
            "General Business",
            "Cost Center",
            "Select cost center...",
            "Vendor Payments",
            "Sales Invoices",
            "general",
            "FALSE",
            "FALSE",
            "FALSE",
            "FALSE",
            "TRUE",
            "FALSE",
        ),
    ]
    for (
        row_id,
        industry,
        industry_label,
        cc_label,
        cc_ph,
        ap_label,
        ar_label,
        theme,
        ifrs15,
        ifrs16,
        rera,
        ejari,
        prop,
        site,
    ) in seeds:
        op.execute(
            f"""
            INSERT INTO industry_config (
                id, industry, industry_label, cost_center_label, cost_center_placeholder,
                ap_label, ar_label, sidebar_theme,
                show_ifrs15, show_ifrs16, show_rera, show_ejari,
                show_property_tagging, show_site_tagging, created_at
            )
            SELECT
                '{row_id}', '{industry}', '{industry_label}', '{cc_label}', '{cc_ph}',
                '{ap_label}', '{ar_label}', '{theme}',
                {ifrs15}, {ifrs16}, {rera}, {ejari},
                {prop}, {site}, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (
                SELECT 1 FROM industry_config WHERE industry = '{industry}'
            )
            """
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS cost_centers")
    op.execute("DROP TABLE IF EXISTS industry_config")
    op.execute("ALTER TABLE workspaces DROP COLUMN IF EXISTS industry_label")
