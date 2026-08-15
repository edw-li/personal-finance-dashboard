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


def quantize_money(value: Decimal, field: str, max_abs: Decimal = MONEY_MAX_ABS) -> Decimal:
    # Pre-check BEFORE quantize: pydantic accepts huge finite Decimals ("1e26") whose
    # quantize() raises InvalidOperation, and NaN comparisons raise too — either would
    # surface as a 500 instead of this module's promised 422.
    if not value.is_finite() or value.copy_abs() >= max_abs:
        raise HTTPException(
            status_code=422,
            detail=f"{field}: |value| must be below 10^{max_abs.adjusted()}",
        )
    quantized = value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    if quantized.copy_abs() >= max_abs:  # rounding can cross the bound
        raise HTTPException(
            status_code=422,
            detail=f"{field}: |value| must be below 10^{max_abs.adjusted()}",
        )
    return quantized


def quantize_pct(value: Decimal) -> Decimal:
    return value.quantize(PCT_QUANTUM, rounding=ROUND_HALF_UP)


def require_first_of_month(month: date) -> date:
    if month.day != 1:
        raise HTTPException(
            status_code=422, detail="month must be the first of the month (YYYY-MM-01)"
        )
    return month


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
