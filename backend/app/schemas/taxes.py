"""Wire shapes for the taxes module (spec §5).

Money and rates cross the wire as pydantic Decimals — JSON strings, so the frontend never
sees a float. The router owns every quantum: inputs 4dp, bracket rates 4dp, thresholds
2dp, summary money 2dp, effective rates 6dp.
"""

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.services.withholding_calc import PARTNER_ENTERED
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


class TaxPersonOut(BaseModel):
    """The person COLUMNS this year's return has, in render order (primary first)."""

    id: int
    name: str


class TaxInputItemOut(BaseModel):
    key: str
    label: str
    sort_order: int
    is_derived: bool
    # True for tax_keys.PER_PERSON_KEYS: this line renders one item per person column.
    is_per_person: bool = False
    # The column this item belongs to. Null for household keys — and also for per-person
    # keys on a database with no people roster, which is the pre-household spelling.
    person_id: int | None = None
    value: Decimal | None
    # The sheet's gray-cell formula for this key, when it has one, computed from THIS
    # column's own values. Advisory: the UI offers a chip, nothing is applied server-side.
    suggested: Decimal | None


class TaxInputSectionOut(BaseModel):
    section: str
    items: list[TaxInputItemOut]


class TaxInputsOut(BaseModel):
    year: int
    filing_status: str = SINGLE
    people: list[TaxPersonOut] = Field(default_factory=list)
    sections: list[TaxInputSectionOut]


class TaxInputRowIn(BaseModel):
    key: str
    # Null on a per-person key means "the primary person" — which is what every client
    # that predates this batch says by saying nothing at all.
    person_id: int | None = None
    value: Decimal | None


class TaxInputsIn(BaseModel):
    # Free-form keys, validated against the definition table by the router (which is the
    # only place that knows which keys are seeded); null deletes the stored row.
    # `values` is the household/primary shorthand every shipped client sends; `rows` is
    # its person-qualified form. Both are merged, and the same (key, person) twice is a
    # 422 rather than a last-write-wins surprise.
    values: dict[str, Decimal | None] = Field(default_factory=dict)
    rows: list[TaxInputRowIn] = Field(default_factory=list)


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
    filing_status: str = SINGLE
    # The statuses this YEAR has at least one stored bracket row for, sorted. The status
    # tabs read it: an empty tab is a setup state the page has to be able to show.
    statuses_with_rows: list[str]
    jurisdictions: dict[str, list[BracketOut]]


class BracketsIn(BaseModel):
    # Per-jurisdiction FULL REPLACE within ONE status; jurisdictions absent from the body
    # are untouched, and so is every other status's copy of them.
    filing_status: FilingStatus = "single"
    jurisdictions: dict[str, list[BracketIn]]


class BracketReviewFlags(BaseModel):
    """Which cloned tables are typically right as-is, and which need threshold edits.

    Social Security and SDI are PER-PERSON parameters — the wage base and the rate do not
    change with filing status, so a verbatim copy is correct. The other four carry
    per-RETURN thresholds that are emphatically not "2x single" (audit §5): the MFJ 37%
    band starts below 2x, the 20% capital-gains tier likewise, and the medicare table's
    additional tier moves from 200k to 250k (MFJ) or 125k (MFS).
    """

    verbatim_ok: list[str]
    review: list[str]


class ClonedBracketsOut(BracketsOut):
    review_flags: BracketReviewFlags


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
    # NIIT (2026-08-31 spec C2), on capital_gains' wire shape so payloads and frontend
    # types extend compatibly: gains_amount carries net investment income,
    # taxable_income the surcharged base min(NII, MAGI excess), effective_rate the tax
    # over NII. Additive + defaulted: stored fixtures and older clients parse unchanged.
    niit: CapitalGainsTaxOut | None = None
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


class WithholdingPartnerLegOut(BaseModel):
    """The partner's SIMULATED salary leg — the primary's `salary` shape plus its OWN check
    grid, because the cadence is their profile's and need not match the primary's."""

    ytd: Decimal
    projected: Decimal
    checks_elapsed: int
    checks_total: int


class SafeHarborOut(BaseModel):
    """The statutory harbor is the LESSER of two legs (2026-08-31 spec C4); either can
    be missing — a first year has no prior return, a refused engine year has no current
    liability — and the surviving leg stands alone. `met` is judged on
    `effective_threshold`, always."""

    # The PRIOR-YEAR leg: 100/110% of last year's total tax. All six fields are None
    # together — a prior year that is missing, not computable under its status, or
    # computed to <= 0 has no leg (each of the last two states warns).
    prior_year: int | None = None
    prior_total_tax: Decimal | None = None
    # The AGI the statutory gate is tested against, and the multiplier it selected. Both
    # are rendered: a threshold that is not 1.10x the number beside it would otherwise
    # read as a bug.
    prior_agi: Decimal | None = None
    multiplier: Decimal | None = None  # 1.10 above the gate, 1.00 at or below it
    threshold: Decimal | None = None  # prior_total_tax x multiplier
    # The status the REFERENCE return was filed under — different from this year's on a
    # wedding year, a labelling matter the card names rather than leaving to wonder.
    prior_filing_status: str | None = None
    # The CURRENT-YEAR leg: 90% of this year's projected liability. None exactly when
    # the engine refused the year (liability_total is null on the card).
    current_year_threshold: Decimal | None = None
    effective_threshold: Decimal  # min of the legs that exist
    met: bool  # projected total withholding >= effective_threshold


class WithholdingOut(BaseModel):
    year: int
    filing_status: str = SINGLE
    # See TaxSummaryOut: non-empty only for a married year whose tables are not entered.
    brackets_missing_for_status: list[str] = Field(default_factory=list)
    # Null exactly when the engine refused: the withholding legs below are still real
    # (they come from profiles, grants and prices), but there is nothing honest to compare
    # them against.
    liability_total: Decimal | None
    salary: WithholdingLegOut
    vest: WithholdingVestOut
    total: WithholdingLegOut
    balance_projected: Decimal | None  # liability - projected withholding; positive = will owe
    checks_elapsed: int
    checks_total: int
    # --- the partner leg. NULL is a different silence from 0 in all three: `partner_wages`
    # is null when this year's return covers one person (single, MFS, or a household with no
    # partner row) and 0.00 when a partner is ON the return with no W-2 entered; the two
    # withheld fields are null when no tracker row is stored at all — the state that raises
    # the "not entered" warning — and 0.00 only when the user really entered a zero.
    partner_wages: Decimal | None = None
    partner_withheld_fed: Decimal | None = None
    partner_withheld_state: Decimal | None = None
    # "simulated" exactly when the partner has a paycheck profile, "entered" otherwise (the
    # 2026-08-26 fallback, byte-identical). ONE source at a time: in "simulated" the two
    # withheld fields above are still reported — they are stored facts — but they are money
    # in no total, and a warning names the ignoring.
    partner_source: str = PARTNER_ENTERED
    # NULL in "entered" mode. A leg that was never simulated has no figures at all, and
    # 0.00 would read as "simulated, and it came to nothing".
    partner_salary: WithholdingPartnerLegOut | None = None
    # SIGNED: positive is the under-withholding trap (each employer withholds the 0.9%
    # surtax only above 200k of its own wages; a joint return owes it above the status
    # threshold on combined wages), negative is over-withholding, 0.00 is one earner or a
    # table with no surtax tier.
    additional_medicare_gap: Decimal = Decimal("0.00")
    safe_harbor: SafeHarborOut | None
    warnings: list[str]
