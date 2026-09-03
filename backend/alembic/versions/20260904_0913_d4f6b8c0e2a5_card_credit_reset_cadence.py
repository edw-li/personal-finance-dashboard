"""card_credits.reset_cadence

When a recurring card credit resets (2026-09-03 calendar spec §6 card row): `calendar`
(January 1) or `anniversary` (the card's opened_on anniversary). Default `calendar` — the
common shape — with a server_default so every existing credit reads it and `alembic check`
stays clean. CHECK-constrained here and on the model (create_all builds the test schema).

Revision ID: d4f6b8c0e2a5
Revises: c3e5a7b9d1f4
Create Date: 2026-09-04 09:13:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f6b8c0e2a5"
down_revision: str | Sequence[str] | None = "c3e5a7b9d1f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "card_credits",
        sa.Column("reset_cadence", sa.String(length=12), nullable=False, server_default="calendar"),
    )
    op.create_check_constraint(
        op.f("ck_card_credits_reset_cadence_vocabulary"),
        "card_credits",
        "reset_cadence IN ('calendar', 'anniversary')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        op.f("ck_card_credits_reset_cadence_vocabulary"), "card_credits", type_="check"
    )
    op.drop_column("card_credits", "reset_cadence")
