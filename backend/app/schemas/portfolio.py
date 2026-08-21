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
    """Parallel arrays (net-worth TimeseriesOut posture): index i across all four lists
    is one weekly imported point. sp500 is the sheet's baseline — the STARTING balance
    benchmarked into VOO shares, not contribution-matched."""

    dates: list[date]
    market_value: list[Decimal]
    cost_basis: list[Decimal]
    sp500: list[Decimal]
