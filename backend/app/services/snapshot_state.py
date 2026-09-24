"""Snapshot state — the ONE owner of "provisional" and "current" (2026-09-23 spec §0.4(b), §K2).

A snapshot keyed M holds the balances on M's 1st. The user records them ON the 1st, and
sometimes early — Oct 1's balances typed on Sep 22, when that month's routine was done. An
early snapshot is PROVISIONAL: its figures describe the day they were typed, not the 1st, and
it becomes final by itself once saved again on or after its 1st (month_writes, K4). Every page
reads the same current snapshot with its as-of date and flag: the net-worth summary (K2), the
projection's base (R5), card utilization (T9) and the assistant (T10).

    provisional = month > today or (recorded_on is not None and recorded_on < month)
    as_of       = month when final; when provisional, recorded_on if set and not after today,
                  else None ("date unknown")
    current     = the latest snapshot whose month is at most the month after today's
    previous    = the one before it, whatever the gap

A NULL recorded_on reads as final: the importer leaves column B blank for history, and blank is
"unknown", never "early". A snapshot further ahead than next month (only an API client or an
import can store one) is never current: it stays in the timeseries and the charts, and the
far-future health check names it (T5).
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import NetWorthSnapshot
from app.schemas.net_worth import SnapshotStateOut
from app.services.month_review import month_shift


@dataclass(frozen=True)
class SnapshotState:
    id: int
    month: date  # the key: balances on this 1st
    recorded_on: date | None  # stored; None = unknown
    provisional: bool
    as_of: date | None  # the date the balances describe; None = "date unknown"


def snapshot_state(id: int, month: date, recorded_on: date | None, today: date) -> SnapshotState:
    provisional = month > today or (recorded_on is not None and recorded_on < month)
    as_of: date | None
    if not provisional:
        as_of = month
    elif recorded_on is not None and recorded_on <= today:
        as_of = recorded_on
    else:
        as_of = None
    return SnapshotState(
        id=id, month=month, recorded_on=recorded_on, provisional=provisional, as_of=as_of
    )


async def load_snapshot_states(db: AsyncSession, today: date) -> list[SnapshotState]:
    """Every snapshot's state, ascending by month — one query, no balances."""
    rows = (
        await db.execute(
            select(
                NetWorthSnapshot.id, NetWorthSnapshot.month, NetWorthSnapshot.recorded_on
            ).order_by(NetWorthSnapshot.month)
        )
    ).all()
    return [snapshot_state(row.id, row.month, row.recorded_on, today) for row in rows]


def current_and_previous(
    states: Iterable[SnapshotState], today: date
) -> tuple[SnapshotState | None, SnapshotState | None]:
    """The current snapshot — the latest whose month is at most the month after today's — and
    the one before it; (None, None) when none qualifies."""
    ordered = sorted(states, key=lambda state: state.month)
    bound = month_shift(today.replace(day=1), 1)
    index = max((i for i, state in enumerate(ordered) if state.month <= bound), default=-1)
    if index == -1:
        return None, None
    return ordered[index], ordered[index - 1] if index > 0 else None


def state_out(state: SnapshotState) -> SnapshotStateOut:
    return SnapshotStateOut(
        month=state.month,
        as_of=state.as_of,
        recorded_on=state.recorded_on,
        provisional=state.provisional,
    )
