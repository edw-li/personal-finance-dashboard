"""Keep each household member's monthly take-home alongside its derived total."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "f12026092901"
down_revision = "f12026092301"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_cashflow", sa.Column("net_pay_by_person", postgresql.JSONB(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("monthly_cashflow", "net_pay_by_person")
