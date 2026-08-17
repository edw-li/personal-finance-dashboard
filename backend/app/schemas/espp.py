"""Wire shapes for the ESPP module (spec §5).

Money, prices and percentages cross the wire as pydantic Decimals — JSON strings, so the
frontend never sees a float. The router owns every quantum: shares 4dp, espp prices 5dp,
period money 2dp, contribution_pct 9dp, modeler money 2dp, gain_pct 6dp.

Share COUNTS in the modeler are Decimals too, so they serialize as `"78"` rather than
`78`: the plan pins those wire values as strings, and it keeps every numeric field in
this module one type on the frontend. They are always whole numbers (the sheet's INT()).
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

# A zero at Numeric(10,9) scale comes back from the driver as Decimal("0E-9"), and
# pydantic's JSON encoder renders `str(...)` verbatim — so a 0% period would hit the wire
# as `"0E-9"`, which no JS decimal parser reads as a number. `format(v, "f")` forces plain
# notation, and `when_used="json"` keeps python-mode dumps on the real Decimal.
Pct9 = Annotated[
    Decimal, PlainSerializer(lambda v: format(v, "f"), return_type=str, when_used="json")
]


class LotIn(BaseModel):
    purchase_date: date
    qualifying_date: date
    shares: Decimal
    subscription_price: Decimal
    purchase_fmv: Decimal
    # Omitted means "use the 85% default" — the router derives
    # quantize5(0.85 x min(subscription_price, purchase_fmv)).
    purchase_price: Decimal | None = None
    sold_date: date | None = None
    sold_price: Decimal | None = None
    notes: str | None = None


class LotUpdate(BaseModel):
    purchase_date: date | None = None
    qualifying_date: date | None = None
    shares: Decimal | None = None
    subscription_price: Decimal | None = None
    purchase_fmv: Decimal | None = None
    # Explicit null re-derives the 85% default from the merged row (the column is NOT
    # NULL, so a null can never mean "store nothing" here).
    purchase_price: Decimal | None = None
    sold_date: date | None = None
    sold_price: Decimal | None = None
    notes: str | None = None


class LotOut(BaseModel):
    id: int
    purchase_date: date
    qualifying_date: date
    shares: Decimal
    subscription_price: Decimal
    purchase_fmv: Decimal
    purchase_price: Decimal
    sold_date: date | None
    sold_price: Decimal | None
    notes: str | None
    # --- computed (espp_calc.lot_metrics); market fields are null when the espp_ticker
    # soft link dangles, or when a sold row is missing its price.
    cost_basis: Decimal
    market_value: Decimal | None
    gain_amount: Decimal | None
    gain_pct: Decimal | None
    qualified: bool
    days_until_qualified: int | None
    is_sold: bool


class LotsOut(BaseModel):
    # The quote the whole table was priced against — null at every break in the link.
    espp_ticker: str | None
    current_price: Decimal | None
    quoted_at: datetime | None
    lots: list[LotOut]


class PeriodIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    period_start: date
    period_end: date
    semi_annual_base: Decimal
    additional_payments: Decimal = Decimal("0")
    contribution_pct: Decimal


class PeriodUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=60)
    period_start: date | None = None
    period_end: date | None = None
    semi_annual_base: Decimal | None = None
    additional_payments: Decimal | None = None
    contribution_pct: Decimal | None = None


class PeriodOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    period_start: date
    period_end: date
    semi_annual_base: Decimal
    additional_payments: Decimal
    contribution_pct: Pct9


class ModelerPeriodOut(BaseModel):
    # Stored inputs, echoed so the card renders without a second call.
    id: int
    label: str
    period_start: date
    period_end: date
    semi_annual_base: Decimal
    additional_payments: Decimal
    contribution_pct: Pct9
    # --- computed chain (espp_calc.run_modeler)
    eligible_earnings: Decimal
    contribution: Decimal
    available: Decimal
    purchase_price: Decimal
    shares_before_limit: Decimal
    unused_25k: Decimal  # remaining limit at the START of this period
    max_shares_25k: Decimal
    over_limit: bool
    shares: Decimal
    cost: Decimal
    carry_forward_out: Decimal
    refund: Decimal
    value_25k: Decimal


class ModelerTotalsOut(BaseModel):
    total_25k_value: Decimal
    out_of_pocket_cost: Decimal
    fmv_of_shares: Decimal
    remaining_25k: Decimal  # 25000 - total_25k_value, for the gauge


class ModelerOut(BaseModel):
    year: int
    espp_ticker: str | None
    # "params" only when BOTH prices came from the query string; any fallback to the
    # ticker's latest quote reports "latest_price".
    price_source: Literal["params", "latest_price"]
    # The quote the fallback prices came from — null whenever price_source is "params",
    # because then no stored quote is behind the numbers (Task 8's provenance line).
    quoted_at: datetime | None
    subscription_price: Decimal
    purchase_fmv: Decimal
    carry_forward: Decimal
    periods: list[ModelerPeriodOut]
    totals: ModelerTotalsOut
