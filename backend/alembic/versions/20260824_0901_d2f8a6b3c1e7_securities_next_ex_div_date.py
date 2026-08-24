"""securities next_ex_div_date

Announced upcoming ex-dividend date (2026-08-24 financial-calendar spec §3.1) — additive
and nullable. ex_div_date keeps its most-recent-past-event semantics unchanged; the daily
refresh stores announced dates >= today here and clears them once they pass.

Revision ID: d2f8a6b3c1e7
Revises: b7c4e1f2a9d3
Create Date: 2026-08-24 09:01:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2f8a6b3c1e7"
down_revision: str | Sequence[str] | None = "b7c4e1f2a9d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("securities", sa.Column("next_ex_div_date", sa.Date(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("securities", "next_ex_div_date")
