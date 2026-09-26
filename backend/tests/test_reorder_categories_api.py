"""PUT /spending/categories/order and the categories' append default (2026-09-23
drag-to-reorder spec §3.2, §3.3, §8.3, §8.4). Change-logged, so its Undo is proven through
the Activity card's own endpoint."""

from uuid import UUID

import pytest
from sqlalchemy import select

from app.models import ChangeLog, SpendingCategory
from app.services.changelog import OVERLAP_REFUSAL
from tests.ordering_helpers import flushed_updates

SP = "/api/v1/spending"
ORDER = f"{SP}/categories/order"
ACTIVITY = "/api/v1/activity"
STALE = "The spending categories changed since this list was loaded — nothing was moved."


async def seed_categories(db) -> dict[str, int]:
    """Workbook column indexes (prod's 2…20 shape) and a retired row. GET order is
    (sort_order, id): Food, Rent, Old, Travel."""
    rows = [
        SpendingCategory(name="Food", slug="food", sort_order=2),
        SpendingCategory(name="Rent", slug="rent", sort_order=3),
        SpendingCategory(name="Old", slug="old", sort_order=7, is_active=False),
        SpendingCategory(name="Travel", slug="travel", sort_order=20),
    ]
    db.add_all(rows)
    await db.commit()
    return {row.name: row.id for row in rows}


async def stored_orders(db) -> list[tuple[int, int]]:
    rows = await db.execute(
        select(SpendingCategory.id, SpendingCategory.sort_order).order_by(SpendingCategory.id)
    )
    return [(row.id, row.sort_order) for row in rows]


async def test_reorder_requires_auth(client):
    assert (await client.put(ORDER, json={"ids": [1]})).status_code == 401


async def test_reorder_renumbers_every_row_and_answers_in_the_new_order(auth_client, db):
    ids = await seed_categories(db)
    new = [ids["Travel"], ids["Food"], ids["Old"], ids["Rent"]]
    resp = await auth_client.put(ORDER, json={"ids": new})
    assert resp.status_code == 200, resp.text
    assert [(c["id"], c["sort_order"]) for c in resp.json()] == [
        (category_id, index) for index, category_id in enumerate(new)
    ]
    assert resp.headers["x-change-batch"]
    listed = (await auth_client.get(f"{SP}/categories")).json()
    assert [c["id"] for c in listed] == new


async def test_an_unchanged_order_writes_and_logs_nothing(auth_client, db):
    ids = await seed_categories(db)
    current = [ids["Food"], ids["Rent"], ids["Old"], ids["Travel"]]
    with flushed_updates(db, SpendingCategory) as written:
        resp = await auth_client.put(ORDER, json={"ids": current})
    assert resp.status_code == 200, resp.text
    # Nothing was even SET: a set attribute is dirty until a flush, and no flush may come.
    assert not db.dirty
    assert [c["sort_order"] for c in resp.json()] == [2, 3, 7, 20]
    assert "x-change-batch" not in resp.headers
    assert written == set()
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


@pytest.mark.parametrize("shape", ["missing", "extra", "retired left out"])
async def test_a_stale_list_409s_with_the_sentence_and_moves_nothing(auth_client, db, shape):
    ids = await seed_categories(db)
    before = await stored_orders(db)
    body = {
        "missing": [ids["Travel"], ids["Food"], ids["Old"]],
        "extra": [ids["Travel"], ids["Food"], ids["Rent"], ids["Old"], 999],
        "retired left out": [ids["Travel"], ids["Food"], ids["Rent"]],
    }[shape]
    resp = await auth_client.put(ORDER, json={"ids": body})
    assert resp.status_code == 409
    assert resp.json()["detail"] == STALE
    assert await stored_orders(db) == before
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


async def test_a_repeated_id_422s_naming_it(auth_client, db):
    ids = await seed_categories(db)
    body = [ids["Rent"], ids["Food"], ids["Rent"], ids["Old"], ids["Travel"]]
    resp = await auth_client.put(ORDER, json={"ids": body})
    assert resp.status_code == 422
    assert resp.json()["detail"] == f"ids lists {ids['Rent']} more than once"


async def test_only_rows_whose_number_moves_are_written_and_logged(auth_client, db):
    rows = [
        SpendingCategory(name=name, slug=name.lower(), sort_order=index)
        for index, name in enumerate(["A", "B", "C", "D"])
    ]
    db.add_all(rows)
    await db.commit()
    a, b, c, d = (row.id for row in rows)
    with flushed_updates(db, SpendingCategory) as written:
        resp = await auth_client.put(ORDER, json={"ids": [b, a, c, d]})
    assert resp.status_code == 200, resp.text
    assert written == {a, b}
    logged = (await db.execute(select(ChangeLog))).scalars().all()
    assert sorted((r.pk["id"], r.before["sort_order"], r.after["sort_order"]) for r in logged) == [
        (a, 0, 1),
        (b, 1, 0),
    ]
    assert {(r.op, r.table_name) for r in logged} == {("update", "spending_categories")}
    assert {r.batch_id for r in logged} == {UUID(resp.headers["x-change-batch"])}
    # An adjacent swap names ONE row (spec §3.1): B is kept, so A is the one that moved.
    assert {r.label for r in logged} == {"Moved category A"}


async def test_the_label_counts_the_minimal_moved_set_otherwise(auth_client, db):
    ids = await seed_categories(db)
    # Food, Rent, Old, Travel -> Travel, Old, Rent, Food: a reversal keeps only Travel.
    await auth_client.put(
        ORDER, json={"ids": [ids["Travel"], ids["Old"], ids["Rent"], ids["Food"]]}
    )
    labels = set((await db.execute(select(ChangeLog.label))).scalars())
    assert labels == {"Reordered 3 categories"}


async def test_undo_puts_back_the_exact_previous_numbers(auth_client, db):
    ids = await seed_categories(db)
    moved = await auth_client.put(
        ORDER, json={"ids": [ids["Travel"], ids["Food"], ids["Rent"], ids["Old"]]}
    )
    assert moved.status_code == 200, moved.text
    undo = await auth_client.post(f"{ACTIVITY}/batches/{moved.headers['x-change-batch']}/undo")
    assert undo.status_code == 200, undo.text
    assert undo.json()["label"] == "Undid: Moved category Travel"
    listed = (await auth_client.get(f"{SP}/categories")).json()
    assert [(c["id"], c["sort_order"]) for c in listed] == [
        (ids["Food"], 2),
        (ids["Rent"], 3),
        (ids["Old"], 7),
        (ids["Travel"], 20),
    ]


async def test_a_later_edit_of_a_moved_row_makes_the_undo_refuse(auth_client, db):
    ids = await seed_categories(db)
    new = [ids["Travel"], ids["Food"], ids["Rent"], ids["Old"]]
    moved = await auth_client.put(ORDER, json={"ids": new})
    batch_id = moved.headers["x-change-batch"]
    renamed = await auth_client.patch(f"{SP}/categories/{ids['Travel']}", json={"name": "Trips"})
    assert renamed.status_code == 200, renamed.text
    refused = await auth_client.post(f"{ACTIVITY}/batches/{batch_id}/undo")
    assert refused.status_code == 409
    assert refused.json()["detail"] == OVERLAP_REFUSAL
    listed = (await auth_client.get(f"{SP}/categories")).json()
    assert [c["id"] for c in listed] == new


async def test_undo_after_a_later_reorder_refuses_until_the_later_one_is_undone(auth_client, db):
    """Spec §9: two reorders touch the same rows, so the first one's before images are stale
    — its undo refuses with the overlap sentence — until the later one is undone: a change and
    its standing Undo cancel out (changelog.superseded), so the retry goes through and puts the
    seed's numbers back."""
    ids = await seed_categories(db)
    first = await auth_client.put(
        ORDER, json={"ids": [ids["Travel"], ids["Food"], ids["Rent"], ids["Old"]]}
    )
    second = await auth_client.put(
        ORDER, json={"ids": [ids["Food"], ids["Travel"], ids["Rent"], ids["Old"]]}
    )
    first_batch = first.headers["x-change-batch"]
    refused = await auth_client.post(f"{ACTIVITY}/batches/{first_batch}/undo")
    assert refused.status_code == 409
    assert refused.json()["detail"] == OVERLAP_REFUSAL
    undone = await auth_client.post(f"{ACTIVITY}/batches/{second.headers['x-change-batch']}/undo")
    assert undone.status_code == 200, undone.text
    listed = (await auth_client.get(f"{SP}/categories")).json()
    # Back to the state the first reorder left: Travel, Food, Rent, Old at 0…3.
    assert [(c["id"], c["sort_order"]) for c in listed] == [
        (ids["Travel"], 0),
        (ids["Food"], 1),
        (ids["Rent"], 2),
        (ids["Old"], 3),
    ]
    retried = await auth_client.post(f"{ACTIVITY}/batches/{first_batch}/undo")
    assert retried.status_code == 200, retried.text
    listed = (await auth_client.get(f"{SP}/categories")).json()
    assert [(c["id"], c["sort_order"]) for c in listed] == [
        (ids["Food"], 2),
        (ids["Rent"], 3),
        (ids["Old"], 7),
        (ids["Travel"], 20),
    ]


# ── the append default (spec §3.3) ───────────────────────────────────────────────────


async def test_create_without_a_sort_order_appends_after_the_last_category(auth_client, db):
    first = await auth_client.post(f"{SP}/categories", json={"name": "Food"})
    assert first.status_code == 201, first.text
    assert first.json()["sort_order"] == 0  # an empty table starts at 0
    db.add(SpendingCategory(name="Travel", slug="travel", sort_order=20))
    await db.commit()
    second = await auth_client.post(f"{SP}/categories", json={"name": "Pets"})
    assert second.json()["sort_order"] == 21
    nulled = await auth_client.post(f"{SP}/categories", json={"name": "Kids", "sort_order": None})
    assert nulled.json()["sort_order"] == 22
    explicit = await auth_client.post(f"{SP}/categories", json={"name": "Gym", "sort_order": 5})
    assert explicit.json()["sort_order"] == 5
