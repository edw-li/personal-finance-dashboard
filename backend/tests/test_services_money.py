from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.services.money import mom_pct, quantize_money, require_first_of_month


def test_quantize_money_half_up():
    # PG rounds half-away-from-zero; Python's default quantize is banker's — must match PG.
    assert quantize_money(Decimal("2.665"), "x") == Decimal("2.67")
    assert quantize_money(Decimal("-2.665"), "x") == Decimal("-2.67")
    assert quantize_money(Decimal("100"), "x") == Decimal("100.00")


def test_quantize_money_bounds():
    assert quantize_money(Decimal("999999999999.99"), "x") == Decimal("999999999999.99")
    with pytest.raises(HTTPException) as exc:
        quantize_money(Decimal("1000000000000.00"), "balance[account_id=3]")
    assert exc.value.status_code == 422
    assert "balance[account_id=3]" in exc.value.detail
    with pytest.raises(HTTPException):
        quantize_money(Decimal("-1000000000000.00"), "x")


def test_require_first_of_month():
    assert require_first_of_month(date(2026, 8, 1)) == date(2026, 8, 1)
    with pytest.raises(HTTPException) as exc:
        require_first_of_month(date(2026, 8, 14))
    assert exc.value.status_code == 422


def test_mom_pct():
    assert mom_pct(Decimal("110"), Decimal("100")) == Decimal("0.100000")
    # Signed denominator: liability moving toward zero is an improvement -> positive pct.
    assert mom_pct(Decimal("-50"), Decimal("-100")) == Decimal("0.500000")
    assert mom_pct(Decimal("100"), Decimal("0")) is None
    assert mom_pct(Decimal("100"), None) is None
    # 6 dp, HALF_UP
    assert mom_pct(Decimal("1.0000005"), Decimal("1")) == Decimal("0.000001")
