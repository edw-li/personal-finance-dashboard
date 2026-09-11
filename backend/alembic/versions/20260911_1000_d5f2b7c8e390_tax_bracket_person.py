"""tax bracket person scope

`tax_brackets.person_id` (nullable FK -> people, NULL = the year+status DEFAULT table) with
the single unique constraint swapped for two partial unique indexes (2026-09-11 spec §2.1).

Social Security's wage base is per employee and SDI — or the employer Voluntary Plan that
replaces it — is per worker, so a household with one spouse on a VP and the other on
statutory SDI needs two tables for the same year. NULL keeps meaning "everyone's", which is
every row that exists today: no data is rewritten here.

Revision ID: d5f2b7c8e390
Revises: b8e1c5f7a204
Create Date: 2026-09-11 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5f2b7c8e390"
down_revision: str | Sequence[str] | None = "b8e1c5f7a204"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "uq_tax_brackets_year"
FOREIGN_KEY = "fk_tax_brackets_person_id_people"
DEFAULT_INDEX = "ux_tax_brackets_default"
PERSON_INDEX = "ux_tax_brackets_person"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("tax_brackets", sa.Column("person_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        FOREIGN_KEY, "tax_brackets", "people", ["person_id"], ["id"], ondelete="RESTRICT"
    )
    # The old constraint cannot simply grow a column: Postgres treats NULLs as distinct, so
    # (year, jurisdiction, filing_status, person_id, bracket_index) would stop constraining
    # the default rows — two of them could share an index and the engine would walk both.
    # Two PARTIAL indexes say the two things separately.
    op.drop_constraint(CONSTRAINT, "tax_brackets", type_="unique")
    op.create_index(
        DEFAULT_INDEX,
        "tax_brackets",
        ["year", "jurisdiction", "filing_status", "bracket_index"],
        unique=True,
        postgresql_where=sa.text("person_id IS NULL"),
    )
    op.create_index(
        PERSON_INDEX,
        "tax_brackets",
        ["year", "jurisdiction", "filing_status", "person_id", "bracket_index"],
        unique=True,
        postgresql_where=sa.text("person_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    # A person's own table only exists because this migration ran, and the narrower key
    # cannot hold it beside the default it overrides — so it goes, and that earner falls
    # back to the year's default table, which is exactly what the old code does.
    op.execute("DELETE FROM tax_brackets WHERE person_id IS NOT NULL")
    op.drop_index(PERSON_INDEX, table_name="tax_brackets")
    op.drop_index(DEFAULT_INDEX, table_name="tax_brackets")
    op.create_unique_constraint(
        CONSTRAINT, "tax_brackets", ["year", "jurisdiction", "filing_status", "bracket_index"]
    )
    op.drop_constraint(FOREIGN_KEY, "tax_brackets", type_="foreignkey")
    op.drop_column("tax_brackets", "person_id")
