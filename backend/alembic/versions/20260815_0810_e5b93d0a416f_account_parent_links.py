"""account parent links

Revision ID: e5b93d0a416f
Revises: 5fbe696d5a10
Create Date: 2026-08-15 08:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5b93d0a416f"
# Re-chained from c8a1f4d27b53 onto Plan 4's 5fbe696d5a10 at the wave-2 merge (both
# branches had grown from c8a1; the shared dev DB already sits past Plan 4's pair, so
# this ordering lets every environment upgrade linearly: c8a1 -> 4ab -> 5fbe -> e5b9).
down_revision: str | Sequence[str] | None = "5fbe696d5a10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PARENT_TO_COMPONENTS = (
    (
        "fidelity-traditional-401-k",
        "'employer-match-401-k','reverse-rollover-401-k','traditional-401-k'",
    ),
    ("fidelity-roth-401-k", "'roth-basic-401-k','after-tax-401-k'"),
)


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("accounts", sa.Column("parent_account_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_accounts_parent_account_id_accounts",
        "accounts",
        "accounts",
        ["parent_account_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Backfill the sheet's two known aggregates (identities verified at every snapshot:
    # Fidelity Traditional 401(k) = employer match + reverse rollover + traditional;
    # Fidelity Roth 401(k) = roth basic + after-tax). Purely presentational — the UI
    # nests components under their parent. A missing aggregate slug makes the subquery
    # NULL, leaving the link unset; already-linked rows are never rewritten.
    for parent_slug, component_slugs in PARENT_TO_COMPONENTS:
        op.execute(
            f"UPDATE accounts SET parent_account_id = "
            f"(SELECT id FROM accounts WHERE slug = '{parent_slug}') "
            f"WHERE slug IN ({component_slugs}) AND parent_account_id IS NULL"
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_accounts_parent_account_id_accounts", "accounts", type_="foreignkey")
    op.drop_column("accounts", "parent_account_id")
