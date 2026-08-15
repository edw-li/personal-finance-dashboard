"""XIRR golden tests. The 5-flow case is Microsoft's documented XIRR example
(expected 0.373362535); the 2-flow cases have closed-form solutions."""

from datetime import date
from decimal import Decimal

from app.services.xirr import _dxnpv, xirr, xnpv


def test_microsoft_doc_example():
    flows = [
        (date(2008, 1, 1), Decimal("-10000")),
        (date(2008, 3, 1), Decimal("2750")),
        (date(2008, 10, 30), Decimal("4250")),
        (date(2009, 2, 15), Decimal("3250")),
        (date(2009, 4, 1), Decimal("2750")),
    ]
    result = xirr(flows)
    assert result is not None
    assert abs(result - Decimal("0.373363")) <= Decimal("0.000002")
    assert str(result) == "0.373363"
    assert result.as_tuple().exponent == -6


def test_two_flow_closed_form():
    # 2020 is a leap year: 366 days at exponent days/365
    flows = [(date(2020, 1, 1), Decimal("-1000")), (date(2021, 1, 1), Decimal("1100"))]
    expected = Decimal(str(1.1 ** (365 / 366) - 1))
    result = xirr(flows)
    assert result is not None
    assert abs(result - expected) <= Decimal("0.000002")


def test_deep_negative_return_uses_bisection_domain():
    flows = [(date(2020, 1, 1), Decimal("-1000")), (date(2021, 1, 1), Decimal("50"))]
    expected = Decimal(str(0.05 ** (365 / 366) - 1))  # ≈ -0.9497
    result = xirr(flows)
    assert result is not None
    assert abs(result - expected) <= Decimal("0.0002")


def test_underdetermined_cases_return_none():
    assert xirr([]) is None
    assert xirr([(date(2020, 1, 1), Decimal("-1000"))]) is None
    assert xirr([(date(2020, 1, 1), Decimal("-1")), (date(2021, 1, 1), Decimal("-2"))]) is None
    assert xirr([(date(2020, 1, 1), Decimal("1")), (date(2021, 1, 1), Decimal("2"))]) is None
    assert xirr([(date(2020, 1, 1), Decimal("-1")), (date(2020, 1, 1), Decimal("2"))]) is None


def test_input_order_does_not_trip_the_zero_span_guard():
    # First and last INPUT flows share a date; only sorting reveals the real span.
    # Without the internal sort this would return None (or a wrong t0 scaling).
    flows = [
        (date(2020, 1, 1), Decimal("-500")),
        (date(2021, 1, 1), Decimal("1100")),
        (date(2020, 1, 1), Decimal("-500")),
    ]
    result = xirr(flows)
    assert result is not None
    expected = Decimal(str(1.1 ** (365 / 366) - 1))
    assert abs(result - expected) <= Decimal("0.000002")


def test_xnpv_at_zero_rate_is_plain_sum():
    flows = [(date(2020, 1, 1), -1000.0), (date(2021, 6, 1), 400.0)]
    assert abs(xnpv(0.0, flows) - (-600.0)) < 1e-9


def test_root_outside_domain_returns_none():
    # +1,000,000% return in a year: the root lies above RATE_HI, and lo/hi NPVs share
    # a sign, so the bisection guard bails rather than fabricating a clamped rate.
    assert xirr([(date(2020, 1, 1), Decimal("-1")), (date(2021, 1, 1), Decimal("10000"))]) is None


def test_absurd_span_returns_none_not_a_crash():
    # A one-digit year typo (1926 for 2026) must degrade to None, never raise
    # ZeroDivisionError/OverflowError through the holdings page.
    flows = [(date(1926, 8, 15), Decimal("-1000")), (date(2026, 8, 15), Decimal("5000"))]
    assert xirr(flows) is None


def test_same_day_flows_netting_to_zero_return_none():
    # Without the zero-span guard this would "converge" at the Newton seed (0.1).
    flows = [(date(2020, 1, 1), Decimal("-1000")), (date(2020, 1, 1), Decimal("1000"))]
    assert xirr(flows) is None


def test_xnpv_at_nonzero_rate_discounts_from_first_flow():
    flows = [(date(2020, 1, 1), -1000.0), (date(2021, 1, 1), 1000.0)]
    expected = -1000.0 + 1000.0 / 1.1 ** (366 / 365)
    assert abs(xnpv(0.1, flows) - expected) < 1e-9


def test_analytic_derivative_matches_central_difference():
    flows = [
        (date(2020, 1, 1), -1000.0),
        (date(2020, 9, 15), 250.0),
        (date(2021, 6, 1), 400.0),
        (date(2022, 3, 10), 700.0),
    ]
    h = 1e-6
    for rate in (-0.5, 0.0, 0.1, 2.0):
        numeric = (xnpv(rate + h, flows) - xnpv(rate - h, flows)) / (2 * h)
        assert abs(_dxnpv(rate, flows) - numeric) <= 1e-4 * max(1.0, abs(numeric))
