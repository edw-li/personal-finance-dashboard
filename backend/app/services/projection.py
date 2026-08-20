"""Deterministic net-worth projection — the FIRE module's engine.

Pure Decimal math, no I/O, no clock: the router owns the database reads (starting
balance, trailing savings, trailing spend, the stored SWR) and the calendar; this module
owns only the compounding. Deliberately deterministic — one return assumption, no Monte
Carlo — and the PAGE carries that honesty in words; the numbers here never pretend to be
more than arithmetic over the knobs.
"""

from decimal import ROUND_HALF_UP, Decimal

ONE = Decimal(1)
TWELVE = Decimal(12)
CENT = Decimal("0.01")


def monthly_rate(annual_return: Decimal) -> Decimal:
    """Geometric monthly equivalent of an annual return: (1 + r)^(1/12) − 1.

    Decimal ** with a fractional exponent is context-rounded (28 significant digits) —
    orders of magnitude under the 2dp display quantum, and deterministic, which is what
    lets the API tests pin exact strings. The router bounds r to [-0.5, 0.5], so the
    base stays strictly positive and the power is always defined.
    """
    return (ONE + annual_return) ** (ONE / TWELVE) - ONE


def project(
    starting_balance: Decimal,
    monthly_contribution: Decimal,
    annual_return: Decimal,
    months: int,
    contribution_growth: Decimal = Decimal("0"),
) -> list[Decimal]:
    """months+1 points at cents; t0 is the starting balance itself, and each later point
    is `previous × (1 + monthly rate) + contribution`, where the contribution escalates
    geometrically by `contribution_growth` per year ((1+g)^(1/12) per month — 0 keeps
    the historical flat behavior byte-identical). The chain runs at full precision and
    only the OUTPUTS land on cents, so no month's dust can compound into the next.
    """
    rate = monthly_rate(annual_return)
    growth = (ONE + contribution_growth) ** (ONE / TWELVE)
    points = [starting_balance.quantize(CENT, rounding=ROUND_HALF_UP)]
    balance = starting_balance
    contribution = monthly_contribution
    for _ in range(months):
        balance = balance * (ONE + rate) + contribution
        contribution *= growth
        points.append(balance.quantize(CENT, rounding=ROUND_HALF_UP))
    return points


def first_reaching(points: list[Decimal], target: Decimal) -> int | None:
    """Index of the first point at or past the target — None when the horizon never gets
    there. Judged on the QUANTIZED points, so the answer can never contradict the chart
    the user is looking at."""
    for i, value in enumerate(points):
        if value >= target:
            return i
    return None
