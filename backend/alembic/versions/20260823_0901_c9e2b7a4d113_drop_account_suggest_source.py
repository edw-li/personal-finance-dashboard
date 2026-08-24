"""drop account suggest_source

Balance suggestions removed end to end (2026-08-23 spec §7) before the adding migration
(712243ee3ff3) ever deployed — prod runs add-then-drop in one boot, harmless. Downgrade
re-adds the column nullable; stored mappings are not restored (the feature is gone).

Revision ID: c9e2b7a4d113
Revises: a7c41e88f2d0
Create Date: 2026-08-23 09:01:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9e2b7a4d113"
down_revision: str | Sequence[str] | None = "a7c41e88f2d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column("accounts", "suggest_source")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column("accounts", sa.Column("suggest_source", sa.String(200), nullable=True))
