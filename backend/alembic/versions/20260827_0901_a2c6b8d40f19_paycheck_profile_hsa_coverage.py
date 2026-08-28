"""paycheck profile hsa coverage

`paycheck_profiles.hsa_coverage` — 'none' | 'self' | 'family', which HSA cap applies to
this person (2026-08-27 spec §3.2). NOT NULL with server_default 'self': every existing
profile is the primary's single-coverage HDHP until the user says otherwise in the form,
which is the honest default for a household that has only ever had one earner.

Validated in Python (api/paycheck.py's HSA_COVERAGES), not by a CHECK constraint — the
vocabulary is the app's and later batches may grow it without a migration. The model
repeats the server_default so `alembic check` stays clean.

Revision ID: a2c6b8d40f19
Revises: d4f9a1c8e307
Create Date: 2026-08-27 09:01:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2c6b8d40f19"
down_revision: str | Sequence[str] | None = "d4f9a1c8e307"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "paycheck_profiles",
        sa.Column(
            "hsa_coverage",
            sa.String(length=10),
            server_default="self",
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("paycheck_profiles", "hsa_coverage")
