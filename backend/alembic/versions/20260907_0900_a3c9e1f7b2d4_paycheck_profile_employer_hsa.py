"""paycheck profile employer hsa

One person's employer HSA policy (2026-09-07 spec): `hsa_employer_annual` for the
employee's own coverage plus `hsa_employer_per_dependent` for each of `hsa_dependents`
ADDITIONAL covered individuals. All NOT NULL with server_default '0' (the match-tier
template) — no employer deposit is the only honest backfill for rows nobody was asked
about.

Validated in Python (api/paycheck.py), not by CHECK constraints: the bounds share the
writers' 422 vocabulary and may move.

Revision ID: a3c9e1f7b2d4
Revises: f6b8d2e4a7c1
Create Date: 2026-09-07 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3c9e1f7b2d4"
down_revision: str | Sequence[str] | None = "f6b8d2e4a7c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLUMNS = (
    ("hsa_employer_annual", sa.Numeric(8, 2)),
    ("hsa_employer_per_dependent", sa.Numeric(8, 2)),
    ("hsa_dependents", sa.Integer()),
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
