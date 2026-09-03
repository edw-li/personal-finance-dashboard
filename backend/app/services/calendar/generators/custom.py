"""User-entered rows (spec §6 custom row): stored money, expanded by their recurrence.
`key = custom:<id>:<occurrence>`; a tagged row wears the person suffix on its label."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from ..model import Event, Window, make_event, shorten
from ..recurrence import expand
from .payroll import person_suffix


@dataclass(frozen=True)
class CustomRow:
    """One stored custom event plus the owner's NAME, resolved by the router — this module
    never reads a person row."""

    event_id: int
    event_date: date
    label: str
    detail: str | None
    person_id: int | None = None
    person_name: str | None = None
    amount: Decimal | None = None
    direction: str = "neutral"
    recurrence: str = "none"
    until: date | None = None


def custom_events(rows: list[CustomRow], window: Window) -> list[Event]:
    events: list[Event] = []
    for row in rows:
        label = row.label if row.person_name is None else row.label + person_suffix(row.person_name)
        recurring = row.recurrence != "none"
        for occurrence in expand(row.recurrence, row.event_date, row.until, window):
            events.append(
                make_event(
                    occurrence,
                    "custom",
                    str(row.event_id),
                    label,
                    shorten(label),
                    detail=row.detail,
                    amount=row.amount,
                    direction=row.direction,
                    basis="confirmed",
                    href=None,
                    event_id=row.event_id,
                    person_id=row.person_id,
                    recurrence=row.recurrence if recurring else None,
                    until=row.until if recurring else None,
                    series_start=row.event_date if recurring else None,
                )
            )
    return events
