"""repair numeric price refresh cron

Revision ID: 5fbe696d5a10
Revises: 4ab0229187e6
Create Date: 2026-08-15 09:43:39.605085

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5fbe696d5a10"
down_revision: str | Sequence[str] | None = "4ab0229187e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # APScheduler numbers crontab days 0=Mon: the originally-seeded "1-5" fired Tue-Sat.
    # Idempotent repair — only touches the exact mis-seeded value, never a user edit.
    op.execute(
        'UPDATE app_settings SET value = \'{"value": "10 13 * * mon-fri"}\' '
        "WHERE key = 'price_refresh_cron' AND value->>'value' = '10 13 * * 1-5'"
    )


def downgrade() -> None:
    pass  # one-way data repair; nothing sane to restore
