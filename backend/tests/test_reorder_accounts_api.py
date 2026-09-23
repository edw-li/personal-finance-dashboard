"""PUT /net-worth/accounts/order and the accounts' append defaults (2026-09-23
drag-to-reorder spec §3.2, §3.3, §8.3, §8.4). The route is change-logged, so its Undo is
proven end to end through the Activity card's own endpoint."""

from uuid import UUID

import pytest
from sqlalchemy import select

from app.models import Account, ChangeLog
from app.services.changelog import OVERLAP_REFUSAL
from tests.ordering_helpers import flushed_updates

NW = "/api/v1/net-worth"
ORDER = f"{NW}/accounts/order"
ACTIVITY = "/api/v1/activity"
STALE = "The accounts changed since this list was loaded — nothing was moved."


async def seed_accounts(db) -> dict[str, int]:
    """Prod's shape (spec §0): workbook column indexes with a tie (3/3) and gaps, and a
    retired row. GET order is (sort_order, id): Checking, Savings, Old Card, Brokerage."""
    rows = [
        Account(name="Checking", slug="checking", group="cash", sort_order=3),
        Account(name="Savings", slug="savings", group="cash", sort_order=3),
        Account(
            name="Old Card", slug="old-card", group="liability", sort_order=29, is_active=False
        ),
        Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=55),
    ]
    db.add_all(rows)
    await db.commit()
    return {row.name: row.id for row in rows}


async def seed_numbered(db, *names: str, group: str = "cash") -> list[int]:
    """Already-normalized rows 0…n−1, so a move's written set is easy to predict."""
    rows = [
        Account(name=name, slug=name.lower(), group=group, sort_order=index)
        for index, name in enumerate(names)
    ]
    db.add_all(rows)
    await db.commit()
    return [row.id for row in rows]


async def stored_orders(db) -> list[tuple[int, int]]:
    rows = await db.execute(select(Account.id, Account.sort_order).order_by(Account.id))
    return [(row.id, row.sort_order) for row in rows]


async def test_reorder_requires_auth(client):
    assert (await client.put(ORDER, json={"ids": [1]})).status_code == 401


async def test_reorder_renumbers_every_row_and_answers_in_the_new_order(auth_client, db):
    ids = await seed_accounts(db)
    new = [ids["Brokerage"], ids["Checking"], ids["Savings"], ids["Old Card"]]
    resp = await auth_client.put(ORDER, json={"ids": new})
    assert resp.status_code == 200, resp.text
    assert [(a["id"], a["sort_order"]) for a in resp.json()] == [
        (account_id, index) for index, account_id in enumerate(new)
    ]
    assert resp.headers["x-change-batch"]
    listed = (await auth_client.get(f"{NW}/accounts")).json()
    assert [a["id"] for a in listed] == new  # the follow-up GET agrees with the answer


async def test_an_unchanged_order_writes_and_logs_nothing(auth_client, db):
    ids = await seed_accounts(db)
    current = [ids["Checking"], ids["Savings"], ids["Old Card"], ids["Brokerage"]]
    with flushed_updates(db, Account) as written:
        resp = await auth_client.put(ORDER, json={"ids": current})
    assert resp.status_code == 200, resp.text
    # Nothing was even SET: a set attribute is dirty until a flush, and no flush may come.
    assert not db.dirty
    # Not even normalized: the tie and the gaps stay until something actually moves.
    assert [(a["id"], a["sort_order"]) for a in resp.json()] == [
        (ids["Checking"], 3),
        (ids["Savings"], 3),
        (ids["Old Card"], 29),
        (ids["Brokerage"], 55),
    ]
    assert "x-change-batch" not in resp.headers
    assert written == set()
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


@pytest.mark.parametrize("shape", ["missing", "extra", "retired left out"])
async def test_a_stale_list_409s_with_the_sentence_and_moves_nothing(auth_client, db, shape):
    ids = await seed_accounts(db)
    before = await stored_orders(db)
    body = {
        "missing": [ids["Brokerage"], ids["Checking"], ids["Old Card"]],
        "extra": [ids["Brokerage"], ids["Checking"], ids["Savings"], ids["Old Card"], 999],
        # Retired rows keep their slots and must be sent too (spec §9).
        "retired left out": [ids["Brokerage"], ids["Checking"], ids["Savings"]],
    }[shape]
    resp = await auth_client.put(ORDER, json={"ids": body})
    assert resp.status_code == 409
    assert resp.json()["detail"] == STALE
    assert await stored_orders(db) == before
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


async def test_a_repeated_id_422s_naming_it(auth_client, db):
    ids = await seed_accounts(db)
    body = [ids["Checking"], ids["Checking"], ids["Savings"], ids["Old Card"], ids["Brokerage"]]
    resp = await auth_client.put(ORDER, json={"ids": body})
    assert resp.status_code == 422
    assert resp.json()["detail"] == f"ids lists {ids['Checking']} more than once"


async def test_an_empty_list_is_a_malformed_body(auth_client, db):
    await seed_accounts(db)
    assert (await auth_client.put(ORDER, json={"ids": []})).status_code == 422


async def test_only_rows_whose_number_moves_are_written_and_logged(auth_client, db):
    a, b, c, d = await seed_numbered(db, "A", "B", "C", "D")
    with flushed_updates(db, Account) as written:
        resp = await auth_client.put(ORDER, json={"ids": [a, b, d, c]})
    assert resp.status_code == 200, resp.text
    assert written == {c, d}
    logged = (await db.execute(select(ChangeLog))).scalars().all()
    assert sorted((r.pk["id"], r.before["sort_order"], r.after["sort_order"]) for r in logged) == [
        (c, 2, 3),
        (d, 3, 2),
    ]
    assert {(r.op, r.table_name, r.source) for r in logged} == {("update", "accounts", "ui")}
    assert {r.batch_id for r in logged} == {UUID(resp.headers["x-change-batch"])}


async def test_the_label_names_a_single_moved_account(auth_client, db):
    a, b, c, d = await seed_numbered(db, "A", "B", "C", "D")
    await auth_client.put(ORDER, json={"ids": [d, a, b, c]})
    labels = set((await db.execute(select(ChangeLog.label))).scalars())
    assert labels == {"Moved account D"}


async def test_the_label_names_a_parent_moved_with_the_components_it_carries(auth_client, db):
    """P carries K (same group). X is also P's component but sits in another group, so the
    Settings table does not nest it under P and it is not part of P's drag."""
    a, b, c = await seed_numbered(db, "A", "B", "C")
    parent = Account(name="P", slug="p", group="cash", sort_order=3)
    db.add(parent)
    await db.flush()
    component = Account(
        name="K",
        slug="k",
        group="cash",
        sort_order=4,
        is_component=True,
        parent_account_id=parent.id,
    )
    elsewhere = Account(
        name="X",
        slug="x",
        group="pre_tax",
        sort_order=5,
        is_component=True,
        parent_account_id=parent.id,
    )
    db.add_all([component, elsewhere])
    await db.commit()
    resp = await auth_client.put(
        ORDER, json={"ids": [parent.id, component.id, a, b, c, elsewhere.id]}
    )
    assert resp.status_code == 200, resp.text
    labels = set((await db.execute(select(ChangeLog.label))).scalars())
    assert labels == {"Moved account P"}


async def test_the_label_counts_the_minimal_moved_set_otherwise(auth_client, db):
    a, b, c, d, e = await seed_numbered(db, "A", "B", "C", "D", "E")
    # Two unrelated swaps: the kept run is B, D, E, so A and C are "the ones that moved".
    await auth_client.put(ORDER, json={"ids": [b, a, d, c, e]})
    labels = set((await db.execute(select(ChangeLog.label))).scalars())
    assert labels == {"Reordered 2 accounts"}


async def test_undo_puts_back_the_exact_previous_numbers(auth_client, db):
    ids = await seed_accounts(db)
    new = [ids["Brokerage"], ids["Old Card"], ids["Savings"], ids["Checking"]]
    moved = await auth_client.put(ORDER, json={"ids": new})
    assert moved.status_code == 200, moved.text
    undo = await auth_client.post(f"{ACTIVITY}/batches/{moved.headers['x-change-batch']}/undo")
    assert undo.status_code == 200, undo.text
    assert undo.json()["label"] == "Undid: Reordered 3 accounts"
    listed = (await auth_client.get(f"{NW}/accounts")).json()
    # The tie and the gaps come back exactly — the undo replays the before images.
    assert [(a["id"], a["sort_order"]) for a in listed] == [
        (ids["Checking"], 3),
        (ids["Savings"], 3),
        (ids["Old Card"], 29),
        (ids["Brokerage"], 55),
    ]


async def test_a_later_edit_of_a_moved_row_makes_the_undo_refuse(auth_client, db):
    ids = await seed_accounts(db)
    new = [ids["Brokerage"], ids["Checking"], ids["Savings"], ids["Old Card"]]
    moved = await auth_client.put(ORDER, json={"ids": new})
    batch_id = moved.headers["x-change-batch"]
    # Brokerage went 55 -> 0, so its row is in the reorder's batch; the rename logs it again.
    renamed = await auth_client.patch(
        f"{NW}/accounts/{ids['Brokerage']}", json={"name": "Taxable Brokerage"}
    )
    assert renamed.status_code == 200, renamed.text
    refused = await auth_client.post(f"{ACTIVITY}/batches/{batch_id}/undo")
    assert refused.status_code == 409
    assert refused.json()["detail"] == OVERLAP_REFUSAL
    listed = (await auth_client.get(f"{NW}/accounts")).json()
    assert [a["id"] for a in listed] == new  # nothing half-undone


# ── the append defaults (spec §3.3) ──────────────────────────────────────────────────


async def test_create_without_a_sort_order_appends_after_the_last_account(auth_client, db):
    first = await auth_client.post(f"{NW}/accounts", json={"name": "Checking", "group": "cash"})
    assert first.status_code == 201, first.text
    assert first.json()["sort_order"] == 0  # an empty table starts at 0
    db.add(Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=55))
    await db.commit()
    second = await auth_client.post(f"{NW}/accounts", json={"name": "Savings", "group": "cash"})
    assert second.json()["sort_order"] == 56
    nulled = await auth_client.post(
        f"{NW}/accounts", json={"name": "HSA", "group": "pre_tax", "sort_order": None}
    )
    assert nulled.json()["sort_order"] == 57
    explicit = await auth_client.post(
        f"{NW}/accounts", json={"name": "IRA", "group": "pre_tax", "sort_order": 4}
    )
    assert explicit.json()["sort_order"] == 4  # an explicit number is still honoured


async def test_a_group_change_appends_the_account_inside_the_same_batch(auth_client, db):
    checking = Account(name="Checking", slug="checking", group="cash", sort_order=1)
    db.add_all([checking, Account(name="Z", slug="z", group="taxable", sort_order=55)])
    await db.commit()
    resp = await auth_client.patch(f"{NW}/accounts/{checking.id}", json={"group": "other"})
    assert resp.status_code == 200, resp.text
    assert (resp.json()["group"], resp.json()["sort_order"]) == ("other", 56)
    [logged] = (await db.execute(select(ChangeLog))).scalars().all()
    assert (logged.before["group"], logged.before["sort_order"]) == ("cash", 1)
    assert (logged.after["group"], logged.after["sort_order"]) == ("other", 56)
    assert logged.label == "Updated account Checking"


async def test_an_explicit_sort_order_wins_and_other_edits_never_move_a_row(auth_client, db):
    checking = Account(name="Checking", slug="checking", group="cash", sort_order=1)
    db.add_all([checking, Account(name="Z", slug="z", group="taxable", sort_order=55)])
    await db.commit()
    url = f"{NW}/accounts/{checking.id}"
    explicit = await auth_client.patch(url, json={"group": "other", "sort_order": 7})
    assert explicit.json()["sort_order"] == 7
    renamed = await auth_client.patch(url, json={"name": "Everyday Checking"})
    assert renamed.json()["sort_order"] == 7
    same_group = await auth_client.patch(url, json={"group": "other"})
    assert same_group.json()["sort_order"] == 7  # not a group CHANGE, so no append
