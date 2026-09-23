"""OrderIn — the one body every reorder endpoint takes (2026-09-23 drag-to-reorder spec §3.2)."""

import pytest
from pydantic import ValidationError

from app.schemas.ordering import OrderIn


def test_order_in_takes_one_to_ten_thousand_ids():
    assert OrderIn(ids=[3, 1, 2]).ids == [3, 1, 2]
    assert len(OrderIn(ids=list(range(10_000))).ids) == 10_000


@pytest.mark.parametrize("ids", [[], list(range(10_001))], ids=["empty", "over the cap"])
def test_order_in_refuses_an_empty_or_runaway_list(ids):
    with pytest.raises(ValidationError):
        OrderIn(ids=ids)


def test_order_in_leaves_unknown_ids_to_the_permutation_check():
    # No int32 bound on purpose: an id the table does not hold reads as a stale list (409),
    # and no route ever hands a body id to SQL.
    assert OrderIn(ids=[0, -1, 10**12]).ids == [0, -1, 10**12]
