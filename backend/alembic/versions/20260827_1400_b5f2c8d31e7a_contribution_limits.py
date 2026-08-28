"""contribution limits

Per-year contribution caps entered by the user (2026-08-27 two-income-streams spec §3
item 3). The app seeds NO values: the definitions live in app/limit_keys.py and every
number is the user's. Additive; downgrade drops the table.

Revision ID: b5f2c8d31e7a
Revises: a2c6b8d40f19
Create Date: 2026-08-27 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5f2c8d31e7a"
down_revision: str | Sequence[str] | None = "a2c6b8d40f19"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "contribution_limits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=40), nullable=False),
        sa.Column("value", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.CheckConstraint("value > 0", name=op.f("ck_contribution_limits_value_positive")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_contribution_limits")),
        sa.UniqueConstraint("year", "key", name=op.f("uq_contribution_limits_year")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("contribution_limits")
