"""Wire shapes for the taxes module (spec §5).

Money and rates cross the wire as pydantic Decimals — JSON strings, so the frontend never
sees a float. The router owns every quantum: inputs 4dp, bracket rates 4dp, thresholds
2dp, summary money 2dp, effective rates 6dp.
"""

from decimal import Decimal

from pydantic import BaseModel


class TaxYearOut(BaseModel):
    year: int
    notes: str | None
    input_count: int
    bracket_count: int


class TaxInputItemOut(BaseModel):
    key: str
    label: str
    sort_order: int
    is_derived: bool
    value: Decimal | None
    # The sheet's gray-cell formula for this key, when it has one. Advisory: the UI offers
    # a chip, nothing is ever applied server-side.
    suggested: Decimal | None


class TaxInputSectionOut(BaseModel):
    section: str
    items: list[TaxInputItemOut]


class TaxInputsOut(BaseModel):
    year: int
    sections: list[TaxInputSectionOut]


class TaxInputsIn(BaseModel):
    # Free-form keys, validated against the definition table by the router (which is the
    # only place that knows which keys are seeded); null deletes the stored row.
    values: dict[str, Decimal | None]


class BracketOut(BaseModel):
    bracket_index: int
    rate: Decimal
    threshold: Decimal


class BracketIn(BaseModel):
    rate: Decimal
    threshold: Decimal


class BracketsOut(BaseModel):
    # All six jurisdictions always present, possibly with empty tables.
    year: int
    jurisdictions: dict[str, list[BracketOut]]


class BracketsIn(BaseModel):
    # Per-jurisdiction FULL REPLACE; jurisdictions absent from the body are untouched.
    jurisdictions: dict[str, list[BracketIn]]


class IncomeTaxOut(BaseModel):
    agi: Decimal
    taxable_income: Decimal
    tax: Decimal
    effective_rate: Decimal | None


class WageTaxOut(BaseModel):
    w2_income: Decimal
    taxable_wages: Decimal
    tax: Decimal
    effective_rate: Decimal | None


class CapitalGainsTaxOut(BaseModel):
    taxable_income: Decimal  # the ordinary income the gains stack on top of
    gains_amount: Decimal
    tax: Decimal
    effective_rate: Decimal | None  # None when there are no gains (the sheet's #DIV/0!)


class TaxTotalsOut(BaseModel):
    gross_income: Decimal
    total_income: Decimal
    total_tax: Decimal
    take_home: Decimal
    effective_rate: Decimal | None


class TaxSummaryOut(BaseModel):
    year: int
    federal: IncomeTaxOut
    state: IncomeTaxOut
    medicare: WageTaxOut
    social_security: WageTaxOut
    disability: WageTaxOut
    capital_gains: CapitalGainsTaxOut
    totals: TaxTotalsOut
    warnings: list[str]


class TaxSummariesOut(BaseModel):
    years: list[TaxSummaryOut]
