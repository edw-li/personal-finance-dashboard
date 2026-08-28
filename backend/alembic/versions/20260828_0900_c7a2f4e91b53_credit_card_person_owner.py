"""credit card person owner

`credit_cards.person_id` — a nullable FK to people where NULL means JOINT (either spouse can
hold the card). Every existing card is backfilled to the PRIMARY person, so NULL keeps
meaning exactly what it says going forward: a card the household shares, not a card whose
owner nobody recorded (2026-08-28 spec §3 item 2).

`primary_holder` and `authorized_users` are deliberately LEFT ALONE. They stop being the
ownership vocabulary but stay as informational text — the exact name embossed on the card —
and no attempt is made to parse a name out of them into `person_id`: a free-text column that
has only ever held one household's spelling of one person is not evidence.

Revision ID: c7a2f4e91b53
Revises: c9f4a7e2b168
Create Date: 2026-08-28 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7a2f4e91b53"
down_revision: str | Sequence[str] | None = "c9f4a7e2b168"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FOREIGN_KEY = "fk_credit_cards_person_id_people"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("credit_cards", sa.Column("person_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        FOREIGN_KEY, "credit_cards", "people", ["person_id"], ["id"], ondelete="SET NULL"
    )
    bind = op.get_bind()
    cards = bind.scalar(sa.text("SELECT count(*) FROM credit_cards"))
    if cards:
        # LOUD, not silent. The column is nullable, so an un-backfilled roster would upgrade
        # cleanly and then read as "every card is joint" the moment the owner chips land —
        # wrong money on a page whose whole new number is a per-owner comparison. A database
        # with cards but no primary person is hand-edited; it gets a sentence, not a shrug.
        primary = bind.scalar(sa.text("SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1"))
        if primary is None:
            raise RuntimeError(
                f"{cards} credit_cards rows would be left owner-less: NULL person_id means "
                "JOINT from here on, so seed the people table (app.seed.seed_people) before "
                "upgrading"
            )
    # The scalar subquery is safe: ux_people_single_primary caps the primary at one row, and
    # an EMPTY cards table with an empty roster simply updates nothing.
    op.execute(
        "UPDATE credit_cards SET person_id = "
        "(SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1) "
        "WHERE person_id IS NULL"
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Ownership is lost, and that is the honest outcome: nothing else on the row records it
    # (primary_holder was never written from person_id). Re-upgrading re-backfills everything
    # to the primary person, which is where this migration found them.
    op.drop_constraint(FOREIGN_KEY, "credit_cards", type_="foreignkey")
    op.drop_column("credit_cards", "person_id")
