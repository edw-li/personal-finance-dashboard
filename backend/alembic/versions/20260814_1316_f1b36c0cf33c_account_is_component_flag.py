"""account is_component flag

Revision ID: f1b36c0cf33c
Revises: a3f86e58ac4d
Create Date: 2026-08-14 13:16:04.048854

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1b36c0cf33c"
down_revision: str | Sequence[str] | None = "a3f86e58ac4d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "accounts",
        sa.Column("is_component", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    # The five sheet source-bucket columns (verified against the workbook 2026-08-14:
    # Fidelity Traditional 401(k) = employer match + reverse rollover + traditional;
    # Fidelity Roth 401(k) = roth basic + after-tax, exact at all 37 snapshots).
    # No-op on a fresh DB (accounts are importer-created).
    op.execute(
        "UPDATE accounts SET is_component = TRUE WHERE slug IN ("
        "'employer-match-401-k','reverse-rollover-401-k','traditional-401-k',"
        "'roth-basic-401-k','after-tax-401-k')"
    )
    # Drop the server_default so the schema matches the model (Python-side default only,
    # like sort_order/is_active) and `alembic check` stays clean.
    op.alter_column("accounts", "is_component", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("accounts", "is_component")
