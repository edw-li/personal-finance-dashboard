"""services.ordering — the reorder endpoints' pure arithmetic (2026-09-23 drag-to-reorder
spec §3.1). Route behaviour lives in each router's own test file."""

from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models import Account, PositionTransaction, Security
from app.services.ordering import (
    SORT_INDEX_STEP,
    STALE_ACCOUNTS,
    STALE_CARDS,
    STALE_CATEGORIES,
    STALE_REWARD_CATEGORIES,
    STALE_TRANSACTIONS,
    apply_order,
    check_permutation,
    in_list_order,
    moved_alone,
    moved_ids,
    next_sort_index,
    next_sort_order,
    order_lock,
    position_changes,
    renumber,
    subset_in_slots,
)
from app.services.portfolio_calc import Position
from tests.portfolio_factories import acct

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
    """A row that remembers every attribute SET after it was built — renumber and
    apply_order must not set an unchanged one."""

    def __init__(self, id_: int, **attrs: int) -> None:
        object.__setattr__(self, "id", id_)
        for name, value in attrs.items():
            object.__setattr__(self, name, value)
        object.__setattr__(self, "sets", 0)

    def __setattr__(self, name: str, value: object) -> None:
        object.__setattr__(self, "sets", self.sets + 1)
        object.__setattr__(self, name, value)


def test_renumber_writes_only_the_rows_whose_value_moves():
    rows = [Recorder(1, value=0), Recorder(2, value=5), Recorder(3, value=2)]
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


# ── moved_alone ──────────────────────────────────────────────────────────────────────

BLOCK = [1, 2, 3, 4, 9, 10]  # 9 is a parent carrying 10


@pytest.mark.parametrize(
    "new",
    [[1, 2, 3, 9, 10, 4], [1, 2, 9, 10, 3, 4], [9, 10, 1, 2, 3, 4], [9, 1, 2, 3, 4, 10]],
    ids=["up 1", "up 2", "up 4", "the carried row left behind"],
)
def test_moved_alone_names_a_head_that_moved_while_everything_else_kept_its_order(new):
    assert moved_alone(BLOCK, new, 9, {10})


@pytest.mark.parametrize(
    "new",
    [BLOCK, [1, 2, 10, 3, 4, 9], [1, 2, 3, 4, 10, 9], [1, 2, 4, 3, 9, 10]],
    ids=["unchanged", "only the carried row moved", "inside the unit", "another row moved"],
)
def test_moved_alone_is_false_unless_the_head_itself_moved_among_an_unchanged_rest(new):
    assert not moved_alone(BLOCK, new, 9, {10})


def test_moved_alone_without_carried_rows_is_the_single_row_rule():
    assert moved_alone([1, 2, 3, 4], [1, 4, 2, 3], 4)
    assert not moved_alone([1, 2, 3, 4], [1, 4, 2, 3], 2)  # 2 did not move among the rest
    assert not moved_alone([1, 2, 3, 4], [4, 3, 2, 1], 4)  # the rest changed too


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


# ── order_lock ───────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("model", [Account, PositionTransaction], ids=["accounts", "ledger"])
def test_order_lock_is_a_transaction_scoped_advisory_lock_named_for_its_list(model):
    # Transaction-scoped (xact): the commit or rollback releases it, so no request can leak
    # it. Named by table, so every path of one list takes the SAME lock without a spelling.
    compiled = order_lock(model).compile()
    assert str(compiled) == "SELECT pg_advisory_xact_lock(hashtext(:key))"
    assert compiled.params == {"key": f"reorder:{model.__tablename__}"}


# ── next_sort_index ──────────────────────────────────────────────────────────────────


async def test_next_sort_index_appends_one_step_after_the_whole_ledger(db):
    assert SORT_INDEX_STEP == 10  # the ledger's spacing: reorders renumber 10, 20, …
    assert (await db.execute(next_sort_index())).scalar_one() == 10  # an empty ledger
    sec = Security(ticker="NSI", name="Next Sort Index", holding_type="stock")
    db.add(sec)
    await db.flush()

    def row(source: str, sort_index: int) -> PositionTransaction:
        return PositionTransaction(
            security_id=sec.id,
            portfolio_account=acct("Fido"),
            type="buy",
            shares=Decimal("1"),
            price=Decimal("1"),
            sort_index=sort_index,
            source=source,
        )

    db.add_all([row("import", 30), row("ui", 7)])  # UI rows count: one ledger, one max
    await db.commit()
    assert (await db.execute(next_sort_index())).scalar_one() == 40


# ── in_list_order ────────────────────────────────────────────────────────────────────


async def test_in_list_order_is_sort_order_then_id(db):
    db.add_all(
        [
            Account(name="C", slug="c", group="cash", sort_order=5),
            Account(name="A", slug="a", group="cash", sort_order=3),
            Account(name="B", slug="b", group="cash", sort_order=3),  # the tie breaks on id
        ]
    )
    await db.commit()
    listed = (await db.execute(in_list_order(Account))).scalars().all()
    assert [account.name for account in listed] == ["A", "B", "C"]


# ── apply_order ──────────────────────────────────────────────────────────────────────


def test_apply_order_leaves_an_unchanged_order_exactly_as_stored():
    rows = [Recorder(1, sort_order=3), Recorder(2, sort_order=3), Recorder(3, sort_order=29)]
    ordered, changed = apply_order(rows, [1, 2, 3], stale_detail="stale")
    assert ordered == rows
    assert changed == []
    assert [row.sort_order for row in rows] == [3, 3, 29]  # the tie and the gap stay
    assert [row.sets for row in rows] == [0, 0, 0]


def test_apply_order_renumbers_the_new_order_and_sets_only_what_moves():
    rows = [Recorder(1, sort_order=0), Recorder(2, sort_order=1), Recorder(3, sort_order=2)]
    ordered, changed = apply_order(rows, [1, 3, 2], stale_detail="stale")
    assert [row.id for row in ordered] == [1, 3, 2]
    assert [(row.id, old, new) for row, old, new in changed] == [(3, 2, 1), (2, 1, 2)]
    assert [row.sets for row in rows] == [0, 1, 1]


@pytest.mark.parametrize(
    ("ids", "status"), [([1, 1, 2], 422), ([2], 409)], ids=["repeated", "stale"]
)
def test_apply_order_judges_the_ids_before_touching_a_row(ids, status):
    rows = [Recorder(1, sort_order=0), Recorder(2, sort_order=1)]
    with pytest.raises(HTTPException) as caught:
        apply_order(rows, ids, stale_detail="stale")
    assert caught.value.status_code == status
    assert [row.sets for row in rows] == [0, 0]


# ── position_changes ─────────────────────────────────────────────────────────────────


def pos(security_id: int, account: str, shares: str, cost: str, gain: str, *warnings: str):
    return Position(
        security_id=security_id,
        account=account,
        shares=Decimal(shares),
        cost_basis=Decimal(cost),
        realized_gl=Decimal(gain),
        warnings=list(warnings),
    )


def test_position_changes_is_empty_when_every_figure_rounds_the_same():
    before = {(1, "Fido"): pos(1, "Fido", "6", "300", "120")}
    # Sub-cent and sub-micro-share noise is not a change: the comparison is quantized.
    after = {(1, "Fido"): pos(1, "Fido", "6.0000001", "300.004", "119.996")}
    assert position_changes(before, after, {1: "VOO"}) == []


def test_position_changes_reports_quantized_strings_and_the_new_warning():
    before = {(1, "Fido"): pos(1, "Fido", "6", "300", "120")}
    after = {(1, "Fido"): pos(1, "Fido", "6", "500", "320", "txn 7: sell with no held shares")}
    [change] = position_changes(before, after, {1: "VOO"})
    assert change.model_dump(mode="json") == {
        "security_id": 1,
        "ticker": "VOO",
        "account": "Fido",
        "shares_before": "6.000000",
        "shares_after": "6.000000",
        "cost_basis_before": "300.00",
        "cost_basis_after": "500.00",
        "realized_gl_before": "120.00",
        "realized_gl_after": "320.00",
        "warnings_added": ["txn 7: sell with no held shares"],
    }


def test_a_new_warning_alone_is_a_change_and_an_old_one_is_not_repeated():
    old_line = "txn 3: sell exceeds held shares"
    before = {(1, "Fido"): pos(1, "Fido", "0", "0", "5", old_line)}
    after = {
        (1, "Fido"): pos(1, "Fido", "0", "0", "5", old_line, "txn 4: sell with no held shares")
    }
    [change] = position_changes(before, after, {1: "VOO"})
    assert change.warnings_added == ["txn 4: sell with no held shares"]


def test_position_changes_are_ordered_by_ticker_then_account_and_never_minus_zero():
    before = {
        (2, "RH"): pos(2, "RH", "1", "10", "0"),
        (1, "Z"): pos(1, "Z", "1", "10", "0"),
        (1, "A"): pos(1, "A", "1", "10", "0"),
    }
    after = {
        (2, "RH"): pos(2, "RH", "2", "10", "0"),
        (1, "Z"): pos(1, "Z", "2", "10", "0"),
        (1, "A"): pos(1, "A", "2", "10", "-0.001"),
    }
    changes = position_changes(before, after, {1: "BBB", 2: "AAA"})
    assert [(c.ticker, c.account) for c in changes] == [("AAA", "RH"), ("BBB", "A"), ("BBB", "Z")]
    assert changes[1].model_dump(mode="json")["realized_gl_after"] == "0.00"
