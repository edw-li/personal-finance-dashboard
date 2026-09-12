"""Month review metadata and explicitly unreviewed historical adoption.

Revision ID: f12026091201
Revises: d5f2b7c8e390
"""

from datetime import datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.services.review_input_v1 import month_input
from app.services.review_input_v1 import revision as input_revision

revision = "f12026091201"
down_revision = "d5f2b7c8e390"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "month_review_adoption",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("adopted_on", sa.Date(), nullable=False),
        sa.CheckConstraint("id = 1", name=op.f("ck_month_review_adoption_singleton")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_month_review_adoption")),
    )
    table = op.create_table(
        "month_reviews",
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("legacy_revision", sa.String(64), nullable=True),
        sa.Column("reviewed_revision", sa.String(64), nullable=True),
        sa.Column("confirmation_revision", sa.String(64), nullable=True),
        sa.Column(
            "balances_reviewed", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "spending_reviewed", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "take_home_reviewed", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "zero_spending_confirmed", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_by", sa.String(255), nullable=True),
        sa.Column("last_request_id", sa.String(36), nullable=True),
        sa.Column("last_request_hash", sa.String(64), nullable=True),
        sa.Column("last_response", postgresql.JSONB(), nullable=True),
        sa.CheckConstraint(
            "EXTRACT(DAY FROM month) = 1", name=op.f("ck_month_reviews_month_is_first_of_month")
        ),
        sa.PrimaryKeyConstraint("month", name=op.f("pk_month_reviews")),
    )
    bind = op.get_bind()
    today = datetime.now(ZoneInfo("America/Los_Angeles")).date()
    bind.execute(
        sa.text("INSERT INTO month_review_adoption (id, adopted_on) VALUES (1, :day)"),
        {"day": today},
    )
    tables = (
        "net_worth_snapshots",
        "account_balances",
        "monthly_spending",
        "monthly_cashflow",
        "accounts",
        "spending_categories",
        "paycheck_profiles",
    )
    inputs = [list(bind.execute(sa.text(f"SELECT * FROM {name}")).mappings()) for name in tables]
    months = sorted({row["month"] for data in (inputs[0], inputs[2], inputs[3]) for row in data})
    legacy = [
        {"month": month, "legacy_revision": input_revision(month_input(month, *inputs))}
        for month in months
        if month < today.replace(day=1)
    ]
    if legacy:
        bind.execute(table.insert(), legacy)


def downgrade() -> None:
    # Financial source tables are intentionally untouched in either direction.
    op.drop_table("month_reviews")
    op.drop_table("month_review_adoption")
