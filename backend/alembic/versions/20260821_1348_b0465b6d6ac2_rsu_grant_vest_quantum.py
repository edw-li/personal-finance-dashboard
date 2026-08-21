"""rsu grant vest quantum

Per-grant share rounding for the vest schedule (2026-08-21 §8.2): the user's broker data
proved the initial offer grant vests in whole TENS — cumulative entitlement floored to a
multiple of 10 (520 cliff, 130 quarterlies, 140 true-ups) — while every focal refresh
floors to single shares. `vest_quantum` carries that multiple; existing rows (and every
refresh grant) keep 1, which reproduces the old behavior bit for bit.

Revision ID: b0465b6d6ac2
Revises: 983a8ec3f1cd
Create Date: 2026-08-21 13:48:37.688016

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b0465b6d6ac2"
down_revision: str | Sequence[str] | None = "983a8ec3f1cd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default so existing rows land on 1 in the same statement; kept afterwards so a
    # raw INSERT can never produce the NULL the model forbids.
    op.add_column(
        "rsu_grants",
        sa.Column("vest_quantum", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("rsu_grants", "vest_quantum")
