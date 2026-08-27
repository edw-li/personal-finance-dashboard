"""people table

Household foundation (2026-08-26 spec §4): a `people` registry with exactly one primary
member, seeded with the single row every existing table already implies. Purely additive —
nothing references it yet; accounts.person_id chains next.

Revision ID: f3a91c7e2b45
Revises: c4d1e8a2b9f3
Create Date: 2026-08-26 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3a91c7e2b45"
down_revision: str | Sequence[str] | None = "c4d1e8a2b9f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "people",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_people")),
        sa.UniqueConstraint("name", name=op.f("uq_people_name")),
    )
    # Exactly-one-primary, enforced by the database rather than by application code: a
    # PARTIAL unique index constrains only the TRUE rows. Mirrored on the model, which is
    # what builds the pytest database (Base.metadata.create_all runs no migrations).
    op.create_index(
        "ux_people_single_primary",
        "people",
        ["is_primary"],
        unique=True,
        postgresql_where=sa.text("is_primary"),
    )
    # The row every existing table already means. Named "Me" and renameable in Settings;
    # the primary flag never moves.
    op.execute("INSERT INTO people (name, is_primary) VALUES ('Me', true)")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ux_people_single_primary", table_name="people")
    op.drop_table("people")
