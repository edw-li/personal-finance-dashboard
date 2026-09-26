"""The reorder endpoints' arithmetic (2026-09-23 drag-to-reorder spec §3.1).

Pure: no session and no I/O. `check_permutation` raises the API's own 422/409 the way
services.money raises its 422s — those sentences ARE the endpoints' vocabulary. Anything
that needs the database is BUILT here and awaited by the router.
"""

from bisect import bisect_left
from collections.abc import Collection, Sequence
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol

from fastapi import HTTPException
from sqlalchemy import Select, TextClause, func, select, text
from sqlalchemy.orm import InstrumentedAttribute

from app.models import Account, CreditCard, PositionTransaction, RewardCategory, SpendingCategory
from app.schemas.portfolio import PositionChangeOut
from app.services.portfolio_calc import MONEY_Q, SHARE_Q, Position, PositionKey

# §8.3 — the 409 a stale list earns. The client shows it in toast.error and reloads, so the
# reader is already looking at the current rows when they read it.
STALE_ACCOUNTS = "The accounts changed since this list was loaded — nothing was moved."
STALE_CATEGORIES = "The spending categories changed since this list was loaded — nothing was moved."
STALE_TRANSACTIONS = "The transactions changed since this list was loaded — nothing was moved."
STALE_CARDS = "The cards changed since this list was loaded — nothing was moved."
STALE_REWARD_CATEGORIES = (
    "The reward categories changed since this list was loaded — nothing was moved."
)

# The ledger's spacing: PUT /portfolio/transactions/order renumbers 10, 20, …, and a new
# transaction — UI or import — lands one step after the whole ledger's max.
SORT_INDEX_STEP = 10


def order_lock(model: type) -> TextClause:
    """`SELECT pg_advisory_xact_lock(hashtext('reorder:<table>'))` — one list's order lock
    (spec §3.4 amended; plan decision 16). Every reorder route takes it as its FIRST
    statement, and every path that APPENDS to the same list takes it before it reads the
    max: the creates without a sort_order, an account's group-change append, the UI
    transaction create and the importer. Two tabs' reorders therefore run one after the
    other — the later request wins whole, with fresh before-images — instead of merging row
    by row, and a create never takes a number a reorder is about to write.

    Transaction-scoped, so the commit or rollback releases it and no request can leak it;
    keyed by table name, so no path can spell another's key. The statement, not the call:
    this module stays I/O-free (the allocation-target save's lock is the precedent)."""
    return text("SELECT pg_advisory_xact_lock(hashtext(:key))").bindparams(
        key=f"reorder:{model.__tablename__}"
    )


# The one order in which any path holding more than one list's order lock takes them — the
# importer (ORDERED_LISTS, the workbook's three lists) and an Activity-card Undo (LOGGED_LISTS,
# every list whose rows a logged write can move) — so no two such paths can each hold one lock
# while waiting for the other's (decision 16). The two card lists joined the change log on
# 2026-09-25 (polish spec §6.1) and come LAST: they are dashboard-only, so the importer never
# takes them, and after every lock it does take they can close no cycle with it.
ORDERED_LISTS: tuple[type, ...] = (PositionTransaction, Account, SpendingCategory)
LOGGED_LISTS: tuple[type, ...] = (*ORDERED_LISTS, CreditCard, RewardCategory)


def order_locks_for(tables: Collection[str]) -> list[TextClause]:
    """order_lock for each of the LOGGED_LISTS among `tables`, in that fixed order."""
    return [order_lock(model) for model in LOGGED_LISTS if model.__tablename__ in tables]


def check_permutation(current_ids: Sequence[int], ids: Sequence[int], *, stale_detail: str) -> None:
    """422 when `ids` names a row twice; 409 with the list's stale sentence when it names a
    different set of rows than `current_ids` (one was added, deleted or re-scoped since the
    page loaded). Order is not judged — any order of exactly the right rows is valid."""
    seen: set[int] = set()
    for row_id in ids:
        if row_id in seen:
            raise HTTPException(status_code=422, detail=f"ids lists {row_id} more than once")
        seen.add(row_id)
    if seen != set(current_ids):
        raise HTTPException(status_code=409, detail=stale_detail)


def subset_in_slots(full_ids: Sequence[int], visible_new_order: Sequence[int]) -> list[int]:
    """The owner-scoped case: the visible rows, in their new order, fill the positions the
    visible rows already occupy in the full list, and every hidden row keeps its own
    position. `visible_new_order` must name distinct rows of `full_ids`."""
    visible = set(visible_new_order)
    slots = [index for index, row_id in enumerate(full_ids) if row_id in visible]
    if len(visible) != len(visible_new_order) or len(slots) != len(visible_new_order):
        raise ValueError("visible_new_order must name distinct rows of full_ids")
    merged = list(full_ids)
    for slot, row_id in zip(slots, visible_new_order, strict=True):
        merged[slot] = row_id
    return merged


def renumber[R](
    rows_in_order: Sequence[R], attr: str, *, start: int, step: int
) -> list[tuple[R, int, int]]:
    """Write start, start + step, … onto `attr` in list order, but only where the stored
    value differs — an unchanged row is never touched, so it is never flushed. Returns the
    rows it changed as (row, old, new), in list order."""
    changed: list[tuple[R, int, int]] = []
    for index, row in enumerate(rows_in_order):
        new = start + index * step
        old = getattr(row, attr)
        if old != new:
            setattr(row, attr, new)
            changed.append((row, old, new))
    return changed


class ListRow(Protocol):
    """A row of one of the four sort_order lists: accounts, spending categories, credit
    cards, reward categories."""

    id: int
    sort_order: int


def apply_order[R: ListRow](
    rows: Sequence[R], ids: Sequence[int], *, stale_detail: str
) -> tuple[list[R], list[tuple[R, int, int]]]:
    """The four sort_order reorder PUTs, minus their I/O (spec §3.2). `rows` is the list in
    its stored order (in_list_order), `ids` the requested order. The ids are judged first
    (check_permutation: 422 repeated, 409 stale). An unchanged order comes back exactly as
    stored, with nothing set — no normalization on a no-op (decision 10). Otherwise the rows
    come back in their new order with sort_order renumbered 0…n−1 where it differs, plus
    renumber's (row, old, new) for every row it set: never empty for a changed order."""
    current = [row.id for row in rows]
    check_permutation(current, ids, stale_detail=stale_detail)
    if list(ids) == current:
        return list(rows), []
    by_id = {row.id: row for row in rows}
    ordered = [by_id[row_id] for row_id in ids]
    return ordered, renumber(ordered, "sort_order", start=0, step=1)


def moved_alone(
    old_order: Sequence[int],
    new_order: Sequence[int],
    head: int,
    carried: Collection[int] = (),
) -> bool:
    """True when `head` — with the rows it carries, if any — explains the whole change:
    take them out of both orders and the rest is the same sequence, and `head` itself now
    sits somewhere else among the rest. A change among the carried rows alone does not
    count, so a component shuffled under its parent never names the parent. The natural
    explanation the Activity label reaches for before the minimal moved set (§8.4, amended
    at the R1 review). O(n)."""
    unit = {head, *carried}
    rest_old = [row_id for row_id in old_order if row_id not in unit]
    rest_new = [row_id for row_id in new_order if row_id not in unit]
    if rest_old != rest_new:
        return False

    def rest_before_head(order: Sequence[int]) -> int:
        count = 0
        for row_id in order:
            if row_id == head:
                return count
            if row_id not in unit:
                count += 1
        raise ValueError("head must be a row of both orders")

    return rest_before_head(old_order) != rest_before_head(new_order)


def moved_ids(old_order: Sequence[int], new_order: Sequence[int]) -> list[int]:
    """The fewest rows whose moves explain old_order -> new_order: every row outside a
    longest increasing subsequence of old positions, read in new order.

    Ties keep the EARLIEST rows of the new order: of all longest subsequences, the kept one
    is the lexicographically smallest by new-order index. An adjacent swap [a, b] -> [b, a]
    therefore names `a` — and "moved a" is as true as "moved b". Returned in new order;
    empty when the order is unchanged. O(n log n)."""
    position = {row_id: index for index, row_id in enumerate(old_order)}
    values = [position[row_id] for row_id in new_order]
    # longest[i]: the longest increasing run of values that STARTS at i, found right to
    # left as the patience-sorting LIS of the reversed, negated sequence.
    longest = [0] * len(values)
    tails: list[int] = []
    for index in range(len(values) - 1, -1, -1):
        slot = bisect_left(tails, -values[index])
        if slot == len(tails):
            tails.append(-values[index])
        else:
            tails[slot] = -values[index]
        longest[index] = slot + 1
    # Greedy, front to back: take the first row that can still start a run of the length
    # left to find. A row with a LONGER run after the kept prefix cannot exist (the whole
    # subsequence would beat the maximum), so "== need" is exact.
    need = len(tails)
    floor = -1
    kept: set[int] = set()
    for index, value in enumerate(values):
        if need and longest[index] == need and value > floor:
            kept.add(index)
            floor = value
            need -= 1
    return [row_id for index, row_id in enumerate(new_order) if index not in kept]


def next_sort_order(column: InstrumentedAttribute[int]) -> Select[tuple[int]]:
    """`SELECT coalesce(max(column), -1) + 1` — the append position a create without a
    sort_order takes (spec §3.3). The statement, not the value, so this module stays free
    of I/O: the router awaits it inside its own transaction."""
    return select(func.coalesce(func.max(column), -1) + 1)


def next_sort_index() -> Select[tuple[int]]:
    """`SELECT coalesce(max(sort_index), 0) + 10` over the WHOLE ledger, UI and import rows
    alike — the replay position a new transaction takes (spec §3.4): after everything, from
    where the user drags it into place. The statement, not the value (next_sort_order's
    posture); the UI create and the importer both read it."""
    return select(func.coalesce(func.max(PositionTransaction.sort_index), 0) + SORT_INDEX_STEP)


def in_list_order[M](model: type[M]) -> Select[tuple[M]]:
    """`SELECT … ORDER BY sort_order, id` — a sort_order list in the order its page shows
    it. Each of the four lists' GET and its reorder PUT read through this one builder, so
    "the rows the page shows" and "the rows the PUT must name" cannot drift apart."""
    return select(model).order_by(model.sort_order, model.id)


def _q(value: Decimal, quantum: Decimal) -> Decimal:
    quantized = value.quantize(quantum, rounding=ROUND_HALF_UP)
    return abs(quantized) if quantized == 0 else quantized  # never "-0.00" on the wire


def position_changes(
    before: dict[PositionKey, Position],
    after: dict[PositionKey, Position],
    tickers: dict[int, str],
) -> list[PositionChangeOut]:
    """Every position whose figures differ between two folds of the SAME rows in two
    orders — shares at 6 dp, cost basis and realized gain at 2 dp — or whose warnings
    gained a line. A reorder never adds or removes a position (the same rows fold both
    times), so the two dicts share their keys. Ordered by (ticker, account)."""
    changes: list[PositionChangeOut] = []
    for key, now in after.items():
        was = before[key]
        shares = (_q(was.shares, SHARE_Q), _q(now.shares, SHARE_Q))
        cost = (_q(was.cost_basis, MONEY_Q), _q(now.cost_basis, MONEY_Q))
        gain = (_q(was.realized_gl, MONEY_Q), _q(now.realized_gl, MONEY_Q))
        warnings_added = [line for line in now.warnings if line not in was.warnings]
        unchanged = shares[0] == shares[1] and cost[0] == cost[1] and gain[0] == gain[1]
        if unchanged and not warnings_added:
            continue
        changes.append(
            PositionChangeOut(
                security_id=now.security_id,
                ticker=tickers[now.security_id],
                account=now.account,
                shares_before=shares[0],
                shares_after=shares[1],
                cost_basis_before=cost[0],
                cost_basis_after=cost[1],
                realized_gl_before=gain[0],
                realized_gl_after=gain[1],
                warnings_added=warnings_added,
            )
        )
    changes.sort(key=lambda change: (change.ticker, change.account))
    return changes
