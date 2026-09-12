from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

HoldingTypeLiteral = Literal["etf", "mutual_fund", "stock", "private"]
TransactionTypeLiteral = Literal["buy", "sell", "split"]
AllocationDimension = Literal["asset_class", "industry", "geography", "account", "type"]
AssetClass = Literal["equity", "bonds", "cash", "real_assets", "mixed", "other"]
Geography = Literal["us", "international", "global"]


class ClassificationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_class: AssetClass | None = None
    industry: str | None = Field(default=None, max_length=80)
    geography: Geography | None = None
    note: str | None = Field(default=None, max_length=500)

    @field_validator("industry", "note")
    @classmethod
    def trim_text(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class ClassificationOut(BaseModel):
    security_id: int
    ticker: str
    name: str
    holding_type: str
    asset_class: str | None
    industry: str | None
    geography: str | None
    source: str
    note: str | None
    reviewed_at: datetime | None
    industry_available: bool


class AllocationTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=100)
    # These are percentages (0..100), unlike allocation weights (0..1).
    target_pct: Decimal = Field(ge=0, le=100, max_digits=7, decimal_places=4)
    tolerance_pp: Decimal = Field(
        default=Decimal("0"), ge=0, le=100, max_digits=7, decimal_places=4
    )

    @field_validator("key")
    @classmethod
    def valid_key(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Target category must not be blank")
        return value


class AllocationTargetSave(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: Literal["draft", "active"]
    targets: list[AllocationTarget] = Field(max_length=100)

    @model_validator(mode="after")
    def valid_total(self):
        if len({target.key for target in self.targets}) != len(self.targets):
            raise ValueError("Each target category must appear once")
        if self.state == "active" and sum(t.target_pct for t in self.targets) != Decimal("100"):
            raise ValueError("Active allocation targets must total exactly 100%")
        return self


class AllocationTargetSetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    scope_key: str
    dimension: AllocationDimension
    state: Literal["draft", "active"]
    targets: list[AllocationTarget]
    updated_at: datetime


class AllocationMember(BaseModel):
    security_id: int
    ticker: str
    name: str
    account: str | None = None
    shares: Decimal
    market_value: Decimal | None
    quoted_at: datetime | None
    classification_source: str
    classification_reviewed_at: datetime | None


class AllocationCoverage(BaseModel):
    holding_count: int
    priced_count: int
    unpriced_count: int
    classified_count: int
    classified_market_value: Decimal
    unknown_market_value: Decimal
    classified_weight_pct: Decimal | None
    unpriced_holdings: list[AllocationMember]
    warnings: list[str]


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
    label: str = ""
    is_unknown: bool = False
    members: list[AllocationMember] = Field(default_factory=list)


class AllocationDrift(BaseModel):
    key: str
    label: str
    market_value: Decimal
    weight_pct: Decimal | None
    target_pct: Decimal
    tolerance_pp: Decimal
    drift_pp: Decimal | None
    drift_amount: Decimal | None
    outside_tolerance: bool | None
    has_unpriced: bool


class AllocationOut(BaseModel):
    by: AllocationDimension
    total_market_value: Decimal
    slices: list[AllocationSlice]
    scope_key: str = "household"
    as_of: datetime | None = None
    latest_quote_at: datetime | None = None
    coverage: AllocationCoverage | None = None
    target_set: AllocationTargetSetOut | None = None
    draft_target_set: AllocationTargetSetOut | None = None
    drift: list[AllocationDrift] = Field(default_factory=list)
    source_href: str = "/portfolio?section=holdings"


class EmployerExposureOut(BaseModel):
    ticker: str | None
    scope_key: str
    as_of: date
    quoted_at: datetime | None
    held_shares: Decimal
    held_value: Decimal | None
    held_weight_pct: Decimal | None
    priced_portfolio_value: Decimal
    unvested_shares: int
    unvested_value: Decimal | None
    # Existing Comp grants have no person ownership. Never imply a person filter applies.
    unvested_scope: str = "Household Comp grants (not owner-tagged)"
    warnings: list[str]


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
    """services.dividend_events.backfill_dividend_events' counts — the deep fetch of the
    performance chart's historical ex-dividend markers. `failed` covers a raising provider
    AND an empty answer: a blocked yfinance returns zero bars rather than raising, and the
    security's floor goes unrecorded either way (the backfill's docstring). Tickers skipped
    because they already failed this run's price leg are not counted at all — they were not
    attempted, and the refresh record's own `failed` map already names them.

    The whole object is null when the backfill CRASHED: its counts are then unknown, and a
    fabricated {0, 0, 0} would read as a settled book on every status surface."""

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
