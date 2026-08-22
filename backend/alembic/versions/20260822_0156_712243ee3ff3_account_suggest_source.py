"""account suggest_source

Where the monthly wizard's balance suggestion for an account comes from (2026-08-21 spec
§5.2): "portfolio:<account-label>" or "vesting:unvested". Nullable and unmapped by
default, so every existing row keeps today's behavior — no chips until the user maps an
account in Settings. Dashboard-only and user-owned: the importer's account diff is
{name, group, sort_order}, so a re-import can never write or clear it (is_component's
posture, pinned by test_importer_never_writes_account_suggest_source).

Revision ID: 712243ee3ff3
Revises: b0465b6d6ac2
Create Date: 2026-08-22 01:56:55.661957

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "712243ee3ff3"
down_revision: str | Sequence[str] | None = "b0465b6d6ac2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Additive and nullable — no backfill, no server_default: NULL *is* "unmapped".
    op.add_column("accounts", sa.Column("suggest_source", sa.String(200), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("accounts", "suggest_source")
