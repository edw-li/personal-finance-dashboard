"""All-in withholding estimate for the current year (2026-08-21 spec §5). Pure module — the
router feeds profiles, vest tuples, bracket tables and `today`; nothing here reads a clock or
the DB. The salary leg reuses paycheck_calc.breakdown so the % applies to the TAXABLE base
(gross minus pre-tax deductions), exactly like the real check; vest legs add the supplemental
rates plus MARGINAL FICA computed with the tax engine's own bracket walk, so the SS wage-base
cap (a terminal 0-rate bracket) and additional Medicare interact with salary+vest totals for
free. Salary-side FICA is NOT added anywhere: the user's all-in withholding_pct already
carries it (user decision, 2026-08-21).

Preconditions (enforced at the API boundary, not here): every profile's
`pay_periods_per_year` >= 1 — paycheck_calc's own divide-by-zero guard, which `check_dates`
inherits — and the router has already split vests into past/future against the SAME `today`
it passes in (nothing here re-reads a vest tuple's date)."""

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
NO_PROFILES_WARNING = "no paycheck profile stored — salary withholding estimated as 0"
EARLY_CHECKS_WARNING = "checks before the first profile's effective date use that profile"

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
    warnings: list[str] = field(default_factory=list)


def check_dates(year: int, periods: int) -> list[date]:
    """Check i (1..P) implied on day ceil(i x days_in_year / P) — deterministic, ~semi-monthly
    at P=24, always ending Dec 31. Integer ceil: -(-a // b)."""
    days = 366 if isleap(year) else 365
    jan1 = date(year, 1, 1)
    return [jan1 + timedelta(days=-(-i * days // periods) - 1) for i in range(1, periods + 1)]


def _cents(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP) + ZERO


def estimate(
    *,
    year: int,
    today: date,
    profiles: list,  # paycheck_profiles rows, any order
    past_vests: list[VestTuple],
    future_vests: list[VestTuple],
    medicare: list[Bracket],
    social_security: list[Bracket],
    disability: list[Bracket],
) -> WithholdingEstimate:
    warnings: list[str] = []
    ordered = sorted(profiles, key=lambda p: p.effective_date)
    if not ordered:
        warnings.append(NO_PROFILES_WARNING)
        salary_ytd = salary_projected = gross_ytd = gross_projected = ZERO
        elapsed = total = 0
    else:
        current = [p for p in ordered if p.effective_date <= today] or [ordered[0]]
        grid = check_dates(year, current[-1].pay_periods_per_year)
        total = len(grid)
        if ordered[0].effective_date > grid[0]:
            warnings.append(EARLY_CHECKS_WARNING)
        salary_ytd = salary_projected = gross_ytd = gross_projected = ZERO
        elapsed = 0
        for check_day in grid:
            in_force = [p for p in ordered if p.effective_date <= check_day] or [ordered[0]]
            lines = breakdown(in_force[-1])
            salary_projected += lines["withholding"]
            gross_projected += lines["gross"]
            if check_day <= today:
                elapsed += 1
                salary_ytd += lines["withholding"]
                gross_ytd += lines["gross"]

    def fica(wages: Decimal) -> Decimal:
        return walk(medicare, wages) + walk(social_security, wages) + walk(disability, wages)

    income_ytd = sum((Decimal(s) * price for _, s, price in past_vests), ZERO)
    income_projected = income_ytd + sum((Decimal(s) * price for _, s, price in future_vests), ZERO)
    supplemental = FED_SUPPLEMENTAL + CA_SUPPLEMENTAL
    fica_ytd = fica(gross_ytd + income_ytd) - fica(gross_ytd)
    fica_projected = fica(gross_projected + income_projected) - fica(gross_projected)
    return WithholdingEstimate(
        checks_elapsed=elapsed,
        checks_total=total,
        salary_ytd=_cents(salary_ytd),
        salary_projected=_cents(salary_projected),
        salary_gross_ytd=_cents(gross_ytd),
        salary_gross_projected=_cents(gross_projected),
        vest_income_ytd=_cents(income_ytd),
        vest_income_projected=_cents(income_projected),
        vest_supplemental_ytd=_cents(income_ytd * supplemental),
        vest_supplemental_projected=_cents(income_projected * supplemental),
        vest_fica_ytd=_cents(fica_ytd),
        vest_fica_projected=_cents(fica_projected),
        warnings=warnings,
    )
