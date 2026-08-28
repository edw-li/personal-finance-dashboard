"""Wire shapes for the contribution-limit registry (2026-08-27 spec §4.5).

Values cross the wire as pydantic Decimals — JSON strings — at the column scale,
Numeric(14,2). `value: null` on the way OUT means "not entered for this year"; `null`
inside a PUT's `values` map means "delete the row", which is the same tri-state the
spending months use.
"""

from decimal import Decimal

from pydantic import BaseModel


class LimitItemOut(BaseModel):
    """One definition and whatever the user has stored for it this year. `label` is the
    code's, never a stored string — the registry holds values only."""

    key: str
    label: str
    value: Decimal | None


class LimitsOut(BaseModel):
    year: int
    items: list[LimitItemOut]


class LimitsIn(BaseModel):
    # A PARTIAL map by design: a caller that only knows about two keys sends two, and the
    # rest keep whatever they had. Only an EXPLICIT null deletes — an omitted key is not
    # a request to clear anything.
    values: dict[str, Decimal | None]
