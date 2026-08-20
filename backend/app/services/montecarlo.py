"""Seeded Monte Carlo over the projection's monthly recurrence.

FLOAT INTERNALS — a documented departure from the Decimal house rule: 500 paths × up to
720 months is 360k multiplies with zero display effect beyond the cent, so the walk runs
float64 and only the OUTPUT percentiles land on cents (polyTrend.ts's float precedent on
the frontend). The deterministic engine (services/projection.py) stays Decimal and its
arrays are untouched — the simulation surrounds the line, never replaces it.

Model: monthly growth factor exp(N(mu_m, sigma_m)) with mu_m = ln(1 + r) / 12, so the
MEDIAN path compounds at exactly the deterministic rate and the p50 band hugs the
deterministic line by construction; sigma_m = sigma / sqrt(12). Contributions are added
after growth each month (the deterministic recurrence's own order) and may escalate
geometrically. Balances stay positive by construction (multiplicative).

SEEDED, deliberately: identical knobs must redraw identical bands — the bands answer
"what does this sigma imply", not "give me fresh noise" — and the tests pin exact values.
"""

import math
import random
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

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


def _percentile(sorted_values: list[float], pct: int) -> float:
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
) -> MonteCarloResult:
    """`annual_return`/`contribution_growth` arrive ALREADY converted to real terms by
    the router when inflation is in play — this module knows nothing about inflation."""
    rng = random.Random(MC_SEED)
    start = float(starting_balance)
    base_contribution = float(monthly_contribution)
    mu_m = math.log(1 + float(annual_return)) / 12
    sigma_m = float(volatility) / math.sqrt(12)
    growth_m = (1 + float(contribution_growth)) ** (1 / 12)
    target_f = None if target is None else float(target)

    paths: list[list[float]] = []
    reach_indices: list[int | None] = []
    for _ in range(SIMULATIONS):
        balance = start
        path = [balance]
        reached: int | None = 0 if target_f is not None and balance >= target_f else None
        contribution = base_contribution
        for month_index in range(1, months + 1):
            balance = balance * math.exp(rng.gauss(mu_m, sigma_m)) + contribution
            contribution *= growth_m
            path.append(balance)
            if reached is None and target_f is not None and balance >= target_f:
                reached = month_index
        paths.append(path)
        reach_indices.append(reached)

    bands: dict[str, list[Decimal]] = {f"p{p}": [] for p in PERCENTILES}
    for month_index in range(months + 1):
        column = sorted(path[month_index] for path in paths)
        for p in PERCENTILES:
            value = Decimal(str(_percentile(column, p))).quantize(CENT, rounding=ROUND_HALF_UP)
            bands[f"p{p}"].append(value)
    return MonteCarloResult(bands=bands, reach_indices=reach_indices)


def reach_percentile(reach_indices: list[int | None], pct: int) -> int | None:
    """The pct-th percentile of first-reach month indices, 'never' sorting as +infinity —
    p10 is the optimistic edge, p90 the pessimistic. None when that percentile never
    reaches (or nothing does)."""
    if not reach_indices:
        return None
    sentinel = float("inf")
    ordered = sorted(sentinel if index is None else float(index) for index in reach_indices)
    value = _percentile(ordered, pct)
    return None if math.isinf(value) else round(value)
