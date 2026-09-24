"""The monthly-update reminder (2026-09-23 spec §T6; calendar spec §6 ritual row, §12).

One event per month U on U's reminder date, listing the parts of the monthly update still
PENDING for it — the two independent parts of the time model (spec §K3): "{Oct 1} balances" (U's)
and "{September} spending & take-home" (U−1's).

What is pending is what the month status (services/month_status.py) itself LISTS — the rule GET
/coverage answers, never a second derivation (lane T code review, controller decision (a)): this
month's balances part unless final; `provisional_past`, a past 1st recorded early and never saved
again on or after it; and `flows_due`, an ended month whose spending is not *entered* under K3's
rule — missing, or partial because it was saved while the month was still running — or whose
take-home is missing. None of it before the month-review ADOPTION month: legacy history does not
nag, the reviewed era starts at adoption. A past 1st whose balances were never recorded is a gap
in the history, not a to-do — K asks only for this month's. Months still ahead are the schedule:
their parts follow the same per-month rules (K's `snapshot`, `spending_state`,
`take_home_entered`), which answer a month still running — why a reminder ahead of its date
already lists it. A book with no snapshot, spending or take-home at all is asked for its first
balances: this month's.

No event when nothing is pending. While pending after its date the event is re-dated to today
(as before) with "Due since {Oct 1}", then "Overdue — {Oct 1} balances were due {Oct 1}; {September}
spending & take-home was due by {Oct 15}" as each part's own threshold passes (month_status's
thresholds: balances from the 7th, the flows from the 16th by default) — the spending named by its
grace deadline, as Needs attention, the ribbon and Budgets say it. The window is judged on the
EVENT's date, not its month: a pending month before the window whose reminder is re-dated to a
today inside it is still drawn, so a subscribed calendar keeps showing what is pending (controller
decision on the code review, minor 1). The KEY never moves — `ritual:{YYYY-MM of U−1}:{nominal
date}` — so ICS UIDs and any done/snooze override keep attaching.

Why the rewrite: the old reminder ("enter M−1", suppressed once M−1's snapshot existed) could
never fire — that snapshot is made on M−1's own 1st, a month before its reminder — and it asked
for the wrong things.
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


@dataclass(frozen=True)
class _Pending:
    """What the month status lists as pending (controller decision (a)): the 1sts whose balances
    are asked for, and the ended months whose spending & take-home are."""

    balances: frozenset[date]
    flows: frozenset[date]


def _pending(status: MonthStatus | None, today: date) -> _Pending:
    """K's own lists, read off `MonthStatus.time()`: this month's balances part unless final,
    `provisional_past` and `flows_due` — none of them before the adoption month (K's
    `before_adoption`: legacy history does not nag; `provisional_past` already leaves its early
    balances out, which K4 never restamps). An empty book has no time status: it is asked for its
    first balances, this month's."""
    time = None if status is None else status.time()
    if status is None or time is None:
        return _Pending(frozenset({today.replace(day=1)}), frozenset())
    balances = {state.month for state in time.provisional_past}
    if time.balances.status != "final":
        balances.add(time.balances.month)
    flows = {part.month for part in time.flows_due}
    return _Pending(
        frozenset(month for month in balances if not status.before_adoption(month)),
        frozenset(month for month in flows if not status.before_adoption(month)),
    )


def _first_month(status: MonthStatus | None) -> date | None:
    """The book's first snapshot month — where K3's windows begin — or None without one."""
    return status.snapshots[0].month if status is not None and status.snapshots else None


def _balances(month: date, status: MonthStatus | None, due_day: int, today: date) -> _Part | None:
    """U's balances, due on U's 1st — asked for because K lists them (this month's, or a past 1st
    recorded early), or because U is still ahead (the schedule): missing, or provisional."""
    snapshot = None if status is None else status.snapshot(month)
    if snapshot is not None and not snapshot.provisional:
        return None
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


def _months(window: Window, pending: _Pending) -> list[date]:
    """Every month whose reminder can land in the window: the window's own, and each month K lists
    as pending — before the window, its reminder is re-dated to a today that may be inside it
    (window membership follows the EVENT's date, review minor 1)."""
    listed = pending.balances | {month_shift(month, 1) for month in pending.flows}
    return sorted(set(window.months()) | listed)


def ritual_events(
    window: Window, today: date, due_day: int, status: MonthStatus | None
) -> list[Event]:
    pending = _pending(status, today)
    current = today.replace(day=1)
    events: list[Event] = []
    for month in _months(window, pending):
        nominal = date(month.year, month.month, due_day)
        ended = month_shift(month, -1)
        # Up to this month the month status says what is pending — its lists, adoption-filtered;
        # past them, the schedule: the same per-month rules answer a month not yet due.
        parts = [
            part
            for part in (
                _balances(month, status, due_day, today)
                if month in pending.balances or month > current
                else None,
                _flows(month, status, due_day, today)
                if ended in pending.flows or ended >= current
                else None,
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
