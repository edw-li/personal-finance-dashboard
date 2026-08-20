"""dividend source and auto-event columns

Revision ID: b3d47a1c9e62
Revises: 705ec03f614f
Create Date: 2026-08-20 12:00:00
"""

import sqlalchemy as sa

from alembic import op

revision = "b3d47a1c9e62"
down_revision = "705ec03f614f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "dividend_payments",
        sa.Column("source", sa.String(length=10), server_default="manual", nullable=False),
    )
    op.add_column("dividend_payments", sa.Column("ex_date", sa.Date(), nullable=True))
    op.add_column("dividend_payments", sa.Column("per_share", sa.Numeric(10, 6), nullable=True))
    op.add_column("dividend_payments", sa.Column("shares_held", sa.Numeric(16, 6), nullable=True))
    op.create_index(
        "ux_dividend_auto_event",
        "dividend_payments",
        ["security_id", "account", "ex_date"],
        unique=True,
        postgresql_where=sa.text("source = 'auto'"),
    )


def downgrade() -> None:
    op.drop_index("ux_dividend_auto_event", table_name="dividend_payments")
    op.drop_column("dividend_payments", "shares_held")
    op.drop_column("dividend_payments", "per_share")
    op.drop_column("dividend_payments", "ex_date")
    op.drop_column("dividend_payments", "source")
