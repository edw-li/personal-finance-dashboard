"""Deterministic net-worth projection — the FIRE module's engine.

Pure Decimal math, no I/O, no clock: the router owns the database reads (starting
balance, trailing savings, trailing spend, the stored SWR) and the calendar; this module
owns only the compounding. Deliberately deterministic — one return assumption, no Monte
Carlo — and the PAGE carries that honesty in words; the numbers here never pretend to be
more than arithmetic over the knobs.
"""

from collections.abc import Sequence
from decimal import ROUND_HALF_UP, Decimal

ONE = Decimal(1)
TWELVE = Decimal(12)
CENT = Decimal("0.01")
ZERO = Decimal("0")


def monthly_rate(annual_return: Decimal) -> Decimal:
    """Geometric monthly equivalent of an annual return: (1 + r)^(1/12) − 1.

    Decimal ** with a fractional exponent is context-rounded (28 significant digits) —
    orders of magnitude under the 2dp display quantum, and deterministic, which is what
    lets the API tests pin exact strings. The router bounds the NOMINAL r to [-0.5, 0.5]
    and may pass a real-terms conversion of it; the inflation bounds keep the worst
    case at -0.6, so the base stays strictly positive and the power is always defined.
    """
    return (ONE + annual_return) ** (ONE / TWELVE) - ONE


def drop_schedule(drops: Sequence[tuple[int, Decimal]]) -> dict[int, Decimal]:
    """`(month_index, amount)` pairs folded into ONE decrement per month index.

    The single owner of the retirement-schedule rule: `montecarlo.simulate` imports this
    rather than re-deriving it, because the fan has to bend exactly where the line bends
    and a second copy could only drift.

    Two retirements in the same month SUM — the household loses both paychecks at once.
    Index 0 folds onto index 1 because t0 carries no contribution (it IS the starting
    balance), so "already retired when the projection starts" and "retires at month 1"
    are the same chain. Indices past the horizon simply never fire: the API validates the
    range, and this function stays total.
    """
    schedule: dict[int, Decimal] = {}
    for index, amount in drops:
        key = max(index, 1)
        schedule[key] = schedule.get(key, ZERO) + amount
    return schedule


def project(
    starting_balance: Decimal,
    monthly_contribution: Decimal,
    annual_return: Decimal,
    months: int,
    contribution_growth: Decimal = Decimal("0"),
    drops: Sequence[tuple[int, Decimal]] = (),
) -> list[Decimal]:
    """months+1 points at cents; t0 is the starting balance itself, and each later point
    is `previous × (1 + monthly rate) + contribution`, where the contribution escalates
    geometrically by `contribution_growth` per year ((1+g)^(1/12) per month — 0 keeps
    the historical flat behavior byte-identical). The chain runs at full precision and
    only the OUTPUTS land on cents, so no month's dust can compound into the next.

    `drops` are retirements (2026-08-28 spec §4.3): at each scheduled month index the
    contribution stream is decremented BEFORE that month's contribution is added, floored
    at 0 (a drop larger than what is left retires the whole stream, and 0 × growth stays
    0), and the escalator then keeps compounding the REMAINDER. An empty schedule leaves
    every output byte-identical to the pre-retirement engine.
    """
    rate = monthly_rate(annual_return)
    growth = (ONE + contribution_growth) ** (ONE / TWELVE)
    schedule = drop_schedule(drops)
    points = [starting_balance.quantize(CENT, rounding=ROUND_HALF_UP)]
    balance = starting_balance
    contribution = monthly_contribution
    for index in range(1, months + 1):
        drop = schedule.get(index)
        if drop is not None:
            contribution = contribution - drop
            if contribution < ZERO:
                contribution = ZERO
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
