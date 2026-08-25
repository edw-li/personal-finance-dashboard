"""custom events

User-entered informational calendar events (2026-08-24 financial-calendar spec §9.3) —
dashboard-only, single-date, no page link. Additive; downgrade drops the table.

Revision ID: e7c5a9f4b2d8
Revises: d2f8a6b3c1e7
Create Date: 2026-08-24 22:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7c5a9f4b2d8"
down_revision: str | Sequence[str] | None = "d2f8a6b3c1e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "custom_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("detail", sa.String(length=300), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_custom_events_event_date"), "custom_events", ["event_date"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_custom_events_event_date"), table_name="custom_events")
    op.drop_table("custom_events")
