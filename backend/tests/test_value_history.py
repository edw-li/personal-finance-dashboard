"""services/value_history's read-side benchmark leg (2026-08-24 contribution-matched
benchmark spec, §2 recurrence / §5 test list). contribution_benchmark is pure, so its
cases are literal-driven, no DB; the baseline_closes_for cases at the bottom are async
against the real test DB, because a loader's whole job is the query."""

from datetime import date
from decimal import Decimal

from app.models import PriceHistory, Security
from app.services.value_history import baseline_closes_for, contribution_benchmark

D = Decimal


def _row(iso: str, market_value: str, cost_basis: str) -> tuple[date, Decimal, Decimal]:
    return (date.fromisoformat(iso), D(market_value), D(cost_basis))


def test_seed_is_the_first_market_value_quantized():
    rows = [_row("2023-10-23", "53619.00", "53619.00")]
    closes = {date(2023, 10, 23): D("400.00")}
    assert contribution_benchmark(rows, closes) == [D("53619.00")]
    # The seed itself wears MONEY_Q HALF_UP — literal-driven inputs may be unquantized.
    assert contribution_benchmark([_row("2023-10-23", "1000.005", "1000.005")], closes) == [
        D("1000.01")
    ]


def test_contribution_lands_then_grows():
    rows = [
        _row("2026-01-05", "1000.00", "1000.00"),
        _row("2026-01-12", "1490.00", "1500.00"),
        _row("2026-01-19", "1700.00", "1500.00"),
    ]
    closes = {
        date(2026, 1, 5): D("100.00"),
        date(2026, 1, 12): D("100.00"),
        date(2026, 1, 19): D("110.00"),
    }
    # Flat close + flow 500 -> the flow lands whole; then 1500 x 110/100 grows it.
    assert contribution_benchmark(rows, closes) == [D("1000.00"), D("1500.00"), D("1650.00")]


def test_negative_flow_withdraws_at_cost():
    rows = [
        _row("2026-01-05", "2000.00", "2000.00"),
        _row("2026-01-12", "1300.00", "1200.00"),
    ]
    closes = {date(2026, 1, 5): D("100.00"), date(2026, 1, 12): D("105.00")}
    # A cost-basis drop is a negative flow (spec §3.1's documented approximation):
    # 2000 x 1.05 - 800 = 1300.
    assert contribution_benchmark(rows, closes) == [D("2000.00"), D("1300.00")]


def test_no_bars_at_all_is_all_none():
    rows = [
        _row("2026-01-05", "1000.00", "1000.00"),
        _row("2026-01-12", "1100.00", "1050.00"),
    ]
    # The one all-None case (spec §4): no benchmark bars AT ALL — degraded, never a 500.
    assert contribution_benchmark(rows, {}) == [None, None]


def test_empty_rows_are_empty():
    assert contribution_benchmark([], {}) == []
    assert contribution_benchmark([], {date(2026, 1, 5): D("1")}) == []


def test_missing_close_carries_flat_and_still_lands_the_flow():
    rows = [
        _row("2026-01-05", "1000.00", "1000.00"),
        _row("2026-01-12", "1150.00", "1200.00"),
        _row("2026-01-19", "1400.00", "1200.00"),
    ]
    closes = {date(2026, 1, 5): D("100.00"), date(2026, 1, 19): D("120.00")}
    # Step INTO the gap: factor 1, the +200 flow lands. Step OUT of it: the previous end
    # is the missing one, so factor 1 again — no invented move on either side of a
    # barless step (spec §2, _extended_baseline's own rule).
    assert contribution_benchmark(rows, closes) == [D("1000.00"), D("1200.00"), D("1200.00")]


def test_leading_rows_before_the_first_bar_carry_the_seed_flat():
    rows = [
        _row("2026-01-05", "1000.00", "1000.00"),
        _row("2026-01-12", "1105.00", "1100.00"),
        _row("2026-01-19", "1210.00", "1200.00"),
        _row("2026-01-26", "1400.00", "1200.00"),
    ]
    # The first two dates precede every VOO bar (absent from the map): the seed rides
    # flat and the flows land — flats, not holes (spec §4).
    closes = {date(2026, 1, 19): D("200.00"), date(2026, 1, 26): D("210.00")}
    assert contribution_benchmark(rows, closes) == [
        D("1000.00"),
        D("1100.00"),
        D("1200.00"),
        D("1260.00"),  # growth finally engages: 1200 x 210/200
    ]


def test_drain_clamp_zeroes_growth_not_the_flow():
    rows = [
        _row("2026-01-05", "1000.00", "2000.00"),
        _row("2026-01-12", "0.00", "500.00"),
        _row("2026-01-19", "300.00", "800.00"),
    ]
    closes = {
        date(2026, 1, 5): D("100.00"),
        date(2026, 1, 12): D("100.00"),
        date(2026, 1, 19): D("200.00"),
    }
    # t1 drains past zero at cost (flow -1500): overdrawn on paper is legal output. t2's
    # doubling close must NOT double a negative balance — the growth TERM clamps to 0
    # (spec §2's guard: never negative VIA MULTIPLICATION) and the +300 flow lands alone.
    assert contribution_benchmark(rows, closes) == [D("1000.00"), D("-500.00"), D("300.00")]


def test_golden_six_row_series_to_the_cent():
    """End to end: seed, growth, a flow, a barless gap (both step ends), a negative
    flow, an exact-ratio step, and a genuinely rounding step — pinned to the cent."""
    rows = [
        _row("2025-09-01", "1000.00", "800.00"),
        _row("2025-09-08", "1300.00", "1050.00"),
        _row("2025-09-15", "1290.00", "1050.00"),
        _row("2025-09-22", "1120.00", "900.00"),
        _row("2025-09-29", "1105.00", "900.00"),
        _row("2025-10-06", "1225.00", "1000.00"),
    ]
    closes = {
        date(2025, 9, 1): D("100.00"),
        date(2025, 9, 8): D("103.00"),
        # 2025-09-15 has no bar: the gap step AND the step out of it run at factor 1.
        date(2025, 9, 22): D("103.00"),
        date(2025, 9, 29): D("100.94"),  # 103.00 x 0.98 exactly
        date(2025, 10, 6): D("101.95"),
    }
    assert contribution_benchmark(rows, closes) == [
        D("1000.00"),  # seed = mv[0]
        D("1280.00"),  # 1000 x 1.03 + 250
        D("1280.00"),  # gap: factor 1, zero flow
        D("1130.00"),  # out of the gap: factor 1, flow -150
        D("1107.40"),  # 1130 x 0.98
        D("1218.48"),  # 1107.40 x 101.95/100.94 + 100 = 1218.4805... -> HALF_UP
    ]


def test_live_extension_recompute_is_idempotent_and_prefix_stable():
    rows = [
        _row("2026-08-10", "1000.00", "1000.00"),
        _row("2026-08-17", "1120.00", "1100.00"),
    ]
    closes = {date(2026, 8, 10): D("500.00"), date(2026, 8, 17): D("510.00")}
    first = contribution_benchmark(rows, closes)
    assert first == [D("1000.00"), D("1120.00")]
    # Same-day recompute: the Monday appender upserts the same row on a re-run and the
    # read-time series re-derives to the same numbers — _extended_baseline's idempotence,
    # inherited by construction because the recurrence reads stored rows only (spec §2's
    # live-extension bullet: the step IS the implied-shares method, benchmark[t-1]/
    # close[t-1] shares x close[t], anchored on the computed series' last value).
    assert contribution_benchmark(rows, closes) == first
    # Extending by the next live Monday never rewrites history.
    extended = contribution_benchmark(
        rows + [_row("2026-08-24", "1150.00", "1100.00")],
        {**closes, date(2026, 8, 24): D("520.00")},
    )
    assert extended[:2] == first
    assert extended == [D("1000.00"), D("1120.00"), D("1141.96")]  # 1120 x 520/510, 0 flow


def test_drain_clamp_wins_over_a_barless_step():
    rows = [
        _row("2026-01-05", "1000.00", "2000.00"),
        _row("2026-01-12", "0.00", "500.00"),
        _row("2026-01-19", "300.00", "800.00"),
    ]
    # 2026-01-19 has NO close: an overdrawn balance crossing a BARLESS step still
    # recovers to flow-only (drain clamp before the missing-close arm). The reordered
    # arms would carry -500 flat and answer -200.00.
    closes = {date(2026, 1, 5): D("100.00"), date(2026, 1, 12): D("100.00")}
    assert contribution_benchmark(rows, closes) == [D("1000.00"), D("-500.00"), D("300.00")]


def test_chaining_consumes_the_quantized_value():
    rows = [
        _row("2026-02-02", "1000.00", "1000.00"),
        _row("2026-02-09", "1010.00", "1000.00"),
        _row("2026-02-16", "10100.00", "1000.00"),
    ]
    closes = {
        date(2026, 2, 2): D("100.94"),
        date(2026, 2, 9): D("101.95"),  # 1000 x 101.95/100.94 = 1010.0059... -> 1010.01
        date(2026, 2, 16): D("1019.50"),  # exactly x10: the NEXT step amplifies the cent
    }
    # Chaining on the QUANTIZED value (the docstring's claim): 1010.01 x 10 = 10100.10.
    # A chain carried at full precision would answer 10100.06 — the amplified step is
    # what makes the difference observable.
    assert contribution_benchmark(rows, closes) == [D("1000.00"), D("1010.01"), D("10100.10")]


async def test_baseline_closes_for_resolves_on_or_before_per_date(db):
    voo = Security(ticker="VOO", name="Vanguard S&P 500 ETF", holding_type="etf")
    decoy = Security(ticker="NVDA", name="NVIDIA", holding_type="stock")
    db.add_all([voo, decoy])
    await db.flush()
    db.add_all(
        [
            PriceHistory(security_id=voo.id, price_date=date(2026, 8, 5), close=D("500.0000")),
            PriceHistory(security_id=voo.id, price_date=date(2026, 8, 14), close=D("510.0000")),
            # Another ticker's bar on an in-range date — the join must not read it.
            PriceHistory(security_id=decoy.id, price_date=date(2026, 8, 10), close=D("999.0000")),
        ]
    )
    await db.commit()
    closes = await baseline_closes_for(
        db,
        [date(2026, 8, 3), date(2026, 8, 10), date(2026, 8, 17)],
    )
    # 8/3 precedes every bar: ABSENT (the factor-1 rule's input, never a zero). 8/10 and
    # 8/17 each carry the newest bar on-or-before them.
    assert closes == {date(2026, 8, 10): D("500.0000"), date(2026, 8, 17): D("510.0000")}


async def test_baseline_closes_for_same_day_bar_and_empty_inputs(db):
    voo = Security(ticker="VOO", name="Vanguard S&P 500 ETF", holding_type="etf")
    db.add(voo)
    await db.flush()
    db.add(PriceHistory(security_id=voo.id, price_date=date(2026, 8, 10), close=D("500.0000")))
    await db.commit()
    # On-or-BEFORE: a bar dated the snapshot day itself resolves (Monday-close parity).
    assert await baseline_closes_for(db, [date(2026, 8, 10)]) == {date(2026, 8, 10): D("500.0000")}
    assert await baseline_closes_for(db, []) == {}


async def test_baseline_closes_for_no_voo_rows_is_empty(db):
    assert await baseline_closes_for(db, [date(2026, 8, 10)]) == {}
