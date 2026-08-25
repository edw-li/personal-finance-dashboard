"""Wire shapes for GET /calendar (2026-08-24 spec §5). No money fields in v1 — labels
and details carry share counts and prices as plain text, so there is nothing to
Decimal-serialize here."""

from datetime import date
from typing import Literal

from pydantic import BaseModel

CalendarEventType = Literal[
    "rsu_vest",
    "espp_purchase",
    "espp_qualify",
    "ex_dividend",
    "payday",
    "offering_start",
    "tax_deadline",
    "update_due",
]


class CalendarEventOut(BaseModel):
    # `date: date` is safe in a pydantic body — an annotation-only statement never binds
    # the name, so the type still resolves. (The SQLAlchemy models rename to *_date
    # because mapped_column ASSIGNS; that hazard does not exist here.)
    date: date
    type: CalendarEventType
    label: str
    detail: str | None
    href: str


class CalendarOut(BaseModel):
    events: list[CalendarEventOut]
