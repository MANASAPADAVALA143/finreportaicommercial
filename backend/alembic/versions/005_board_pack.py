"""Board pack, commentary, and risk flag tables

Revision ID: 005
Revises: 004
"""

from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "statement_commentaries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("trial_balance_id", sa.Integer(), nullable=False),
        sa.Column("commentary_type", sa.String(length=64), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("edited_content", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["trial_balance_id"], ["trial_balances.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_statement_commentaries_tenant_id", "statement_commentaries", ["tenant_id"])
    op.create_index("ix_statement_commentaries_trial_balance_id", "statement_commentaries", ["trial_balance_id"])
    op.create_index("ix_statement_commentaries_commentary_type", "statement_commentaries", ["commentary_type"])

    op.create_table(
        "risk_flags",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("trial_balance_id", sa.Integer(), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("metric_name", sa.String(length=256), nullable=True),
        sa.Column("metric_value", sa.String(length=256), nullable=True),
        sa.Column("recommendation", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["trial_balance_id"], ["trial_balances.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_risk_flags_tenant_id", "risk_flags", ["tenant_id"])
    op.create_index("ix_risk_flags_trial_balance_id", "risk_flags", ["trial_balance_id"])
    op.create_index("ix_risk_flags_severity", "risk_flags", ["severity"])

    op.create_table(
        "board_packs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("trial_balance_id", sa.Integer(), nullable=False),
        sa.Column("company_name", sa.String(length=512), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("pdf_path", sa.String(length=2048), nullable=False),
        sa.Column("public_token", sa.String(length=64), nullable=False),
        sa.Column("watermark", sa.String(length=32), nullable=False),
        sa.Column("generated_at", sa.DateTime(), nullable=False),
        sa.Column("reviewed_by", sa.String(length=256), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("shared_at", sa.DateTime(), nullable=True),
        sa.Column("view_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["trial_balance_id"], ["trial_balances.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_token"),
    )
    op.create_index("ix_board_packs_tenant_id", "board_packs", ["tenant_id"])
    op.create_index("ix_board_packs_trial_balance_id", "board_packs", ["trial_balance_id"])
    op.create_index("ix_board_packs_public_token", "board_packs", ["public_token"])


def downgrade() -> None:
    op.drop_index("ix_board_packs_public_token", table_name="board_packs")
    op.drop_index("ix_board_packs_trial_balance_id", table_name="board_packs")
    op.drop_index("ix_board_packs_tenant_id", table_name="board_packs")
    op.drop_table("board_packs")
    op.drop_index("ix_risk_flags_severity", table_name="risk_flags")
    op.drop_index("ix_risk_flags_trial_balance_id", table_name="risk_flags")
    op.drop_index("ix_risk_flags_tenant_id", table_name="risk_flags")
    op.drop_table("risk_flags")
    op.drop_index("ix_statement_commentaries_commentary_type", table_name="statement_commentaries")
    op.drop_index("ix_statement_commentaries_trial_balance_id", table_name="statement_commentaries")
    op.drop_index("ix_statement_commentaries_tenant_id", table_name="statement_commentaries")
    op.drop_table("statement_commentaries")
