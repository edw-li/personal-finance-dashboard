"""credit card tables

Rewards-optimizer + credit-line tracking (2026-08-25 spec §2): credit_cards,
card_credits, reward_categories, reward_rates, credit_limit_events. All five are
dashboard-only and importer-immune. Purely additive.

Revision ID: c4d1e8a2b9f3
Revises: e7c5a9f4b2d8
Create Date: 2026-08-25 21:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4d1e8a2b9f3"
down_revision: str | Sequence[str] | None = "e7c5a9f4b2d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "credit_cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False),
        sa.Column("annual_fee", sa.Numeric(precision=8, scale=2), nullable=False),
        sa.Column("rewards_currency", sa.String(length=20), nullable=False),
        sa.Column("point_value_cents", sa.Numeric(precision=6, scale=4), nullable=False),
        sa.Column("primary_holder", sa.String(length=80), nullable=True),
        sa.Column("authorized_users", sa.String(length=200), nullable=True),
        sa.Column("opened_on", sa.Date(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.String(length=300), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.CheckConstraint("annual_fee >= 0", name=op.f("ck_credit_cards_annual_fee_non_negative")),
        sa.CheckConstraint(
            "point_value_cents > 0", name=op.f("ck_credit_cards_point_value_positive")
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name=op.f("fk_credit_cards_account_id_accounts"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_credit_cards")),
        sa.UniqueConstraint("name", name=op.f("uq_credit_cards_name")),
        sa.UniqueConstraint("slug", name=op.f("uq_credit_cards_slug")),
    )
    op.create_table(
        "card_credits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("annual_value", sa.Numeric(precision=8, scale=2), nullable=False),
        sa.Column("counts", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "annual_value >= 0", name=op.f("ck_card_credits_annual_value_non_negative")
        ),
        sa.ForeignKeyConstraint(
            ["card_id"],
            ["credit_cards.id"],
            name=op.f("fk_card_credits_card_id_credit_cards"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_card_credits")),
    )
    op.create_table(
        "reward_categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("annual_spend", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("spending_category_id", sa.Integer(), nullable=True),
        sa.Column("pinned_card_id", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "annual_spend IS NULL OR annual_spend >= 0",
            name=op.f("ck_reward_categories_annual_spend_non_negative"),
        ),
        sa.ForeignKeyConstraint(
            ["spending_category_id"],
            ["spending_categories.id"],
            name=op.f("fk_reward_categories_spending_category_id_spending_categories"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["pinned_card_id"],
            ["credit_cards.id"],
            name=op.f("fk_reward_categories_pinned_card_id_credit_cards"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reward_categories")),
        sa.UniqueConstraint("name", name=op.f("uq_reward_categories_name")),
        sa.UniqueConstraint("slug", name=op.f("uq_reward_categories_slug")),
    )
    op.create_table(
        "reward_rates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("multiplier", sa.Numeric(precision=6, scale=2), nullable=False),
        sa.Column("note", sa.String(length=120), nullable=True),
        sa.Column("monthly_cap", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.CheckConstraint("multiplier > 0", name=op.f("ck_reward_rates_multiplier_positive")),
        sa.CheckConstraint(
            "monthly_cap IS NULL OR monthly_cap > 0",
            name=op.f("ck_reward_rates_monthly_cap_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["card_id"],
            ["credit_cards.id"],
            name=op.f("fk_reward_rates_card_id_credit_cards"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["reward_categories.id"],
            name=op.f("fk_reward_rates_category_id_reward_categories"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reward_rates")),
        sa.UniqueConstraint("card_id", "category_id", name=op.f("uq_reward_rates_card_id")),
    )
    op.create_table(
        "credit_limit_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("limit_amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("note", sa.String(length=120), nullable=True),
        sa.CheckConstraint(
            "limit_amount > 0", name=op.f("ck_credit_limit_events_limit_amount_positive")
        ),
        sa.ForeignKeyConstraint(
            ["card_id"],
            ["credit_cards.id"],
            name=op.f("fk_credit_limit_events_card_id_credit_cards"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_credit_limit_events")),
        sa.UniqueConstraint(
            "card_id", "effective_date", name=op.f("uq_credit_limit_events_card_id")
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("credit_limit_events")
    op.drop_table("reward_rates")
    op.drop_table("reward_categories")
    op.drop_table("card_credits")
    op.drop_table("credit_cards")
