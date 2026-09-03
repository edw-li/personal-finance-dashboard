"""The event model with money (2026-09-03 calendar spec §6). Pure — no DB, no HTTP, no
clock. `Event` is what every generator returns and what fold, overrides, the router, the
ICS renderer and the assistant all read; `key` is the ONE identity grammar."""

import re
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.models.calendar import DIRECTIONS, RECURRENCES

# The wire vocabulary: the nine v1 types plus the three card types. schemas/calendar.py's
# Literal and the frontend's CalendarEventType spell exactly these twelve.
EVENT_TYPES = (
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
)
# Seven derived families plus custom — the eight palette slots (spec §7 color rule).
SOURCE_FAMILIES = ("rsu", "espp", "dividend", "payroll", "tax", "card", "ritual", "custom")
TYPE_SOURCE: dict[str, str] = {
    "rsu_vest": "rsu",
    "espp_purchase": "espp",
    "espp_qualify": "espp",
    "offering_start": "espp",
    "ex_dividend": "dividend",
    "payday": "payroll",
    "tax_deadline": "tax",
    "update_due": "ritual",
    "custom": "custom",
    "card_fee": "card",
    "card_credit": "card",
    "card_anniversary": "card",
}
BASES = ("confirmed", "scheduled", "estimated")
# Only these two families fold (spec §7): a fee and a credit on one card the same day are
# two facts.
FOLDABLE_TYPES = ("rsu_vest", "payday")
# Types that carry a VALARM in ICS and a "Mark done" affordance in the drawer.
DEADLINE_TYPES = ("tax_deadline", "update_due", "card_fee")

# entity_ref: no colons, so the key's three fields split unambiguously; <= 60 chars so the
# whole key fits String(120). KEY_RE is the overrides router's path validator (spec §13).
ENTITY_REF_RE = re.compile(r"^[A-Za-z0-9._-]{1,60}$")
KEY_RE = re.compile(r"^[a-z]+:[A-Za-z0-9._-]{1,60}:\d{4}-\d{2}-\d{2}$")

SHORT_LABEL_MAX = 24
MONEY_QUANTUM = Decimal("0.01")
ZERO = Decimal("0")


def money(value: Decimal) -> Decimal:
    """2dp, half-up, signed zero collapsed — paycheck_calc.half_up2's posture: a PLAIN
    quantize, because a read must never trap on stored data."""
    return value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP) + ZERO


def shorten(text: str, limit: int = SHORT_LABEL_MAX) -> str:
    """A chip-sized label: the text itself when it fits, else a word-boundary cut plus an
    ellipsis, never longer than `limit`."""
    if len(text) <= limit:
        return text
    cut = text[: limit - 2]
    if " " in cut:
        cut = cut[: cut.rfind(" ")]
    return f"{cut.rstrip()} …"[:limit]


def key(source: str, entity_ref: str, day: date) -> str:
    """`<source>:<entity_ref>:<date>` — a pure function of source facts (an id, a date, a
    fixed word), never of a label, so a rename can never churn an ICS UID."""
    if not ENTITY_REF_RE.fullmatch(entity_ref):
        raise ValueError(f"entity_ref {entity_ref!r} must match {ENTITY_REF_RE.pattern}")
    return f"{source}:{entity_ref}:{day.isoformat()}"


@dataclass(frozen=True)
class Item:
    """One constituent of a folded event (a grant's tranche, a person's paycheck)."""

    label: str
    amount: Decimal | None
    person_id: int | None = None
    detail: str | None = None


@dataclass(frozen=True)
class Window:
    start: date
    end: date

    def contains(self, day: date) -> bool:
        return self.start <= day <= self.end

    def months(self) -> list[date]:
        """First-of-month dates for every month the window touches, ascending."""
        out: list[date] = []
        year, month = self.start.year, self.start.month
        while (year, month) <= (self.end.year, self.end.month):
            out.append(date(year, month, 1))
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        return out


@dataclass(frozen=True)
class Event:
    """One calendar entry. `event_date`, not `date` (the type would be shadowed); the WIRE
    field is `date`. `key` is stored, not derived from event_date: the ritual reminder is
    re-dated to today while overdue and its key must not move with it."""

    event_date: date
    type: str
    source: str
    entity_ref: str
    key: str
    label: str
    short_label: str
    detail: str | None
    amount: Decimal | None
    direction: str
    basis: str
    href: str | None
    items: tuple[Item, ...] = ()
    event_id: int | None = None  # custom rows only
    person_id: int | None = None  # custom rows only
    recurrence: str | None = None  # custom rows only, None when the row does not recur
    until: date | None = None
    series_start: date | None = None
    # --- the overlay (spec §13), applied by overrides.apply
    done: bool = False
    hidden: bool = False
    note: str | None = None
    amount_overridden: bool = False

    def __post_init__(self) -> None:
        if self.type not in EVENT_TYPES:
            raise ValueError(f"unknown event type {self.type!r}")
        if self.source != TYPE_SOURCE[self.type]:
            raise ValueError(f"{self.type} belongs to {TYPE_SOURCE[self.type]}, not {self.source}")
        if self.direction not in DIRECTIONS:
            raise ValueError(f"unknown direction {self.direction!r}")
        if self.basis not in BASES:
            raise ValueError(f"unknown basis {self.basis!r}")
        if self.recurrence is not None and self.recurrence not in RECURRENCES:
            raise ValueError(f"unknown recurrence {self.recurrence!r}")
        if not KEY_RE.fullmatch(self.key):
            raise ValueError(f"malformed key {self.key!r}")
        if len(self.short_label) > SHORT_LABEL_MAX:
            raise ValueError(f"short_label longer than {SHORT_LABEL_MAX}: {self.short_label!r}")


def make_event(
    event_date: date,
    type: str,
    entity_ref: str,
    label: str,
    short_label: str,
    *,
    detail: str | None = None,
    amount: Decimal | None = None,
    direction: str = "neutral",
    basis: str = "scheduled",
    href: str | None = None,
    items: tuple[Item, ...] = (),
    event_id: int | None = None,
    person_id: int | None = None,
    key_date: date | None = None,
    recurrence: str | None = None,
    until: date | None = None,
    series_start: date | None = None,
) -> Event:
    """The generators' constructor: derives `source` from the type and `key` from
    (source, entity_ref, key_date or event_date); quantizes the amount to cents."""
    source = TYPE_SOURCE.get(type)
    if source is None:
        raise ValueError(f"unknown event type {type!r}")
    return Event(
        event_date=event_date,
        type=type,
        source=source,
        entity_ref=entity_ref,
        key=key(source, entity_ref, key_date or event_date),
        label=label,
        short_label=short_label,
        detail=detail,
        amount=None if amount is None else money(amount),
        direction=direction,
        basis=basis,
        href=href,
        items=items,
        event_id=event_id,
        person_id=person_id,
        recurrence=recurrence,
        until=until,
        series_start=series_start,
    )
