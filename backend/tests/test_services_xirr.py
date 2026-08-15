"""XIRR golden tests. The 5-flow case is Microsoft's documented XIRR example
(expected 0.373362535); the 2-flow cases have closed-form solutions."""

from datetime import date
from decimal import Decimal

from app.services.xirr import xirr, xnpv


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


def test_unordered_input_is_sorted_internally():
    flows = [(date(2021, 1, 1), Decimal("1100")), (date(2020, 1, 1), Decimal("-1000"))]
    assert xirr(flows) is not None


def test_xnpv_at_zero_rate_is_plain_sum():
    flows = [(date(2020, 1, 1), -1000.0), (date(2021, 6, 1), 400.0)]
    assert abs(xnpv(0.0, flows) - (-600.0)) < 1e-9
