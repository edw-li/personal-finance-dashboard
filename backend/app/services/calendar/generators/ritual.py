"""The monthly-update reminder (2026-09-23 spec §T6; calendar spec §6 ritual row, §12).

One event per month U in the window, on U's reminder date, listing the parts of the monthly
update still PENDING for it — the two independent parts of the time model (spec §K3):

  - "{Oct 1} balances": pending while U's snapshot is missing or provisional (recorded early,
    never saved again on or after its 1st);
  - "{September} spending & take-home": pending while U−1's spending is not *entered* under
    K3's rule — missing, or partial because it was saved while September was still running — or
    its take-home is missing. The same rule answers a month that is still running, which is why
    a reminder ahead of its date already lists it.

No event when nothing is pending. While pending after its date the event is re-dated to today
(as before) with "Due since {Oct 1}", then "Overdue — {Oct 1} balances were due {Oct 1}; {September}
spending & take-home was due by {Oct 15}" as each part's own threshold passes (month_status's
thresholds: balances from the 7th, the flows from the 16th by default) — the spending named by its
grace deadline, as Needs attention, the ribbon and Budgets say it. The window is judged on the
EVENT's date, not its month: a month before the window whose reminder is re-dated to a today
inside it is still drawn, so a subscribed calendar keeps showing what is pending (controller
decision on the code review). The KEY never moves — `ritual:{YYYY-MM of U−1}:{nominal date}` —
so ICS UIDs and any done/snooze override keep attaching.

Why the rewrite: the old reminder ("enter M−1", suppressed once M−1's snapshot existed) could
never fire — that snapshot is made on M−1's own 1st, a month before its reminder — and it asked
for the wrong things. What is pending comes from the month status (services/month_status.py),
the rule GET /coverage answers, never a second derivation. Months before the book's first
snapshot are never pending (K3's windows start there); a book with no snapshot at all is asked
for its first balances.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from app.services.day_labels import month_name
from app.services.month_review import day_label, month_shift
from app.services.month_status import MonthStatus, balances_overdue_from, flows_overdue_from

from ..model import Event, Item, Window, make_event


@dataclass(frozen=True)
class _Part:
    """One pending part of U's update: its name, what it still lacks, its own threshold and its
    own deadline in words ("due Oct 1" for balances, "due by Oct 15" for the flows)."""

    label: str
    detail: str
    overdue_from: date
    plural: bool  # "Oct 1 balances were due" vs "September spending & take-home was due"
    due: str


def _first_month(status: MonthStatus | None) -> date | None:
    """The book's first snapshot month — where K3's windows begin — or None without one."""
    return status.snapshots[0].month if status is not None and status.snapshots else None


def _balances(month: date, status: MonthStatus | None, due_day: int, today: date) -> _Part | None:
    """U's balances, due on U's 1st: pending while missing or provisional — except a month before
    the adoption, whose early balances K4 never restamps (they stay provisional for good): the
    reminder does not nag about history, as `provisional_past` does not."""
    snapshot = None if status is None else status.snapshot(month)
    if snapshot is not None and not snapshot.provisional:
        return None
    if snapshot is not None and status is not None and status.before_adoption(month):
        return None
    first = _first_month(status)
    if first is not None and month < first:
        return None  # before the book began
    if snapshot is None:
        detail = "not recorded yet"
    elif snapshot.recorded_on is not None and snapshot.recorded_on < month:
        detail = f"recorded early, on {day_label(snapshot.recorded_on, today)} — update them"
    else:
        # Provisional only because its month is still ahead — an API client or an import.
        detail = "recorded ahead of their date — update them"
    return _Part(
        f"{day_label(month, today)} balances",
        detail,
        balances_overdue_from(month, due_day),
        True,
        f"due {day_label(month, today)}",
    )


def _flows(month: date, status: MonthStatus | None, due_day: int, today: date) -> _Part | None:
    """U−1's spending and take-home, due once U−1 has ended (spec §K3)."""
    ended = month_shift(month, -1)
    first = _first_month(status)
    if status is None or first is None or ended < first:
        return None
    spending = status.spending_state(ended)
    take_home = status.take_home_entered(ended)
    if spending == "entered" and take_home:
        return None
    name = month_name(ended, today.year)
    if spending == "missing":
        detail = "spending not entered" if take_home else "not entered"
    else:
        clauses = []
        if spending == "partial":
            clauses.append(f"entered during {name}; add what has posted since")
        if not take_home:
            clauses.append("take-home not entered")
        detail = " · ".join(clauses)
    overdue_from = flows_overdue_from(ended, due_day)
    # "Due by" = the day before the flows turn overdue (spec §K3's copy table).
    due_by = day_label(overdue_from - timedelta(days=1), today)
    return _Part(f"{name} spending & take-home", detail, overdue_from, False, f"due by {due_by}")


def _months(window: Window, status: MonthStatus | None) -> list[date]:
    """Every month whose reminder can land in the window: the window's own, and — back to the
    book's first snapshot month — the earlier ones, whose pending reminders are re-dated to today
    (no month after the window can land in it: its date is later, or today is)."""
    months = window.months()
    first = _first_month(status)
    if first is None or first >= months[0]:
        return months
    earlier, month = [], first
    while month < months[0]:
        earlier.append(month)
        month = month_shift(month, 1)
    return earlier + months


def ritual_events(
    window: Window, today: date, due_day: int, status: MonthStatus | None
) -> list[Event]:
    events: list[Event] = []
    for month in _months(window, status):
        nominal = date(month.year, month.month, due_day)
        parts = [
            part
            for part in (
                _balances(month, status, due_day, today),
                _flows(month, status, due_day, today),
            )
            if part is not None
        ]
        if not parts:
            continue
        redated = nominal < today
        event_date = today if redated else nominal
        if not window.contains(event_date):
            continue
        detail = None
        if redated:
            overdue = [part for part in parts if today >= part.overdue_from]
            if overdue:
                # Each part with its own deadline (controller decision on the code review): the
                # balances were due on their 1st, the spending by its grace day.
                clauses = [f"{p.label} {'were' if p.plural else 'was'} {p.due}" for p in overdue]
                detail = f"Overdue — {'; '.join(clauses)}"
            else:
                detail = f"Due since {day_label(month, today)}"
        events.append(
            make_event(
                event_date,
                "update_due",
                month_shift(month, -1).strftime("%Y-%m"),
                "Monthly update — " + " · ".join(part.label for part in parts),
                "Monthly update",
                detail=detail,
                basis="scheduled",
                href="/update",
                key_date=nominal,
                items=tuple(Item(part.label, None, None, part.detail) for part in parts),
            )
        )
    return events
