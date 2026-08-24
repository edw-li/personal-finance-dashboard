"""services/value_history's read-side benchmark leg (2026-08-24 contribution-matched
benchmark spec, §2 recurrence / §5 test list). contribution_benchmark is pure — every
case here is literal-driven, no DB."""

from datetime import date
from decimal import Decimal

from app.services.value_history import contribution_benchmark

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
