from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

ACCOUNT_GROUPS = ("cash", "pre_tax", "post_tax", "taxable", "equity", "other", "liability")


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    group: Mapped[str] = mapped_column(String(20))  # one of ACCOUNT_GROUPS
    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    # Source-bucket columns the sheet tracks inside an aggregate account (the two Fidelity
    # 401(k)s). Excluded from every computed rollup; user-owned (the importer never diffs it).
    is_component: Mapped[bool] = mapped_column(default=False)
    # The aggregate a component folds into. Presentation-only (rollups key off
    # is_component alone): the UI lists components under their parent instead of at
    # their sheet-column position. Set at import-create / migration backfill; user-owned
    # after, like is_component.
    parent_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), default=None
    )


class NetWorthSnapshot(Base):
    __tablename__ = "net_worth_snapshots"
    __table_args__ = (
        CheckConstraint("EXTRACT(DAY FROM month) = 1", name="month_is_first_of_month"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    month: Mapped[date] = mapped_column(Date, unique=True)  # first of month
    recorded_on: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)


class AccountBalance(Base):
    __tablename__ = "account_balances"
    __table_args__ = (UniqueConstraint("snapshot_id", "account_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_id: Mapped[int] = mapped_column(
        ForeignKey("net_worth_snapshots.id", ondelete="CASCADE")
    )
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    # Signed. Liability-group balances are stored NEGATIVE (matching the sheet), so
    # net worth = SUM(balance) with no sign-flipping anywhere downstream.
    balance: Mapped[Decimal] = mapped_column(Numeric(14, 2))
