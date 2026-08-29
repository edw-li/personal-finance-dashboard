from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

HoldingTypeLiteral = Literal["etf", "mutual_fund", "stock", "private"]
TransactionTypeLiteral = Literal["buy", "sell", "split"]


class SecurityCreate(BaseModel):
    ticker: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=200)
    industry: str | None = Field(default=None, max_length=80)
    holding_type: HoldingTypeLiteral
    is_manual_priced: bool = False
    annual_dividend: Decimal | None = None
    ex_div_date: date | None = None


class SecurityUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    industry: str | None = Field(default=None, max_length=80)
    holding_type: HoldingTypeLiteral | None = None
    is_manual_priced: bool | None = None
    is_active: bool | None = None
    annual_dividend: Decimal | None = None
    ex_div_date: date | None = None


class SecurityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticker: str
    name: str
    industry: str | None
    holding_type: str
    is_manual_priced: bool
    is_active: bool
    annual_dividend: Decimal | None
    ex_div_date: date | None


class TransactionCreate(BaseModel):
    security_id: int
    account: str = Field(min_length=1, max_length=80)
    type: TransactionTypeLiteral
    txn_date: date | None = None
    shares: Decimal | None = None
    price: Decimal | None = None
    fees: Decimal | None = None
    split_factor: Decimal | None = None
    notes: str | None = None


class TransactionUpdate(BaseModel):
    account: str | None = Field(default=None, min_length=1, max_length=80)
    type: TransactionTypeLiteral | None = None
    txn_date: date | None = None
    shares: Decimal | None = None
    price: Decimal | None = None
    fees: Decimal | None = None
    split_factor: Decimal | None = None
    notes: str | None = None


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    security_id: int
    account: str
    type: str
    txn_date: date | None
    shares: Decimal
    price: Decimal
    fees: Decimal | None
    split_factor: Decimal | None
    sort_index: int
    source: str
    notes: str | None


class DividendCreate(BaseModel):
    security_id: int
    account: str | None = Field(default=None, max_length=80)
    pay_date: date
    amount: Decimal
    notes: str | None = None


class DividendUpdate(BaseModel):
    account: str | None = Field(default=None, max_length=80)
    pay_date: date | None = None
    amount: Decimal | None = None
    notes: str | None = None


class DividendOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    security_id: int
    account: str | None
    pay_date: date
    amount: Decimal
    source: str
    ex_date: date | None
    per_share: Decimal | None
    shares_held: Decimal | None
    notes: str | None


class DividendEventOut(BaseModel):
    """A display-only historical ex-dividend marker (2026-08-28 spec). Deliberately three
    fields: per_share and NO dollar amount, because the imported book is dateless and the
    shares held on an old ex-date are unknowable — see models.SecurityDividendEvent. The
    decimal crosses the wire as a string, like every other Numeric in this module."""

    model_config = ConfigDict(from_attributes=True)

    security_id: int
    ex_date: date
    per_share: Decimal


class HoldingOut(BaseModel):
    security_id: int
    ticker: str
    name: str
    industry: str | None
    holding_type: str
    is_manual_priced: bool
    shares: Decimal
    avg_cost: Decimal | None
    cost_basis: Decimal
    price: Decimal | None
    quoted_at: datetime | None
    price_source: str | None
    day_change_pct: Decimal | None
    day_change_amount: Decimal | None
    market_value: Decimal | None
    weight_pct: Decimal | None
    unrealized_gl: Decimal | None
    unrealized_gl_pct: Decimal | None
    realized_gl: Decimal
    dividends_collected: Decimal
    annual_dividend: Decimal | None
    annual_income: Decimal | None
    yield_pct: Decimal | None
    yoc_pct: Decimal | None
    xirr_pct: Decimal | None
    accounts: list[str]
    warnings: list[str]


class HoldingsTotals(BaseModel):
    market_value: Decimal
    cost_basis: Decimal
    unrealized_gl: Decimal
    unrealized_gl_pct: Decimal | None
    day_change_amount: Decimal | None
    day_change_pct: Decimal | None
    realized_gl: Decimal
    dividends_collected: Decimal
    annual_income: Decimal
    unpriced_count: int


class HoldingsOut(BaseModel):
    as_of: datetime | None  # OLDEST quoted_at among priced holdings (conservative staleness)
    # NEWEST quoted_at — the performance chart dates its live ping by this. Dating it by
    # as_of let one stale manual quote drag the ping behind the weekly series' end and
    # silently retire it once live Monday rows kept the series fresh (review-confirmed).
    latest_quote_at: datetime | None
    totals: HoldingsTotals
    holdings: list[HoldingOut]


class AllocationSlice(BaseModel):
    key: str
    market_value: Decimal
    weight_pct: Decimal
    holdings: int


class AllocationOut(BaseModel):
    by: Literal["industry", "type", "account"]
    total_market_value: Decimal
    slices: list[AllocationSlice]


class PortfolioAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    # NULL = JOINT/household (the accounts.person_id grammar), never "unknown": migration
    # c9f4a7e2b168 backfilled every pre-existing label to the primary person.
    person_id: int | None


class PortfolioAccountUpdate(BaseModel):
    # extra="forbid": labels ARE the positions' identity this batch, so an attempted rename
    # must be a loud 422 rather than a key pydantic quietly drops.
    model_config = ConfigDict(extra="forbid")

    # int32-bounded so a garbage id 422s instead of surfacing asyncpg's DataError; null is
    # a real write (it is how an account becomes joint), so absence is what "no change"
    # means — the router reads model_fields_set, not the value.
    person_id: int | None = Field(default=None, ge=1, le=2_147_483_647)


class RealizedRow(BaseModel):
    security_id: int
    ticker: str
    name: str
    realized_gl: Decimal


class RealizedOut(BaseModel):
    total: Decimal
    rows: list[RealizedRow]


class RefreshOut(BaseModel):
    updated: list[str]
    failed: dict[str, str]
    skipped_manual: list[str]
    duration_ms: int
    dividends_ingested: int


class DividendEventCounts(BaseModel):
    """services.dividend_events.backfill_dividend_events' counts — the deep one-time fetch
    of the performance chart's pre-window ex-dividend markers. `failed` covers a raising
    provider AND an empty answer: a blocked yfinance returns zero bars rather than raising,
    and the security stays unmarked either way (the backfill's docstring)."""

    created: int
    synced: int
    failed: int


class LastRefreshOut(BaseModel):
    """The persisted outcome of the most recent refresh run, manual or scheduled —
    price_service.record_refresh_run's payload, given back a shape."""

    at: datetime
    trigger: str
    updated: int
    failed: dict[str, str]
    skipped_manual: int
    history_appended: bool
    # Optional: payloads stored before this feature lack the keys and must still validate
    # (the status endpoint's degrade posture).
    dividends_ingested: int | None = None
    dividends_removed: int | None = None
    dividends_skipped_overlap: int | None = None
    # Same posture, one release later (2026-08-28): absent in every blob written before the
    # historical-events backfill existed, so it reads as "unknown", never as zero.
    dividend_events: DividendEventCounts | None = None


class RefreshStatusOut(BaseModel):
    # last is None before the first recorded run; next_run_at is None when no scheduler
    # is running (SCHEDULER_ENABLED=0, tests) — two different kinds of quiet.
    last: LastRefreshOut | None
    next_run_at: datetime | None


class PricePoint(BaseModel):
    d: date
    c: Decimal


class PriceHistoryOut(BaseModel):
    ticker: str
    points: list[PricePoint]


class ManualPriceIn(BaseModel):
    price: Decimal
    as_of: date | None = None


class LatestPriceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    security_id: int
    price: Decimal
    quoted_at: datetime
    source: str


class PortfolioHistoryOut(BaseModel):
    """Parallel arrays (net-worth TimeseriesOut posture): index i across all five lists
    is one weekly imported point. sp500 is the sheet's baseline — the STARTING balance
    benchmarked into VOO shares, not contribution-matched. benchmark is the
    contribution-matched leg, derived at read time (value_history.contribution_benchmark):
    every inferred contribution buys VOO instead. Rows are Decimal wherever computable —
    rows before the first VOO bar carry the seed flat; ALL-None only when VOO has no bars
    at all (nulls, never a 500)."""

    dates: list[date]
    market_value: list[Decimal]
    cost_basis: list[Decimal]
    sp500: list[Decimal]
    benchmark: list[Decimal | None]
