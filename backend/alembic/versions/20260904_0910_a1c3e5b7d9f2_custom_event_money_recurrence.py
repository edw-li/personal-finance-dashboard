"""custom events carry money and a recurrence rule

`custom_events.amount` (2dp, nullable — an informational reminder has no money),
`direction` (in/out/neutral, default neutral) and the rrule-lite pair `recurrence`
(none/weekly/monthly/yearly) + `until` (inclusive, nullable) — 2026-09-03 calendar spec §6,
§16. Both vocabularies are CHECK-constrained here AND repeated on the model, because the
test database is built by create_all (Person's rule). server_defaults so existing rows read
neutral/none and `alembic check` stays clean (paycheck_profiles.hsa_coverage's precedent).

Revision ID: a1c3e5b7d9f2
Revises: c3a7e19d5b42
Create Date: 2026-09-04 09:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c3e5b7d9f2"
down_revision: str | Sequence[str] | None = "c3a7e19d5b42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "custom_events", sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=True)
    )
    op.add_column(
        "custom_events",
        sa.Column("direction", sa.String(length=8), nullable=False, server_default="neutral"),
    )
    op.add_column(
        "custom_events",
        sa.Column("recurrence", sa.String(length=8), nullable=False, server_default="none"),
    )
    op.add_column("custom_events", sa.Column("until", sa.Date(), nullable=True))
    op.create_check_constraint(
        op.f("ck_custom_events_direction_vocabulary"),
        "custom_events",
        "direction IN ('in', 'out', 'neutral')",
    )
    op.create_check_constraint(
        op.f("ck_custom_events_recurrence_vocabulary"),
        "custom_events",
        "recurrence IN ('none', 'weekly', 'monthly', 'yearly')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        op.f("ck_custom_events_recurrence_vocabulary"), "custom_events", type_="check"
    )
    op.drop_constraint(
        op.f("ck_custom_events_direction_vocabulary"), "custom_events", type_="check"
    )
    op.drop_column("custom_events", "until")
    op.drop_column("custom_events", "recurrence")
    op.drop_column("custom_events", "direction")
    op.drop_column("custom_events", "amount")
