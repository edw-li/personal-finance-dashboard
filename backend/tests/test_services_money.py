from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.services.money import (
    MONEY_MAX_ABS_10_4,
    MONEY_MAX_ABS_12_2,
    mom_pct,
    quantize_money,
    quantize_price,
    quantize_shares,
    require_first_of_month,
    require_reasonable_date,
)


def test_quantize_money_half_up():
    # PG rounds half-away-from-zero; Python's default quantize is banker's — must match PG.
    assert quantize_money(Decimal("2.665"), "x") == Decimal("2.67")
    assert quantize_money(Decimal("-2.665"), "x") == Decimal("-2.67")
    assert quantize_money(Decimal("100"), "x") == Decimal("100.00")
    # Exponent pinned, not just value: pydantic serializes "100.00", never "100".
    assert str(quantize_money(Decimal("100"), "x")) == "100.00"


def test_quantize_money_bounds():
    assert quantize_money(Decimal("999999999999.99"), "x") == Decimal("999999999999.99")
    with pytest.raises(HTTPException) as exc:
        quantize_money(Decimal("1000000000000.00"), "balance[account_id=3]")
    assert exc.value.status_code == 422
    assert "balance[account_id=3]" in exc.value.detail
    with pytest.raises(HTTPException):
        quantize_money(Decimal("-1000000000000.00"), "x")
    with pytest.raises(HTTPException):
        quantize_money(Decimal("999999999999.996"), "x")  # rounding crosses the bound
    with pytest.raises(HTTPException):
        quantize_money(Decimal("1e26"), "x")  # pydantic-accepted; quantize() would raise
    with pytest.raises(HTTPException):
        quantize_money(Decimal("NaN"), "x")  # comparisons on NaN raise without the guard
    # Numeric(12,2) family (spending amounts, net_pay): only 10 integer digits fit.
    assert quantize_money(Decimal("9999999999.99"), "x", max_abs=MONEY_MAX_ABS_12_2) == Decimal(
        "9999999999.99"
    )
    with pytest.raises(HTTPException) as exc:
        quantize_money(Decimal("10000000000"), "net_pay", max_abs=MONEY_MAX_ABS_12_2)
    assert "10^10" in exc.value.detail


def test_quantize_shares_rounds_half_up_to_6dp():
    assert quantize_shares(Decimal("1.0000005"), "shares") == Decimal("1.000001")


def test_quantize_shares_rejects_out_of_bounds():
    with pytest.raises(HTTPException) as exc:
        quantize_shares(Decimal("1e10"), "shares")
    assert exc.value.status_code == 422
    assert "shares" in exc.value.detail


def test_quantize_price_rounds_half_up_to_4dp():
    assert quantize_price(Decimal("710.17005"), "price") == Decimal("710.1701")
    # rounding may cross the bound — still 422
    with pytest.raises(HTTPException):
        quantize_price(Decimal("9999999999.99999"), "price")


def test_quantize_price_honors_custom_bound():
    with pytest.raises(HTTPException):
        quantize_price(Decimal("1000000"), "split_factor", max_abs=MONEY_MAX_ABS_10_4)
    assert quantize_price(Decimal("3"), "split_factor", max_abs=MONEY_MAX_ABS_10_4) == Decimal(
        "3.0000"
    )


def test_quantize_shares_rejects_non_finite():
    with pytest.raises(HTTPException):
        quantize_shares(Decimal("NaN"), "shares")


def test_require_first_of_month():
    assert require_first_of_month(date(2026, 8, 1)) == date(2026, 8, 1)
    with pytest.raises(HTTPException) as exc:
        require_first_of_month(date(2026, 8, 14))
    assert exc.value.status_code == 422


def test_require_reasonable_date_bounds():
    assert require_reasonable_date(date(1900, 1, 1), "d") == date(1900, 1, 1)
    assert require_reasonable_date(date(2100, 12, 31), "d") == date(2100, 12, 31)
    for bad in (date(1899, 12, 31), date(2101, 1, 1)):
        with pytest.raises(HTTPException) as exc:
            require_reasonable_date(bad, "ex_div_date")
        assert exc.value.status_code == 422
        assert "ex_div_date" in exc.value.detail


def test_mom_pct():
    assert mom_pct(Decimal("110"), Decimal("100")) == Decimal("0.100000")
    # Signed denominator: liability moving toward zero is an improvement -> positive pct.
    assert mom_pct(Decimal("-50"), Decimal("-100")) == Decimal("0.500000")
    assert mom_pct(Decimal("100"), Decimal("0")) is None
    assert mom_pct(Decimal("100"), None) is None
    # 6 dp, HALF_UP
    assert mom_pct(Decimal("1.0000005"), Decimal("1")) == Decimal("0.000001")
