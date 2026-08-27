"""tax bracket filing status

`tax_brackets.filing_status` + the unique-key swap to
(year, jurisdiction, filing_status, bracket_index) (2026-08-26 spec §4). All existing
rows become 'single'; MFJ/MFS tables are new rows the user brings, never a rewrite.

Revision ID: c81d4a6f2e35
Revises: a7e3f1b90c24
Create Date: 2026-08-26 12:01:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c81d4a6f2e35"
down_revision: str | Sequence[str] | None = "a7e3f1b90c24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "uq_tax_brackets_year"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "tax_brackets",
        sa.Column("filing_status", sa.String(length=20), server_default="single", nullable=False),
    )
    # SAME NAME on both sides: the metadata convention is
    # uq_%(table_name)s_%(column_0_name)s and column 0 is still `year`, so this is a
    # drop-then-create of one constraint rather than a rename.
    op.drop_constraint(CONSTRAINT, "tax_brackets", type_="unique")
    op.create_unique_constraint(
        CONSTRAINT, "tax_brackets", ["year", "jurisdiction", "filing_status", "bracket_index"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(CONSTRAINT, "tax_brackets", type_="unique")
    # Non-single rows would violate the narrower key, and they only exist because this
    # migration ran — drop them rather than leaving the constraint uncreatable.
    op.execute("DELETE FROM tax_brackets WHERE filing_status <> 'single'")
    op.create_unique_constraint(CONSTRAINT, "tax_brackets", ["year", "jurisdiction", "bracket_index"])
    op.drop_column("tax_brackets", "filing_status")
