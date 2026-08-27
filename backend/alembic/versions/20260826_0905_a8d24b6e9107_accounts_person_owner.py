"""accounts person owner

Household foundation (2026-08-26 spec §4): accounts.person_id — a nullable FK to people
where NULL means JOINT/household. Every existing account is backfilled to the primary
person, so NULL keeps meaning exactly what it says going forward.

Revision ID: a8d24b6e9107
Revises: f3a91c7e2b45
Create Date: 2026-08-26 09:05:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8d24b6e9107"
down_revision: str | Sequence[str] | None = "f3a91c7e2b45"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("accounts", sa.Column("person_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_accounts_person_id_people",
        "accounts",
        "people",
        ["person_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Backfill EVERY existing account to the primary person. NULL is reserved for genuine
    # joint accounts from here on, so an un-backfilled roster would silently read as "all
    # joint" the moment owner views land. The scalar subquery is safe: the partial unique
    # index ux_people_single_primary caps the primary at one row, and a database with none
    # simply leaves person_id NULL rather than failing.
    op.execute(
        "UPDATE accounts SET person_id = (SELECT id FROM people WHERE is_primary) "
        "WHERE person_id IS NULL"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_accounts_person_id_people", "accounts", type_="foreignkey")
    op.drop_column("accounts", "person_id")
