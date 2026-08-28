from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

HOLDING_TYPES = ("etf", "mutual_fund", "stock", "private")
TRANSACTION_TYPES = ("buy", "sell", "split")
TRANSACTION_SOURCES = ("import", "ui")
DIVIDEND_SOURCES = ("manual", "auto")
PRICE_SOURCES = ("yfinance", "manual")


class Security(Base):
    __tablename__ = "securities"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticker: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    industry: Mapped[str | None] = mapped_column(String(80))
    holding_type: Mapped[str] = mapped_column(String(20))  # one of HOLDING_TYPES
    is_manual_priced: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)
    annual_dividend: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    ex_div_date: Mapped[date | None] = mapped_column(Date)
    # ex_div_date (above) is the most recent PAST event — maintained from historical
    # bars by price_service._update_dividend_metadata, always behind us. This one is the
    # ANNOUNCED upcoming date from the provider's forward calendar (2026-08-24 calendar
    # spec §3.1): a new column, not an overload, so ex_div_date's consumers (Securities
    # panel, TTM metadata) keep their semantics. The refresh clears it once it passes.
    next_ex_div_date: Mapped[date | None] = mapped_column(Date)


class PortfolioAccount(Base):
    """A brokerage/platform label with an owner — the identity behind every position row.

    `label` is the EXACT string the sheet and the ledger UI already use ("RH Taxable",
    "Fidelity Taxable"). It is the positions' natural key, so it is UNIQUE and immutable
    this batch (the accounts-slug posture): renaming is a data migration, not a PATCH.
    `person_id` NULL means JOINT/household, never "unknown" — migration c9f4a7e2b168
    backfilled every pre-existing label to the primary person, so an unset owner is a
    deliberate statement (the accounts.person_id grammar, 2026-08-26 spec §4).
    """

    __tablename__ = "portfolio_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(80), unique=True)
    person_id: Mapped[int | None] = mapped_column(
        ForeignKey("people.id", ondelete="SET NULL"), default=None
    )

    def __repr__(self) -> str:
        # The importer's diff samples print this ("portfolio_account Old -> New"), so it
        # reads as the label rather than as an object address.
        return self.label if self.label is not None else "<portfolio account>"


class PositionTransaction(Base):
    __tablename__ = "position_transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    security_id: Mapped[int] = mapped_column(ForeignKey("securities.id", ondelete="CASCADE"))
    portfolio_account_id: Mapped[int] = mapped_column(
        ForeignKey(
            "portfolio_accounts.id",
            ondelete="RESTRICT",
            # Named explicitly: the naming convention derives a 64-character name, one past
            # Postgres' 63-byte identifier limit, and SQLAlchemy would silently truncate it
            # to a hash suffix — in create_all AND in the migration. A readable name that
            # both paths agree on beats two identical hashes.
            name="fk_position_transactions_portfolio_account",
        )
    )
    # selectin: every SELECT of a transaction carries its label without a per-caller loader
    # option. An UNLOADED many-to-one raises MissingGreenlet the moment a response
    # serializes `account`, so rows are always constructed with portfolio_account=<row>,
    # never with a bare FK id (routers, importer and the tests' factory all do this).
    portfolio_account: Mapped["PortfolioAccount"] = relationship(lazy="selectin")

    @property
    def account(self) -> str:
        """The wire's `account` label, unchanged since before ownership existed
        (2026-08-28 spec §3 item 1: every response that carried `account: str` still
        does). Read-only — writes go through services.portfolio_accounts."""
        return self.portfolio_account.label

    type: Mapped[str] = mapped_column(String(10))  # one of TRANSACTION_TYPES
    txn_date: Mapped[date | None] = mapped_column(Date)
    shares: Mapped[Decimal] = mapped_column(Numeric(16, 6))
    price: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    fees: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    split_factor: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    # Preserves spreadsheet row order — cost-basis folding must process transactions in
    # this order because most rows have no date. Order by (sort_index, id) for stability.
    sort_index: Mapped[int] = mapped_column(default=0)
    # Ownership contract (supersedes Plan 2's sort_index-0 rule): the importer keys and
    # sync-deletes ONLY source='import' rows; UI rows are invisible to re-imports.
    source: Mapped[str] = mapped_column(String(10), default="ui", server_default="ui")
    notes: Mapped[str | None] = mapped_column(Text)


class DividendPayment(Base):
    __tablename__ = "dividend_payments"
    __table_args__ = (
        # The auto-ingest idempotency key: one row per (security, portfolio account, event
        # date) for refresh-written rows. Partial — manual rows stay unconstrained, and the
        # index must live HERE (not only in the migration) because the test database is
        # built by Base.metadata.create_all.
        Index(
            "ux_dividend_auto_event",
            "security_id",
            "portfolio_account_id",
            "ex_date",
            unique=True,
            postgresql_where=text("source = 'auto'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    security_id: Mapped[int] = mapped_column(ForeignKey("securities.id", ondelete="CASCADE"))
    # NULLABLE, like the label it replaces: a dividend with no account is unattributed and
    # still crosses the wire as `account: null`. It is therefore HOUSEHOLD-only — an
    # unattributed payment cannot honestly join a person's view (load_portfolio's rule).
    portfolio_account_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "portfolio_accounts.id",
            ondelete="RESTRICT",
            name="fk_dividend_payments_portfolio_account",
        ),
        default=None,
    )
    portfolio_account: Mapped["PortfolioAccount | None"] = relationship(lazy="selectin")

    @property
    def account(self) -> str | None:
        """The wire's optional `account` label (see PositionTransaction.account)."""
        return None if self.portfolio_account is None else self.portfolio_account.label

    pay_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    # Ownership contract (the transactions `source` precedent, user decision 2026-08-20):
    # the refresh owns source='auto' rows inside its 370-day window; the importer never
    # writes dividends at all (pinned in tests); manual rows are the user's alone.
    source: Mapped[str] = mapped_column(String(10), default="manual", server_default="manual")
    # The event date (auto rows always carry it; pay_date on auto rows equals it — Yahoo's
    # chart feed has no payment date, an honest documented approximation).
    ex_date: Mapped[date | None] = mapped_column(Date)
    per_share: Mapped[Decimal | None] = mapped_column(Numeric(10, 6))
    shares_held: Mapped[Decimal | None] = mapped_column(Numeric(16, 6))
    notes: Mapped[str | None] = mapped_column(Text)


class LatestPrice(Base):
    __tablename__ = "latest_prices"

    security_id: Mapped[int] = mapped_column(
        ForeignKey("securities.id", ondelete="CASCADE"), primary_key=True
    )
    price: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    quoted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(20))  # one of PRICE_SOURCES


class PriceHistory(Base):
    __tablename__ = "price_history"
    __table_args__ = (UniqueConstraint("security_id", "price_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    security_id: Mapped[int] = mapped_column(ForeignKey("securities.id", ondelete="CASCADE"))
    # price_date, NOT date: an attribute named `date` shadows datetime.date inside its own
    # annotation — Mapped[date | None] would then silently build a SQL OR expression and
    # leave the column non-nullable. Verified hazard; do not rename back.
    price_date: Mapped[date] = mapped_column(Date)
    close: Mapped[Decimal] = mapped_column(Numeric(14, 4))


class PortfolioValueHistory(Base):
    """The workbook's weekly portfolio series (Portfolio sheet, hidden cols AB..AH):
    imported verbatim and extended live at the same weekly-Monday cadence
    (services.value_history), never derived from transactions (most position rows are
    undated by design — see PositionTransaction.sort_index). Import-owned up to the
    workbook's last row: a re-import upserts by date AND deletes rows the sheet doesn't
    carry in that range (apply_portfolio_history's override contract)."""

    __tablename__ = "portfolio_value_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    # snapshot_date, NOT date — the same annotation-shadowing hazard PriceHistory
    # documents above; do not rename.
    snapshot_date: Mapped[date] = mapped_column(Date, unique=True)
    market_value: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    cost_basis: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    # The sheet's S&P 500 baseline: the STARTING balance benchmarked into VOO shares —
    # later contributions are not added to it (spec "S&P baseline semantics").
    sp500_value: Mapped[Decimal] = mapped_column(Numeric(14, 2))
