"""tax year filing status

`tax_years.filing_status` (2026-08-26 spec §4): 'single' | 'married_joint' |
'married_separate', Python-validated like `accounts.group`. Purely additive — every
existing row lands on 'single' through the server default, so history is untouched and
the engine's single-filer path stays byte-identical. The user flips 2026 in the UI.

Revision ID: a7e3f1b90c24
Revises: a8d24b6e9107
Create Date: 2026-08-26 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7e3f1b90c24"
# The household-foundation head this branch was cut from (Step 0.3).
down_revision: str | Sequence[str] | None = "a8d24b6e9107"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "tax_years",
        sa.Column("filing_status", sa.String(length=20), server_default="single", nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tax_years", "filing_status")
