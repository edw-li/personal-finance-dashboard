from datetime import date
from typing import Literal

from pydantic import BaseModel

from app.schemas.month_review import MonthReviewOut
from app.schemas.net_worth import SnapshotStateOut

# SnapshotStateOut is defined in schemas/net_worth.py (SummaryOut.previous needs it, and this
# module importing month_review → net_worth rules out the other direction) and re-exported here
# as part of the time contract (2026-09-23 spec §0.4(b)).
__all__ = [
    "BalancesPartOut",
    "CoverageLatestOut",
    "CoverageOut",
    "FlowsPartOut",
    "SnapshotStateOut",
    "TimeStatusOut",
]


class CoverageLatestOut(BaseModel):
    """The newest month each feed covers — None when the feed has nothing. `spending` is
    the newest ENTERED month, which is what the footer and the freshness cue name."""

    balances: date | None
    spending: date | None
    net_pay: date | None


class BalancesPartOut(BaseModel):
    """The balances part of the monthly update (2026-09-23 spec §0.4(c)): the current month's
    balances, due on its 1st."""

    month: date  # the current month: the balances due on its 1st
    status: Literal["final", "provisional", "missing"]
    due_on: date  # = month
    overdue_from: date  # min(reminder date of `month` + 6 days, the month's last day)
    overdue: bool  # status != "final" and today >= overdue_from
    snapshot: SnapshotStateOut | None


class FlowsPartOut(BaseModel):
    """An ended month's spending and take-home (spec §0.4(c), §K3)."""

    month: date  # a month that has ended
    spending: Literal["missing", "partial", "entered"]  # K3's rule
    spending_entered: bool  # == (spending == "entered"); kept for readers
    spending_saved_on: date | None  # product date of the newest counted spending write
    take_home_entered: bool  # a take-home row (0.00 counts)
    due_on: date  # the 1st of the next month
    overdue_from: date  # reminder date of the next month + 15 days (default: the 16th)
    overdue: bool  # today >= overdue_from


class TimeStatusOut(BaseModel):
    """What is due and what is overdue on the product day (spec §0.4(c)) —
    services.month_status."""

    today: date
    current_month: date
    reminder_day: int  # app setting calendar_update_due_day, default 1
    current_snapshot: SnapshotStateOut | None
    previous_snapshot: SnapshotStateOut | None
    balances: BalancesPartOut
    # Every ended month from the first snapshot month on whose spending is not "entered" or
    # whose take-home is missing, newest first.
    flows_due: list[FlowsPartOut] = []
    # Months before the current one whose snapshot is still provisional (recorded early, never
    # saved again), newest first; legacy months left out.
    provisional_past: list[SnapshotStateOut] = []
    # EVERY snapshot month whose balances are provisional — snapshot_state's flag: recorded before
    # their 1st, or the month still ahead — legacy months included, ascending. What the month
    # ribbon hatches (2026-09-23 spec §T8; lane T review M9): provisional_past leaves legacy months
    # out for Needs attention, the chip must not, and the browser keeps no copy of the rule.
    provisional_months: list[date] = []
    last_complete_month: date | None  # the review book's default_month (unchanged rule)


class CoverageOut(BaseModel):
    """Which months each hand-entered feed covers (2026-09-03 shell spec §7, extended by
    the 2026-09-04 honest-numbers spec §3). Ascending first-of-month dates, one entry per
    month regardless of row count.

    `spending` lists ENTERED months only — a month whose rows are all $0.00 with no
    take-home is in `spending_empty`, and a month inside the missing window with nothing
    at all is in `spending_missing`. `balances` and `net_pay` are unchanged. The missing
    windows end at the newest month whose flows are overdue (2026-09-23 spec §K3); what is
    due, and whether an ended month's spending is complete, is `time`.
    """

    balances: list[date]
    spending: list[date]
    net_pay: list[date]
    spending_empty: list[date]
    spending_missing: list[date]
    net_pay_missing: list[date]
    latest: CoverageLatestOut
    review_months: list[MonthReviewOut] = []
    default_month: date | None = None
    adopted_on: date | None = None
    eligible_spending: list[date] = []
    eligible_savings: list[date] = []
    # The two parts of the monthly update (2026-09-23 spec §K3) — null only on an empty book.
    time: TimeStatusOut | None = None
