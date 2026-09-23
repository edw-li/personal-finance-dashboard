"""services.ordering — the reorder endpoints' pure arithmetic (2026-09-23 drag-to-reorder
spec §3.1). Route behaviour lives in each router's own test file."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models import Account
from app.services.ordering import (
    STALE_ACCOUNTS,
    STALE_CARDS,
    STALE_CATEGORIES,
    STALE_REWARD_CATEGORIES,
    STALE_TRANSACTIONS,
    check_permutation,
    moved_ids,
    next_sort_order,
    renumber,
    subset_in_slots,
)

# ── the §8.3 sentences ───────────────────────────────────────────────────────────────


def test_the_stale_sentences_are_the_spec_copy():
    assert STALE_ACCOUNTS == "The accounts changed since this list was loaded — nothing was moved."
    assert STALE_CATEGORIES == (
        "The spending categories changed since this list was loaded — nothing was moved."
    )
    assert STALE_TRANSACTIONS == (
        "The transactions changed since this list was loaded — nothing was moved."
    )
    assert STALE_CARDS == "The cards changed since this list was loaded — nothing was moved."
    assert STALE_REWARD_CATEGORIES == (
        "The reward categories changed since this list was loaded — nothing was moved."
    )


# ── check_permutation ────────────────────────────────────────────────────────────────


def test_check_permutation_accepts_any_order_of_exactly_the_rows():
    check_permutation([1, 2, 3], [3, 1, 2], stale_detail="stale")
    check_permutation([1, 2, 3], [1, 2, 3], stale_detail="stale")


def test_check_permutation_422s_a_duplicate_naming_it():
    with pytest.raises(HTTPException) as caught:
        check_permutation([1, 2, 3], [3, 1, 3], stale_detail="stale")
    assert caught.value.status_code == 422
    assert caught.value.detail == "ids lists 3 more than once"


def test_a_duplicate_is_reported_before_a_stale_set():
    # [1, 1, 99] is both repeated and foreign; the malformed body is the first thing to say.
    with pytest.raises(HTTPException) as caught:
        check_permutation([1, 2], [1, 1, 99], stale_detail="stale")
    assert (caught.value.status_code, caught.value.detail) == (422, "ids lists 1 more than once")


@pytest.mark.parametrize(
    "ids", [[1, 2], [1, 2, 3, 4], [1, 2, 4]], ids=["missing", "extra", "swapped"]
)
def test_check_permutation_409s_a_different_set_with_the_lists_sentence(ids):
    with pytest.raises(HTTPException) as caught:
        check_permutation([1, 2, 3], ids, stale_detail=STALE_ACCOUNTS)
    assert caught.value.status_code == 409
    assert caught.value.detail == STALE_ACCOUNTS


# ── subset_in_slots ──────────────────────────────────────────────────────────────────


def test_subset_in_slots_keeps_hidden_rows_where_they_are():
    # Visible 2, 4, 5 hold slots 1, 3, 4; the new visible order [5, 2, 4] fills exactly
    # those slots, and hidden 1 and 3 never move.
    assert subset_in_slots([1, 2, 3, 4, 5], [5, 2, 4]) == [1, 5, 3, 2, 4]


def test_subset_in_slots_with_everything_visible_is_the_new_order():
    assert subset_in_slots([1, 2, 3], [3, 1, 2]) == [3, 1, 2]


@pytest.mark.parametrize("visible", [[2, 2], [2, 9]], ids=["repeated", "foreign"])
def test_subset_in_slots_refuses_rows_that_are_not_a_subset(visible):
    with pytest.raises(ValueError):
        subset_in_slots([1, 2, 3], visible)


# ── renumber ─────────────────────────────────────────────────────────────────────────


class Recorder:
    """A row that remembers every attribute SET — renumber must not set an unchanged one."""

    def __init__(self, id_: int, value: int) -> None:
        object.__setattr__(self, "id", id_)
        object.__setattr__(self, "value", value)
        object.__setattr__(self, "sets", 0)

    def __setattr__(self, name: str, value: object) -> None:
        object.__setattr__(self, "sets", self.sets + 1)
        object.__setattr__(self, name, value)


def test_renumber_writes_only_the_rows_whose_value_moves():
    rows = [Recorder(1, 0), Recorder(2, 5), Recorder(3, 2)]
    changed = renumber(rows, "value", start=0, step=1)
    assert [(row.id, old, new) for row, old, new in changed] == [(2, 5, 1)]
    assert [row.value for row in rows] == [0, 1, 2]
    assert [row.sets for row in rows] == [0, 1, 0]  # rows 1 and 3 were never touched


def test_renumber_steps_from_start():
    rows = [SimpleNamespace(sort_index=7), SimpleNamespace(sort_index=20)]
    changed = renumber(rows, "sort_index", start=10, step=10)
    assert [row.sort_index for row in rows] == [10, 20]
    assert [(old, new) for _, old, new in changed] == [(7, 10)]


# ── moved_ids ────────────────────────────────────────────────────────────────────────


def test_moved_ids_is_empty_for_an_unchanged_order():
    assert moved_ids([1, 2, 3], [1, 2, 3]) == []


def test_moved_ids_names_a_single_row_moved_up():
    assert moved_ids([1, 2, 3, 4, 5], [4, 1, 2, 3, 5]) == [4]


def test_moved_ids_names_a_single_row_moved_down():
    assert moved_ids([1, 2, 3, 4, 5], [2, 3, 4, 5, 1]) == [1]


def test_moved_ids_on_an_adjacent_swap_names_one_row_the_later_one():
    # Ties keep the earliest rows of the new order: 2 is kept, so 1 is "the one that moved"
    # (it did — one place down — exactly as 2 moved one place up).
    assert moved_ids([1, 2, 3], [2, 1, 3]) == [1]


def test_moved_ids_names_a_moved_block():
    # 4 and 5 travel together to the top: the minimal explanation is the block itself.
    assert moved_ids([1, 2, 3, 4, 5], [4, 5, 1, 2, 3]) == [4, 5]


def test_moved_ids_prefers_the_smaller_side_of_a_block_move():
    # A three-row block moving down past ONE row is explained by that one row moving up.
    assert moved_ids([9, 1, 2, 3], [1, 2, 3, 9]) == [9]


def test_moved_ids_on_a_reversal_keeps_the_first_row_of_the_new_order():
    assert moved_ids([1, 2, 3], [3, 2, 1]) == [2, 1]


# ── next_sort_order ──────────────────────────────────────────────────────────────────


async def test_next_sort_order_appends_after_the_max_and_starts_at_zero(db):
    assert (await db.execute(next_sort_order(Account.sort_order))).scalar_one() == 0
    db.add_all(
        [
            Account(name="A", slug="a", group="cash", sort_order=3),
            Account(name="B", slug="b", group="cash", sort_order=29),
        ]
    )
    await db.commit()
    assert (await db.execute(next_sort_order(Account.sort_order))).scalar_one() == 30
