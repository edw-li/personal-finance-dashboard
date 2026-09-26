"""The credit-card router's writes are change-logged (2026-09-25 polish spec §6.1, lane L3b).

Every create, edit and delete — each list reorder and each bulk matrix save too — is ONE batch
with an Activity label and the X-Change-Batch header. The two deletes with dependents image
them through the ORM, children first and the row LAST, so the Activity card's Undo brings
back exactly what went: a card with its credits, cells, limit history AND the categories
pinned to it; a reward category with its cells — every id the same."""

from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import (
    CardCredit,
    ChangeLog,
    CreditCard,
    CreditLimitEvent,
    RewardCategory,
    RewardRate,
)
from app.services.changelog import (
    DEPENDENT_REFUSAL,
    OVERLAP_REFUSAL,
    REPLAY_REFUSAL,
    undo_batch,
)
from app.services.ordering import order_lock, order_locks_for
from tests.exact_undo import images, label_of, logged, shape, table_images, undo
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


def cell(
    card_id: int,
    category_id: int,
    multiplier: str | None,
    cap: str | None = None,
    note: str | None = None,
) -> dict:
    return {
        "card_id": card_id,
        "category_id": category_id,
        "multiplier": multiplier,
        "note": note,
        "monthly_cap": cap,
    }


CARD_TABLES = (CreditCard, CardCredit, RewardRate, CreditLimitEvent, RewardCategory)


async def seed_matrix(db) -> tuple[int, int, int]:
    """Groceries with two cells (one with a note, one with a cap) and Dining with one, on two
    cards. Returns the ids of Venture X, Groceries and Dining."""
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
    return venture.id, groceries.id, dining.id


async def seed_card_graph(db) -> tuple[int, int, int]:
    """Venture X with two credits, two cells, two limit events and the Travel category pinned to
    it, beside SavorOne with a credit, a cell, a limit and the Dining pin of its own. Returns the
    ids of Venture X, SavorOne and Travel."""
    venture = card("Capital One Venture X", annual_fee=Decimal("395.00"), rewards_currency="miles")
    savor = card("SavorOne", 1)
    db.add_all([venture, savor])
    await db.flush()
    travel = category("Travel", pinned_card_id=venture.id)
    dining = category("Dining", 1, pinned_card_id=savor.id)
    groceries = category("Groceries", 2)
    db.add_all([travel, dining, groceries])
    await db.flush()
    db.add_all(
        [
            CardCredit(card_id=venture.id, label="Travel", annual_value=Decimal("300.00")),
            CardCredit(
                card_id=venture.id,
                label="Global Entry",
                annual_value=Decimal("100.00"),
                counts=False,
                reset_cadence="anniversary",
            ),
            CardCredit(card_id=savor.id, label="Streaming", annual_value=Decimal("60.00")),
            RewardRate(
                card_id=venture.id,
                category_id=travel.id,
                multiplier=Decimal("10.00"),
                note="portal",
            ),
            RewardRate(card_id=venture.id, category_id=dining.id, multiplier=Decimal("2.00")),
            RewardRate(
                card_id=savor.id,
                category_id=dining.id,
                multiplier=Decimal("3.00"),
                monthly_cap=Decimal("500.00"),
            ),
            CreditLimitEvent(
                card_id=venture.id, effective_date=date(2023, 5, 12), limit_amount=Decimal("20000")
            ),
            CreditLimitEvent(
                card_id=venture.id,
                effective_date=date(2024, 6, 1),
                limit_amount=Decimal("30000"),
                note="CLI",
            ),
            CreditLimitEvent(
                card_id=savor.id, effective_date=date(2024, 1, 1), limit_amount=Decimal("9000")
            ),
        ]
    )
    await db.commit()
    return venture.id, savor.id, travel.id


async def assert_round_trips(auth_client, db, deleted, tables, whole) -> None:
    """Undo, then an Undo of that Undo (the delete again), then Undo once more: the rows land on
    exactly `whole`, exactly what the delete left, and exactly `whole` again."""
    gone = await table_images(db, *tables)
    batch = deleted
    for expected in (whole, gone, whole):
        resp = await undo(auth_client, batch)
        assert resp.status_code == 200, resp.text
        assert await table_images(db, *tables) == expected
        batch = resp.json()["batch_id"]


# ── reward categories and the matrix ─────────────────────────────────────────────────


async def test_reward_category_create_edit_hide_show_delete_each_log_one_batch(auth_client, db):
    created = await auth_client.post(CATEGORIES, json={"name": "Groceries"})
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert shape(rows) == [("insert", "reward_categories")]
    assert label_of(rows) == "Added reward category Groceries"
    assert rows[0].after["is_active"] is True  # the column default, imaged after the flush
    url = f"{CATEGORIES}/{created.json()['id']}"

    edited = await auth_client.patch(url, json={"annual_spend": "6000"})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert shape(rows) == [("update", "reward_categories")]
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
    assert shape(rows) == [("delete", "reward_categories")]  # no cells: nothing else to image
    assert label_of(rows) == "Deleted reward category Groceries"


async def test_undo_restores_a_deleted_reward_category_with_its_cells(auth_client, db):
    venture_id, groceries_id, dining_id = await seed_matrix(db)
    before = await table_images(db, RewardCategory, RewardRate)
    with recorded_sql(db) as statements:
        deleted = await auth_client.delete(f"{CATEGORIES}/{groceries_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    # Its two cells, then the row LAST: the undo replays in reverse, so the row comes back
    # before the cells that point at it.
    assert shape(rows) == [
        ("delete", "reward_rates"),
        ("delete", "reward_rates"),
        ("delete", "reward_categories"),
    ]
    assert label_of(rows) == "Deleted reward category Groceries"
    # The cells go by their own DELETE, before the row's — never under the FK's cascade.
    assert first_position(statements, "DELETE FROM reward_rates") < first_position(
        statements, "DELETE FROM reward_categories"
    )
    left = await images(db, RewardRate)
    assert [(row["card_id"], row["category_id"]) for row in left] == [(venture_id, dining_id)]
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert resp.json()["rows"] == 3
    assert await table_images(db, RewardCategory, RewardRate) == before


async def test_a_grouped_re_insert_that_breaks_a_constraint_still_refuses_whole(auth_client, db):
    """The Undo re-inserts a reward category's cells in ONE statement. When one of them can no
    longer go back — its card was deleted since — that statement's IntegrityError is still the
    replay refusal, and the category the same Undo had already put back goes again with it."""
    venture, savor, groceries = card("Venture X"), card("SavorOne", 1), category("Groceries")
    db.add_all([venture, savor, groceries])
    await db.flush()
    db.add_all(
        [
            RewardRate(card_id=venture.id, category_id=groceries.id, multiplier=Decimal("2.00")),
            RewardRate(card_id=savor.id, category_id=groceries.id, multiplier=Decimal("3.00")),
        ]
    )
    await db.commit()
    savor_id, groceries_id = savor.id, groceries.id
    deleted = await auth_client.delete(f"{CATEGORIES}/{groceries_id}")
    assert deleted.status_code == 204
    assert (await auth_client.delete(f"{CARDS}/{savor_id}")).status_code == 204
    refused = await undo(auth_client, deleted)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    assert await images(db, RewardCategory) == []
    assert await images(db, RewardRate) == []


async def test_a_reward_category_delete_undone_redone_and_undone_again_gives_the_same_rows(
    auth_client, db
):
    _, groceries_id, _ = await seed_matrix(db)
    tables = (RewardCategory, RewardRate)
    whole = await table_images(db, *tables)
    deleted = await auth_client.delete(f"{CATEGORIES}/{groceries_id}")
    assert deleted.status_code == 204
    await assert_round_trips(auth_client, db, deleted, tables, whole)


async def test_undoing_a_reward_category_delete_after_its_name_was_taken_again_refuses(
    auth_client, db
):
    """Accepted (spec §6.1): name and slug are unique, so the replayed row cannot sit beside the
    new category that took the name — the replay refusal, and none of its cells half-back."""
    venture = card("Venture X")
    db.add(venture)
    await db.commit()
    v = venture.id
    created = await auth_client.post(CATEGORIES, json={"name": "Groceries"})
    assert created.status_code == 201, created.text
    category_id = created.json()["id"]
    assert (await auth_client.put(RATES, json=[cell(v, category_id, "3")])).status_code == 200
    deleted = await auth_client.delete(f"{CATEGORIES}/{category_id}")
    assert deleted.status_code == 204
    again = await auth_client.post(CATEGORIES, json={"name": "Groceries"})
    assert again.status_code == 201, again.text
    again_id = again.json()["id"]
    refused = await undo(auth_client, deleted)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    assert [row["id"] for row in await images(db, RewardCategory)] == [again_id]
    assert await images(db, RewardRate) == []


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
    before = await images(db, RewardRate)
    saved = await auth_client.put(
        RATES, json=[cell(v, t, "5"), cell(v, d, None), cell(v, g, "4", cap="500")]
    )
    assert saved.status_code == 200, saved.text
    rows = await logged(db, saved)
    # Every cell that changed is a row of ONE batch: the edit and the clear in the order sent,
    # the new cell once the flush has given it an id.
    assert shape(rows) == [
        ("update", "reward_rates"),
        ("delete", "reward_rates"),
        ("insert", "reward_rates"),
    ]
    assert label_of(rows) == "Edited 3 reward multipliers"
    assert (rows[0].before["multiplier"], rows[0].after["multiplier"]) == ("2.00", "5.00")
    assert rows[2].after["monthly_cap"] == "500.00"
    resp = await undo(auth_client, saved)
    assert resp.status_code == 200, resp.text
    assert await images(db, RewardRate) == before


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


async def test_a_matrix_save_is_named_for_what_it_changed(auth_client, db):
    """A cell whose multiplier was added, changed or cleared counts as a multiplier; a cell
    whose multiplier stayed while its note or monthly cap moved — its condition, the ⁺ the
    matrix shows — is named as a condition, never as an edited multiplier."""
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
    capped = await auth_client.put(RATES, json=[cell(v, t, "2", cap="500")])
    assert label_of(await logged(db, capped)) == "Edited the condition on 1 reward multiplier"
    noted = await auth_client.put(
        RATES, json=[cell(v, t, "2", cap="500", note="portal"), cell(v, d, "3", note="Uber only")]
    )
    assert label_of(await logged(db, noted)) == "Edited the conditions on 2 reward multipliers"
    mixed = await auth_client.put(
        RATES, json=[cell(v, t, "5", cap="500", note="portal"), cell(v, d, "3"), cell(v, g, "4")]
    )
    assert label_of(await logged(db, mixed)) == (
        "Edited 2 reward multipliers and the condition on 1 more"
    )


async def test_a_matrix_save_that_fails_partway_records_nothing(auth_client, db):
    """ATOMIC (the route's own word): the 422 on the third cell comes after the first was
    cleared and the second changed in the session — and still no batch is named, nothing is
    logged and no cell is written."""
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
    before = await images(db, RewardRate)
    failed = await auth_client.put(RATES, json=[cell(v, t, None), cell(v, d, "5"), cell(v, g, "0")])
    assert failed.status_code == 422, failed.text
    assert failed.json()["detail"] == "multiplier must be positive"
    assert "x-change-batch" not in failed.headers
    assert (await db.execute(select(ChangeLog))).scalars().all() == []  # not even in the session
    await db.rollback()  # what the request's own session does on its way out
    assert (await db.execute(select(ChangeLog))).scalars().all() == []
    assert await images(db, RewardRate) == before


# ── cards, their credits and their limit history ─────────────────────────────────────


def card_body(name: str = "Capital One Venture X", **over) -> dict:
    """A full CreditCardIn: PATCH is a full replace, so every edit sends all of it."""
    body = {
        "name": name,
        "annual_fee": "395.00",
        "rewards_currency": "miles",
        "point_value_cents": "1.7",
        "primary_holder": "Ed",
        "authorized_users": None,
        "opened_on": "2023-05-12",
        "is_active": True,
        "account_id": None,
        "notes": None,
        "person_id": None,
    }
    body.update(over)
    return body


async def test_card_create_edit_archive_delete_each_log_one_batch(auth_client, db):
    created = await auth_client.post(CARDS, json=card_body())
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert shape(rows) == [("insert", "credit_cards")]
    assert label_of(rows) == "Added card Capital One Venture X"
    assert rows[0].after["point_value_cents"] == "1.7000"
    url = f"{CARDS}/{created.json()['id']}"

    edited = await auth_client.patch(url, json=card_body(annual_fee="0"))
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert shape(rows) == [("update", "credit_cards")]
    assert label_of(rows) == "Edited card Capital One Venture X"
    assert (rows[0].before["annual_fee"], rows[0].after["annual_fee"]) == ("395.00", "0.00")
    # The roster's one-click toggle (a full PATCH with is_active flipped), named as the button.
    archived = await auth_client.patch(url, json=card_body(annual_fee="0", is_active=False))
    assert label_of(await logged(db, archived)) == "Archived card Capital One Venture X"
    unarchived = await auth_client.patch(url, json=card_body(annual_fee="0"))
    assert label_of(await logged(db, unarchived)) == "Unarchived card Capital One Venture X"
    unchanged = await auth_client.patch(url, json=card_body(annual_fee="0.00"))
    assert unchanged.status_code == 200 and "x-change-batch" not in unchanged.headers

    deleted = await auth_client.delete(url)
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert shape(rows) == [("delete", "credit_cards")]  # a bare card: nothing else to image
    assert label_of(rows) == "Deleted card Capital One Venture X"


async def test_undo_restores_a_deleted_card_with_its_credits_cells_limits_and_pins(auth_client, db):
    venture_id, savor_id, travel_id = await seed_card_graph(db)
    tables = CARD_TABLES
    before = await table_images(db, *tables)
    with recorded_sql(db) as statements:
        deleted = await auth_client.delete(f"{CARDS}/{venture_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    # The pin first (an UPDATE to NULL), then every child, then the card LAST — the undo
    # replays in reverse, so the card is back before anything that points at it.
    assert shape(rows) == [
        ("update", "reward_categories"),
        ("delete", "card_credits"),
        ("delete", "card_credits"),
        ("delete", "reward_rates"),
        ("delete", "reward_rates"),
        ("delete", "credit_limit_events"),
        ("delete", "credit_limit_events"),
        ("delete", "credit_cards"),
    ]
    assert label_of(rows) == "Deleted card Capital One Venture X"
    assert rows[0].pk == {"id": travel_id}
    assert (rows[0].before["pinned_card_id"], rows[0].after["pinned_card_id"]) == (venture_id, None)
    # All of it reaches the database before the card's own DELETE — never the FKs' cascade.
    card_delete = first_position(statements, "DELETE FROM credit_cards")
    for fragment in (
        "UPDATE reward_categories",
        "DELETE FROM card_credits",
        "DELETE FROM reward_rates",
        "DELETE FROM credit_limit_events",
    ):
        assert first_position(statements, fragment) < card_delete, fragment
    # SavorOne keeps everything of its own, and its pin.
    gone = await table_images(db, *tables)
    children = gone["card_credits"] + gone["reward_rates"] + gone["credit_limit_events"]
    assert {row["card_id"] for row in children} == {savor_id}
    assert [row["pinned_card_id"] for row in gone["reward_categories"]] == [None, savor_id, None]
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == "Undid: Deleted card Capital One Venture X"
    assert await table_images(db, *tables) == before


async def test_a_card_delete_undone_redone_and_undone_again_gives_the_same_rows(auth_client, db):
    venture_id, _, _ = await seed_card_graph(db)
    whole = await table_images(db, *CARD_TABLES)
    deleted = await auth_client.delete(f"{CARDS}/{venture_id}")
    assert deleted.status_code == 204
    await assert_round_trips(auth_client, db, deleted, CARD_TABLES, whole)


async def test_undoing_a_card_delete_after_its_name_was_taken_again_refuses(auth_client, db):
    """Accepted (spec §6.1): a card's name is unique, so the replayed card cannot sit beside
    the new one that took it — the replay refusal, and nothing half-restored."""
    card_id = (await auth_client.post(CARDS, json=card_body())).json()["id"]
    credit = await auth_client.post(
        f"{CARDS}/{card_id}/credits", json={"label": "Travel", "annual_value": "300"}
    )
    assert credit.status_code == 201, credit.text
    deleted = await auth_client.delete(f"{CARDS}/{card_id}")
    again = await auth_client.post(CARDS, json=card_body())
    assert again.status_code == 201, again.text
    again_id = again.json()["id"]
    refused = await undo(auth_client, deleted)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    rows = await table_images(db, CreditCard, CardCredit)
    assert [row["id"] for row in rows["credit_cards"]] == [again_id]
    assert rows["card_credits"] == []


async def test_undoing_a_card_create_while_rows_point_at_it_refuses(auth_client, db):
    """Accepted (spec §6.1): the replayed DELETE would cascade a credit the create never
    imaged, so the Undo asks for the change that added it to be undone first."""
    created = await auth_client.post(CARDS, json=card_body())
    card_id = created.json()["id"]
    credit = await auth_client.post(
        f"{CARDS}/{card_id}/credits", json={"label": "Travel", "annual_value": "300"}
    )
    assert credit.status_code == 201, credit.text
    refused = await undo(auth_client, created)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == DEPENDENT_REFUSAL
    assert len(await images(db, CardCredit)) == 1


async def test_card_credit_writes_each_log_one_batch_and_a_delete_undoes(auth_client, db):
    card_id = (await auth_client.post(CARDS, json=card_body("Venture X"))).json()["id"]
    created = await auth_client.post(
        f"{CARDS}/{card_id}/credits", json={"label": "Travel", "annual_value": "300"}
    )
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert shape(rows) == [("insert", "card_credits")]
    assert label_of(rows) == "Added the $300 Travel credit to Venture X"
    credit_url = f"{CARDS}/credits/{created.json()['id']}"

    edited = await auth_client.patch(
        credit_url, json={"label": "Travel", "annual_value": "300", "counts": False}
    )
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert shape(rows) == [("update", "card_credits")]
    assert label_of(rows) == "Edited the Travel credit on Venture X"
    assert (rows[0].before["counts"], rows[0].after["counts"]) == (True, False)

    before = await images(db, CardCredit)
    deleted = await auth_client.delete(credit_url)
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert shape(rows) == [("delete", "card_credits")]
    assert label_of(rows) == "Deleted the $300 Travel credit from Venture X"
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert await images(db, CardCredit) == before


async def test_a_credit_edit_that_fails_validation_records_nothing(auth_client, db):
    """update_card_credit validates before it mutates: its 422 leaves the row untouched in the
    session as well as in the log."""
    card_id = (await auth_client.post(CARDS, json=card_body("Venture X"))).json()["id"]
    created = await auth_client.post(
        f"{CARDS}/{card_id}/credits", json={"label": "Travel", "annual_value": "300"}
    )
    assert created.status_code == 201, created.text
    credit_id = created.json()["id"]
    logged_before = (await db.execute(select(func.count()).select_from(ChangeLog))).scalar_one()
    before = await images(db, CardCredit)
    failed = await auth_client.patch(
        f"{CARDS}/credits/{credit_id}", json={"label": "Airline", "annual_value": "-1"}
    )
    assert failed.status_code == 422, failed.text
    assert failed.json()["detail"] == "annual_value must be non-negative"
    assert "x-change-batch" not in failed.headers
    assert not db.dirty  # not even the label moved
    count = (await db.execute(select(func.count()).select_from(ChangeLog))).scalar_one()
    assert count == logged_before
    assert await images(db, CardCredit) == before


async def test_a_credit_label_that_already_says_credit_is_not_doubled(auth_client, db):
    card_id = (await auth_client.post(CARDS, json=card_body("Venture X"))).json()["id"]
    created = await auth_client.post(
        f"{CARDS}/{card_id}/credits", json={"label": "Airline credit", "annual_value": "1234.5"}
    )
    assert created.status_code == 201, created.text
    assert label_of(await logged(db, created)) == "Added the $1,234.50 Airline credit to Venture X"


async def test_limit_add_and_delete_each_log_one_batch_and_a_delete_undoes(auth_client, db):
    card_id = (await auth_client.post(CARDS, json=card_body("Venture X"))).json()["id"]
    added = await auth_client.post(
        f"{CARDS}/{card_id}/limits",
        json={"effective_date": "2023-05-12", "limit_amount": "20000", "note": "opening line"},
    )
    assert added.status_code == 201, added.text
    assert [event["limit_amount"] for event in added.json()] == ["20000.00"]  # the history
    rows = await logged(db, added)
    assert shape(rows) == [("insert", "credit_limit_events")]
    assert label_of(rows) == "Added Venture X's $20,000 limit from May 12, 2023"
    event_id = added.json()[0]["id"]

    before = await images(db, CreditLimitEvent)
    deleted = await auth_client.delete(f"{CARDS}/{card_id}/limits/{event_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert shape(rows) == [("delete", "credit_limit_events")]
    assert label_of(rows) == "Deleted Venture X's $20,000 limit from May 12, 2023"
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert await images(db, CreditLimitEvent) == before


# ── the two list reorders ────────────────────────────────────────────────────────────

CARD_ORDER = f"{CARDS}/order"
CATEGORY_ORDER = f"{CATEGORIES}/order"


async def sort_orders(db, model) -> list[tuple[int, int]]:
    rows = await db.execute(select(model.id, model.sort_order).order_by(model.sort_order, model.id))
    return [tuple(row) for row in rows]


async def test_a_card_reorder_is_one_batch_named_for_what_moved(auth_client, db):
    seeded = [card("A"), card("B", 1), card("C", 2)]
    db.add_all(seeded)
    await db.commit()
    a, b, c = (row.id for row in seeded)
    moved = await auth_client.put(CARD_ORDER, json={"ids": [c, a, b]})
    assert moved.status_code == 200, moved.text
    rows = await logged(db, moved)
    assert shape(rows) == [("update", "credit_cards")] * 3
    assert label_of(rows) == "Moved card C"
    assert [(r.pk["id"], r.before["sort_order"], r.after["sort_order"]) for r in rows] == [
        (c, 2, 0),
        (a, 0, 1),
        (b, 1, 2),
    ]
    swapped = await auth_client.put(CARD_ORDER, json={"ids": [b, a, c]})
    assert label_of(await logged(db, swapped)) == "Reordered 2 cards"
    same = await auth_client.put(CARD_ORDER, json={"ids": [b, a, c]})
    assert same.status_code == 200 and "x-change-batch" not in same.headers


async def test_undoing_an_older_card_edit_refuses_until_the_reorder_is_undone(auth_client, db):
    """Why the reorder is logged at all (spec §6.1): the edit's Undo writes the card's whole
    old row back, sort_order included, so after an unlogged reorder it would silently move
    the card. Logged, the reorder is a later change to the same row: undo that first — and
    then the edit's Undo goes through (a change and its standing Undo cancel out,
    changelog.superseded), putting back exactly the rows it found."""
    seeded = [card("A"), card("B", 1), card("C", 2)]
    db.add_all(seeded)
    await db.commit()
    a, b, c = (row.id for row in seeded)
    before = await images(db, CreditCard)
    edited = await auth_client.patch(f"{CARDS}/{b}", json=card_body("B"))
    assert edited.status_code == 200, edited.text
    reordered = await auth_client.put(CARD_ORDER, json={"ids": [b, a, c]})
    assert reordered.status_code == 200, reordered.text
    refused = await undo(auth_client, edited)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == OVERLAP_REFUSAL
    assert await sort_orders(db, CreditCard) == [(b, 0), (a, 1), (c, 2)]  # nothing moved back
    resp = await undo(auth_client, reordered)
    assert resp.status_code == 200, resp.text
    assert await sort_orders(db, CreditCard) == [(a, 0), (b, 1), (c, 2)]
    retried = await undo(auth_client, edited)
    assert retried.status_code == 200, retried.text
    assert await images(db, CreditCard) == before


async def test_a_reward_category_reorder_is_one_batch_named_for_what_moved(auth_client, db):
    seeded = [category("Dining"), category("Groceries", 1), category("Travel", 2)]
    db.add_all(seeded)
    await db.commit()
    d, g, t = (row.id for row in seeded)
    moved = await auth_client.put(CATEGORY_ORDER, json={"ids": [t, d, g]})
    assert moved.status_code == 200, moved.text
    rows = await logged(db, moved)
    assert shape(rows) == [("update", "reward_categories")] * 3
    assert label_of(rows) == "Moved reward category Travel"
    swapped = await auth_client.put(CATEGORY_ORDER, json={"ids": [g, d, t]})
    assert label_of(await logged(db, swapped)) == "Reordered 2 reward categories"
    same = await auth_client.put(CATEGORY_ORDER, json={"ids": [g, d, t]})
    assert same.status_code == 200 and "x-change-batch" not in same.headers


async def test_undoing_an_older_reward_category_edit_refuses_until_the_reorder_is_undone(
    auth_client, db
):
    seeded = [category("Dining"), category("Groceries", 1), category("Travel", 2)]
    db.add_all(seeded)
    await db.commit()
    d, g, t = (row.id for row in seeded)
    before = await images(db, RewardCategory)
    edited = await auth_client.patch(f"{CATEGORIES}/{g}", json={"annual_spend": "6000"})
    assert edited.status_code == 200, edited.text
    reordered = await auth_client.put(CATEGORY_ORDER, json={"ids": [g, d, t]})
    assert reordered.status_code == 200, reordered.text
    refused = await undo(auth_client, edited)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == OVERLAP_REFUSAL
    resp = await undo(auth_client, reordered)
    assert resp.status_code == 200, resp.text
    assert await sort_orders(db, RewardCategory) == [(d, 0), (g, 1), (t, 2)]
    retried = await undo(auth_client, edited)
    assert retried.status_code == 200, retried.text
    assert await images(db, RewardCategory) == before


def test_an_undo_takes_the_card_lists_locks_after_the_workbook_lists():
    """One fixed order for every path that takes several order locks (reorder plan decision
    16): an Undo whose batch spans lists takes the workbook's first and the two dashboard-only
    card lists last — the importer never takes those, so they can close no cycle with it."""
    tables = {"reward_categories", "credit_cards", "accounts", "card_credits"}
    keys = [lock.compile().params["key"] for lock in order_locks_for(tables)]
    assert keys == ["reorder:accounts", "reorder:credit_cards", "reorder:reward_categories"]


@pytest.mark.parametrize(
    "model", [CreditCard, RewardCategory], ids=["credit_cards", "reward_categories"]
)
async def test_an_undo_of_a_card_list_reorder_waits_for_its_lists_order_lock(
    auth_client, db, engine, model
):
    """Decision 16, now that these reorders are logged: an Activity-card Undo rewrites the
    list's numbers, so while another session holds the list's order lock (a reorder or an
    append in flight in another tab) the Undo waits — here out to a short lock_timeout,
    having written nothing — and goes through once the lock is free."""
    seeded = [card("A"), card("B", 1)] if model is CreditCard else [category("A"), category("B", 1)]
    db.add_all(seeded)
    await db.commit()
    a, b = (row.id for row in seeded)
    path = CARD_ORDER if model is CreditCard else CATEGORY_ORDER
    reordered = await auth_client.put(path, json={"ids": [b, a]})
    assert reordered.status_code == 200, reordered.text
    batch_id = UUID(reordered.headers["x-change-batch"])
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as holder:
        await holder.execute(order_lock(model))  # a reorder or an append in flight elsewhere
        async with sessions() as undoing:
            await undoing.execute(text("SET LOCAL lock_timeout = '200ms'"))
            with pytest.raises(DBAPIError, match="lock timeout"):
                await undo_batch(undoing, batch_id, actor="tab 2")
        assert await sort_orders(db, model) == [(b, 0), (a, 1)]  # nothing undone meanwhile
    async with sessions() as undoing:  # the holder's transaction is over: the lock is free
        await undo_batch(undoing, batch_id, actor="tab 2")
    assert await sort_orders(db, model) == [(a, 0), (b, 1)]
