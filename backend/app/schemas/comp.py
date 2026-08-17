"""Wire shapes for the comp module (spec §5).

Money/shares/prices cross the wire as pydantic Decimals — JSON strings — at the column
scale the router quantized to: bases Numeric(12,2), RSU counts Numeric(12,4), prices
Numeric(14,4). The computed columns are 2dp money and 6dp percentages.

Everything except `focal_year` and `current_base` is nullable all the way down, and the
computed fields inherit that: `comp_calc.metrics` explains which null cascades where.
On PATCH an explicit null on one of the nullable columns really CLEARS it — that is the
deliberate difference from the espp lots table, where every null is a no-op.
"""

from decimal import Decimal

from pydantic import BaseModel


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
