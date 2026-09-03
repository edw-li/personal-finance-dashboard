"""Wire shapes for the calendar (2026-09-03 calendar spec §6 v2, additive over v1). Money
is a 2dp Decimal string on the wire; `null` amount = unknowable, never 0."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

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
    "card_fee",
    "card_credit",
    "card_anniversary",
]
CalendarSource = Literal["rsu", "espp", "dividend", "payroll", "tax", "card", "ritual", "custom"]
Direction = Literal["in", "out", "neutral"]
Basis = Literal["confirmed", "scheduled", "estimated"]
Recurrence = Literal["none", "weekly", "monthly", "yearly"]
HealthStatus = Literal["ok", "partial", "off"]


class CalendarItemOut(BaseModel):
    label: str
    amount: Decimal | None
    person_id: int | None
    detail: str | None


class CalendarEventOut(BaseModel):
    # `date: date` is safe in a pydantic body — an annotation-only statement never binds
    # the name, so the type still resolves.
    date: date
    type: CalendarEventType
    source: CalendarSource
    key: str  # "<source>:<entity_ref>:<date>" — stable identity, the ICS UID stem
    entity_ref: str
    label: str  # full sentence: drawer, list, ICS SUMMARY
    short_label: str  # ≤ 24 chars for the chip
    detail: str | None
    amount: Decimal | None  # 2dp; null = unknowable
    direction: Direction
    basis: Basis  # stored fact · stored parameter · quote or model
    items: list[CalendarItemOut]
    href: str | None
    id: int | None  # custom rows only
    person_id: int | None  # custom rows only
    recurrence: Recurrence | None  # custom rows that recur; the edit form needs the series
    until: date | None
    series_start: date | None
    done: bool  # overlay
    hidden: bool  # overlay — the list offers Unhide, the grid removes it before counting
    note: str | None  # overlay
    amount_overridden: bool  # overlay — "your figure"


class SourceHealthOut(BaseModel):
    """One line of the source-health footer (spec §3): which families are on, partial
    (producing with a named gap) or off (nothing configured)."""

    source: CalendarSource
    status: HealthStatus
    note: str | None


class CalendarOut(BaseModel):
    events: list[CalendarEventOut]
    sources: list[SourceHealthOut] = Field(default_factory=list)
    quote_as_of: datetime | None = None  # the employer quote every vest estimate rides


class CustomEventIn(BaseModel):
    """POST/PATCH body — full replace. The four money/recurrence fields default so v1
    clients (and every existing test body) stay valid."""

    date: date
    label: str = Field(min_length=1, max_length=120)
    detail: str | None = Field(default=None, max_length=300)
    # NULL = household. The bound mirrors the accounts router's: a garbage 10-digit value
    # 422s in the parser rather than reaching the FK.
    person_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    # `direction` carries the sign (in / out / neutral), so the figure is a MAGNITUDE: a
    # negative one would draw an "out" event as money arriving.
    amount: Decimal | None = Field(default=None, ge=0)
    direction: Direction = "neutral"
    recurrence: Recurrence = "none"
    until: date | None = None

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

    @model_validator(mode="after")
    def _until_needs_a_series(self) -> "CustomEventIn":
        if self.until is not None and self.recurrence == "none":
            raise ValueError("until requires a recurrence")
        if self.until is not None and self.until < self.date:
            raise ValueError("until must be on or after date")
        return self


class CustomEventOut(BaseModel):
    id: int
    date: date
    label: str  # as STORED — unstamped; the suffix is composed, never persisted
    detail: str | None
    person_id: int | None
    amount: Decimal | None
    direction: Direction
    recurrence: Recurrence
    until: date | None


class OverrideIn(BaseModel):
    """PUT body — full replace (spec §13)."""

    done: bool
    hidden: bool
    note: str | None = Field(default=None, max_length=300)
    # A magnitude, like CustomEventIn's: the generated event owns the direction, and "your
    # figure" replaces the estimate without flipping which way the money goes.
    amount: Decimal | None = Field(default=None, ge=0)

    @field_validator("note")
    @classmethod
    def _note_stripped(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class OverrideOut(OverrideIn):
    key: str
