"""espp offerings table

The subscription-price source for the purchase modeler (2026-08-23 spec §2.1).
Dashboard-only and importer-immune; no FKs in or out — periods resolve by date.

Revision ID: a7c41e88f2d0
Revises: 712243ee3ff3
Create Date: 2026-08-23 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7c41e88f2d0"
down_revision: str | Sequence[str] | None = "712243ee3ff3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "espp_offerings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("offering_start", sa.Date(), nullable=False),
        sa.Column("subscription_price", sa.Numeric(precision=14, scale=5), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_espp_offerings")),
        sa.UniqueConstraint("offering_start", name=op.f("uq_espp_offerings_offering_start")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("espp_offerings")
