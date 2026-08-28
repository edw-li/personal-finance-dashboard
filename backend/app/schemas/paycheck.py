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
    notes: str | None


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
