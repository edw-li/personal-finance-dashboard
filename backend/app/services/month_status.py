"""Month status — the monthly update's two parts, due and overdue (2026-09-23 spec §K3,
§0.4(c)).

The routine has two INDEPENDENT parts (the user's time-model decision): the balances on a
month's 1st, due that day, and an ended month's spending and take-home, due once it is over and
entered whenever its charges have posted — often days later. This module says, for any day, what
each part's state is and when it turns overdue. `GET /coverage` serializes it as `time`;
coverage's "missing" windows end at its newest overdue month (`overdue_through`); the budget seed
leaves incomplete months out (K6); lane T's reminder and health checks ask it per month
(`MonthStatus.spending_state`, the thresholds).

An ended month's SPENDING is missing, partial or entered (review C1). *Missing*: no non-zero
amount and no confirmed zero. Otherwise *entered* when any of these holds, *partial* when none
does:
  (a) certified — the month was ever closed, or it is before the adoption month;
  (b) no row-level `monthly_spending` write for it is on record — history from before the log
      began (prod's starts 2026-09-04), import-only months (an import logs one summary line
      with no month), rows past the 400-day retention, any restored copy (the log is not
      exported);
  (c) a `ui` spending write for it dated on or after the next month's 1st in product time, from
      a batch never undone (undo batches never count);
  (d) a `ui` month-review write for it dated on or after the next 1st whose after-image has
      `spending_reviewed = true` ("Confirm {September} spending is complete"), or an import or
      restore summary line dated on or after the next 1st.
Rent saved on Sep 7 leaves September *partial* from Oct 1 until it is saved again after it ends
or confirmed. A take-home save never completes spending, and an unchanged save logs nothing
(ChangeBatch.record), which is why the explicit confirm exists. The change log and not the
review flags: the flags hold only while the month's digest is unchanged and every PUT resets
them (services/month_review.py), so a late charge or an Undo would silently bring the to-do
back; a change-log row is a one-time event later edits cannot erase, and nothing here writes a
flag.

Thresholds are date arithmetic from the reminder day (`calendar_update_due_day`, default 1):
balances are overdue from the reminder date + 6 days, capped at the month's last day (a reminder
day of 23-28 still turns them amber inside their own month); flows from the NEXT month's
reminder date + 15 days (default: the 16th).
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting
from app.schemas.coverage import BalancesPartOut, FlowsPartOut, TimeStatusOut
from app.services.month_review import month_shift
from app.services.snapshot_state import SnapshotState, current_and_previous, state_out

SpendingState = Literal["missing", "partial", "entered"]

DEFAULT_UPDATE_DUE_DAY = 1
MAX_UPDATE_DUE_DAY = 28  # every month has a 28th — the reminder can never miss a month
BALANCES_GRACE_DAYS = 6
FLOWS_GRACE_DAYS = 15


async def read_update_due_day(db: AsyncSession) -> int:
    """app_settings['calendar_update_due_day'] envelope {"value": 1..28}; any unexpected shape
    falls back to the default (get_swr_pct's posture). Lives here since 2026-09-24 (spec §K3: a
    service may not import a router); api/app_settings.py re-exports it for its importers."""
    setting = await db.get(AppSetting, "calendar_update_due_day")
    if setting is None or not isinstance(setting.value, dict):
        return DEFAULT_UPDATE_DUE_DAY
    raw = setting.value.get("value")
    if isinstance(raw, bool) or not isinstance(raw, int):
        return DEFAULT_UPDATE_DUE_DAY
    return raw if 1 <= raw <= MAX_UPDATE_DUE_DAY else DEFAULT_UPDATE_DUE_DAY


def reminder_date(month: date, reminder_day: int) -> date:
    return date(month.year, month.month, reminder_day)


def balances_overdue_from(month: date, reminder_day: int) -> date:
    """Unsaved or provisional balances for `month` are amber from here (default: the 7th)."""
    last_day = month_shift(month, 1) - timedelta(days=1)
    return min(reminder_date(month, reminder_day) + timedelta(days=BALANCES_GRACE_DAYS), last_day)


def flows_overdue_from(month: date, reminder_day: int) -> date:
    """`month`'s spending and take-home are amber from here (default: the 16th of the next)."""
    return reminder_date(month_shift(month, 1), reminder_day) + timedelta(days=FLOWS_GRACE_DAYS)


def overdue_through(today: date, reminder_day: int) -> date:
    """The newest month whose flows are overdue today — where coverage's "missing" windows end
    (spec §K3). At most three steps back: with a day-28 reminder, August is overdue on Oct 13."""
    month = month_shift(today.replace(day=1), -1)
    while flows_overdue_from(month, reminder_day) > today:
        month = month_shift(month, -1)
    return month


@dataclass(frozen=True)
class SpendingEvidence:
    """What the change log proves about the candidate months (clauses b-d)."""

    written: frozenset[date] = frozenset()  # months with ANY row-level spending write
    # month -> product date of its newest counted `ui` spending write (clause c)
    saved_on: Mapping[date, date] = field(default_factory=dict)
    # month -> product date of its newest counted confirm (clause d)
    confirmed_on: Mapping[date, date] = field(default_factory=dict)
    # the newest import/restore summary line from the earliest candidate's next 1st on
    newest_summary: date | None = None


@dataclass(frozen=True)
class MonthStatus:
    """The monthly update's state on `today`, from rows already read (load_month_status)."""

    today: date
    reminder_day: int
    snapshots: tuple[SnapshotState, ...]  # ascending by month
    spending: frozenset[date]  # a non-zero amount or a confirmed zero
    take_home: frozenset[date]  # a take-home row (0.00 counts)
    closed: frozenset[date]  # closed_at set — closed now or at some point
    adopted_on: date | None
    last_complete_month: date | None  # the review book's default_month
    empty_book: bool  # no snapshot, no spending row and no take-home row at all
    evidence: SpendingEvidence = SpendingEvidence()

    @property
    def current_month(self) -> date:
        return self.today.replace(day=1)

    def is_legacy(self, month: date) -> bool:
        """Before the adoption month: history the review feature adopted."""
        return self.adopted_on is not None and month < self.adopted_on.replace(day=1)

    def certified(self, month: date) -> bool:
        """Clause (a): the user already vouched for this month's spending."""
        return month in self.closed or self.is_legacy(month)

    def candidates(self) -> list[date]:
        """The months the change log must be asked about: spending present, not certified. The
        running month is one of them — T6's reminder asks about it ahead of time, and clause
        (b) needs the log for it."""
        return sorted(month for month in self.spending if not self.certified(month))

    def spending_state(self, month: date) -> SpendingState:
        """K3's rule for any month — an ended one, or one still running (then only (a) or (b)
        can make it entered)."""
        if month not in self.spending:
            return "missing"
        if self.certified(month) or month not in self.evidence.written:
            return "entered"  # (a) certified, (b) no spending write on record
        after = month_shift(month, 1)
        for day in (
            self.evidence.saved_on.get(month),  # (c) saved after the month ended
            self.evidence.confirmed_on.get(month),  # (d) confirmed after it
            self.evidence.newest_summary,  # (d) an import or a restore after it
        ):
            if day is not None and day >= after:
                return "entered"
        return "partial"

    def take_home_entered(self, month: date) -> bool:
        return month in self.take_home

    def snapshot(self, month: date) -> SnapshotState | None:
        return next((state for state in self.snapshots if state.month == month), None)

    def flows_part(self, month: date) -> FlowsPartOut:
        state = self.spending_state(month)
        overdue_from = flows_overdue_from(month, self.reminder_day)
        return FlowsPartOut(
            month=month,
            spending=state,
            spending_entered=state == "entered",
            spending_saved_on=self.evidence.saved_on.get(month),
            take_home_entered=self.take_home_entered(month),
            due_on=month_shift(month, 1),
            overdue_from=overdue_from,
            overdue=self.today >= overdue_from,
        )

    def ended_months(self) -> list[date]:
        """Every month from the first snapshot's through the one before the current month."""
        if not self.snapshots:
            return []
        months, month = [], self.snapshots[0].month
        while month < self.current_month:
            months.append(month)
            month = month_shift(month, 1)
        return months

    def time(self) -> TimeStatusOut | None:
        """The wire form (spec §0.4(c)); None only on an empty book."""
        if self.empty_book:
            return None
        current, previous = current_and_previous(self.snapshots, self.today)
        this_month = self.snapshot(self.current_month)
        status: Literal["final", "provisional", "missing"] = (
            "missing"
            if this_month is None
            else "provisional"
            if this_month.provisional
            else "final"
        )
        overdue_from = balances_overdue_from(self.current_month, self.reminder_day)
        parts = (self.flows_part(month) for month in reversed(self.ended_months()))
        return TimeStatusOut(
            today=self.today,
            current_month=self.current_month,
            reminder_day=self.reminder_day,
            current_snapshot=None if current is None else state_out(current),
            previous_snapshot=None if previous is None else state_out(previous),
            balances=BalancesPartOut(
                month=self.current_month,
                status=status,
                due_on=self.current_month,
                overdue_from=overdue_from,
                overdue=status != "final" and self.today >= overdue_from,
                snapshot=None if this_month is None else state_out(this_month),
            ),
            flows_due=[p for p in parts if p.spending != "entered" or not p.take_home_entered],
            provisional_past=[
                state_out(state)
                for state in reversed(self.snapshots)
                if state.month < self.current_month
                and state.provisional
                and not self.is_legacy(state.month)
            ],
            last_complete_month=self.last_complete_month,
        )
