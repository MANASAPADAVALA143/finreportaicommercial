"""R2R client learning tables (profiles, feedback, events).

Revision ID: 007
Revises: 006
"""

from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_profiles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.String(length=128), nullable=False),
        sa.Column("client_name", sa.String(length=512), nullable=False),
        sa.Column("industry", sa.String(length=256), nullable=True),
        sa.Column("fiscal_year_end", sa.String(length=64), nullable=True),
        sa.Column("months_of_data", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("account_baselines", sa.JSON(), nullable=True),
        sa.Column("user_baselines", sa.JSON(), nullable=True),
        sa.Column("vendor_baselines", sa.JSON(), nullable=True),
        sa.Column("timing_baselines", sa.JSON(), nullable=True),
        sa.Column("amount_threshold_multiplier", sa.Float(), nullable=False, server_default="2.0"),
        sa.Column("weekend_penalty_score", sa.Float(), nullable=False, server_default="15.0"),
        sa.Column("round_number_penalty", sa.Float(), nullable=False, server_default="10.0"),
        sa.Column("new_vendor_penalty", sa.Float(), nullable=False, server_default="12.0"),
        sa.Column("total_entries_analysed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_flagged", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_approved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_rejected", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("false_positive_rate", sa.Float(), nullable=True),
        sa.Column("learning_status", sa.String(length=32), nullable=False, server_default="initialising"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(datetime('now'))")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("(datetime('now'))")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id"),
    )

    op.create_table(
        "journal_entry_feedback",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.String(length=128), nullable=False),
        sa.Column("entry_id", sa.String(length=256), nullable=False),
        sa.Column("gl_account", sa.String(length=512), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("posted_by", sa.String(length=256), nullable=False),
        sa.Column("posting_date", sa.DateTime(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("original_risk_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("original_risk_level", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("original_risk_reasons", sa.JSON(), nullable=True),
        sa.Column("feedback", sa.String(length=32), nullable=False),
        sa.Column("feedback_comment", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.String(length=256), nullable=False, server_default="analyst"),
        sa.Column("reviewed_at", sa.DateTime(), nullable=False, server_default=sa.text("(datetime('now'))")),
        sa.Column("threshold_adjusted", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("adjustment_note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["client_id"], ["client_profiles.client_id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_journal_entry_feedback_client_id", "journal_entry_feedback", ["client_id"], unique=False)
    op.create_index("ix_journal_entry_feedback_entry_id", "journal_entry_feedback", ["entry_id"], unique=False)

    op.create_table(
        "learning_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.String(length=128), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("old_value", sa.String(length=512), nullable=True),
        sa.Column("new_value", sa.String(length=512), nullable=True),
        sa.Column("triggered_by_feedback_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(datetime('now'))")),
        sa.ForeignKeyConstraint(["client_id"], ["client_profiles.client_id"]),
        sa.ForeignKeyConstraint(["triggered_by_feedback_id"], ["journal_entry_feedback.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_learning_events_client_id", "learning_events", ["client_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_learning_events_client_id", table_name="learning_events")
    op.drop_table("learning_events")
    op.drop_index("ix_journal_entry_feedback_entry_id", table_name="journal_entry_feedback")
    op.drop_index("ix_journal_entry_feedback_client_id", table_name="journal_entry_feedback")
    op.drop_table("journal_entry_feedback")
    op.drop_table("client_profiles")
