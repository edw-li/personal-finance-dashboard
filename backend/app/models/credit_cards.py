"""Credit-card rewards optimizer tables (2026-08-25 spec §2).

ALL FIVE tables are dashboard-only — the workbook's Credit Card Matrix sheet is
reference material, not a source: the importer never reads or writes these tables
(rsu_grants' posture, pinned in test_importer_apply.py). Derived numbers (effective
rates, best-card sets, marginal value) are computed frontend-side; nothing here
stores a computed value.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

REWARDS_CURRENCIES = ("cash", "points", "miles")

# When a recurring credit resets (2026-09-03 calendar spec §6): the calendar year, or the
# card's opened_on anniversary. The calendar's card generator dates `card_credit` events by it.
CREDIT_RESET_CADENCES = ("calendar", "anniversary")


class CreditCard(Base):
    """One real card account. OWNERSHIP is `person_id` (NULL = joint — either spouse can
    hold the card); `primary_holder`/`authorized_users` stay as INFORMATIONAL text, e.g.
    the exact name embossed on the plastic (2026-08-28 spec §3 item 2)."""

    __tablename__ = "credit_cards"
    __table_args__ = (
        CheckConstraint("annual_fee >= 0", name="annual_fee_non_negative"),
        CheckConstraint("point_value_cents > 0", name="point_value_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    annual_fee: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("0"))
    rewards_currency: Mapped[str] = mapped_column(String(20))  # one of REWARDS_CURRENCIES
    # Valuation of ONE point/mile in cents; cash stays 1.0. The optimizer's whole
    # cross-currency comparison hangs off this column (spec §1).
    point_value_cents: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("1"))
    # NULL = JOINT, never "unowned": migration c7a2f4e91b53 backfilled every pre-existing
    # card to the primary person, so NULL only ever arrives from a deliberate choice.
    person_id: Mapped[int | None] = mapped_column(
        ForeignKey("people.id", ondelete="SET NULL"), default=None
    )
    primary_holder: Mapped[str | None] = mapped_column(String(80))
    authorized_users: Mapped[str | None] = mapped_column(String(200))  # free-form, comma chips
    opened_on: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(default=True)  # archived cards keep history
    # Optional link to a group='liability' Account: balance ÷ current limit = utilization.
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), default=None
    )
    notes: Mapped[str | None] = mapped_column(String(300))
    sort_order: Mapped[int] = mapped_column(default=0)


class CardCredit(Base):
    """A recurring credit on a card (e.g. the $300 travel credit). `counts` is the
    user's "I actually use this" toggle — only counted credits enter the
    worth-keeping math (spec §1 economics decision)."""

    __tablename__ = "card_credits"
    __table_args__ = (
        CheckConstraint("annual_value >= 0", name="annual_value_non_negative"),
        CheckConstraint(
            "reset_cadence IN ('calendar', 'anniversary')", name="reset_cadence_vocabulary"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("credit_cards.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(String(120))
    annual_value: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    counts: Mapped[bool] = mapped_column(default=True)
    # server_default repeated from migration d4f6b8c0e2a5 so `alembic check` stays clean.
    reset_cadence: Mapped[str] = mapped_column(
        String(12), default="calendar", server_default="calendar"
    )


class RewardCategory(Base):
    """A matrix ROW. Distinct from spending_categories (more granular: Flights vs
    Hotels); the optional mapping feeds the auto-suggested annual weight, and
    annual_spend is the manual override. pinned_card_id is the allocation override
    (spec §1 tie decision)."""

    __tablename__ = "reward_categories"
    __table_args__ = (
        CheckConstraint(
            "annual_spend IS NULL OR annual_spend >= 0", name="annual_spend_non_negative"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    annual_spend: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    spending_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("spending_categories.id", ondelete="SET NULL"), default=None
    )
    pinned_card_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_cards.id", ondelete="SET NULL"), default=None
    )


class RewardRate(Base):
    """A matrix CELL: card × category → multiplier. NO row = N/A (card unusable for
    the category). monthly_cap is the bonus-rate spend ceiling (Citi Custom Cash's
    $500/mo); overflow re-allocates frontend-side."""

    __tablename__ = "reward_rates"
    __table_args__ = (
        UniqueConstraint("card_id", "category_id"),
        CheckConstraint("multiplier > 0", name="multiplier_positive"),
        CheckConstraint("monthly_cap IS NULL OR monthly_cap > 0", name="monthly_cap_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("credit_cards.id", ondelete="CASCADE"))
    category_id: Mapped[int] = mapped_column(ForeignKey("reward_categories.id", ondelete="CASCADE"))
    multiplier: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    note: Mapped[str | None] = mapped_column(String(120))  # "portal", "Uber only", …
    monthly_cap: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))


class CreditLimitEvent(Base):
    """Credit-line history: dated limit changes; current limit = greatest
    effective_date. Event-shaped (not a column on the card) so v2's non-card credit
    lines (mortgage/HELOC) generalize this table instead of redesigning it."""

    __tablename__ = "credit_limit_events"
    __table_args__ = (
        UniqueConstraint("card_id", "effective_date"),
        CheckConstraint("limit_amount > 0", name="limit_amount_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("credit_cards.id", ondelete="CASCADE"))
    effective_date: Mapped[date] = mapped_column(Date)
    limit_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    note: Mapped[str | None] = mapped_column(String(120))
