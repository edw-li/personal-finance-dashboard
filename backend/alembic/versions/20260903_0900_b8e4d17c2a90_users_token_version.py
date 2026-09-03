"""users.token_version — sign out everywhere (2026-09-03 shell spec §10)

Revision ID: b8e4d17c2a90
Revises: f7d3b2a91c40
Create Date: 2026-09-03 09:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8e4d17c2a90"
down_revision: str | Sequence[str] | None = "f7d3b2a91c40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default so existing rows read 0 — the version every pre-deploy token implies.
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "token_version")
