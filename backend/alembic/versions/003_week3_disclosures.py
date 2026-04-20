"""Week 3 IFRS disclosure notes and compliance checks

Revision ID: 003
Revises: 002
"""
from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "disclosure_notes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("trial_balance_id", sa.Integer(), nullable=False),
        sa.Column("note_number", sa.Integer(), nullable=False),
        sa.Column("note_code", sa.String(length=8), nullable=False),
        sa.Column("note_title", sa.String(length=512), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("ai_generated_content", sa.Text(), nullable=True),
        sa.Column("user_edited_content", sa.Text(), nullable=True),
        sa.Column("is_user_edited", sa.Boolean(), nullable=False),
        sa.Column("word_count", sa.Integer(), nullable=False),
        sa.Column("generated_at", sa.DateTime(), nullable=True),
        sa.Column("edited_at", sa.DateTime(), nullable=True),
        sa.Column("edited_by", sa.String(length=256), nullable=True),
        sa.ForeignKeyConstraint(["trial_balance_id"], ["trial_balances.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_disclosure_notes_trial_balance_id", "disclosure_notes", ["trial_balance_id"])
    op.create_index("ix_disclosure_notes_tenant_id", "disclosure_notes", ["tenant_id"])

    op.create_table(
        "disclosure_sections",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("section_title", sa.String(length=512), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("is_table", sa.Boolean(), nullable=False),
        sa.Column("table_data", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["note_id"], ["disclosure_notes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_disclosure_sections_note_id", "disclosure_sections", ["note_id"])

    op.create_table(
        "compliance_checks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("trial_balance_id", sa.Integer(), nullable=False),
        sa.Column("check_code", sa.String(length=32), nullable=False),
        sa.Column("check_description", sa.String(length=1024), nullable=False),
        sa.Column("standard", sa.String(length=128), nullable=False),
        sa.Column("result", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=32), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("recommendation", sa.Text(), nullable=True),
        sa.Column("checked_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["trial_balance_id"], ["trial_balances.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_compliance_checks_trial_balance_id", "compliance_checks", ["trial_balance_id"])
    op.create_index("ix_compliance_checks_check_code", "compliance_checks", ["check_code"])


def downgrade() -> None:
    op.drop_index("ix_compliance_checks_check_code", table_name="compliance_checks")
    op.drop_index("ix_compliance_checks_trial_balance_id", table_name="compliance_checks")
    op.drop_table("compliance_checks")
    op.drop_index("ix_disclosure_sections_note_id", table_name="disclosure_sections")
    op.drop_table("disclosure_sections")
    op.drop_index("ix_disclosure_notes_tenant_id", table_name="disclosure_notes")
    op.drop_index("ix_disclosure_notes_trial_balance_id", table_name="disclosure_notes")
    op.drop_table("disclosure_notes")
