"""paycheck profile match tiers

One person's employer 401(k) match policy (2026-09-06 spec §2.1): `match_rate_1` on the
first `match_band_1` dollars of elective deferrals, `match_rate_2` on the next
`match_band_2`. All NOT NULL with server_default '0' (the hsa_coverage template) — zero
bands mean "no match", the only honest backfill.

Validated in Python (api/paycheck.py), not by CHECK constraints: the bounds share the
writers' 422 vocabulary and may move.

Revision ID: f6b8d2e4a7c1
Revises: e5a7c1d3f6b8
Create Date: 2026-09-06 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6b8d2e4a7c1"
down_revision: str | Sequence[str] | None = "e5a7c1d3f6b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLUMNS = (
    ("match_rate_1", sa.Numeric(10, 9)),
    ("match_band_1", sa.Numeric(12, 2)),
    ("match_rate_2", sa.Numeric(10, 9)),
    ("match_band_2", sa.Numeric(12, 2)),
)


def upgrade() -> None:
    """Upgrade schema."""
    for name, kind in _COLUMNS:
        op.add_column(
            "paycheck_profiles", sa.Column(name, kind, server_default="0", nullable=False)
        )


def downgrade() -> None:
    """Downgrade schema."""
    for name, _kind in reversed(_COLUMNS):
        op.drop_column("paycheck_profiles", name)
