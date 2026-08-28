from decimal import Decimal

from app.services.montecarlo import PERCENTILES, SIMULATIONS, reach_percentile, simulate
from app.services.projection import project

# Pure math over a seeded RNG — no DB, no clock, no HTTP. Every assertion here is either
# structural (ordering, alignment) or a tolerance; the one hand-computed number is the
# mixed reach percentile, whose arithmetic is spelled out at its assert.

BAND_KEYS = [f"p{p}" for p in PERCENTILES]


def test_seed_determinism():
    # The seed is the feature: identical knobs must redraw identical bands.
    args = (Decimal("100000"), Decimal("1000"), Decimal("0.05"), Decimal("0.15"), Decimal("0"))
    first = simulate(*args, 60, Decimal("500000"))
    second = simulate(*args, 60, Decimal("500000"))
    assert first.bands == second.bands
    assert first.reach_indices == second.reach_indices


def test_band_ordering():
    result = simulate(
        Decimal("100000"),
        Decimal("1000"),
        Decimal("0.05"),
        Decimal("0.15"),
        Decimal("0"),
        240,
        None,
    )
    assert sorted(result.bands) == sorted(BAND_KEYS)
    for month_index in range(241):
        row = [result.bands[key][month_index] for key in BAND_KEYS]
        assert row == sorted(row), f"percentiles crossed at month {month_index}: {row}"


def test_median_tracks_deterministic_rate():
    # mu_m = ln(1+r)/12 centers the MEDIAN on the deterministic path, so p50 lands near
    # 100,000 x 1.05^10 = 162,889.46. Tolerance, not equality: 500 draws carry sampling
    # noise, and pinning the exact cent here would pin the RNG, not the model.
    result = simulate(
        Decimal("100000"), Decimal("0"), Decimal("0.05"), Decimal("0.15"), Decimal("0"), 120, None
    )
    deterministic = Decimal("100000") * (Decimal("1.05") ** 10)
    assert abs(result.bands["p50"][-1] - deterministic) / deterministic < Decimal("0.05")


def test_t0_is_the_starting_balance_in_every_band():
    # t0 is not simulated — every path starts at the same known balance, so the fan
    # opens from the deterministic line's own first point.
    result = simulate(
        Decimal("100000"),
        Decimal("1000"),
        Decimal("0.05"),
        Decimal("0.15"),
        Decimal("0"),
        12,
        None,
    )
    for key in BAND_KEYS:
        assert result.bands[key][0] == Decimal("100000.00")
        assert len(result.bands[key]) == 13


def test_zero_target_reached_immediately():
    # A target already met at t0 reaches at index 0 on every path — including the
    # pessimistic p90 edge.
    result = simulate(
        Decimal("100000"),
        Decimal("1000"),
        Decimal("0.05"),
        Decimal("0.15"),
        Decimal("0"),
        12,
        Decimal("50000"),
    )
    assert result.reach_indices == [0] * SIMULATIONS
    assert reach_percentile(result.reach_indices, 90) == 0


def test_never_reaching_paths_percentile_none():
    # Absurd target: every path is "never", so every percentile is None — the router
    # renders a dash rather than inventing a date.
    result = simulate(
        Decimal("100000"),
        Decimal("1000"),
        Decimal("0.05"),
        Decimal("0.15"),
        Decimal("0"),
        12,
        Decimal("1000000000"),
    )
    assert result.reach_indices == [None] * SIMULATIONS
    for pct in PERCENTILES:
        assert reach_percentile(result.reach_indices, pct) is None


def test_reach_percentile_mixed():
    indices: list[int | None] = [2, 5, None, None]
    # Sorted with "never" as +inf: [2.0, 5.0, inf, inf], n = 4.
    # p10: rank = 0.10 x (4-1) = 0.3 -> between ranks 0 and 1
    #      -> 2.0 x 0.7 + 5.0 x 0.3 = 2.0 + 0.3 x 3 = 2.9 -> round -> 3.
    assert reach_percentile(indices, 10) == 3
    # p50: rank = 1.5 -> between 5.0 and inf -> inf -> None (the median path never gets
    # there, and half-of-infinity is still infinity).
    assert reach_percentile(indices, 50) is None
    # p90: rank = 2.7 -> between inf and inf -> inf -> None.
    assert reach_percentile(indices, 90) is None


def test_contribution_growth_shifts_bands_up():
    # Same seed, same draws — the only difference is the escalating contribution, so the
    # final median must be strictly higher.
    flat = simulate(
        Decimal("100000"),
        Decimal("1000"),
        Decimal("0.05"),
        Decimal("0.15"),
        Decimal("0"),
        120,
        None,
    )
    escalating = simulate(
        Decimal("100000"),
        Decimal("1000"),
        Decimal("0.05"),
        Decimal("0.15"),
        Decimal("0.05"),
        120,
        None,
    )
    assert escalating.bands["p50"][-1] > flat.bands["p50"][-1]


# --- retirement drops (2026-08-28 spec §4.3) ---


def test_simulate_without_drops_is_byte_identical():
    # CAPTURED FROM simulate() BEFORE THE DROPS PARAMETER EXISTED. The schedule lookup must
    # cost the walk nothing — not one extra rng draw, not one changed multiply — so these
    # three strings are what byte-identity is measured against. They are NOT regenerated:
    # if they stop matching, the simulation moved.
    args = (Decimal("100000"), Decimal("1000"), Decimal("0.05"), Decimal("0.15"), Decimal("0"))
    result = simulate(*args, 60, Decimal("500000"))
    assert str(result.bands["p10"][-1]) == "134857.43"
    assert str(result.bands["p50"][-1]) == "194732.88"
    assert str(result.bands["p90"][-1]) == "282599.44"
    # An EXPLICIT empty schedule is the same walk, and so is one that never fires.
    assert simulate(*args, 60, Decimal("500000"), []).bands == result.bands
    assert simulate(*args, 60, Decimal("500000"), [(999, Decimal("500"))]).bands == result.bands


def test_simulate_shares_the_deterministic_drop_schedule():
    # Sigma 0 collapses every path onto exp(mu_m) = (1+r)^(1/12) — the deterministic
    # recurrence itself — so p50 must TRACK project() month for month. That is what pins
    # the two functions onto ONE schedule: a mismatched index or a missed sum would
    # diverge by the drop amount, orders of magnitude above this tolerance. The tolerance
    # itself is float-vs-Decimal dust only (~1e-9 on these magnitudes).
    schedule = [(24, Decimal("2500.00"))]
    line = project(
        Decimal("100000"), Decimal("4000"), Decimal("0.05"), 60, Decimal("0.03"), schedule
    )
    fan = simulate(
        Decimal("100000"),
        Decimal("4000"),
        Decimal("0.05"),
        Decimal("0"),
        Decimal("0.03"),
        60,
        None,
        schedule,
    )
    for index, point in enumerate(line):
        assert abs(fan.bands["p50"][index] - point) <= Decimal("0.05"), index


def test_simulate_drops_lower_every_band_from_the_retirement_month():
    # Same seed, same draws: the only difference is 2,000 a month leaving the stream at
    # month 12, so nothing after it can be higher and the end must be strictly lower.
    args = (Decimal("100000"), Decimal("4000"), Decimal("0.05"), Decimal("0.15"), Decimal("0"))
    full = simulate(*args, 36, None)
    retired = simulate(*args, 36, None, [(12, Decimal("2000.00"))])
    for key in BAND_KEYS:
        assert retired.bands[key][:12] == full.bands[key][:12]  # nothing before it moves
        assert retired.bands[key][-1] < full.bands[key][-1]


def test_simulate_floors_the_stream_at_zero():
    # A drop bigger than the stream retires it entirely; the escalator cannot revive a 0.
    args = (Decimal("100000"), Decimal("1000"), Decimal("0.05"), Decimal("0.15"), Decimal("0.05"))
    retired = simulate(*args, 36, None, [(6, Decimal("5000.00"))])
    coasting = simulate(
        Decimal("100000"),
        Decimal("0"),
        Decimal("0.05"),
        Decimal("0.15"),
        Decimal("0.05"),
        36,
        None,
        [(6, Decimal("5000.00"))],
    )
    # From month 6 on, a retired stream and a stream that never existed are the same walk
    # — the balances differ only by the five contributions made before the drop (the drop
    # lands BEFORE month 6's own contribution).
    assert retired.bands["p50"][-1] > coasting.bands["p50"][-1]
    assert all(v >= Decimal("0") for v in retired.bands["p10"])
