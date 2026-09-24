import random
from decimal import Decimal
from functools import partial

import anyio

from app.services.montecarlo import (
    PERCENTILES,
    SIMULATIONS,
    reach_percentile,
    simulate,
    survival_count,
)
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


# --- the shared flow schedule: resets, a withdrawal, lumps, depletion (2026-09-23 spec §R1) ---


def test_simulate_without_the_new_inputs_is_byte_identical():
    # The strings test_simulate_without_drops_is_byte_identical pins, on every empty spelling of
    # the three new inputs — and nothing depletes on a positive stream.
    args = (Decimal("100000"), Decimal("1000"), Decimal("0.05"), Decimal("0.15"), Decimal("0"))
    result = simulate(*args, 60, Decimal("500000"))
    assert str(result.bands["p10"][-1]) == "134857.43"
    assert str(result.bands["p50"][-1]) == "194732.88"
    assert str(result.bands["p90"][-1]) == "282599.44"
    assert result.depletion_indices == [None] * SIMULATIONS
    for kwargs in (
        {"resets": []},
        {"withdrawal": None},
        {"lumps": {}},
        {"lumps": None},
        {"resets": [(999, Decimal("5"))]},
    ):
        assert simulate(*args, 60, Decimal("500000"), **kwargs).bands == result.bands, kwargs


def test_simulate_shares_the_deterministic_flow_schedule():
    # Sigma 0 collapses every path onto the deterministic recurrence, so p50 must track
    # project() month for month through a reset, a lump and a withdrawal — one schedule, two
    # engines. The tolerance is float-vs-Decimal dust only.
    kwargs = {
        "resets": [(24, Decimal("1500.00"))],
        "withdrawal": (40, Decimal("9000.00")),
        "lumps": {12: Decimal("20000.00")},
    }
    line = project(
        Decimal("100000"), Decimal("4000"), Decimal("0.05"), 60, Decimal("0.03"), **kwargs
    )
    fan = simulate(
        Decimal("100000"),
        Decimal("4000"),
        Decimal("0.05"),
        Decimal("0"),
        Decimal("0.03"),
        60,
        None,
        **kwargs,
    )
    for index, point in enumerate(line):
        assert abs(fan.bands["p50"][index] - point) <= Decimal("0.05"), index


def test_a_withdrawal_depletes_paths_clamps_the_bands_at_zero_and_records_the_month():
    args = (Decimal("100000"), Decimal("0"), Decimal("0.05"), Decimal("0.15"), Decimal("0"))
    result = simulate(*args, 120, None, withdrawal=(1, Decimal("1200.00")))
    depleted = [index for index in result.depletion_indices if index is not None]
    assert depleted and all(1 <= index <= 120 for index in depleted)
    assert all(value >= Decimal("0") for value in result.bands["p10"])
    assert result.bands["p10"][-1] == Decimal("0.00")


def test_depleted_paths_keep_drawing_so_every_path_sees_the_same_numbers():
    # Common random numbers: a bigger withdrawal can only deplete a path EARLIER, path by path.
    # A depleted path that stopped drawing would hand every later path different draws, and this
    # ordering would break.
    args = (Decimal("100000"), Decimal("0"), Decimal("0.05"), Decimal("0.15"), Decimal("0"))
    small = simulate(*args, 240, None, withdrawal=(1, Decimal("500.00")))
    big = simulate(*args, 240, None, withdrawal=(1, Decimal("700.00")))
    never = float("inf")
    n_big = sum(index is not None for index in big.depletion_indices)
    n_small = sum(index is not None for index in small.depletion_indices)
    assert n_big > n_small > 0
    for b, s in zip(big.depletion_indices, small.depletion_indices, strict=True):
        assert (never if b is None else b) <= (never if s is None else s)


def test_every_path_draws_every_month_whatever_happens_to_it(monkeypatch):
    calls = {"n": 0}
    real = random.Random.gauss

    def counting(self, mu, sigma):
        calls["n"] += 1
        return real(self, mu, sigma)

    monkeypatch.setattr(random.Random, "gauss", counting)
    simulate(
        Decimal("1000"),
        Decimal("0"),
        Decimal("0.05"),
        Decimal("0.15"),
        Decimal("0"),
        36,
        None,
        withdrawal=(1, Decimal("900")),
    )
    assert calls["n"] == SIMULATIONS * 36


def test_a_negative_contribution_depletes_before_any_withdrawal():
    result = simulate(
        Decimal("1000"), Decimal("-600"), Decimal("0"), Decimal("0"), Decimal("0"), 3, None
    )
    assert result.depletion_indices == [2] * SIMULATIONS
    assert result.bands["p90"] == [
        Decimal("1000.00"),
        Decimal("400.00"),
        Decimal("0.00"),
        Decimal("0.00"),
    ]


def test_lumps_raise_every_band_from_their_month_only():
    args = (Decimal("100000"), Decimal("1000"), Decimal("0.05"), Decimal("0.15"), Decimal("0"))
    plain = simulate(*args, 36, None)
    vested = simulate(*args, 36, None, lumps={12: Decimal("50000.00")})
    for key in BAND_KEYS:
        assert vested.bands[key][:12] == plain.bands[key][:12]
        assert vested.bands[key][-1] > plain.bands[key][-1]


def test_resets_lower_every_band_from_their_month():
    args = (Decimal("100000"), Decimal("4000"), Decimal("0.05"), Decimal("0.15"), Decimal("0"))
    full = simulate(*args, 36, None)
    reset = simulate(*args, 36, None, resets=[(12, Decimal("2000.00"))])
    for key in BAND_KEYS:
        assert reset.bands[key][:12] == full.bands[key][:12]
        assert reset.bands[key][-1] < full.bands[key][-1]


def test_survival_counts_the_paths_never_depleted_through_an_index():
    # A path depleting AFTER the index (13 here) survives it — "through December" means a
    # depletion in January of the next year is a success.
    assert survival_count([None, 5, 12, 13], 12) == 2
    assert survival_count([], 3) == 0


async def test_the_threaded_run_equals_the_inline_run():
    args = (
        Decimal("100000"),
        Decimal("1000"),
        Decimal("0.05"),
        Decimal("0.15"),
        Decimal("0"),
        60,
        Decimal("500000"),
    )
    inline = simulate(*args, withdrawal=(30, Decimal("900")))
    threaded = await anyio.to_thread.run_sync(
        partial(simulate, *args, withdrawal=(30, Decimal("900")))
    )
    assert threaded.bands == inline.bands
    assert threaded.reach_indices == inline.reach_indices
    assert threaded.depletion_indices == inline.depletion_indices
