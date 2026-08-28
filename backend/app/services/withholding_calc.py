"""All-in withholding estimate for the current year (2026-08-21 spec §5). Pure module — the
router feeds profiles, vest tuples, bracket tables and `today`; nothing here reads a clock or
the DB. The salary leg reuses paycheck_calc.breakdown so the % applies to the TAXABLE base
(gross minus pre-tax deductions), exactly like the real check; vest legs add the supplemental
rates plus MARGINAL FICA computed with the tax engine's own bracket walk, so the SS wage-base
cap (a terminal 0-rate bracket) and additional Medicare interact with salary+vest totals for
free. Salary-side FICA is NOT added anywhere: the user's all-in withholding_pct already
carries it (user decision, 2026-08-21). The partner leg has TWO modes (2026-08-27 spec
§4.2): with `partner_profiles` it is simulated by the very same `_salary_leg` walk the
primary's uses (no vest or ESPP legs — lean scope); without one it falls back to the
2026-08-26 behavior, where their W-2 wages and their two withholding figures are read
straight from the year's per-person tax inputs and the module's only arithmetic on them is
the sum and the additional-Medicare gap below. The two never mix.

The marginal FICA split is an APPROXIMATION, and a deliberate one: vest income is stacked ON
TOP of the salary gross as of `today` rather than interleaved with the checks by date, so when
salary alone already crosses the SS wage base the vest leg is handed a zero SS marginal (a
date-interleaved split would have given some of that cap room to the earlier vest instead).
That is the CONSERVATIVE (owe-more) direction: the vest leg is the only FICA this module
reports, so shifting cap room onto the salary side — where the all-in `withholding_pct` is
presumed to cover it — understates the estimate and overstates what the card says you will
owe. The YEAR TOTAL is order-invariant either way: FICA(salary + vests) telescopes regardless
of which leg claims which slice.

Preconditions (enforced at the API boundary, not here): every profile's
`pay_periods_per_year` >= 1 — paycheck_calc's own divide-by-zero guard; note the failure mode
differs here, since `check_dates(year, 0)` does not divide by zero but returns [], and
`estimate` then trips on `grid[0]` — vest tuples carry nonnegative shares and prices (nothing
below clamps a negative into the FICA walks), and the router has already split vests into
past/future against the SAME `today` it passes in (nothing here re-reads a vest tuple's
date)."""

from calendar import isleap
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.services.paycheck_calc import breakdown
from app.services.tax_service import Bracket, walk

ZERO = Decimal("0")
CENT = Decimal("0.01")
FED_SUPPLEMENTAL = Decimal("0.22")  # federal supplemental rate (under $1M cumulative)
CA_SUPPLEMENTAL = Decimal("0.1023")  # CA stock/bonus supplemental rate
# Statute, not data: EVERY employer withholds the additional-Medicare surtax only above
# $200,000 of ITS OWN wages, whatever the employee's filing status is (IRC 3102(f)(1)). The
# THRESHOLD the return owes it at is data — it lives in the medicare bracket table, which
# the loader selects by filing status — which is precisely why the two can disagree.
EMPLOYER_ADDITIONAL_MEDICARE_FLOOR = Decimal("200000")
# "no usable", not "none stored": the router hands over only the profiles that survived its
# pay-periods fence, so an empty list can equally mean every stored row was hand-edited into
# something `breakdown` cannot divide by (Task 6 review).
NO_PROFILES_WARNING = "no usable paycheck profile — salary withholding estimated as 0"
EARLY_CHECKS_WARNING = "checks before the first profile's effective date use that profile"
PARTNER_WITHHOLDING_MISSING_WARNING = (
    "partner withholding not entered — their W-2 withholding counts as 0 until you enter it"
)
# The partner's own two sentences (2026-08-27 spec §4.2). Separate constants rather than a
# shared one with a name in it: these are wire strings the panel renders verbatim, and the
# primary's copy must not move when the partner's does.
PARTNER_EARLY_CHECKS_WARNING = (
    "partner checks before their first profile's effective date use that profile"
)
PARTNER_TRACKER_IGNORED_NOTE = (
    "partner withholding simulated from their paycheck profile — the entered "
    "w2_fed_withholding / w2_state_withholding rows are ignored"
)
# The two spellings of `partner_source`. A profile wins over the tracker keys ALWAYS — one
# source of truth at a time, never a blend of a simulation and a running snapshot.
PARTNER_ENTERED = "entered"
PARTNER_SIMULATED = "simulated"

# (vest date, shares, price) — past vests carry the vest-date FMV, future ones a quote.
VestTuple = tuple[date, int, Decimal]


@dataclass
class WithholdingEstimate:
    checks_elapsed: int
    checks_total: int
    salary_ytd: Decimal
    salary_projected: Decimal
    salary_gross_ytd: Decimal
    salary_gross_projected: Decimal
    vest_income_ytd: Decimal
    vest_income_projected: Decimal
    vest_supplemental_ytd: Decimal
    vest_supplemental_projected: Decimal
    vest_fica_ytd: Decimal
    vest_fica_projected: Decimal
    # --- the two-earner block (2026-08-26 spec §5.6). Both default to ZERO, which is exactly
    # what a single-earner call produces, so the existing card is unmoved.
    partner_withheld_total: Decimal = ZERO
    additional_medicare_gap: Decimal = ZERO
    # --- the SIMULATED partner leg (2026-08-27 spec §4.2). "entered" is the default, so a
    # single-earner call — and the whole P2 fallback — is unmoved. In "simulated" mode
    # `partner_withheld_total` is ZERO and these carry the money; in "entered" mode the
    # reverse. The two are never both non-zero, which is what lets the router add both.
    partner_source: str = PARTNER_ENTERED
    partner_salary_ytd: Decimal = ZERO
    partner_salary_projected: Decimal = ZERO
    partner_checks_elapsed: int = 0
    partner_checks_total: int = 0
    warnings: list[str] = field(default_factory=list)


def check_dates(year: int, periods: int) -> list[date]:
    """Check i (1..P) implied on day ceil(i x days_in_year / P) — deterministic, ~semi-monthly
    at P=24, always ending Dec 31. Integer ceil: -(-a // b)."""
    days = 366 if isleap(year) else 365
    jan1 = date(year, 1, 1)
    return [jan1 + timedelta(days=-(-i * days // periods) - 1) for i in range(1, periods + 1)]


def _cents(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP) + ZERO


def additional_medicare_tier(medicare: list[Bracket]) -> tuple[Decimal, Decimal] | None:
    """(surtax rate, filing-status threshold) of the medicare table's additional tier.

    The tier is DATA. The table models Form 8959's 0.9% as a second row whose rate is the
    1.45% base PLUS the surtax, so the surtax is the top row's rate minus the first row's and
    the threshold is the top row's inclusive floor — 250,000 on an MFJ table, 125,000 on MFS,
    200,000 on a single one. None when the table is absent, flat, or terminates in a 0-rate
    CAP row (the social-security wage-base shape, which is not a surtax); a None tier makes
    the gap below 0, which is what leaves every pre-marriage year untouched.
    """
    if len(medicare) < 2:
        return None
    ordered = sorted(medicare, key=lambda bracket: bracket[1])
    base_rate = ordered[0][0]
    top_rate, top_threshold = ordered[-1]
    if top_rate <= base_rate:
        return None
    return top_rate - base_rate, top_threshold


def _additional_medicare_gap(
    medicare: list[Bracket], primary_wages: Decimal, partner_wages: Decimal
) -> Decimal:
    """What the RETURN owes in additional Medicare, minus what the EMPLOYERS will withhold.

    The trap (audit §3.2): each employer applies the surtax only above 200,000 of its own
    wages, while a joint return owes it above the status threshold on COMBINED wages — so two
    salaries that each fall short of 200,000 withhold nothing against a joint liability that
    starts at 250,000. The same rate is used on both sides deliberately: the gap is then
    purely the THRESHOLD effect this figure exists to name, and a hand-edited surtax rate
    moves both sides together instead of manufacturing a difference.

    For ONE earner the two sides are the same expression, so the result is exactly 0 with no
    branch — that is what keeps the single-filer path byte-identical. SIGNED: a negative gap
    is over-withholding (one high earner beside a low-earning spouse), which is honest and
    stays in the payload; the card decides what to shout about.
    """
    tier = additional_medicare_tier(medicare)
    if tier is None:
        return ZERO
    rate, threshold = tier
    combined = primary_wages + partner_wages
    owed = max(combined - threshold, ZERO) * rate
    withheld = sum(
        (
            max(wages - EMPLOYER_ADDITIONAL_MEDICARE_FLOOR, ZERO) * rate
            for wages in (primary_wages, partner_wages)
        ),
        ZERO,
    )
    return owed - withheld


@dataclass
class _SalaryLeg:
    """One person's salary withholding over the year's check grid — the arithmetic only.

    The WARNINGS are the caller's: "no usable profile" and "checks before the first one"
    read differently depending on whose leg they describe, and this helper deliberately
    does not know whose it is computing.
    """

    checks_elapsed: int
    checks_total: int
    withheld_ytd: Decimal
    withheld_projected: Decimal
    gross_ytd: Decimal
    gross_projected: Decimal
    # The grid's FIRST check predates the earliest profile, so those checks are priced with
    # a profile that was not yet in force.
    early_checks: bool = False


def _salary_leg(year: int, today: date, profiles: list) -> _SalaryLeg:
    """The check-grid walk, per person: cadence from the profile in force TODAY, then one
    `breakdown` per check against the profile in force on THAT day.

    Preconditions are the module's (see the header): every profile's
    `pay_periods_per_year` >= 1, fenced at the API boundary. An empty list is not an
    error here — it returns a zeroed leg, which is exactly what a partner without a
    profile contributes and what the no-profiles primary path has always computed.
    """
    ordered = sorted(profiles, key=lambda p: p.effective_date)
    if not ordered:
        return _SalaryLeg(0, 0, ZERO, ZERO, ZERO, ZERO)
    current = [p for p in ordered if p.effective_date <= today] or [ordered[0]]
    grid = check_dates(year, current[-1].pay_periods_per_year)
    withheld_ytd = withheld_projected = gross_ytd = gross_projected = ZERO
    elapsed = 0
    for check_day in grid:
        in_force = [p for p in ordered if p.effective_date <= check_day] or [ordered[0]]
        lines = breakdown(in_force[-1])
        withheld_projected += lines["withholding"]
        gross_projected += lines["gross"]
        if check_day <= today:
            elapsed += 1
            withheld_ytd += lines["withholding"]
            gross_ytd += lines["gross"]
    return _SalaryLeg(
        checks_elapsed=elapsed,
        checks_total=len(grid),
        withheld_ytd=withheld_ytd,
        withheld_projected=withheld_projected,
        gross_ytd=gross_ytd,
        gross_projected=gross_projected,
        early_checks=ordered[0].effective_date > grid[0],
    )


def estimate(
    *,
    year: int,
    today: date,
    profiles: list,  # the PRIMARY's paycheck_profiles rows, any order
    past_vests: list[VestTuple],
    future_vests: list[VestTuple],
    medicare: list[Bracket],
    social_security: list[Bracket],
    disability: list[Bracket],
    # The two-earner block (2026-08-26 spec §5.6). Wages are the year's stored W-2 figures
    # PER PERSON — the same numbers the liability is computed on — not the paycheck
    # simulation, because the additional-Medicare split is about what each EMPLOYER saw.
    primary_wages: Decimal = ZERO,
    partner_wages: Decimal = ZERO,
    # The ENTERED fallback (P2): None means "no row stored" (which warns); Decimal("0")
    # means "entered as zero". Ignored entirely once `partner_profiles` is non-empty.
    partner_withheld_fed: Decimal | None = None,
    partner_withheld_state: Decimal | None = None,
    # The partner's own profiles (2026-08-27 spec §4.2). NON-EMPTY is the whole switch:
    # their leg is then simulated exactly like the primary's salary leg — no vest or ESPP
    # legs, which is the lean scope, not an oversight.
    partner_profiles: list | None = None,
) -> WithholdingEstimate:
    warnings: list[str] = []
    leg = _salary_leg(year, today, profiles)
    if not profiles:
        warnings.append(NO_PROFILES_WARNING)
    elif leg.early_checks:
        warnings.append(EARLY_CHECKS_WARNING)

    def fica(wages: Decimal) -> Decimal:
        return walk(medicare, wages) + walk(social_security, wages) + walk(disability, wages)

    income_ytd = sum((Decimal(s) * price for _, s, price in past_vests), ZERO)
    income_projected = income_ytd + sum((Decimal(s) * price for _, s, price in future_vests), ZERO)
    supplemental = FED_SUPPLEMENTAL + CA_SUPPLEMENTAL
    # Vest FICA stacks on the PRIMARY's gross alone: the vests are the primary's grants,
    # and the partner's checks are a separate employer's wage base whose own FICA their
    # all-in withholding_pct already carries.
    fica_ytd = fica(leg.gross_ytd + income_ytd) - fica(leg.gross_ytd)
    fica_projected = fica(leg.gross_projected + income_projected) - fica(leg.gross_projected)

    simulated = bool(partner_profiles)
    partner_leg = _salary_leg(year, today, partner_profiles or [])
    if simulated:
        # SIMULATED: the tracker keys are not blended in, not halved, not preferred when
        # larger — they are ignored, and said to be.
        partner_withheld_total = ZERO
        if partner_leg.early_checks:
            warnings.append(PARTNER_EARLY_CHECKS_WARNING)
        if partner_withheld_fed is not None or partner_withheld_state is not None:
            warnings.append(PARTNER_TRACKER_IGNORED_NOTE)
    else:
        partner_withheld_total = (partner_withheld_fed or ZERO) + (partner_withheld_state or ZERO)
        if partner_wages > 0 and partner_withheld_fed is None and partner_withheld_state is None:
            # Only BOTH being unset is "not entered": an entered 0 is a real answer (a state
            # with no income tax, or a W-4 that zeroed it) and must not be nagged about.
            warnings.append(PARTNER_WITHHOLDING_MISSING_WARNING)
    gap = _additional_medicare_gap(medicare, primary_wages, partner_wages)
    return WithholdingEstimate(
        checks_elapsed=leg.checks_elapsed,
        checks_total=leg.checks_total,
        salary_ytd=_cents(leg.withheld_ytd),
        salary_projected=_cents(leg.withheld_projected),
        salary_gross_ytd=_cents(leg.gross_ytd),
        salary_gross_projected=_cents(leg.gross_projected),
        vest_income_ytd=_cents(income_ytd),
        vest_income_projected=_cents(income_projected),
        vest_supplemental_ytd=_cents(income_ytd * supplemental),
        vest_supplemental_projected=_cents(income_projected * supplemental),
        vest_fica_ytd=_cents(fica_ytd),
        vest_fica_projected=_cents(fica_projected),
        partner_withheld_total=_cents(partner_withheld_total),
        additional_medicare_gap=_cents(gap),
        partner_source=PARTNER_SIMULATED if simulated else PARTNER_ENTERED,
        partner_salary_ytd=_cents(partner_leg.withheld_ytd if simulated else ZERO),
        partner_salary_projected=_cents(partner_leg.withheld_projected if simulated else ZERO),
        partner_checks_elapsed=partner_leg.checks_elapsed if simulated else 0,
        partner_checks_total=partner_leg.checks_total if simulated else 0,
        warnings=warnings,
    )
