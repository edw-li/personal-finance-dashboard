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
"""

from datetime import date
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
    notes: str | None = None


class RsuGrantUpdate(BaseModel):
    # kind/label/shares/grant_price/first_vest_date/cliff_pct are NOT NULL: explicit null is
    # the house no-op on those. focal_year and notes are nullable: their null really CLEARS.
    kind: str | None = None
    label: str | None = Field(default=None, min_length=1, max_length=60)
    focal_year: int | None = None
    shares: int | None = None
    grant_price: Decimal | None = None
    first_vest_date: date | None = None
    cliff_pct: Decimal | None = None
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
    notes: str | None
    # --- computed (rsu_vesting); the vested split is judged on the scheduler-zone day the
    # ROUTE reads, never a clock inside the helper.
    vest_count: int
    vested_shares: int
    unvested_shares: int
