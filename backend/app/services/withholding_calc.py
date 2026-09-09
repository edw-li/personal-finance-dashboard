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
CA_SUPPLEMENTAL = Decimal("0.1023")  # CA stock-option/ESPP supplemental rate
# The OTHER half of the tier (2026-09-09 audit item 4d): 37% on the portion of the year's
# cumulative supplemental wages above $1,000,000 (Reg. 31.3402(g)-1). Statute, not data —
# it is not a bracket table anyone enters, and withholding is not the return's tax.
FED_SUPPLEMENTAL_HIGH = Decimal("0.37")
SUPPLEMENTAL_TIER_THRESHOLD = Decimal("1000000")
# California withholds BONUSES at 6.6% and stock at 10.23% (DE 44). Two rates, because the
# bonus leg is not a vest — using the stock rate on a bonus overstates the state leg by
# more than a third of it.
CA_SUPPLEMENTAL_BONUS = Decimal("0.066")
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

# The two spellings of `bonus_source`, the bonus leg's own version of the same idea: a
# figure the user entered from a paystub always beats the 22 / 6.6 / marginal-FICA model.
BONUS_ESTIMATED = "estimated"
BONUS_ENTERED = "entered"
SUPPLEMENTAL_TIER_WARNING = (
    "supplemental wages (vests + bonuses) reach {total} this year — the federal supplemental "
    "rate on the {excess} above $1,000,000 is 37%, not 22%"
)
# Payroll is a REMAINDER (see `_jurisdiction_legs`), so a negative one is not a number to
# clamp away in silence: it means the all-in rate is smaller than the two entered rates add
# up to, i.e. at least one of the three is wrong.
NEGATIVE_PAYROLL_WARNING = (
    "federal + state withholding exceeds the all-in withholding % — the payroll (FICA) "
    "leg is negative; check the three rates on your paycheck profile"
)

# (vest date, shares, price) — past vests carry the vest-date FMV, future ones a quote.
VestTuple = tuple[date, int, Decimal]


@dataclass
class JurisdictionLegs:
    """The combined withholding total, split three ways (2026-09-09 audit item 3).

    Federal and state are BUILT: each check's taxable base times the rate a paystub gave,
    plus the supplemental rates on vests and bonuses. Payroll is the REMAINDER — what the
    all-in `withholding_pct` carried that the two entered rates did not claim — so the
    three always add back to the combined total to the cent, and no rounding lands
    somewhere the card cannot show. That also makes payroll the only leg that can go
    negative, which warns rather than clamping.
    """

    federal_ytd: Decimal
    federal_projected: Decimal
    state_ytd: Decimal
    state_projected: Decimal
    payroll_ytd: Decimal
    payroll_projected: Decimal


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
    # --- the BONUS leg (2026-09-09 audit item 4c). `w2_bonuses` raises the liability, so
    # leaving it out of the withholding was a one-sided estimate. Treated as money already
    # RECEIVED — the input is an actual, not a forecast — so the same income sits in both
    # columns and only its marginal FICA differs between them.
    bonus_income: Decimal = ZERO
    bonus_withheld_ytd: Decimal = ZERO
    bonus_withheld_projected: Decimal = ZERO
    bonus_source: str = BONUS_ESTIMATED  # 'estimated' | 'entered'
    # --- the per-jurisdiction split (2026-09-09 audit item 3). None means the split is
    # UNAVAILABLE: at least one profile pricing a check on the grid carries no federal or
    # no state rate, and half a year's federal figure is not a federal figure.
    jurisdictions: JurisdictionLegs | None = None
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


def tiered_federal_supplemental(prior: Decimal, amount: Decimal) -> Decimal:
    """`amount` of supplemental wages withheld at 22% / 37%, stacked on `prior` of them.

    The tier is on the YEAR's cumulative supplemental wages, so the total is the same
    whatever order the vests and bonuses are walked in — order decides only which LEG
    reports the 37% slice, and this module walks bonuses (already received) first, then
    vests by date. Splitting a slice is exact for the same reason: t(p, a + b) equals
    t(p, a) + t(p + a, b).
    """
    room = max(SUPPLEMENTAL_TIER_THRESHOLD - prior, ZERO)
    under = min(amount, room)
    return under * FED_SUPPLEMENTAL + (amount - under) * FED_SUPPLEMENTAL_HIGH


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
    # The same walk, split by jurisdiction: each check's TAXABLE base times the two rates
    # the profile in force that day carries (2026-09-09 audit item 3).
    fed_ytd: Decimal = ZERO
    fed_projected: Decimal = ZERO
    state_ytd: Decimal = ZERO
    state_projected: Decimal = ZERO
    # False as soon as ONE check is priced by a profile missing either rate. True on an
    # EMPTY leg — a person with no profile withholds nothing and has nothing to veto.
    split: bool = True
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
    fed_ytd = fed_projected = state_ytd = state_projected = ZERO
    split = True
    elapsed = 0
    for check_day in grid:
        in_force = [p for p in ordered if p.effective_date <= check_day] or [ordered[0]]
        profile = in_force[-1]
        lines = breakdown(profile)
        withheld_projected += lines["withholding"]
        gross_projected += lines["gross"]
        # getattr with a default, not an attribute read: this module takes "anything with
        # the profile's columns" (the sandbox's ScenarioProfile, a test stub), and a
        # missing pair is exactly the unavailable-split state rather than an AttributeError.
        fed_rate = getattr(profile, "fed_withholding_pct", None)
        state_rate = getattr(profile, "state_withholding_pct", None)
        if fed_rate is None or state_rate is None:
            split = False
        else:
            # The SAME base the all-in rate uses (gross minus pre-tax deductions), because
            # that is the base a paystub's "federal withheld / taxable wages" divides by.
            fed_projected += fed_rate * lines["taxable"]
            state_projected += state_rate * lines["taxable"]
        if check_day <= today:
            elapsed += 1
            withheld_ytd += lines["withholding"]
            gross_ytd += lines["gross"]
            if fed_rate is not None and state_rate is not None:
                fed_ytd += fed_rate * lines["taxable"]
                state_ytd += state_rate * lines["taxable"]
    return _SalaryLeg(
        checks_elapsed=elapsed,
        checks_total=len(grid),
        withheld_ytd=withheld_ytd,
        withheld_projected=withheld_projected,
        gross_ytd=gross_ytd,
        gross_projected=gross_projected,
        fed_ytd=fed_ytd,
        fed_projected=fed_projected,
        state_ytd=state_ytd,
        state_projected=state_projected,
        split=split,
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
    # The BONUS leg (2026-09-09 audit item 4c): the year's `w2_bonuses` for this return,
    # and the optional `w2_bonus_withholding` actual that replaces the model when entered.
    # None is "no row stored" and Decimal("0") is "entered as zero" — the partner keys'
    # own distinction, for the same reason.
    bonuses: Decimal = ZERO,
    bonus_withholding: Decimal | None = None,
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

    # --- the bonus leg (2026-09-09 audit item 4c), computed FIRST because everything below
    # stacks on it: bonuses are money already received, so they take the year's first slice
    # of both the supplemental tier and the FICA wage base, and the vests sit on top.
    bonus_fed = tiered_federal_supplemental(ZERO, bonuses)
    bonus_state = bonuses * CA_SUPPLEMENTAL_BONUS
    bonus_fica_ytd = fica(leg.gross_ytd + bonuses) - fica(leg.gross_ytd)
    bonus_fica_projected = fica(leg.gross_projected + bonuses) - fica(leg.gross_projected)

    # Vest supplemental: the state rate is flat, the federal one is tiered ABOVE whatever
    # the bonuses already used. Below $1M this is exactly the old income x 0.3223.
    vest_fed_ytd = tiered_federal_supplemental(bonuses, income_ytd)
    vest_fed_projected = tiered_federal_supplemental(bonuses, income_projected)
    vest_state_ytd = income_ytd * CA_SUPPLEMENTAL
    vest_state_projected = income_projected * CA_SUPPLEMENTAL
    if bonuses + income_projected > SUPPLEMENTAL_TIER_THRESHOLD:
        total = bonuses + income_projected
        warnings.append(
            SUPPLEMENTAL_TIER_WARNING.format(
                total=f"${total:,.2f}",
                excess=f"${total - SUPPLEMENTAL_TIER_THRESHOLD:,.2f}",
            )
        )

    # Vest FICA stacks on the PRIMARY's gross plus the bonuses, and on nothing else: the
    # vests are the primary's grants, and the partner's checks are a separate employer's
    # wage base whose own FICA their all-in withholding_pct already carries. Stacking the
    # bonus UNDER the vests keeps the two legs telescoping to one walk over the year's
    # wages, so neither can claim the same slice of the SS wage base twice.
    fica_ytd = fica(leg.gross_ytd + bonuses + income_ytd) - fica(leg.gross_ytd + bonuses)
    fica_projected = fica(leg.gross_projected + bonuses + income_projected) - fica(
        leg.gross_projected + bonuses
    )

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

    # The bonus leg's three parts, and the ENTERED actual that replaces them. The override
    # is a single figure from a paystub, so it is spread across the three in the very
    # proportions the model would have used — the split has to add back to what was
    # entered, and no other rule keeps a total the user typed intact. With no bonus income
    # behind it there is nothing to scale, so it falls back to the statutory 22 : 6.6.
    computed_ytd = bonus_fed + bonus_state + bonus_fica_ytd
    computed_projected = bonus_fed + bonus_state + bonus_fica_projected
    bonus_source = BONUS_ESTIMATED if bonus_withholding is None else BONUS_ENTERED
    if bonus_withholding is None:
        bonus_ytd, bonus_projected = computed_ytd, computed_projected
        bonus_fed_ytd = bonus_fed_projected = bonus_fed
        bonus_state_ytd = bonus_state_projected = bonus_state
    else:
        bonus_ytd = bonus_projected = bonus_withholding
        fed_share = (
            bonus_fed / computed_ytd
            if computed_ytd > 0
            else FED_SUPPLEMENTAL / (FED_SUPPLEMENTAL + CA_SUPPLEMENTAL_BONUS)
        )
        state_share = (
            bonus_state / computed_ytd
            if computed_ytd > 0
            else CA_SUPPLEMENTAL_BONUS / (FED_SUPPLEMENTAL + CA_SUPPLEMENTAL_BONUS)
        )
        bonus_fed_ytd = bonus_fed_projected = bonus_withholding * fed_share
        bonus_state_ytd = bonus_state_projected = bonus_withholding * state_share

    # Everything below is at CENTS, and deliberately: the combined total is the sum of the
    # very fields this dataclass publishes, so the router's own sum of them and the split's
    # remainder can never drift by a rounding step.
    salary_ytd = _cents(leg.withheld_ytd)
    salary_projected = _cents(leg.withheld_projected)
    supplemental_ytd = _cents(vest_fed_ytd + vest_state_ytd)
    supplemental_projected = _cents(vest_fed_projected + vest_state_projected)
    vest_fica_ytd = _cents(fica_ytd)
    vest_fica_projected = _cents(fica_projected)
    partner_total = _cents(partner_withheld_total)
    partner_ytd = _cents(partner_leg.withheld_ytd if simulated else ZERO)
    partner_projected = _cents(partner_leg.withheld_projected if simulated else ZERO)
    bonus_withheld_ytd = _cents(bonus_ytd)
    bonus_withheld_projected = _cents(bonus_projected)
    combined_ytd = (
        salary_ytd
        + supplemental_ytd
        + vest_fica_ytd
        + bonus_withheld_ytd
        + partner_total
        + partner_ytd
    )
    combined_projected = (
        salary_projected
        + supplemental_projected
        + vest_fica_projected
        + bonus_withheld_projected
        + partner_total
        + partner_projected
    )

    jurisdictions = None
    if leg.split and partner_leg.split:
        # A SIMULATED partner splits by their own profile's rates; an ENTERED one already
        # gives the two figures by name. The modes are mutually exclusive upstream, so both
        # are added rather than branched on (the combined total's own rule).
        partner_fed = partner_leg.fed_ytd if simulated else (partner_withheld_fed or ZERO)
        partner_fed_projected = (
            partner_leg.fed_projected if simulated else (partner_withheld_fed or ZERO)
        )
        partner_state = partner_leg.state_ytd if simulated else (partner_withheld_state or ZERO)
        partner_state_projected = (
            partner_leg.state_projected if simulated else (partner_withheld_state or ZERO)
        )
        federal_ytd = _cents(leg.fed_ytd + vest_fed_ytd + bonus_fed_ytd + partner_fed)
        federal_projected = _cents(
            leg.fed_projected + vest_fed_projected + bonus_fed_projected + partner_fed_projected
        )
        state_ytd = _cents(leg.state_ytd + vest_state_ytd + bonus_state_ytd + partner_state)
        state_projected = _cents(
            leg.state_projected
            + vest_state_projected
            + bonus_state_projected
            + partner_state_projected
        )
        payroll_ytd = combined_ytd - federal_ytd - state_ytd
        payroll_projected = combined_projected - federal_projected - state_projected
        if payroll_ytd < 0 or payroll_projected < 0:
            warnings.append(NEGATIVE_PAYROLL_WARNING)
        jurisdictions = JurisdictionLegs(
            federal_ytd=federal_ytd,
            federal_projected=federal_projected,
            state_ytd=state_ytd,
            state_projected=state_projected,
            payroll_ytd=payroll_ytd,
            payroll_projected=payroll_projected,
        )

    return WithholdingEstimate(
        checks_elapsed=leg.checks_elapsed,
        checks_total=leg.checks_total,
        salary_ytd=salary_ytd,
        salary_projected=salary_projected,
        salary_gross_ytd=_cents(leg.gross_ytd),
        salary_gross_projected=_cents(leg.gross_projected),
        vest_income_ytd=_cents(income_ytd),
        vest_income_projected=_cents(income_projected),
        vest_supplemental_ytd=supplemental_ytd,
        vest_supplemental_projected=supplemental_projected,
        vest_fica_ytd=vest_fica_ytd,
        vest_fica_projected=vest_fica_projected,
        partner_withheld_total=partner_total,
        additional_medicare_gap=_cents(gap),
        partner_source=PARTNER_SIMULATED if simulated else PARTNER_ENTERED,
        partner_salary_ytd=partner_ytd,
        partner_salary_projected=partner_projected,
        partner_checks_elapsed=partner_leg.checks_elapsed if simulated else 0,
        partner_checks_total=partner_leg.checks_total if simulated else 0,
        bonus_income=_cents(bonuses),
        bonus_withheld_ytd=bonus_withheld_ytd,
        bonus_withheld_projected=bonus_withheld_projected,
        bonus_source=bonus_source,
        jurisdictions=jurisdictions,
        warnings=warnings,
    )
