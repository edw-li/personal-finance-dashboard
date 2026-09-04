"""spending_categories.kind

What a category MEANS for savings (2026-09-04 honest-numbers spec §1): 'living' (money
left the household), 'tax' (an income-tax payment made from take-home — the April bill,
estimated payments; payroll withholding is NOT here, it never reaches net pay) or
'transfer' (money that stayed yours). NOT NULL, server_default 'living', so every
existing category keeps reading exactly as it does today.

The upgrade SEEDS by slug and name, case-insensitively: 'taxes' -> tax; 'investments'
and 'financial' -> transfer. Both columns are checked because the slug is derived from
the sheet's column header and a hand-renamed category can carry either spelling. The
downgrade drops the column: the classification is the only thing lost, and it is
re-derivable from the same two rules.

This is the ONLY migration the honest-numbers program writes.

Revision ID: e5a7c1d3f6b8
Revises: d4f6b8c0e2a5
Create Date: 2026-09-04 09:14:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5a7c1d3f6b8"
down_revision: str | Sequence[str] | None = "d4f6b8c0e2a5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "spending_categories",
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="living"),
    )
    op.create_check_constraint(
        op.f("ck_spending_categories_kind_vocabulary"),
        "spending_categories",
        "kind IN ('living', 'tax', 'transfer')",
    )
    op.execute(
        "UPDATE spending_categories SET kind = 'tax' "
        "WHERE lower(slug) = 'taxes' OR lower(name) = 'taxes'"
    )
    op.execute(
        "UPDATE spending_categories SET kind = 'transfer' "
        "WHERE lower(slug) IN ('investments', 'financial') "
        "OR lower(name) IN ('investments', 'financial')"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        op.f("ck_spending_categories_kind_vocabulary"), "spending_categories", type_="check"
    )
    op.drop_column("spending_categories", "kind")
