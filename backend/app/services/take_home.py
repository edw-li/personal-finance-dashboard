"""Exact monthly household take-home from the amounts entered for its members."""

from decimal import Decimal

from fastapi import HTTPException

from app.services.money import MONEY_MAX_ABS_12_2, quantize_money


def total_take_home(
    amounts: dict[int, Decimal], person_ids: set[int]
) -> tuple[dict[str, str], Decimal]:
    if not amounts:
        raise HTTPException(422, "Enter each person's take-home or clear the household take-home")
    unknown = sorted(set(amounts) - person_ids)
    if unknown:
        raise HTTPException(422, f"unknown person_id(s) in take-home: {unknown}")
    values = {}
    for person_id, amount in sorted(amounts.items()):
        value = quantize_money(
            amount, f"take-home[person_id={person_id}]", max_abs=MONEY_MAX_ABS_12_2
        )
        if value < 0:
            raise HTTPException(422, "Each person's take-home must be non-negative")
        values[str(person_id)] = format(value, ".2f")
    total = quantize_money(
        sum((Decimal(value) for value in values.values()), Decimal("0")),
        "household take-home",
        max_abs=MONEY_MAX_ABS_12_2,
    )
    return values, total
