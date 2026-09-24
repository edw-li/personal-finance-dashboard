"""Seeded Monte Carlo over the projection's monthly recurrence.

FLOAT INTERNALS — a documented departure from the Decimal house rule: 500 paths × up to
720 months is 360k multiplies with zero display effect beyond the cent, so the walk runs
float64 and only the OUTPUT percentiles land on cents (polyTrend.ts's float precedent on
the frontend). The deterministic engine (services/projection.py) stays Decimal and its
arrays are untouched — the simulation surrounds the line, never replaces it.

Model: monthly growth factor exp(N(mu_m, sigma_m)) with mu_m = ln(1 + r) / 12, so the
MEDIAN growth FACTOR is exactly the deterministic rate; with contributions the p50
band tracks the deterministic line approximately, not identically (summed lognormals
pull the median toward the mean over long horizons — measured ~+8% at month 360 on
typical knobs), which is one reason p50 is never drawn as its own curve.
sigma_m = sigma / sqrt(12). Each month's flow — the contribution (re-leveled at a phase
boundary, escalated), a lump, a withdrawal — comes from the ONE schedule the line uses
(services/projection.monthly_flows), built once per run because it does not depend on the
path. A month whose result would be below 0 is clamped to 0 and the path's first such month
recorded (2026-09-23 spec §R1), so balances stay at or above 0 in every phase — and a
depleted path KEEPS DRAWING its Gaussian every month, so every path sees the same random
numbers in every scenario (common random numbers: a change of spend or retirement never
reshuffles later paths, and success stays monotone in them).

SEEDED, deliberately: identical knobs must redraw identical bands — the bands answer
"what does this sigma imply", not "give me fresh noise" — and the tests pin exact values.
The router runs this in a worker thread (api/projection.py MC_LIMITER): it is pure, owns
its own Random, and touches nothing shared.
"""

import math
import random
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.services.projection import (
    drop_schedule,
    fold_withdrawal,
    lump_schedule,
    monthly_flows,
    reset_schedule,
)

SIMULATIONS = 500
MC_SEED = 20260820
CENT = Decimal("0.01")
PERCENTILES = (10, 25, 50, 75, 90)


@dataclass
class MonteCarloResult:
    # Keys "p10"/"p25"/"p50"/"p75"/"p90"; each list is months+1 points at cents,
    # aligned to the deterministic axis (t0 = the starting balance in every path).
    bands: dict[str, list[Decimal]]
    # Per path: first month index whose balance >= target; None = never (or no target).
    reach_indices: list[int | None]
    # Per path: the first month index whose balance would have gone below 0 — clamped to 0
    # there (spec §R1) — or None when the path never ran out.
    depletion_indices: list[int | None]


def _percentile(sorted_values: list[float] | tuple[float, ...], pct: int) -> float:
    """Linear interpolation between closest ranks (numpy's default) — pinned by tests."""
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (pct / 100) * (len(sorted_values) - 1)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return sorted_values[low]
    fraction = rank - low
    return sorted_values[low] * (1 - fraction) + sorted_values[high] * fraction


def simulate(
    starting_balance: Decimal,
    monthly_contribution: Decimal,
    annual_return: Decimal,
    volatility: Decimal,
    contribution_growth: Decimal,
    months: int,
    target: Decimal | None,
    drops: Sequence[tuple[int, Decimal]] = (),
    *,
    resets: Sequence[tuple[int, Decimal]] = (),
    withdrawal: tuple[int, Decimal] | None = None,
    lumps: Mapping[int, Decimal] | None = None,
) -> MonteCarloResult:
    """`annual_return`/`contribution_growth` arrive ALREADY converted to real terms by
    the router when inflation is in play — this module knows nothing about inflation.

    `resets`, `withdrawal` and `lumps` are the deterministic engine's own inputs, normalized
    by services/projection rather than re-derived here: the fan has to bend exactly where the
    line bends. They cost the walk no randomness — the flows are one list built before the
    first path — which is what keeps empty inputs byte-identical. (`drops` is the transient
    retirement decrement; see services/projection.drop_schedule.)
    """
    rng = random.Random(MC_SEED)
    start = float(starting_balance)
    mu_m = math.log(1 + float(annual_return)) / 12
    sigma_m = float(volatility) / math.sqrt(12)
    growth_m = (1 + float(contribution_growth)) ** (1 / 12)
    target_f = None if target is None else float(target)
    flows = monthly_flows(
        float(monthly_contribution),
        growth_m,
        months,
        resets=reset_schedule(resets),
        withdrawal=fold_withdrawal(withdrawal),
        lumps=lump_schedule(lumps),
        convert=float,
        drops=drop_schedule(drops) if drops else None,
    )
    # Bound once: the walk below runs 500 × up to 720 steps, and on the 1 GB box it was the
    # route's whole cost (audit perf B6). Same calls, same order, same numbers.
    gauss = rng.gauss
    exp = math.exp

    paths: list[list[float]] = []
    reach_indices: list[int | None] = []
    depletion_indices: list[int | None] = []
    for _ in range(SIMULATIONS):
        balance = start
        path = [balance]
        append = path.append
        reached: int | None = 0 if target_f is not None and balance >= target_f else None
        depleted: int | None = None
        for month_index in range(1, months + 1):
            balance = balance * exp(gauss(mu_m, sigma_m)) + flows[month_index]
            if balance < 0.0:
                balance = 0.0
                if depleted is None:
                    depleted = month_index
            append(balance)
            if reached is None and target_f is not None and balance >= target_f:
                reached = month_index
        paths.append(path)
        reach_indices.append(reached)
        depletion_indices.append(depleted)

    bands: dict[str, list[Decimal]] = {f"p{p}": [] for p in PERCENTILES}
    # One tuple per month: the values the per-month generator used to collect, so the same
    # sorted column and the same percentiles — just without 361+ passes over 500 lists.
    for column in zip(*paths, strict=True):
        ordered = sorted(column)
        for p in PERCENTILES:
            value = Decimal(str(_percentile(ordered, p))).quantize(CENT, rounding=ROUND_HALF_UP)
            bands[f"p{p}"].append(value)
    return MonteCarloResult(
        bands=bands, reach_indices=reach_indices, depletion_indices=depletion_indices
    )


def reach_percentile(reach_indices: list[int | None], pct: int) -> int | None:
    """The pct-th percentile of first-reach month indices, 'never' sorting as +infinity —
    p10 is the optimistic edge, p90 the pessimistic. None when that percentile never
    reaches (or nothing does). The depletion months use the same rule: their 10th
    percentile is the month 9 in 10 paths last at least until."""
    if not reach_indices:
        return None
    sentinel = float("inf")
    ordered = sorted(sentinel if index is None else float(index) for index in reach_indices)
    value = _percentile(ordered, pct)
    return None if math.isinf(value) else round(value)


def survival_count(depletion_indices: list[int | None], through_index: int) -> int:
    """Paths never depleted through `through_index` — one depleting after it survives it, which
    is how "lasts through December {year}" counts a January depletion as a success (§R3)."""
    return sum(1 for index in depletion_indices if index is None or index > through_index)
