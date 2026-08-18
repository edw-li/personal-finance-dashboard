"""portfolio value history table

Revision ID: 705ec03f614f
Revises: e5b93d0a416f
Create Date: 2026-08-17 21:01:02.384429

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "705ec03f614f"
down_revision: str | Sequence[str] | None = "e5b93d0a416f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "portfolio_value_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("market_value", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("cost_basis", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("sp500_value", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_portfolio_value_history")),
        sa.UniqueConstraint("snapshot_date", name=op.f("uq_portfolio_value_history_snapshot_date")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("portfolio_value_history")
