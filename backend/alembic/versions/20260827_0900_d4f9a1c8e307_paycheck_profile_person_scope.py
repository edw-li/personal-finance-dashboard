"""paycheck profile person scope

`paycheck_profiles.person_id` (int FK -> people, NOT NULL) with the unique key swapped
from `effective_date` to (person_id, effective_date), so every household member keeps
their own profile timeline (2026-08-27 spec §3.1). The old unique was enforced in three
places — the model, api/paycheck.py's 409 pre-check, and migration e301f88ed241 — and
all three move together.

Backfill: every existing profile becomes the PRIMARY person's; the sheet and the app have
only ever modeled one earner. f3a91c7e2b45 seeds that member earlier in this same chain,
so the roster is always there in practice — the guard below is for a hand-edited database,
and it fails LOUDLY rather than dropping rows, because a profile with no owner is not a
state this table may hold after today.

Revision ID: d4f9a1c8e307
Revises: e26b9d70a4c1
Create Date: 2026-08-27 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f9a1c8e307"
down_revision: str | Sequence[str] | None = "e26b9d70a4c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_CONSTRAINT = "uq_paycheck_profiles_effective_date"
# Named after the FIRST column only — this must equal the name database.py's naming
# convention derives for the model's UniqueConstraint, or create_all (tests) and this
# migration (deploys) produce differently-named schemas. Do not "fix" it to mention
# effective_date.
NEW_CONSTRAINT = "uq_paycheck_profiles_person_id"
FOREIGN_KEY = "fk_paycheck_profiles_person_id_people"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("paycheck_profiles", sa.Column("person_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        FOREIGN_KEY, "paycheck_profiles", "people", ["person_id"], ["id"], ondelete="RESTRICT"
    )
    # Backfill BEFORE the NOT NULL. The scalar subquery is safe: ux_people_single_primary
    # caps the primary at one row.
    op.execute(
        "UPDATE paycheck_profiles SET person_id = "
        "(SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1) "
        "WHERE person_id IS NULL"
    )
    orphans = op.get_bind().scalar(
        sa.text("SELECT count(*) FROM paycheck_profiles WHERE person_id IS NULL")
    )
    if orphans:
        # The sentence that says what to do, instead of a bare NOT NULL violation from the
        # ALTER below.
        raise RuntimeError(
            f"{orphans} paycheck_profiles rows have no owner: seed the people table "
            "(app.seed.seed_people) before upgrading"
        )
    op.alter_column("paycheck_profiles", "person_id", nullable=False)
    op.drop_constraint(OLD_CONSTRAINT, "paycheck_profiles", type_="unique")
    op.create_unique_constraint(
        NEW_CONSTRAINT, "paycheck_profiles", ["person_id", "effective_date"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Anybody but the primary person only has profiles because this migration ran; the
    # narrower `effective_date` key cannot hold them. IS DISTINCT FROM, not <>, so an empty
    # roster (NULL subquery) still deletes every owned row instead of none.
    op.execute(
        "DELETE FROM paycheck_profiles WHERE person_id IS DISTINCT FROM "
        "(SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1)"
    )
    # Belt and braces for a hand-edited database: keep the OLDEST row of any date pair.
    op.execute(
        "DELETE FROM paycheck_profiles a USING paycheck_profiles b "
        "WHERE a.effective_date = b.effective_date AND a.id > b.id"
    )
    op.drop_constraint(NEW_CONSTRAINT, "paycheck_profiles", type_="unique")
    op.create_unique_constraint(OLD_CONSTRAINT, "paycheck_profiles", ["effective_date"])
    op.drop_constraint(FOREIGN_KEY, "paycheck_profiles", type_="foreignkey")
    op.drop_column("paycheck_profiles", "person_id")
