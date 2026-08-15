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
    # Existing rows: importer-owned rows are exactly those with sheet-assigned sort_index.
    op.execute("UPDATE position_transactions SET source = 'import' WHERE sort_index > 0")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("position_transactions", "source")
