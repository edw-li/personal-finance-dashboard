"""paycheck profile withholding split

The all-in `withholding_pct` split by jurisdiction (2026-09-09 audit item 3):
`fed_withholding_pct` and `state_withholding_pct`, each a fraction of the same taxable
base the all-in rate applies to, read off a paystub.

NULLABLE with NO server_default, unlike every other column added to this table: absent is
not zero here. A profile nobody has split has no federal rate at all, and the withholding
tracker refuses to split its balance rather than pricing a jurisdiction at 0% — so NULL is
the honest backfill for every existing row, and the model repeats no default (there is
none to drift from).

Validated in Python (api/paycheck.py), not by CHECK constraints: the 0–1 bound shares the
writers' 422 vocabulary and may move (the employer-HSA migration's rule).

Revision ID: c4a7e2b9d13f
Revises: a3c9e1f7b2d4
Create Date: 2026-09-09 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4a7e2b9d13f"
down_revision: str | Sequence[str] | None = "a3c9e1f7b2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLUMNS = ("fed_withholding_pct", "state_withholding_pct")


def upgrade() -> None:
    """Upgrade schema."""
    for name in _COLUMNS:
        op.add_column("paycheck_profiles", sa.Column(name, sa.Numeric(10, 9), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    for name in reversed(_COLUMNS):
        op.drop_column("paycheck_profiles", name)
