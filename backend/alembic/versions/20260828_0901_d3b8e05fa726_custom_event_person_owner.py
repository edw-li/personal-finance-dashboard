"""custom event person owner

`custom_events.person_id` — a nullable FK to people where NULL means HOUSEHOLD (2026-08-28
spec §3 item 3).

NO BACKFILL, deliberately, and this is the one place in the household retrofit where that is
right: every pre-existing custom event was entered before anybody could tag it, so assigning
it to the primary person would put a name on chips the user never chose. NULL already means
exactly what those rows mean. There is therefore no zero-people guard here either — nothing
is being resolved against the roster.

Revision ID: d3b8e05fa726
Revises: c7a2f4e91b53
Create Date: 2026-08-28 09:01:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3b8e05fa726"
down_revision: str | Sequence[str] | None = "c7a2f4e91b53"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FOREIGN_KEY = "fk_custom_events_person_id_people"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("custom_events", sa.Column("person_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        FOREIGN_KEY, "custom_events", "people", ["person_id"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Tags are lost; the labels are not, because the suffix was only ever composed and never
    # stored (api/calendar.py's _custom_out returns the label as typed).
    op.drop_constraint(FOREIGN_KEY, "custom_events", type_="foreignkey")
    op.drop_column("custom_events", "person_id")
