"""Group intelligence: ownership, intercompany matches, financial snapshots, parent entity.

Revision ID: 034_group_intelligence
Revises: 033_rera_os
Create Date: 2026-11-17
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "034_group_intelligence"
down_revision = "033_rera_os"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("uae_company_profiles") as batch:
        batch.add_column(sa.Column("parent_company_id", sa.String(length=36), nullable=True))
        batch.create_index("ix_uae_company_profiles_parent_company_id", ["parent_company_id"])

    op.create_table(
        "group_entity_ownership",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("workspace_id", sa.String(length=36), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("company_id", sa.String(length=36), sa.ForeignKey("uae_company_profiles.id"), nullable=False),
        sa.Column("owner_company_id", sa.String(length=36), sa.ForeignKey("uae_company_profiles.id"), nullable=True),
        sa.Column("ownership_percent", sa.Numeric(7, 4), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("created_by", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_group_entity_ownership_workspace_id", "group_entity_ownership", ["workspace_id"])
    op.create_index("ix_group_entity_ownership_company_id", "group_entity_ownership", ["company_id"])
    op.create_index("ix_group_entity_ownership_owner_company_id", "group_entity_ownership", ["owner_company_id"])
    op.create_index("ix_group_ownership_ws_company", "group_entity_ownership", ["workspace_id", "company_id"])

    op.create_table(
        "group_financial_snapshots",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("workspace_id", sa.String(length=36), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("reporting_currency", sa.String(length=3), nullable=False),
        sa.Column("company_set_key", sa.String(length=64), nullable=False),
        sa.Column("company_ids", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("kpis", sa.JSON(), nullable=False),
        sa.Column("methodology", sa.JSON(), nullable=False),
        sa.Column("limitations", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_group_financial_snapshots_workspace_id", "group_financial_snapshots", ["workspace_id"])
    op.create_index("ix_group_financial_snapshots_created_at", "group_financial_snapshots", ["created_at"])
    op.create_index("ix_group_snapshot_ws_period", "group_financial_snapshots", ["workspace_id", "period"])
    op.create_index("ix_group_financial_snapshots_company_set_key", "group_financial_snapshots", ["company_set_key"])

    op.create_table(
        "group_intercompany_matches",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("workspace_id", sa.String(length=36), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("snapshot_id", sa.String(length=36), sa.ForeignKey("group_financial_snapshots.id"), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("reporting_currency", sa.String(length=3), nullable=False),
        sa.Column("reference", sa.String(length=100), nullable=False),
        sa.Column("seller_company_id", sa.String(length=36), nullable=True),
        sa.Column("buyer_company_id", sa.String(length=36), nullable=True),
        sa.Column("seller_name", sa.String(length=256), nullable=True),
        sa.Column("buyer_name", sa.String(length=256), nullable=True),
        sa.Column("seller_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("buyer_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("eliminated_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("difference", sa.Numeric(18, 2), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("source_refs", sa.JSON(), nullable=True),
        sa.Column("methodology", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_group_intercompany_matches_workspace_id", "group_intercompany_matches", ["workspace_id"])
    op.create_index("ix_group_ic_ws_period", "group_intercompany_matches", ["workspace_id", "period"])
    op.create_index("ix_group_ic_snapshot", "group_intercompany_matches", ["snapshot_id"])


def downgrade() -> None:
    op.drop_index("ix_group_ic_snapshot", table_name="group_intercompany_matches")
    op.drop_index("ix_group_ic_ws_period", table_name="group_intercompany_matches")
    op.drop_index("ix_group_intercompany_matches_workspace_id", table_name="group_intercompany_matches")
    op.drop_table("group_intercompany_matches")
    op.drop_index("ix_group_financial_snapshots_company_set_key", table_name="group_financial_snapshots")
    op.drop_index("ix_group_snapshot_ws_period", table_name="group_financial_snapshots")
    op.drop_index("ix_group_financial_snapshots_created_at", table_name="group_financial_snapshots")
    op.drop_index("ix_group_financial_snapshots_workspace_id", table_name="group_financial_snapshots")
    op.drop_table("group_financial_snapshots")
    op.drop_index("ix_group_ownership_ws_company", table_name="group_entity_ownership")
    op.drop_index("ix_group_entity_ownership_owner_company_id", table_name="group_entity_ownership")
    op.drop_index("ix_group_entity_ownership_company_id", table_name="group_entity_ownership")
    op.drop_index("ix_group_entity_ownership_workspace_id", table_name="group_entity_ownership")
    op.drop_table("group_entity_ownership")
    with op.batch_alter_table("uae_company_profiles") as batch:
        batch.drop_index("ix_uae_company_profiles_parent_company_id")
        batch.drop_column("parent_company_id")
