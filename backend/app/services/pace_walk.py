"""The payday walk every pace row is built from (2026-09-06 spec §2.6).

Pure module — no DB, no HTTP, no clock (the limit_check / espp_pace posture). The caller
hands over the person's whole profile timeline, the scenario profile that speaks for TODAY
ONWARD, `today` and the window; the walk hands back four contribution legs twice over: what
has gone in so far, and where the window lands if nothing changes.

Why a walk and not `rate x pay periods`: the old annualization answered "a year at this
rate", which reads as a lie in September — a 2,400-of-4,400 HSA row looked like a shortfall
when it was simply two thirds of a year. Walking the window prices each payday by the
profile in force on it, so a mid-year raise is visible and the two figures are honest about
which is history and which is a projection.

Every figure is a STATED ESTIMATE, never a ledger (spec §5): the app has no per-paycheck
history, so a past payday is priced from the profile in force on it. A payday ON OR BEFORE the
person's earliest profile's date credits NOTHING, on both sides of today (2026-09-23 spec §W1 —
the "Will I owe?" card's own rule, so the pace strip and the tax card count the same checks):
it used to borrow that earliest profile, which stretched a September job back to January.
`starts_on` names the start whenever it cut a payday out of the window; `backfilled_from` stays
on the result for older readers and is always None.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_CEILING, Decimal

from app.services.business_days import semi_monthly_paydays
from app.services.paycheck_calc import MONTHS_PER_YEAR, half_up2

ZERO = Decimal("0")
ONE = Decimal("1")
CENTS = Decimal("0.01")
# The only cadence `semi_monthly_paydays` describes; anything else takes the month basis.
SEMI_MONTHLY = 24
# The four legs a paycheck contributes, named for the rows that read them. 'elective' is
# traditional + Roth (what 402(g) counts), 'hsa_employee' is the EMPLOYEE's own deferral —
# the employer's deposit is a policy figure, not a payday one, and limit_check adds it.
LEGS = ("elective", "after_tax", "hsa_employee", "espp")


@dataclass(frozen=True)
class Walked:
    """One window walked: the same four legs before `today` and across the whole window.

    `basis` is 'paydays' (a semi-monthly calendar) or 'months' (the per-month approximation
    any other cadence takes) — a window that mixes the two reports the coarser word, so the
    label can never overstate the precision behind the figure.
    """

    so_far: dict[str, Decimal]
    projected: dict[str, Decimal]
    basis: str
    # Always None since 2026-09-23 spec §W1 (nothing borrows any more); kept so a reader that
    # still looks for it reads "nothing borrowed" rather than a KeyError.
    backfilled_from: date | None
    # Has the person's first CREDITED payday of the window gone by? The employer's HSA deposit
    # rides that check (spec §2.6) — the year's first payday for anyone employed in January,
    # their first real check for a job that starts later (§W1: nothing is paid before it).
    # `limit_check.paycheck_pace` is pure and has no clock, so the walk answers it here.
    first_payday_passed: bool
    # What the window still has AHEAD of it — the paychecks left from `today` onward and the
    # gross they pay, priced by the SCENARIO like every other future payday (2026-09-09 audit
    # item 5). These are the two divisors a "land exactly on the cap" target is built from: a
    # rate over the remaining GROSS, a per-check amount over the remaining CHECKS. The walk
    # answers them because it is the only thing here that knows which paydays are left.
    #
    # `remaining_checks` is EXACT and fractional on purpose: on the month basis a "check" is
    # `pay_periods_per_year / 12` of a month's credit, so four months of a biweekly profile
    # are 8.67 checks and the walk will credit 8.67 of them. Dividing by a rounded 9 would
    # under-fill the cap by a whole check's worth (4,400 landing at 99.44 %), so the DIVISOR
    # is this number and the rounding up happens once, at the wire, where the figure is a
    # count a sentence prints rather than a divisor.
    #
    # `remaining_gross` does round up to the cent, which is safe in the other direction: a
    # bigger divisor makes a rate SMALLER, so the projection lands under the cap, never over.
    #
    # The defaults are the empty tail — a window with nothing left — so a hand-built Walked
    # stays constructible; `walk` always states both.
    remaining_checks: Decimal = ZERO
    remaining_gross: Decimal = ZERO
    # The person's first profile's date when at least one payday inside the window fell on or
    # before it and so credited nothing (2026-09-23 spec §W1) — "Nothing counts before Sep 1".
    # None when the whole window is on a profile that was already in force.
    starts_on: date | None = None


def months(start: date, end: date):
    """Every (year, month) from `start`'s month through `end`'s, inclusive."""
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        yield year, month
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def in_force(profiles: list, day: date):
    """The latest profile effective on or before `day` — `_default_profile`'s rule without
    the DB. Before the earliest profile there is nothing to read, so the earliest one stands
    in — for a CADENCE probe or an employer policy only: the walk never credits a payday on or
    before the earliest profile (2026-09-23 spec §W1)."""
    eligible = [p for p in profiles if p.effective_date <= day]
    if eligible:
        return max(eligible, key=lambda p: p.effective_date)
    return min(profiles, key=lambda p: p.effective_date)


def _payday_gross(profile) -> Decimal:
    """One check's gross under `profile` — the figure every percentage leg is a share of, and
    the unit the window's remaining gross is summed from. Full precision: the walk quantizes
    once, at the end."""
    return profile.annual_salary / Decimal(profile.pay_periods_per_year)


def _per_payday(profile) -> dict[str, Decimal]:
    """One check under `profile`: the same expressions `paycheck_calc.breakdown` uses, so a
    walked year and the waterfall above it can never disagree about one payday."""
    gross = _payday_gross(profile)
    return {
        "elective": (profile.trad_401k_pct + profile.roth_401k_pct) * gross,
        "after_tax": profile.after_tax_401k_pct * gross,
        # Dollars, not a percentage — so this leg is the one the month basis has to
        # re-cadence rather than simply divide.
        "hsa_employee": profile.hsa_per_check,
        "espp": profile.espp_pct * gross,
    }


def _per_month(profile) -> dict[str, Decimal]:
    """One month under `profile` when there is no payday calendar: a twelfth of the annual
    rate, and the per-check HSA figure re-cadenced through the profile's own periods."""
    salary = profile.annual_salary
    return {
        "elective": (profile.trad_401k_pct + profile.roth_401k_pct) * salary / MONTHS_PER_YEAR,
        "after_tax": profile.after_tax_401k_pct * salary / MONTHS_PER_YEAR,
        "hsa_employee": profile.hsa_per_check
        * Decimal(profile.pay_periods_per_year)
        / MONTHS_PER_YEAR,
        "espp": profile.espp_pct * salary / MONTHS_PER_YEAR,
    }


def walk(profiles: list, scenario, today: date, start: date, end: date) -> Walked:
    """The window walked payday by payday: `so_far` is the paydays before `today`,
    `projected` is all of them.

    A semi-monthly month contributes its two real paydays (the 15th and the month end, each
    pulled BACK over weekends and holidays — payroll's own convention), priced by the profile
    in force on THAT day. Any other cadence has no payday calendar in this app, so the month
    contributes one twelfth of the annual rate instead and the walk says "months". Paydays on
    or after `today` are priced by the SCENARIO — the in-force profile for the GET, the
    sandbox's knobs for the preview — so the projection answers "if I change now, where does
    the year land?", never "what if I had changed in March". The same fence gives the window
    its TAIL: the paydays from `today` onward, counted and grossed up, which is what a "what
    rate lands me exactly on the cap" question divides by.
    """
    earliest = min(p.effective_date for p in profiles)
    so_far = dict.fromkeys(LEGS, ZERO)
    projected = dict.fromkeys(LEGS, ZERO)
    by_month = False
    # §W1: the first profile's date once a payday inside the window fell on or before it, and
    # the first payday that really paid — the one the employer's HSA deposit rides.
    starts: date | None = None
    first_credited: date | None = None
    # Summed in the same pass, on the far side of `today`: the paydays left and their gross.
    remaining_checks = ZERO
    remaining_gross = ZERO

    def priced_by(day: date):
        """Who prices `day` — PURE, so asking the question never records an answer."""
        return scenario if day >= today else in_force(profiles, day)

    def credit(day: date, legs: dict[str, Decimal], gross: Decimal, checks: Decimal) -> None:
        nonlocal remaining_checks, remaining_gross, starts, first_credited
        if day <= earliest:
            # Before the job (2026-09-23 spec §W1): nothing was paid, so nothing is credited or
            # counted — on EITHER side of today, the scenario's included, because a knob moved
            # now cannot pay a check from before the first profile. The window says so instead.
            starts = earliest
            return
        if first_credited is None:
            first_credited = day
        for name, value in legs.items():
            projected[name] += value
            if day < today:
                so_far[name] += value
        # The same fence `so_far` is drawn at, from the other side: a payday is either behind
        # today or still to come, so the two halves can never double-count or lose one.
        if day >= today:
            remaining_gross += gross
            remaining_checks += checks

    for year, month in months(start, end):
        mid = date(year, month, 15)
        # Clamped so a window that opens after the 15th still probes a date inside it. This
        # read decides the CADENCE only — it prices nothing.
        monthly = priced_by(min(max(mid, start), end))
        if monthly.pay_periods_per_year == SEMI_MONTHLY:
            for day in semi_monthly_paydays(year, month):
                if start <= day <= end:
                    payer = priced_by(day)
                    credit(day, _per_payday(payer), _payday_gross(payer), ONE)
        else:
            by_month = True
            if start <= mid <= end:
                # A month is one credit but `pay_periods_per_year / 12` CHECKS: the HSA leg
                # is per-check dollars, so a divisor counted in months would under-fill by
                # exactly the cadence.
                credit(
                    mid,
                    _per_month(monthly),
                    monthly.annual_salary / MONTHS_PER_YEAR,
                    Decimal(monthly.pay_periods_per_year) / MONTHS_PER_YEAR,
                )
    return Walked(
        # Quantized ONCE, here, at the end of the walk: every consumer adds these figures to
        # employer legs that are themselves cents, so a second rounding pass downstream is a
        # no-op and the numbers on screen are the numbers that were summed.
        so_far={name: half_up2(value) for name, value in so_far.items()},
        projected={name: half_up2(value) for name, value in projected.items()},
        basis="months" if by_month else "paydays",
        backfilled_from=None,
        first_payday_passed=first_credited is not None and first_credited < today,
        # The count stays exact (it is a divisor); the gross rounds UP to the cent, which can
        # only make a rate smaller — a projection that lands a hair under the cap is the one
        # that reads 100 %.
        remaining_checks=remaining_checks,
        remaining_gross=remaining_gross.quantize(CENTS, rounding=ROUND_CEILING),
        starts_on=starts,
    )
