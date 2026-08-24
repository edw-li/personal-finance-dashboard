"""category budgets table

Effective-dated per-category budget targets (2026-08-24 spec §2). Dashboard-only and
importer-immune; the budget for month M resolves to the row with the greatest
effective_month <= M, and a NULL amount is the dated "budget ends here" marker.

Revision ID: b7c4e1f2a9d3
Revises: c9e2b7a4d113
Create Date: 2026-08-24 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c4e1f2a9d3"
down_revision: str | Sequence[str] | None = "c9e2b7a4d113"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "category_budgets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("effective_month", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.CheckConstraint(
            "EXTRACT(DAY FROM effective_month) = 1",
            name=op.f("ck_category_budgets_effective_month_is_first_of_month"),
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["spending_categories.id"],
            name=op.f("fk_category_budgets_category_id_spending_categories"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_category_budgets")),
        sa.UniqueConstraint(
            "category_id", "effective_month", name=op.f("uq_category_budgets_category_id")
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("category_budgets")
