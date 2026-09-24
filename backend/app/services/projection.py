"""Deterministic net-worth projection — the FIRE module's engine.

Pure Decimal math, no I/O, no clock: the router owns the database reads (starting
balance, trailing savings, trailing spend, the stored SWR) and the calendar; this module
owns only the compounding. Deliberately deterministic — one return assumption, no Monte
Carlo — and the PAGE carries that honesty in words; the numbers here never pretend to be
more than arithmetic over the knobs.

Phases, a drawdown and lumps (2026-09-23 spec §R1): one recurrence,
`balance = balance × (1 + r) + flow`, where each month's flow comes from ONE schedule
(`monthly_flows`) that both engines share — the contribution, re-leveled by a reset at a
phase boundary and escalated by repeated multiplication; a lump (a scheduled vest) added
at its month; and, from the drawdown month, a withdrawal taken out. A month whose result
would be below 0 is clamped to 0 and the path's first such month is recorded — in EVERY
phase, so a negative typed contribution bottoms out at $0 too. With no resets, lumps or
withdrawal, the flow is exactly the pre-2026-09-23 contribution chain, so every output is
byte-identical whenever the clamp never fires (always, with a non-negative contribution).
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

ONE = Decimal(1)
TWELVE = Decimal(12)
CENT = Decimal("0.01")
ZERO = Decimal("0")
# The projection's reach (api/projection.py YEARS_MAX): no horizon — and so no plan-until
# year — runs past 60 years from the start month (2026-09-23 spec §R3, §R11).
MAX_YEARS = 60


def monthly_rate(annual_return: Decimal) -> Decimal:
    """Geometric monthly equivalent of an annual return: (1 + r)^(1/12) − 1.

    Decimal ** with a fractional exponent is context-rounded (28 significant digits) —
    orders of magnitude under the 2dp display quantum, and deterministic, which is what
    lets the API tests pin exact strings. The router bounds the NOMINAL r to [-0.5, 0.5]
    and may pass a real-terms conversion of it; the inflation bounds keep the worst
    case at -0.6, so the base stays strictly positive and the power is always defined.
    """
    return (ONE + annual_return) ** (ONE / TWELVE) - ONE


def reset_schedule(resets: Sequence[tuple[int, Decimal]]) -> dict[int, Decimal]:
    """`(month_index, level)` pairs as ONE contribution level per month index (spec §R1).

    A reset SETS the contribution to `level` in t0 dollars — the escalator carries it to the
    month it lands in — so two resets at one index would be two answers to one question: the
    router emits one per phase boundary (people retiring in the same month share it), and a
    second is a caller bug, raised rather than summed or silently overwritten. Index 0 folds
    onto 1 BEFORE the check (t0 carries no flow; it IS the starting balance), so a reset at 0
    and one at 1 collide too.
    """
    schedule: dict[int, Decimal] = {}
    for index, level in resets:
        key = max(index, 1)
        if key in schedule:
            raise ValueError(f"more than one contribution reset at month index {key}")
        schedule[key] = level
    return schedule


def lump_schedule(lumps: Mapping[int, Decimal] | None) -> dict[int, Decimal]:
    """Lumps (scheduled vests) by month index, index 0 folded onto 1 and SUMMED — two vests in
    one month are both real money. Indices past the horizon simply never fire."""
    schedule: dict[int, Decimal] = {}
    for index, amount in (lumps or {}).items():
        key = max(index, 1)
        schedule[key] = schedule.get(key, ZERO) + amount
    return schedule


def fold_withdrawal(withdrawal: tuple[int, Decimal] | None) -> tuple[int, Decimal] | None:
    """`(start_index, monthly_amount)` with a start at t0 folded onto month 1."""
    return None if withdrawal is None else (max(withdrawal[0], 1), withdrawal[1])


def monthly_flows[N: (Decimal, float)](
    contribution: N,
    growth: N,
    months: int,
    *,
    resets: Mapping[int, Decimal],
    withdrawal: tuple[int, Decimal] | None,
    lumps: Mapping[int, Decimal],
    convert: Callable[[Decimal], N],
) -> list[N]:
    """flows[k] = month k's contribution, plus its lump, minus the withdrawal; flows[0] is t0
    and carries nothing. ONE owner for both engines — the Decimal line passes Decimals, the
    float Monte Carlo floats (`convert=float`) — so the fan bends exactly where the line bends.

    The contribution escalates by repeated multiplication after each month, the chain the
    pre-2026-09-23 loops ran; with no reset, lump or withdrawal a flow is exactly that chain's
    contribution, which is what keeps empty inputs byte-identical. A reset at month k sets
    `level × growth^(k−1)` — the escalator, tracked the same way — and the escalation carries
    on from there. The schedules arrive normalized (`reset_schedule`, `lump_schedule`,
    `fold_withdrawal`).
    """
    flows = [convert(ZERO)] * (months + 1)
    escalator = convert(ONE)
    for index in range(1, months + 1):
        level = resets.get(index)
        if level is not None:
            contribution = convert(level) * escalator
        flow = contribution
        lump = lumps.get(index)
        if lump is not None:
            flow = flow + convert(lump)
        if withdrawal is not None and index >= withdrawal[0]:
            flow = flow - convert(withdrawal[1])
        flows[index] = flow
        contribution *= growth
        escalator *= growth
    return flows


@dataclass(frozen=True)
class ProjectedPath:
    # months+1 points at cents; t0 is the starting balance itself.
    points: list[Decimal]
    # The first month index whose balance would have gone below 0 (clamped to 0 there), or
    # None when the line never runs out.
    depletion_index: int | None


def project_path(
    starting_balance: Decimal,
    monthly_contribution: Decimal,
    annual_return: Decimal,
    months: int,
    contribution_growth: Decimal = Decimal("0"),
    *,
    resets: Sequence[tuple[int, Decimal]] = (),
    withdrawal: tuple[int, Decimal] | None = None,
    lumps: Mapping[int, Decimal] | None = None,
) -> ProjectedPath:
    """months+1 points at cents; t0 is the starting balance itself, and each later point is
    `previous × (1 + monthly rate) + flow`, the flow from `monthly_flows`. The contribution
    escalates geometrically by `contribution_growth` per year ((1+g)^(1/12) per month — 0
    keeps the historical flat behavior byte-identical). The chain runs at full precision and
    only the OUTPUTS land on cents, so no month's dust can compound into the next.

    The clamp holds in every phase (spec §R1): a month whose result would be below 0 is 0,
    and the first such month is `depletion_index` — once the balance has been at or above 0.
    A negative STARTING balance is debt being paid down, not a path that ran out: it is carried
    unclamped until it first reaches 0 (2026-09-24 review minor 1). A clamped month leaves 0
    behind, so "the month before was not below 0" is exactly "the floor applies".
    """
    rate = monthly_rate(annual_return)
    growth = (ONE + contribution_growth) ** (ONE / TWELVE)
    flows = monthly_flows(
        monthly_contribution,
        growth,
        months,
        resets=reset_schedule(resets),
        withdrawal=fold_withdrawal(withdrawal),
        lumps=lump_schedule(lumps),
        convert=Decimal,
    )
    points = [starting_balance.quantize(CENT, rounding=ROUND_HALF_UP)]
    balance = starting_balance
    depleted: int | None = None
    for index in range(1, months + 1):
        previous = balance
        balance = previous * (ONE + rate) + flows[index]
        if balance < ZERO and previous >= ZERO:
            balance = ZERO
            if depleted is None:
                depleted = index
        points.append(balance.quantize(CENT, rounding=ROUND_HALF_UP))
    return ProjectedPath(points=points, depletion_index=depleted)


def project(
    starting_balance: Decimal,
    monthly_contribution: Decimal,
    annual_return: Decimal,
    months: int,
    contribution_growth: Decimal = Decimal("0"),
    *,
    resets: Sequence[tuple[int, Decimal]] = (),
    withdrawal: tuple[int, Decimal] | None = None,
    lumps: Mapping[int, Decimal] | None = None,
) -> list[Decimal]:
    """`project_path`'s points — for every caller that does not need the depletion month."""
    return project_path(
        starting_balance,
        monthly_contribution,
        annual_return,
        months,
        contribution_growth,
        resets=resets,
        withdrawal=withdrawal,
        lumps=lumps,
    ).points


def first_reaching(points: list[Decimal], target: Decimal) -> int | None:
    """Index of the first point at or past the target — None when the horizon never gets
    there. Judged on the QUANTIZED points, so the answer can never contradict the chart
    the user is looking at."""
    for i, value in enumerate(points):
        if value >= target:
            return i
    return None


def december_index(start_month: date, year: int) -> int:
    """The month index of December `year` on an axis whose t0 is `start_month`."""
    return (year - start_month.year) * 12 + (12 - start_month.month)


def latest_december_year(start_month: date, months: int) -> int:
    """The latest year whose December is on an axis of `months` months after `start_month`:
    Dec Y sits at (Y − y0)·12 + 12 − m0, so the largest Y with that ≤ `months`."""
    return start_month.year + (months - 12 + start_month.month) // 12


def max_plan_until_year(start_month: date) -> int:
    """The latest plan-until year the projection can reach — its December within MAX_YEARS
    of the start month (2085 from Sep 2026). One owner for the knob's 422 and the Settings
    PUT's bound (spec §R3, §R11)."""
    return latest_december_year(start_month, MAX_YEARS * 12)
