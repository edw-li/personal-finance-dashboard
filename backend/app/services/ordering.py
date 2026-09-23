"""The reorder endpoints' arithmetic (2026-09-23 drag-to-reorder spec §3.1).

Pure: no session and no I/O. `check_permutation` raises the API's own 422/409 the way
services.money raises its 422s — those sentences ARE the endpoints' vocabulary. Anything
that needs the database is BUILT here and awaited by the router.
"""

from bisect import bisect_left
from collections.abc import Sequence

from fastapi import HTTPException

# §8.3 — the 409 a stale list earns. The client shows it in toast.error and reloads, so the
# reader is already looking at the current rows when they read it.
STALE_ACCOUNTS = "The accounts changed since this list was loaded — nothing was moved."
STALE_CATEGORIES = "The spending categories changed since this list was loaded — nothing was moved."
STALE_TRANSACTIONS = "The transactions changed since this list was loaded — nothing was moved."
STALE_CARDS = "The cards changed since this list was loaded — nothing was moved."
STALE_REWARD_CATEGORIES = (
    "The reward categories changed since this list was loaded — nothing was moved."
)


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
