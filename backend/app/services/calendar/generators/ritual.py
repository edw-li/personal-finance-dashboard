"""The monthly-update reminder (spec §6 ritual row, §12): one event per month in the
window on the configured due day, for the PREVIOUS month; suppressed once that month's
snapshot exists; re-dated to today while overdue with its key unchanged."""

from datetime import date

from ..model import Event, Window, make_event

_MONTH_NAMES = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)  # our own literal — calendar.month_name is locale-dependent


def _previous_month(month: date) -> date:
    return date(month.year - 1, 12, 1) if month.month == 1 else date(month.year, month.month - 1, 1)


def ritual_events(
    window: Window, today: date, due_day: int, entered_months: set[date]
) -> list[Event]:
    events: list[Event] = []
    for month in window.months():
        nominal = date(month.year, month.month, due_day)
        previous = _previous_month(month)
        if previous in entered_months:
            continue
        overdue = nominal < today
        event_date = today if overdue else nominal
        if not window.contains(event_date):
            continue
        name = f"{_MONTH_NAMES[previous.month - 1]} {previous.year}"
        events.append(
            make_event(
                event_date,
                "update_due",
                previous.strftime("%Y-%m"),
                f"Monthly update — enter {name}",
                "Monthly update",
                detail=(
                    f"Overdue — was due {nominal.isoformat()}"
                    if overdue
                    else f"Enter {name} balances and spending"
                ),
                basis="scheduled",
                href="/update",
                key_date=nominal,
            )
        )
    return events
