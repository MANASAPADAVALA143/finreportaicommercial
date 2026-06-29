"""Add workspaces multi-tenant tables and UAE AP tables.

Revision ID: 012_workspaces
Revises: 011_je_narratives
Create Date: 2026-06-05
"""

from alembic import op
import sqlalchemy as sa

revision = "012_workspaces"
down_revision = "011_je_narratives"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("legal_entity_name", sa.String(256), nullable=False),
        sa.Column("trn_number", sa.String(20), nullable=True),
        sa.Column("country", sa.String(64), nullable=False, server_default="UAE"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="AED"),
        sa.Column("fiscal_year_start_month", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("fiscal_year_end_month", sa.Integer(), nullable=False, server_default="12"),
        sa.Column("industry", sa.String(128), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "workspace_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False, index=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("rbac_users.id"), nullable=False, index=True),
        sa.Column("role", sa.String(32), nullable=False, server_default="accountant"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_workspace_user"),
    )

    op.create_table(
        "workspace_vat_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False, unique=True),
        sa.Column("entity_type", sa.String(32), server_default="mainland"),
        sa.Column("vat_registered", sa.Boolean(), server_default=sa.true()),
        sa.Column("standard_rate", sa.String(10), server_default="5"),
        sa.Column("filing_frequency", sa.String(20), server_default="quarterly"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "uae_vendors",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(64), nullable=False, index=True),
        sa.Column("workspace_id", sa.String(36), nullable=True, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("trn", sa.String(20), nullable=True),
        sa.Column("email", sa.String(200), nullable=True),
        sa.Column("phone", sa.String(30), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("emirate", sa.String(50), nullable=True),
        sa.Column("currency", sa.String(3), server_default="AED"),
        sa.Column("payment_terms_days", sa.Integer(), server_default="30"),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "uae_purchase_invoices",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(64), nullable=False, index=True),
        sa.Column("workspace_id", sa.String(36), nullable=True, index=True),
        sa.Column("invoice_number", sa.String(50), nullable=False),
        sa.Column("vendor_id", sa.String(36), sa.ForeignKey("uae_vendors.id"), nullable=False),
        sa.Column("invoice_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("subtotal", sa.Numeric(15, 2), server_default="0"),
        sa.Column("vat_amount", sa.Numeric(15, 2), server_default="0"),
        sa.Column("total_amount", sa.Numeric(15, 2), server_default="0"),
        sa.Column("outstanding", sa.Numeric(15, 2), server_default="0"),
        sa.Column("status", sa.String(20), server_default="draft"),
        sa.Column("vat_treatment", sa.String(30), server_default="standard_rated"),
        sa.Column("journal_entry_id", sa.String(36), sa.ForeignKey("uae_journal_entries.id"), nullable=True),
        sa.Column("source", sa.String(30), server_default="manual"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "uae_purchase_invoice_lines",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("invoice_id", sa.String(36), sa.ForeignKey("uae_purchase_invoices.id"), nullable=False),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 3), server_default="1"),
        sa.Column("unit_price", sa.Numeric(15, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(15, 2), server_default="0"),
        sa.Column("vat_rate", sa.Numeric(5, 2), server_default="5"),
        sa.Column("vat_amount", sa.Numeric(15, 2), server_default="0"),
        sa.Column("account_code", sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("uae_purchase_invoice_lines")
    op.drop_table("uae_purchase_invoices")
    op.drop_table("uae_vendors")
    op.drop_table("workspace_vat_settings")
    op.drop_table("workspace_members")
    op.drop_table("workspaces")
