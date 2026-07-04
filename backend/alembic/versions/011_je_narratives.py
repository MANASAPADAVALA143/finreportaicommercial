"""
Add je_narratives table and meta_json column to je_account_baseline.

Revision: 011
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "011_je_narratives"
down_revision = "010"
branch_labels = None
depends_on = None


def _json_type():
    return postgresql.JSONB().with_variant(sa.JSON(), "sqlite")


def upgrade():
    # ── 1. New column on je_account_baseline ─────────────────────────────────
    # SQLite does not support ADD COLUMN with JSONB; use JSON variant.
    with op.batch_alter_table("je_account_baseline") as batch_op:
        batch_op.add_column(
            sa.Column("meta_json", _json_type(), nullable=True)
        )

    # ── 2. New table: je_narratives ───────────────────────────────────────────
    op.create_table(
        "je_narratives",
        sa.Column("id",              sa.Integer(),     nullable=False, autoincrement=True),
        sa.Column("company_id",      sa.String(100),   nullable=False),
        sa.Column("journal_id",      sa.String(100),   nullable=False),
        sa.Column("risk_level",      sa.String(20),    nullable=True),
        sa.Column("composite_score", sa.Float(),       nullable=True),
        sa.Column("narrative",       sa.Text(),        nullable=False),
        sa.Column("model_used",      sa.String(100),   nullable=True),
        sa.Column("created_at",      sa.DateTime(),    nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_je_narratives_company_id", "je_narratives", ["company_id"])
    op.create_index("ix_je_narratives_journal_id", "je_narratives", ["journal_id"])
    op.create_index("ix_je_narratives_created_at", "je_narratives", ["created_at"])


def downgrade():
    op.drop_index("ix_je_narratives_created_at",  table_name="je_narratives")
    op.drop_index("ix_je_narratives_journal_id",  table_name="je_narratives")
    op.drop_index("ix_je_narratives_company_id",  table_name="je_narratives")
    op.drop_table("je_narratives")

    with op.batch_alter_table("je_account_baseline") as batch_op:
        batch_op.drop_column("meta_json")
