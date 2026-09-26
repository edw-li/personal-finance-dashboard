"""The credit-card router's writes are change-logged (2026-09-25 polish spec §6.1, lane L3b).

Every create, edit and delete — each list reorder and each bulk matrix save too — is ONE batch
with an Activity label and the X-Change-Batch header. The two deletes with dependents image
them through the ORM, children first and the row LAST, so the Activity card's Undo brings
back exactly what went: a card with its credits, cells, limit history AND the categories
pinned to it; a reward category with its cells — every id the same."""

from decimal import Decimal

from app.models import CreditCard, RewardCategory, RewardRate
from tests.changelog_asserts import label_of, logged, ops, table_rows, undo
from tests.ordering_helpers import first_position, recorded_sql

CARDS = "/api/v1/credit-cards"
CATEGORIES = f"{CARDS}/categories"
RATES = f"{CARDS}/rates"


def card(name: str, sort_order: int = 0, **over) -> CreditCard:
    fields = {
        "name": name,
        "slug": name.lower().replace(" ", "-"),
        "annual_fee": Decimal("0.00"),
        "rewards_currency": "cash",
        "point_value_cents": Decimal("1.0000"),
        "sort_order": sort_order,
    }
    fields.update(over)
    return CreditCard(**fields)


def category(name: str, sort_order: int = 0, **over) -> RewardCategory:
    return RewardCategory(name=name, slug=name.lower(), sort_order=sort_order, **over)


def cell(card_id: int, category_id: int, multiplier: str | None, cap: str | None = None) -> dict:
    return {
        "card_id": card_id,
        "category_id": category_id,
        "multiplier": multiplier,
        "note": None,
        "monthly_cap": cap,
    }


# ── reward categories and the matrix ─────────────────────────────────────────────────


async def test_reward_category_create_edit_hide_show_delete_each_log_one_batch(auth_client, db):
    created = await auth_client.post(CATEGORIES, json={"name": "Groceries"})
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "reward_categories")]
    assert label_of(rows) == "Added reward category Groceries"
    assert rows[0].after["is_active"] is True  # the column default, imaged after the flush
    url = f"{CATEGORIES}/{created.json()['id']}"

    edited = await auth_client.patch(url, json={"annual_spend": "6000"})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "reward_categories")]
    assert label_of(rows) == "Edited reward category Groceries"
    # The one-click toggle is named with its button's own verb (the Hide / Show column).
    hidden = await auth_client.patch(url, json={"is_active": False})
    assert label_of(await logged(db, hidden)) == "Hid reward category Groceries"
    shown = await auth_client.patch(url, json={"is_active": True})
    assert label_of(await logged(db, shown)) == "Showed reward category Groceries"
    unchanged = await auth_client.patch(url, json={"annual_spend": "6000.00"})
    assert unchanged.status_code == 200 and "x-change-batch" not in unchanged.headers

    deleted = await auth_client.delete(url)
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "reward_categories")]  # no cells: nothing else to image
    assert label_of(rows) == "Deleted reward category Groceries"


async def test_undo_restores_a_deleted_reward_category_with_its_cells(auth_client, db):
    venture, savor = card("Venture X"), card("SavorOne", 1)
    groceries, dining = category("Groceries"), category("Dining", 1)
    db.add_all([venture, savor, groceries, dining])
    await db.flush()
    db.add_all(
        [
            RewardRate(
                card_id=venture.id,
                category_id=groceries.id,
                multiplier=Decimal("2.00"),
                note="Amex offer",
            ),
            RewardRate(
                card_id=savor.id,
                category_id=groceries.id,
                multiplier=Decimal("3.00"),
                monthly_cap=Decimal("500.00"),
            ),
            RewardRate(card_id=venture.id, category_id=dining.id, multiplier=Decimal("4.00")),
        ]
    )
    await db.commit()
    venture_id, groceries_id, dining_id = venture.id, groceries.id, dining.id
    before = await table_rows(db, RewardCategory, RewardRate)
    with recorded_sql(db) as statements:
        deleted = await auth_client.delete(f"{CATEGORIES}/{groceries_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    # Its two cells, then the row LAST: the undo replays in reverse, so the row comes back
    # before the cells that point at it.
    assert ops(rows) == [
        ("delete", "reward_rates"),
        ("delete", "reward_rates"),
        ("delete", "reward_categories"),
    ]
    assert label_of(rows) == "Deleted reward category Groceries"
    # The cells go by their own DELETE, before the row's — never under the FK's cascade.
    assert first_position(statements, "DELETE FROM reward_rates") < first_position(
        statements, "DELETE FROM reward_categories"
    )
    left = (await table_rows(db, RewardRate))["reward_rates"]
    assert [(row["card_id"], row["category_id"]) for row in left] == [(venture_id, dining_id)]
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert resp.json()["rows"] == 3
    assert await table_rows(db, RewardCategory, RewardRate) == before


async def test_a_matrix_save_that_adds_changes_and_clears_is_one_batch_undone_whole(
    auth_client, db
):
    venture = card("Venture X")
    travel, dining, groceries = category("Travel"), category("Dining", 1), category("Groceries", 2)
    db.add_all([venture, travel, dining, groceries])
    await db.flush()
    db.add_all(
        [
            RewardRate(card_id=venture.id, category_id=travel.id, multiplier=Decimal("2.00")),
            RewardRate(card_id=venture.id, category_id=dining.id, multiplier=Decimal("3.00")),
        ]
    )
    await db.commit()
    v, t, d, g = venture.id, travel.id, dining.id, groceries.id
    before = await table_rows(db, RewardRate)
    saved = await auth_client.put(
        RATES, json=[cell(v, t, "5"), cell(v, d, None), cell(v, g, "4", cap="500")]
    )
    assert saved.status_code == 200, saved.text
    rows = await logged(db, saved)
    # Every cell that changed is a row of ONE batch: the edit and the clear in the order sent,
    # the new cell once the flush has given it an id.
    assert ops(rows) == [
        ("update", "reward_rates"),
        ("delete", "reward_rates"),
        ("insert", "reward_rates"),
    ]
    assert label_of(rows) == "Edited 3 reward multipliers"
    assert (rows[0].before["multiplier"], rows[0].after["multiplier"]) == ("2.00", "5.00")
    assert rows[2].after["monthly_cap"] == "500.00"
    resp = await undo(auth_client, saved)
    assert resp.status_code == 200, resp.text
    assert await table_rows(db, RewardRate) == before


async def test_a_one_cell_save_is_singular_and_an_unchanged_save_names_no_batch(auth_client, db):
    venture, travel = card("Venture X"), category("Travel")
    db.add_all([venture, travel])
    await db.commit()
    v, t = venture.id, travel.id
    first = await auth_client.put(RATES, json=[cell(v, t, "2")])
    assert first.status_code == 200, first.text
    assert label_of(await logged(db, first)) == "Edited 1 reward multiplier"
    again = await auth_client.put(RATES, json=[cell(v, t, "2.00")])
    assert again.status_code == 200, again.text
    assert "x-change-batch" not in again.headers
