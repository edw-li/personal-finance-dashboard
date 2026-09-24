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
      `spending_reviewed = true` and whose batch wrote nothing else for that month — the
      wizard's "Confirm {September} spending is complete", a PUT with no legs — or an import or
      restore summary line dated on or after the next 1st. A save that carries a still-ticked
      box writes its spending, take-home or balances rows beside the review row, so it is not a
      confirmation: a spending change counts under (c) by its own date, a close under (a), and a
      take-home save counts for nothing.
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

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import Date, and_, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting, ChangeLog
from app.schemas.coverage import BalancesPartOut, FlowsPartOut, TimeStatusOut
from app.services import clock
from app.services.changelog import undone_by
from app.services.month_review import ReviewBook, month_shift
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


# --- the database-facing half: the evidence query and the loader ---

SPENDING_TABLE = "monthly_spending"
REVIEW_TABLE = "month_reviews"
SUMMARY_SOURCES = ("import", "restore")


def _product_day(stamp):
    """`(at AT TIME ZONE 'America/Los_Angeles')::date` — the day the product clock showed."""
    return cast(func.timezone(clock.PRODUCT_TIMEZONE, stamp), Date)


def _midnight(day: date) -> datetime:
    """The first instant of `day` in the product zone — a bound the `at` index can serve."""
    return datetime(day.year, day.month, day.day, tzinfo=ZoneInfo(clock.PRODUCT_TIMEZONE))


async def _undone(db: AsyncSession, batch_ids: Iterable[UUID]) -> set[UUID]:
    """The batches among `batch_ids` whose effect is undone now: an Undo reversed them and no
    later Undo reversed that one. Follows changelog.undone_by link by link until it is stable
    (review minor 2) — an even number of undos (none, or an Undo that was itself undone) leaves a
    batch in force. One query per link; one in all when nothing was ever undone."""
    tips = {batch_id: batch_id for batch_id in batch_ids}
    undos = dict.fromkeys(tips, 0)
    frontier = set(tips)
    while frontier:
        links = await undone_by(db, list(frontier))
        for origin, tip in tips.items():
            if tip in links:
                tips[origin] = links[tip]
                undos[origin] += 1
        frontier = set(links.values())
    return {origin for origin, count in undos.items() if count % 2}


def _newest(rows, undone: set[UUID]) -> dict[date, date]:
    """month -> the product date of its newest row from a batch whose effect stands."""
    newest: dict[date, date] = {}
    for row in rows:
        if row.batch_id not in undone and (row.month not in newest or row.day > newest[row.month]):
            newest[row.month] = row.day
    return newest


async def load_spending_evidence(db: AsyncSession, candidates: Sequence[date]) -> SpendingEvidence:
    """Clauses (b)-(d) for `candidates`, in ONE indexed query (spec §K3): the candidates' own
    row-level writes (the `month` index), plus import and restore summary lines from the
    earliest candidate's next 1st on (the `at` index). Undone batches come from
    changelog.undone_by — a second, small query, only when a `ui` row could count."""
    months = sorted(set(candidates))
    if not months:
        return SpendingEvidence()
    day = _product_day(ChangeLog.at)
    rows = (
        await db.execute(
            select(
                ChangeLog.batch_id,
                ChangeLog.source,
                ChangeLog.table_name,
                ChangeLog.op,
                ChangeLog.month,
                day.label("day"),
                ChangeLog.after["spending_reviewed"].as_boolean().label("spending_reviewed"),
            ).where(
                or_(
                    # Every row-level write for the candidates, whatever its table: clause (d)
                    # needs to know what ELSE a review row's batch wrote for its month.
                    and_(ChangeLog.month.in_(months), ChangeLog.op != "batch"),
                    and_(
                        ChangeLog.op == "batch",
                        ChangeLog.source.in_(SUMMARY_SOURCES),
                        ChangeLog.at >= _midnight(month_shift(months[0], 1)),
                    ),
                )
            )
        )
    ).all()
    # (batch, month) pairs that wrote something other than the month's review row: a review row
    # in one of these rode along with a save, and confirms nothing (clause (d)).
    other = {
        (row.batch_id, row.month)
        for row in rows
        if row.op != "batch" and row.table_name != REVIEW_TABLE
    }
    written: set[date] = set()
    saves, confirms, summaries = [], [], []
    for row in rows:
        if row.op == "batch":
            summaries.append(row.day)
        elif row.table_name == SPENDING_TABLE:
            written.add(row.month)
            if row.source == "ui":
                saves.append(row)
        elif (
            row.table_name == REVIEW_TABLE
            and row.source == "ui"
            and row.spending_reviewed
            and (row.batch_id, row.month) not in other
        ):
            confirms.append(row)
    undone = await _undone(db, {row.batch_id for row in (*saves, *confirms)})
    return SpendingEvidence(
        written=frozenset(written),
        saved_on=_newest(saves, undone),
        confirmed_on=_newest(confirms, undone),
        newest_summary=max(summaries, default=None),
    )


async def load_month_status(
    db: AsyncSession,
    *,
    today: date,
    reviews: ReviewBook,
    snapshots: Iterable[SnapshotState],
    spending: Iterable[date],
    take_home: Iterable[date],
    empty_book: bool,
) -> MonthStatus:
    """The status from rows load_coverage already read, plus the reminder day and the evidence
    query. Lane T reads it as `(await load_coverage(db)).status` — never a second derivation."""
    status = MonthStatus(
        today=today,
        reminder_day=await read_update_due_day(db),
        snapshots=tuple(sorted(snapshots, key=lambda state: state.month)),
        spending=frozenset(spending),
        take_home=frozenset(take_home),
        closed=frozenset(
            month for month, review in reviews.reviews.items() if review.closed_at is not None
        ),
        adopted_on=reviews.adopted_on,
        last_complete_month=reviews.default_month,
        empty_book=empty_book,
    )
    return replace(status, evidence=await load_spending_evidence(db, status.candidates()))
