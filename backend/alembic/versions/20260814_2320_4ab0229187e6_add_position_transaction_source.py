"""add position transaction source

Revision ID: 4ab0229187e6
Revises: f1b36c0cf33c
Create Date: 2026-08-14 23:20:31.213794

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4ab0229187e6"
down_revision: str | Sequence[str] | None = "f1b36c0cf33c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "position_transactions",
        sa.Column("source", sa.String(length=10), server_default="ui", nullable=False),
    )
    # One-time backfill for pre-Plan-4 data: at migration time, rows with a
    # sheet-assigned sort_index are exactly the importer's. NOT a durable rule —
    # UI rows created later also get sort_index > 0, so this heuristic (and this
    # migration's downgrade) must not be re-run once UI rows exist.
    op.execute("UPDATE position_transactions SET source = 'import' WHERE sort_index > 0")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("position_transactions", "source")
