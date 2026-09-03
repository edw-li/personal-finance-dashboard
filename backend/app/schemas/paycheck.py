"""Wire shapes for the paycheck module (spec §5).

Money crosses the wire as pydantic Decimals — JSON strings — at the column scale the
router quantized to: salary Numeric(12,2), dental/HSA Numeric(8,2), the five pcts
Numeric(10,9). The waterfall lines are computed 2dp Decimals (strings too).

The pct fields wear `Pct9`, IMPORTED from the espp schemas rather than re-declared: it is
one shared serializer for one shared column type (Numeric(10,9)), and a second copy could
drift. See its definition for why a plain-format serializer is mandatory — a zero comes
back from the driver as Decimal("0E-9"), which no JS decimal parser reads as a number.
"""

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.espp import Pct9

# The people PK is an int4: an out-of-range id would reach asyncpg as a bare DataError
# (a 500 on a plain create), so it is fenced at the boundary — api/paycheck.py's IdPath
# precedent, applied to the one person field that arrives in a BODY rather than a query.
INT32_MAX = 2**31 - 1


class ProfileIn(BaseModel):
    # Absent = the primary person: the wire's back-compat rule, since every pre-P3 caller
    # passes nothing and means the one earner the app modeled.
    person_id: int | None = Field(default=None, ge=1, le=INT32_MAX)
    effective_date: date
    annual_salary: Decimal
    # The sheet's hardcoded 24 (semi-monthly), as a default rather than a constant.
    pay_periods_per_year: int = 24
    trad_401k_pct: Decimal = Decimal("0")
    roth_401k_pct: Decimal = Decimal("0")
    after_tax_401k_pct: Decimal = Decimal("0")
    espp_pct: Decimal = Decimal("0")
    withholding_pct: Decimal = Decimal("0")
    dental_vision_per_check: Decimal = Decimal("0")
    hsa_per_check: Decimal = Decimal("0")
    # 'none' | 'self' | 'family'; the default matches the column's server_default, so an
    # old client that never sends it stores exactly what the migration backfilled.
    hsa_coverage: str = "self"
    notes: str | None = None


class ProfileUpdate(BaseModel):
    # Every stored column here is NOT NULL except `notes`, so an explicit null is a
    # no-op on all of them (the house PATCH convention) — only `notes` really clears.
    # `person_id` is deliberately ABSENT: a profile does not change owner, and pydantic
    # drops the unknown key rather than 422ing on a client that sends one back.
    effective_date: date | None = None
    annual_salary: Decimal | None = None
    pay_periods_per_year: int | None = None
    trad_401k_pct: Decimal | None = None
    roth_401k_pct: Decimal | None = None
    after_tax_401k_pct: Decimal | None = None
    espp_pct: Decimal | None = None
    withholding_pct: Decimal | None = None
    dental_vision_per_check: Decimal | None = None
    hsa_per_check: Decimal | None = None
    hsa_coverage: str | None = None
    notes: str | None = None


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    # The owner. Every profile has one (NOT NULL); the list stays a single ordered list
    # and the UI groups it by this.
    person_id: int
    effective_date: date
    annual_salary: Decimal
    pay_periods_per_year: int
    trad_401k_pct: Pct9
    roth_401k_pct: Pct9
    after_tax_401k_pct: Pct9
    espp_pct: Pct9
    withholding_pct: Pct9
    dental_vision_per_check: Decimal
    hsa_per_check: Decimal
    hsa_coverage: str
    notes: str | None


class PaceItemOut(BaseModel):
    """One contribution line annualized from the profile in force, against the cap the
    user entered for the current year (2026-08-27 spec §4.5).

    `limit` and `ratio` are null together and mean "nothing entered for this key this
    year" — the page renders a call-to-action, never a fabricated cap. `ratio` is a 4 dp
    fraction and `tone` was judged on exactly that value, so the badge and the percentage
    can never disagree.
    """

    model_config = ConfigDict(from_attributes=True)

    key: str
    label: str
    annualized: Decimal
    limit: Decimal | None
    ratio: Decimal | None
    tone: str


class BreakdownOut(BaseModel):
    """One check, in the sheet's waterfall order, plus the monthly roll-up.

    Every line is a display value (2dp HALF_UP) of a full-precision chain, so the lines
    may not reconcile to `net_pay` by a cent — `net_pay` is the authoritative one.
    """

    profile: ProfileOut
    gross: Decimal
    trad_401k: Decimal
    dental_vision: Decimal
    hsa: Decimal
    taxable: Decimal
    withholding: Decimal
    post_tax: Decimal
    roth_401k: Decimal
    after_tax_401k: Decimal
    espp: Decimal
    net_pay: Decimal
    monthly_net: Decimal
    warnings: list[str]
    # The contribution-pace rows for THIS profile against the current year's entered
    # limits. Empty only if the profile somehow yields no rows at all — the two 401(k)
    # rows are unconditional.
    pace: list[PaceItemOut]


class ProfileOverrides(BaseModel):
    """The knobs of a `POST /preview` scenario (2026-09-03 planning-sandboxes spec §13).

    Every field optional; unknown keys are REFUSED (`extra='forbid'`), so a mistyped knob
    422s instead of silently modelling the base profile. Values are validated in the router
    by the WRITERS' own helpers, word for word — a scenario obeys exactly the rules a stored
    row does, and its 422s read exactly like theirs.
    """

    model_config = ConfigDict(extra="forbid")

    annual_salary: Decimal | None = None
    pay_periods_per_year: int | None = None
    trad_401k_pct: Decimal | None = None
    roth_401k_pct: Decimal | None = None
    after_tax_401k_pct: Decimal | None = None
    espp_pct: Decimal | None = None
    withholding_pct: Decimal | None = None
    dental_vision_per_check: Decimal | None = None
    hsa_per_check: Decimal | None = None
    hsa_coverage: str | None = None


class PreviewIn(BaseModel):
    # The base: the same two selectors GET /breakdown takes — an explicit row wins, absent
    # means the primary's profile in force (the wire's back-compat rule).
    profile_id: int | None = Field(default=None, ge=1, le=INT32_MAX)
    person_id: int | None = Field(default=None, ge=1, le=INT32_MAX)
    overrides: ProfileOverrides = Field(default_factory=ProfileOverrides)


class PreviewLines(BaseModel):
    """The eleven waterfall lines plus `savings` (trad + Roth + after-tax + ESPP + HSA — the
    figure the projection consumes), each a 2dp display value of the full-precision chain.
    In a delta block every field is the difference of two such figures, so the Δ column can
    never contradict its neighbours."""

    gross: Decimal
    trad_401k: Decimal
    dental_vision: Decimal
    hsa: Decimal
    taxable: Decimal
    withholding: Decimal
    post_tax: Decimal
    roth_401k: Decimal
    after_tax_401k: Decimal
    espp: Decimal
    net_pay: Decimal
    savings: Decimal


class PreviewBlock(BaseModel):
    baseline: PreviewLines
    scenario: PreviewLines
    delta: PreviewLines


class PreviewPace(BaseModel):
    baseline: list[PaceItemOut]
    scenario: list[PaceItemOut]


class ChangedField(BaseModel):
    """One profile field the scenario moved — `before`/`after` as plain text because the
    fields are mixed (money, a 9dp fraction, an integer, a coverage tier)."""

    key: str
    label: str
    before: str
    after: str


class PreviewOut(BaseModel):
    profile: ProfileOut
    per_check: PreviewBlock
    # Scaled server-side on the full-precision chain by the profile's OWN cadence (each side
    # its own — a scenario may change pay_periods_per_year), then quantized.
    monthly: PreviewBlock
    annual: PreviewBlock
    pace: PreviewPace
    changed: list[ChangedField]
    # Scenario-side advisories only (CONTRIBUTIONS_WARNING / NEGATIVE_NET_WARNING).
    warnings: list[str]
