"""Shared money/percent/month guards for the API layer.

Raises HTTPException(422) directly — these ARE the API's validation vocabulary; keeping
the message format here means every router reports bad values identically.
"""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException

MONEY_QUANTUM = Decimal("0.01")
PCT_QUANTUM = Decimal("0.000001")
# Per-column-family bounds (over-scale values otherwise surface as bare DBAPIError
# sqlstate 22003 — Plan 1 forward note). NUMERIC precision counts TOTAL digits:
# Numeric(14,2) keeps 12 integer digits, Numeric(12,2) keeps only 10.
MONEY_MAX_ABS = Decimal(10) ** 12  # Numeric(14,2): account balances
MONEY_MAX_ABS_12_2 = Decimal(10) ** 10  # Numeric(12,2): spending amounts, net_pay
MONEY_MAX_ABS_8_2 = Decimal(10) ** 6  # Numeric(8,2): card annual fees / credit values
SHARE_QUANTUM = Decimal("0.000001")
PRICE_QUANTUM = Decimal("0.0001")
MONEY_MAX_ABS_10_2 = Decimal(10) ** 8  # Numeric(10,2): transaction fees
MONEY_MAX_ABS_16_6 = Decimal(10) ** 10  # Numeric(16,6): transaction shares
MONEY_MAX_ABS_14_4 = Decimal(10) ** 10  # Numeric(14,4): prices
MONEY_MAX_ABS_10_4 = Decimal(10) ** 6  # Numeric(10,4): split factors, annual dividends


def _quantize_bounded(value: Decimal, field: str, quantum: Decimal, max_abs: Decimal) -> Decimal:
    # Pre-check BEFORE quantize: pydantic accepts huge finite Decimals ("1e26") whose
    # quantize() raises InvalidOperation, and NaN comparisons raise too — either would
    # surface as a 500 instead of this module's promised 422.
    if not value.is_finite() or value.copy_abs() >= max_abs:
        raise HTTPException(
            status_code=422,
            detail=f"{field}: |value| must be below 10^{max_abs.adjusted()}",
        )
    quantized = value.quantize(quantum, rounding=ROUND_HALF_UP)
    if quantized.copy_abs() >= max_abs:  # rounding can cross the bound
        raise HTTPException(
            status_code=422,
            detail=f"{field}: |value| must be below 10^{max_abs.adjusted()}",
        )
    return quantized


def quantize_money(value: Decimal, field: str, max_abs: Decimal = MONEY_MAX_ABS) -> Decimal:
    return _quantize_bounded(value, field, MONEY_QUANTUM, max_abs)


def quantize_shares(value: Decimal, field: str) -> Decimal:
    return _quantize_bounded(value, field, SHARE_QUANTUM, MONEY_MAX_ABS_16_6)


def quantize_price(value: Decimal, field: str, max_abs: Decimal = MONEY_MAX_ABS_14_4) -> Decimal:
    return _quantize_bounded(value, field, PRICE_QUANTUM, max_abs)


def quantize_pct(value: Decimal) -> Decimal:
    return value.quantize(PCT_QUANTUM, rounding=ROUND_HALF_UP)


def require_first_of_month(month: date) -> date:
    if month.day != 1:
        raise HTTPException(
            status_code=422, detail="month must be the first of the month (YYYY-MM-01)"
        )
    return month


DATE_MIN = date(1900, 1, 1)
DATE_MAX = date(2100, 12, 31)


def require_reasonable_date(value: date, field: str) -> date:
    """Century-bounded sanity guard: a mistyped year (1026, 3026) must 422 at the API
    boundary, not surface as absurd spans in XIRR/day-Δ/refresh windows downstream."""
    if not DATE_MIN <= value <= DATE_MAX:
        raise HTTPException(
            status_code=422,
            detail=f"{field}: date must be between {DATE_MIN} and {DATE_MAX}",
        )
    return value


def mom_pct(curr: Decimal, prev: Decimal | None) -> Decimal | None:
    """(curr - prev) / |prev|; None when prev is missing or zero.

    Signed denominator so the result's sign always matches net-worth impact —
    a liability balance rising toward zero reads as a positive change.
    Assumes API-bounded inputs (|values| < 10^12 at 2dp); ratios beyond ~1e20
    would exceed the default 28-digit Decimal context.
    """
    if prev is None or prev == 0:
        return None
    return quantize_pct((curr - prev) / prev.copy_abs())
