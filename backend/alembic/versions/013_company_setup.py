"""Company onboarding tables — profiles, periods, controls, module roles.

Revision ID: 013_company_setup
Revises: 012_workspaces
Create Date: 2026-06-08
"""

from alembic import op
import sqlalchemy as sa

revision = "013_company_setup"
down_revision = "012_workspaces"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "uae_company_profiles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False, index=True),
        sa.Column("company_name", sa.String(256), nullable=False),
        sa.Column("trade_name", sa.String(256), nullable=True),
        sa.Column("legal_type", sa.String(64), nullable=True),
        sa.Column("trn", sa.String(20), nullable=True),
        sa.Column("license_number", sa.String(64), nullable=True),
        sa.Column("license_authority", sa.String(128), nullable=True),
        sa.Column("base_currency", sa.String(3), nullable=False, server_default="AED"),
        sa.Column("reporting_standard", sa.String(32), nullable=False, server_default="IFRS"),
        sa.Column("financial_year_start", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("industry", sa.String(64), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("email", sa.String(200), nullable=True),
        sa.Column("website", sa.String(256), nullable=True),
        sa.Column("logo_url", sa.String(512), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="setup"),
        sa.Column("setup_step", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("coa_option", sa.String(20), nullable=True),
        sa.Column("opening_balance_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "accounting_periods",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False, index=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("uae_company_profiles.id"), nullable=True, index=True),
        sa.Column("period_number", sa.Integer(), nullable=False),
        sa.Column("period_name", sa.String(32), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("locked_by", sa.String(36), nullable=True),
        sa.Column("locked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("workspace_id", "company_id", "period_number", name="uq_period"),
    )

    op.create_table(
        "accounting_controls",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False, unique=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("uae_company_profiles.id"), nullable=True),
        sa.Column("je_approval_threshold_aed", sa.Numeric(15, 2), nullable=True),
        sa.Column("allow_backdating", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("max_backdate_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("require_docs_account_ids", sa.Text(), nullable=True),
        sa.Column("dual_approval_account_ids", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "workspace_user_roles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False, index=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("rbac_users.id"), nullable=False, index=True),
        sa.Column("module", sa.String(64), nullable=False),
        sa.Column("role", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("workspace_id", "user_id", "module", name="uq_ws_user_module"),
    )


def downgrade() -> None:
    op.drop_table("workspace_user_roles")
    op.drop_table("accounting_controls")
    op.drop_table("accounting_periods")
    op.drop_table("uae_company_profiles")
