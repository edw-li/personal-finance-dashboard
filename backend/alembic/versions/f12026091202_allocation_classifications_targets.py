"""Allocation classifications and owner-scoped target plans.

Revision ID: f12026091202
Revises: f12026091201
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "f12026091202"
down_revision = "f12026091201"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name, length in (
        ("asset_class", 30),
        ("allocation_industry", 80),
        ("geography", 30),
        ("classification_source", 30),
        ("classification_note", 500),
    ):
        op.add_column("securities", sa.Column(name, sa.String(length), nullable=True))
    op.add_column("securities", sa.Column("classification_reviewed_at", sa.DateTime(timezone=True)))
    # Only a stock's wrapper gives us a defensible asset class. Funds remain unknown;
    # their names/tickers cannot establish what they hold. No review date is fabricated.
    op.execute(
        "UPDATE securities SET asset_class = 'equity', classification_source = 'existing' "
        "WHERE holding_type = 'stock'"
    )
    op.create_table(
        "allocation_target_sets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("scope_key", sa.String(40), nullable=False),
        sa.Column("dimension", sa.String(30), nullable=False),
        sa.Column("state", sa.String(10), nullable=False),
        sa.Column("targets", postgresql.JSONB(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("scope_key", "dimension", "state"),
        sa.CheckConstraint("state IN ('draft', 'active')", name="allocation_target_state"),
        sa.CheckConstraint(
            "dimension IN ('asset_class', 'industry', 'geography', 'account', 'type')",
            name="allocation_target_dimension",
        ),
    )


def downgrade() -> None:
    op.drop_table("allocation_target_sets")
    for name in (
        "classification_reviewed_at",
        "classification_note",
        "classification_source",
        "geography",
        "allocation_industry",
        "asset_class",
    ):
        op.drop_column("securities", name)
