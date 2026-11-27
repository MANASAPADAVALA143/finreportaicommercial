"""Phase 9.7 — consolidation integrity: elimination_type + IC reference sequence.

ADJ-1: adds elimination_type column to consolidation_eliminations.
       Existing rows default to 'both' (legacy behaviour preserved).
SVC-1: adds ic_reference_sequences table for collision-resistant IC numbering.

Revision ID: 035_phase97_consolidation_integrity
Revises: 034_group_intelligence
Create Date: 2026-11-27
"""

from alembic import op
import sqlalchemy as sa

revision = "035_phase97_consolidation_integrity"
down_revision = "034_group_intelligence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ADJ-1: separate P&L eliminations from balance-sheet eliminations.
    # 'pl'   = affects Consolidated P&L only (revenue / expense accounts).
    # 'bs'   = affects Consolidated Balance Sheet only (asset / liability / equity accounts).
    # 'both' = default for legacy rows; treated as both P&L and BS (pre-9.7 behaviour).
    with op.batch_alter_table("consolidation_eliminations") as batch:
        batch.add_column(
            sa.Column(
                "elimination_type",
                sa.String(4),
                nullable=False,
                server_default="both",
            )
        )

    # SVC-1: collision-resistant IC reference sequences — one counter per workspace+period.
    op.create_table(
        "ic_reference_sequences",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("period", sa.String(7), nullable=False),  # YYYY-MM
        sa.Column("last_seq", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("workspace_id", "period", name="uq_ic_seq_ws_period"),
    )


def downgrade() -> None:
    op.drop_table("ic_reference_sequences")
    with op.batch_alter_table("consolidation_eliminations") as batch:
        batch.drop_column("elimination_type")
