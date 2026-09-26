"""'Later changes touched these rows — undo those first' is true (2026-09-25 polish L3c): a later
change and the Undo that reversed it cancel out, so undoing the later change makes the older one
undoable again. Undos chain (an Undo of an Undo is a redo) and count by parity; an Undo whose
target is OLDER than the batch being undone is an ordinary later change. The Activity listing's
`undoable` flag and the Undo's own refusal read the same predicate (changelog.superseded)."""

from app.models import SpendingCategory
from app.services.changelog import OVERLAP_REFUSAL
from tests.exact_undo import batch_id_of, images, undo
from tests.ordering_helpers import recorded_sql

SP = "/api/v1/spending"
ORDER = f"{SP}/categories/order"
ACTIVITY = "/api/v1/activity"


async def seed(db) -> list[int]:
    """Food, Rent, Travel at 0, 1, 2."""
    rows = [
        SpendingCategory(name=name, slug=name.lower(), sort_order=index)
        for index, name in enumerate(("Food", "Rent", "Travel"))
    ]
    db.add_all(rows)
    await db.commit()
    return [row.id for row in rows]


async def rename(auth_client, category_id: int, name: str):
    resp = await auth_client.patch(f"{SP}/categories/{category_id}", json={"name": name})
    assert resp.status_code == 200, resp.text
    return resp


async def reorder(auth_client, ids: list[int]):
    resp = await auth_client.put(ORDER, json={"ids": ids})
    assert resp.status_code == 200, resp.text
    return resp


async def undone(auth_client, batch) -> str:
    """Undo `batch`, which must go through; the Undo's own batch id."""
    resp = await undo(auth_client, batch)
    assert resp.status_code == 200, resp.text
    return resp.json()["batch_id"]


async def refused(auth_client, batch) -> None:
    resp = await undo(auth_client, batch)
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == OVERLAP_REFUSAL


async def flag(auth_client, batch) -> bool:
    """The Activity listing's `undoable` for `batch`."""
    wanted = batch_id_of(batch)
    entries = (await auth_client.get(ACTIVITY)).json()["entries"]
    return next(entry for entry in entries if entry.get("batch_id") == wanted)["undoable"]


async def test_undoing_the_later_change_frees_the_older_one_and_a_redo_takes_it_back(
    auth_client, db
):
    """edit → reorder: the edit's Undo refuses. Undo the reorder and it is free — until the
    reorder is redone (an Undo of its Undo), and free again once the redo is undone: a batch
    stands while an even number of Undos sit above it. The listing's flag agrees at every step,
    and the last Undo puts back exactly the rows the edit found."""
    food, rent, travel = await seed(db)
    seeded = await images(db, SpendingCategory)
    edit = await rename(auth_client, food, "Groceries")
    assert await flag(auth_client, edit) is True
    move = await reorder(auth_client, [travel, food, rent])
    assert await flag(auth_client, edit) is False
    await refused(auth_client, edit)
    unmove = await undone(auth_client, move)
    assert await flag(auth_client, edit) is True
    redo = await undone(auth_client, unmove)  # the reorder is in force again
    assert await flag(auth_client, edit) is False
    await refused(auth_client, edit)
    await undone(auth_client, redo)  # three Undos above the reorder: undone again
    assert await flag(auth_client, edit) is True
    await undone(auth_client, edit)
    assert await images(db, SpendingCategory) == seeded


async def test_with_two_later_changes_undoing_one_still_refuses(auth_client, db):
    food, rent, travel = await seed(db)
    seeded = await images(db, SpendingCategory)
    edit = await rename(auth_client, food, "Groceries")
    first = await reorder(auth_client, [rent, food, travel])
    second = await reorder(auth_client, [travel, rent, food])
    await undone(auth_client, second)
    await refused(auth_client, edit)  # the first reorder still stands on the row
    assert await flag(auth_client, edit) is False
    await undone(auth_client, first)  # free too: the second reorder and its Undo cancel
    await undone(auth_client, edit)
    assert await images(db, SpendingCategory) == seeded


async def test_a_redo_refuses_once_an_older_changes_undo_rewrote_its_rows(auth_client, db):
    """An Undo cancels only a change LATER than the batch being undone. Here the edit is older
    than the reorder: once the reorder is undone and then the edit, redoing the reorder would
    write its after-images — which still carry the edit's name — over the row the edit's Undo
    restored, silently re-applying the edit. So the edit's Undo counts against the redo, which
    refuses until the edit is redone first."""
    food, rent, travel = await seed(db)
    edit = await rename(auth_client, food, "Groceries")
    move = await reorder(auth_client, [travel, food, rent])
    in_force = await images(db, SpendingCategory)
    unmove = await undone(auth_client, move)
    unedit = await undone(auth_client, edit)  # free: the reorder and its Undo cancel
    await refused(auth_client, unmove)
    assert await flag(auth_client, unmove) is False
    names = [row["name"] for row in await images(db, SpendingCategory)]
    assert names == ["Food", "Rent", "Travel"]  # the refusal re-applied nothing
    await undone(auth_client, unedit)  # redo the edit first…
    await undone(auth_client, unmove)  # …and the reorder's redo goes through
    assert await images(db, SpendingCategory) == in_force


# The one read of the undo runs (changelog.undo_links): the listing's page query has no WHERE.
UNDO_LINKS_READ = "lifecycle_runs.kind ="


async def test_the_undo_runs_are_read_once_per_request(auth_client, db):
    """Every chain is walked over every successful undo run, so the listing and an Undo each
    read the runs once and hand the one map to both questions they ask — whether a batch was
    undone, and whether a later change still stands over it."""
    food, rent, travel = await seed(db)
    edit = await rename(auth_client, food, "Groceries")
    move = await reorder(auth_client, [travel, food, rent])
    await undone(auth_client, move)  # the edit now has later changes, cancelled
    with recorded_sql(db) as statements:
        assert await flag(auth_client, edit) is True
    assert sum(UNDO_LINKS_READ in sql for sql, _ in statements) == 1
    with recorded_sql(db) as statements:
        await undone(auth_client, edit)
    assert sum(UNDO_LINKS_READ in sql for sql, _ in statements) == 1
