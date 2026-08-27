"""Wire shapes for the taxes module (spec §5).

Money and rates cross the wire as pydantic Decimals — JSON strings, so the frontend never
sees a float. The router owns every quantum: inputs 4dp, bracket rates 4dp, thresholds
2dp, summary money 2dp, effective rates 6dp.
"""

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.tax_keys import SINGLE

# The wire spelling of tax_keys.FILING_STATUSES. A Literal, not a str + validator, so
# FastAPI 422s an unknown status at the boundary with its own message; the constant tuple
# stays the source of truth and `test_filing_status_literal_matches_the_constant` pins the
# two together.
FilingStatus = Literal["single", "married_joint", "married_separate"]


class TaxYearOut(BaseModel):
    year: int
    notes: str | None
    filing_status: str
    input_count: int
    bracket_count: int


class TaxYearUpdate(BaseModel):
    # One field this batch: notes are still importer-owned, and the bracket tables are
    # NOT moved by a status change (see the router docstring).
    filing_status: FilingStatus


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
    filing_status: str = SINGLE
    # Jurisdictions with NO bracket table under this year's filing status. Always empty
    # for 'single': a partial single-filer year has always computed, with per-jurisdiction
    # warnings, and stored history depends on that. Non-empty only for a married year
    # whose tables have not been entered yet — where every section below is null rather
    # than a confidently wrong zero computed against a single filer's brackets.
    brackets_missing_for_status: list[str] = Field(default_factory=list)
    federal: IncomeTaxOut | None = None
    state: IncomeTaxOut | None = None
    medicare: WageTaxOut | None = None
    social_security: WageTaxOut | None = None
    disability: WageTaxOut | None = None
    capital_gains: CapitalGainsTaxOut | None = None
    totals: TaxTotalsOut | None = None
    warnings: list[str]


class IncompleteYearOut(BaseModel):
    """A year the trend feed had to skip — named so the page can offer the fix."""

    year: int
    filing_status: str
    brackets_missing_for_status: list[str]


class TaxSummariesOut(BaseModel):
    years: list[TaxSummaryOut]
    # Kept OUT of `years` on purpose: the trend chart consumes that list positionally and
    # a null-sectioned entry would be a landmine in every consumer.
    incomplete: list[IncompleteYearOut] = Field(default_factory=list)


class SaleLegIn(BaseModel):
    security_id: int
    shares: Decimal
    price: Decimal | None = None  # None -> the security's latest price
    term: Literal["long", "short"] | None = None  # None -> 'long' (+ warning if dateless)


class EsppSaleIn(BaseModel):
    lot_id: int
    sale_price: Decimal | None = None  # None -> the ESPP ticker's latest quote


class WhatIfIn(BaseModel):
    year: int
    sales: list[SaleLegIn] = Field(default_factory=list, max_length=20)
    espp_sales: list[EsppSaleIn] = Field(default_factory=list, max_length=20)
    overrides: dict[str, Decimal | None] = Field(default_factory=dict)


class WhatIfDelta(BaseModel):
    total_tax: Decimal
    take_home: Decimal
    federal_tax: Decimal
    state_tax: Decimal
    medicare_tax: Decimal
    social_security_tax: Decimal
    disability_tax: Decimal
    capital_gains_tax: Decimal
    effective_rate: Decimal | None  # fraction delta; None when either side is None


class ChangedInput(BaseModel):
    key: str
    label: str
    before: Decimal  # 0 when the key was absent
    after: Decimal


class SaleDetailOut(BaseModel):
    security_id: int
    ticker: str
    shares: Decimal
    price: Decimal
    proceeds: Decimal
    cost_basis: Decimal
    gain: Decimal
    term: str
    warnings: list[str]


class EsppSaleDetailOut(BaseModel):
    lot_id: int
    purchase_date: date
    shares: Decimal
    sale_price: Decimal
    proceeds: Decimal
    ordinary_income: Decimal
    capital_gain: Decimal
    term: str
    disposition: str
    warnings: list[str]


class WhatIfOut(BaseModel):
    year: int
    baseline: TaxSummaryOut
    scenario: TaxSummaryOut
    delta: WhatIfDelta
    changed_inputs: list[ChangedInput]
    sale_details: list[SaleDetailOut]
    espp_sale_details: list[EsppSaleDetailOut]
    warnings: list[str]


# --- the "Will I owe?" tracker (2026-08-21 spec §4). Every figure is computed at read time
# from stored profiles/grants/brackets; nothing below is ever persisted.


class WithholdingLegOut(BaseModel):
    ytd: Decimal
    projected: Decimal


class WithholdingVestOut(BaseModel):
    # Income is the vest BASE (fmv x shares), reported alongside the tax it carries so the
    # card can show what the supplemental/FICA figures were computed on.
    income_ytd: Decimal
    income_projected: Decimal
    supplemental_ytd: Decimal
    supplemental_projected: Decimal
    fica_ytd: Decimal
    fica_projected: Decimal


class SafeHarborOut(BaseModel):
    prior_year: int
    prior_total_tax: Decimal
    threshold: Decimal  # prior_total_tax x 1.10
    met: bool  # projected total withholding >= threshold


class WithholdingOut(BaseModel):
    year: int
    liability_total: Decimal
    salary: WithholdingLegOut
    vest: WithholdingVestOut
    total: WithholdingLegOut
    balance_projected: Decimal  # liability - projected withholding; positive = will owe
    checks_elapsed: int
    checks_total: int
    safe_harbor: SafeHarborOut | None
    warnings: list[str]
