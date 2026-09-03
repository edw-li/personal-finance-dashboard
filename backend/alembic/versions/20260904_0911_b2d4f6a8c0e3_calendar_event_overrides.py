"""calendar event overrides

The user-edit OVERLAY for generated calendar events (2026-09-03 calendar spec §4 approach
C, §13): only what the user typed — done, hidden, a note, the figure actually paid — keyed
by the event's stable `source:entity_ref:date` key. Nothing derived is ever stored here, so
`rsu_grants`' and `credit_cards`' docstrings stay true. Dashboard-only and importer-immune
(the custom_events posture). Additive; downgrade drops the table.

Revision ID: b2d4f6a8c0e3
Revises: a1c3e5b7d9f2
Create Date: 2026-09-04 09:11:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2d4f6a8c0e3"
down_revision: str | Sequence[str] | None = "a1c3e5b7d9f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "calendar_event_overrides",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_key", sa.String(length=120), nullable=False),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hidden", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_event_overrides")),
        sa.UniqueConstraint("event_key", name=op.f("uq_calendar_event_overrides_event_key")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("calendar_event_overrides")
