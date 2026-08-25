"""Wire shapes for GET /calendar (2026-08-24 spec §5). No money fields in v1 — labels
and details carry share counts and prices as plain text, so there is nothing to
Decimal-serialize here."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

CalendarEventType = Literal[
    "rsu_vest",
    "espp_purchase",
    "espp_qualify",
    "ex_dividend",
    "payday",
    "offering_start",
    "tax_deadline",
    "update_due",
    "custom",
]


class CalendarEventOut(BaseModel):
    # `date: date` is safe in a pydantic body — an annotation-only statement never binds
    # the name, so the type still resolves. (The SQLAlchemy models rename to *_date
    # because mapped_column ASSIGNS; that hazard does not exist here.)
    date: date
    type: CalendarEventType
    label: str
    detail: str | None
    href: str | None  # null for custom events — they have no page (spec §9.3)
    id: int | None  # set only for custom events, the frontend's edit/delete handle


class CalendarOut(BaseModel):
    events: list[CalendarEventOut]


class CustomEventIn(BaseModel):
    """POST/PATCH body — full replace: the form always submits all three fields."""

    date: date
    label: str = Field(min_length=1, max_length=120)
    detail: str | None = Field(default=None, max_length=300)

    @field_validator("label")
    @classmethod
    def _label_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("label must not be blank")
        return stripped

    @field_validator("detail")
    @classmethod
    def _detail_stripped(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class CustomEventOut(BaseModel):
    id: int
    date: date
    label: str
    detail: str | None
