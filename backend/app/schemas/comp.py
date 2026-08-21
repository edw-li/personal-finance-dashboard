"""Wire shapes for the comp module (spec §5).

Money/shares/prices cross the wire as pydantic Decimals — JSON strings — at the column
scale the router quantized to: bases Numeric(12,2), RSU counts Numeric(12,4), prices
Numeric(14,4). The computed columns are 2dp money and 6dp percentages.

Everything except `focal_year` and `current_base` is nullable all the way down, and the
computed fields inherit that: `comp_calc.metrics` explains which null cascades where.
On PATCH an explicit null on one of the nullable columns really CLEARS it — that is the
deliberate difference from the espp lots table, where every null is a no-op.

The RSU grant shapes at the bottom follow the same split, with a different NOT NULL set:
only `focal_year` and `notes` are nullable there. Their vest columns are never stored —
`rsu_vesting` recomputes the schedule on every read (2026-08-21 spec §3).

The vesting-schedule payload after them is READ-ONLY and computed end to end: nothing in it
is stored, and every field that depends on a price is nullable, because the ticker -> security
-> quote/history chain is a soft link that breaks at any hop (spec §4).
"""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class CompEventIn(BaseModel):
    focal_year: int
    current_base: Decimal
    new_base: Decimal | None = None
    unvested_rsus: Decimal | None = None
    unvested_price: Decimal | None = None
    refresh_rsus: Decimal | None = None
    grant_price: Decimal | None = None
    notes: str | None = None


class CompEventUpdate(BaseModel):
    # focal_year / current_base are NOT NULL: an explicit null is a no-op on those two.
    # Every other field's null is a real "clear this column".
    focal_year: int | None = None
    current_base: Decimal | None = None
    new_base: Decimal | None = None
    unvested_rsus: Decimal | None = None
    unvested_price: Decimal | None = None
    refresh_rsus: Decimal | None = None
    grant_price: Decimal | None = None
    notes: str | None = None


class CompEventOut(BaseModel):
    id: int
    focal_year: int
    current_base: Decimal
    new_base: Decimal | None
    unvested_rsus: Decimal | None
    unvested_price: Decimal | None
    refresh_rsus: Decimal | None
    grant_price: Decimal | None
    notes: str | None
    # --- computed (comp_calc.metrics)
    base_delta: Decimal | None
    base_delta_pct: Decimal | None
    unvested_equity: Decimal | None
    equity_delta: Decimal | None
    equity_delta_pct: Decimal | None
    # Total comp proxy = base + unvested equity (+ the refresh grant, after). Never null:
    # `current_base` is NOT NULL and every missing side contributes 0.
    tc_before: Decimal
    tc_after: Decimal


class RsuGrantIn(BaseModel):
    kind: str
    # max_length matches the String(60) column (espp.PeriodIn's precedent): 61 chars would
    # otherwise reach asyncpg as a StringDataRightTruncation, i.e. a 500. `kind` needs no
    # such guard — the router's GRANT_KINDS membership check is narrower than String(10).
    label: str = Field(min_length=1, max_length=60)
    focal_year: int | None = None
    shares: int
    grant_price: Decimal
    first_vest_date: date
    cliff_pct: Decimal
    # Shares-per-vest rounding (spec §8.2): cumulative entitlement floors to a multiple of
    # this, the final vest trues up. 1 (the default, so pre-§8.2 clients keep working) is
    # plain whole-share flooring; the user's real offer grant vests in tens.
    vest_quantum: int = 1
    notes: str | None = None


class RsuGrantUpdate(BaseModel):
    # kind/label/shares/grant_price/first_vest_date/cliff_pct/vest_quantum are NOT NULL:
    # explicit null is the house no-op on those. focal_year and notes are nullable: their
    # null really CLEARS.
    kind: str | None = None
    label: str | None = Field(default=None, min_length=1, max_length=60)
    focal_year: int | None = None
    shares: int | None = None
    grant_price: Decimal | None = None
    first_vest_date: date | None = None
    cliff_pct: Decimal | None = None
    vest_quantum: int | None = None
    notes: str | None = None


class RsuGrantOut(BaseModel):
    id: int
    kind: str
    label: str
    focal_year: int | None
    shares: int
    grant_price: Decimal
    first_vest_date: date
    cliff_pct: Decimal
    vest_quantum: int
    notes: str | None
    # --- computed (rsu_vesting); the vested split is judged on the scheduler-zone day the
    # ROUTE reads, never a clock inside the helper.
    vest_count: int
    vested_shares: int
    unvested_shares: int


# --- GET /comp/vesting-schedule: one payload for the whole Comp card set (spec §4).


class VestOut(BaseModel):
    # vest_date, NOT date: a field literally named `date` shadows the datetime.date it is
    # annotated with, inside the class body (the hazard PriceHistory.price_date documents,
    # and the reason prices' PricePoint uses `d`/`c`). Do not rename.
    vest_date: date
    grant_id: int
    label: str
    shares: int
    fmv: Decimal | None  # stored close on-or-before the vest date; null when none
    value: Decimal | None  # fmv x shares, 2dp; null when fmv is
    is_past: bool


class VestDayOut(BaseModel):
    """One vest DATE across every grant — the table's summary row (2026-08-21 revision: the
    per-tranche list grew four rows per quarter and the user asked for date grouping). All
    tranches on one past day price at the SAME close (one bar per security per day), so a
    single fmv/value pair is exact, not an average; the per-grant breakdown stays in `vests`.
    """

    vest_date: date
    is_past: bool
    tranche_count: int
    shares: int  # every grant's tranche on this date, summed
    # Past day: the day's shared close (null when the history has no bar behind it).
    # Future day: the latest quote the estimate below was priced at (null without one).
    fmv: Decimal | None
    # Past day: fmv x shares, 2dp. Future day: latest quote x shares — an ESTIMATE, and
    # `value_is_estimate` is how the UI knows to say so.
    value: Decimal | None
    value_is_estimate: bool


class NextVestOut(BaseModel):
    vest_date: date
    shares: int
    est_value: Decimal | None  # at the latest quote


class VestingTilesOut(BaseModel):
    next_vest: NextVestOut | None
    unvested_shares: int
    unvested_value: Decimal | None
    vested_this_year_shares: int
    vested_this_year_income: Decimal | None


class SeedCandidateOut(BaseModel):
    focal_year: int
    # comp_events.refresh_rsus verbatim at its Numeric(12,4) scale — this is a form prefill,
    # and the grant writer is the one that enforces whole shares.
    shares: Decimal
    grant_price: Decimal
    suggested_first_vest_date: date
    suggested_label: str


class VestingScheduleOut(BaseModel):
    ticker: str | None
    latest_price: Decimal | None
    quoted_at: datetime | None
    grants: list[RsuGrantOut]
    vests: list[VestOut]
    # `vests` grouped by date, chronological — the table renders THESE rows and expands a
    # date into its `vests` entries on demand (2026-08-21 revision).
    vest_days: list[VestDayOut]
    tiles: VestingTilesOut
    seed_candidates: list[SeedCandidateOut]
    # Informational only: focal history and a grant disagreeing is a hint, never an error —
    # the grant is the vesting truth (spec §4).
    drift_warnings: list[str]
    warnings: list[str]
