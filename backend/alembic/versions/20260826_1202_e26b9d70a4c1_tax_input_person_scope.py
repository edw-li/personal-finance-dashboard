"""tax input person scope

`tax_inputs.person_id` (nullable FK -> people, NULL = household) with the unique key
swapped to (year, key, person_id) NULLS NOT DISTINCT, plus
`tax_input_definitions.is_per_person` and the two tracker-only withholding keys
(2026-08-26 spec §4 / §5.6).

Backfill: every row whose key is per-person becomes the PRIMARY person's; household keys
stay NULL. Invariant after this migration: NULL means household-level, strictly.

Revision ID: e26b9d70a4c1
Revises: c81d4a6f2e35
Create Date: 2026-08-26 12:02:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e26b9d70a4c1"
down_revision: str | Sequence[str] | None = "c81d4a6f2e35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "uq_tax_inputs_year"
FOREIGN_KEY = "fk_tax_inputs_person_id_people"

# app/tax_keys.py PER_PERSON_KEYS, spelled out rather than imported: a migration pins the
# vocabulary as it was ON THIS DAY, and must not drift when the constant later grows.
PER_PERSON_KEYS = (
    "annual_salary",
    "gross_paycheck",
    "pay_periods",
    "latest_w2_income",
    "other_w2_income",
    "w2_stock_rsus_sold",
    "w2_bonuses",
    "w2_salary_checkpoint",
    "w2_espp_sale_component",
    "w2_employer_hsa",
    "w2_other",
    "w2_fed_withholding",
    "w2_state_withholding",
    "trad_401k_contributions",
    "hsa_contributions",
    "hsa_contributions_employer",
    "other_pretax_deductions",
    "pretax_dental",
    "pretax_vision",
)
KEY_LIST = ", ".join(f"'{key}'" for key in PER_PERSON_KEYS)

# The two tracker-only definitions, seeded HERE as well as in app/seed.py: start.sh runs
# `alembic upgrade head` BEFORE `python -m app.seed`, so the flag update below would miss
# them on a boot that migrates and seeds in the same breath.
NEW_DEFINITIONS = (
    ("w2_fed_withholding", "W2: Federal Withholding", "ordinary_income", 112),
    ("w2_state_withholding", "W2: State Withholding", "ordinary_income", 114),
)


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "tax_input_definitions",
        sa.Column("is_per_person", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    for key, label, section, sort_order in NEW_DEFINITIONS:
        op.execute(
            "INSERT INTO tax_input_definitions "
            "(key, label, section, sort_order, is_derived, is_per_person) "
            f"VALUES ('{key}', '{label}', '{section}', {sort_order}, FALSE, TRUE) "
            "ON CONFLICT (key) DO NOTHING"
        )
    op.execute(f"UPDATE tax_input_definitions SET is_per_person = TRUE WHERE key IN ({KEY_LIST})")
    # Match the model (Python-side default only), like accounts.is_component, so
    # `alembic check` stays clean.
    op.alter_column("tax_input_definitions", "is_per_person", server_default=None)

    op.add_column("tax_inputs", sa.Column("person_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        FOREIGN_KEY, "tax_inputs", "people", ["person_id"], ["id"], ondelete="RESTRICT"
    )
    # De-dupe guard BEFORE the NULLS NOT DISTINCT key (spec §8). The old unique was
    # (year, key), so duplicates cannot exist through the app — this is belt and braces
    # for a hand-edited database, and it keeps the OLDEST row of any pair.
    op.execute(
        "DELETE FROM tax_inputs a USING tax_inputs b "
        "WHERE a.year = b.year AND a.key = b.key AND a.id > b.id"
    )
    # Backfill: per-person rows become the primary person's; household keys stay NULL. A
    # database with no seeded roster is left entirely alone (the EXISTS guard), where NULL
    # keeps meaning what it meant before.
    op.execute(
        "UPDATE tax_inputs SET person_id = "
        "(SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1) "
        f"WHERE key IN ({KEY_LIST}) AND person_id IS NULL "
        "AND EXISTS (SELECT 1 FROM people WHERE is_primary)"
    )
    op.drop_constraint(CONSTRAINT, "tax_inputs", type_="unique")
    op.create_unique_constraint(
        CONSTRAINT,
        "tax_inputs",
        ["year", "key", "person_id"],
        postgresql_nulls_not_distinct=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(CONSTRAINT, "tax_inputs", type_="unique")
    # Anybody but the primary person only has rows because this migration ran; the
    # narrower (year, key) key cannot hold them. IS DISTINCT FROM, not <>, so an empty
    # roster (NULL subquery) still deletes every person-owned row instead of none.
    op.execute(
        "DELETE FROM tax_inputs WHERE person_id IS NOT NULL AND person_id IS DISTINCT FROM "
        "(SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1)"
    )
    op.execute(
        "DELETE FROM tax_inputs a USING tax_inputs b "
        "WHERE a.year = b.year AND a.key = b.key AND a.id > b.id"
    )
    op.create_unique_constraint(CONSTRAINT, "tax_inputs", ["year", "key"])
    op.drop_constraint(FOREIGN_KEY, "tax_inputs", type_="foreignkey")
    op.drop_column("tax_inputs", "person_id")
    # The two tracker definitions are left in place: they are inert rows the seed would
    # recreate anyway, and deleting them would cascade real user values away.
    op.drop_column("tax_input_definitions", "is_per_person")
