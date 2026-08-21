"""rsu grants table

Revision ID: 983a8ec3f1cd
Revises: b3d47a1c9e62
Create Date: 2026-08-21 04:10:08.464152

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "983a8ec3f1cd"
down_revision: str | Sequence[str] | None = "b3d47a1c9e62"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "rsu_grants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=False),
        sa.Column("focal_year", sa.Integer(), nullable=True),
        sa.Column("shares", sa.Integer(), nullable=False),
        sa.Column("grant_price", sa.Numeric(precision=14, scale=4), nullable=False),
        sa.Column("first_vest_date", sa.Date(), nullable=False),
        sa.Column("cliff_pct", sa.Numeric(precision=7, scale=4), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rsu_grants")),
        sa.UniqueConstraint("label", name=op.f("uq_rsu_grants_label")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("rsu_grants")
