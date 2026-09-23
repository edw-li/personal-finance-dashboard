"""PUT /credit-cards/order, PUT /credit-cards/categories/order and their append/keep
defaults (2026-09-23 drag-to-reorder spec §3.2, §3.3, §8.3). Both routes are unlogged like
the rest of the credit-cards router; the client's Undo re-sends the previous order."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import ChangeLog, CreditCard, CreditLimitEvent, RewardCategory
from tests.ordering_helpers import flushed_updates

CARDS = "/api/v1/credit-cards"
CARD_ORDER = f"{CARDS}/order"
CATEGORY_ORDER = f"{CARDS}/categories/order"
STALE_CARDS = "The cards changed since this list was loaded — nothing was moved."
STALE_REWARD = "The reward categories changed since this list was loaded — nothing was moved."


def card_body(name: str, **over) -> dict:
    """A full CreditCardIn WITHOUT sort_order — the shape the UI sends from now on."""
    body = {
        "name": name,
        "annual_fee": "95.00",
        "rewards_currency": "points",
        "point_value_cents": "1.25",
        "primary_holder": None,
        "authorized_users": None,
        "opened_on": None,
        "is_active": True,
        "account_id": None,
        "notes": None,
        "person_id": None,
    }
    body.update(over)
    return body


def card(name: str, sort_order: int = 0, is_active: bool = True) -> CreditCard:
    return CreditCard(
        name=name,
        slug=name.lower().replace(" ", "-"),
        annual_fee=Decimal("0"),
        rewards_currency="cash",
        point_value_cents=Decimal("1"),
        is_active=is_active,
        sort_order=sort_order,
    )


async def seed_cards(db) -> dict[str, int]:
    """Prod's shape (spec §0): every card at 0, so the list is in creation order; one is
    inactive; one has a limit history the reorder answer must carry like the GET does."""
    rows = [card("Venture X"), card("SavorOne"), card("Old Card", is_active=False)]
    db.add_all(rows)
    await db.flush()
    db.add(
        CreditLimitEvent(
            card_id=rows[1].id, effective_date=date(2024, 1, 1), limit_amount=Decimal("9000")
        )
    )
    await db.commit()
    return {row.name: row.id for row in rows}


async def seed_reward_categories(db) -> dict[str, int]:
    rows = [
        RewardCategory(name="Dining", slug="dining", sort_order=0),
        RewardCategory(name="Groceries", slug="groceries", sort_order=1),
        RewardCategory(name="Travel", slug="travel", sort_order=2, is_active=False),
    ]
    db.add_all(rows)
    await db.commit()
    return {row.name: row.id for row in rows}


async def test_both_reorders_require_auth(client):
    assert (await client.put(CARD_ORDER, json={"ids": [1]})).status_code == 401
    assert (await client.put(CATEGORY_ORDER, json={"ids": [1]})).status_code == 401


# ── cards ────────────────────────────────────────────────────────────────────────────


async def test_card_reorder_answers_exactly_as_the_list_get_does(auth_client, db):
    ids = await seed_cards(db)
    new = [ids["Old Card"], ids["SavorOne"], ids["Venture X"]]
    resp = await auth_client.put(CARD_ORDER, json={"ids": new})
    assert resp.status_code == 200, resp.text
    assert [(c["id"], c["sort_order"]) for c in resp.json()] == [
        (card_id, index) for index, card_id in enumerate(new)
    ]
    assert resp.json()[1]["current_limit"] == "9000.00"  # children ride along, as in the GET
    assert resp.json() == (await auth_client.get(CARDS)).json()
    assert (await db.execute(select(ChangeLog))).scalars().all() == []  # unlogged


async def test_an_unchanged_card_order_writes_nothing(auth_client, db):
    ids = await seed_cards(db)
    current = [ids["Venture X"], ids["SavorOne"], ids["Old Card"]]
    with flushed_updates(db, CreditCard) as written:
        resp = await auth_client.put(CARD_ORDER, json={"ids": current})
    assert resp.status_code == 200, resp.text
    assert [c["sort_order"] for c in resp.json()] == [0, 0, 0]  # not normalized
    assert written == set()


async def test_only_cards_whose_number_moves_are_written(auth_client, db):
    rows = [card("A", 0), card("B", 1), card("C", 2)]
    db.add_all(rows)
    await db.commit()
    a, b, c = (row.id for row in rows)
    with flushed_updates(db, CreditCard) as written:
        resp = await auth_client.put(CARD_ORDER, json={"ids": [a, c, b]})
    assert resp.status_code == 200, resp.text
    assert written == {b, c}


@pytest.mark.parametrize("shape", ["missing", "extra", "inactive left out"])
async def test_a_stale_card_list_409s_with_the_sentence(auth_client, db, shape):
    ids = await seed_cards(db)
    body = {
        "missing": [ids["SavorOne"], ids["Old Card"]],
        "extra": [ids["SavorOne"], ids["Venture X"], ids["Old Card"], 999],
        "inactive left out": [ids["SavorOne"], ids["Venture X"]],
    }[shape]
    resp = await auth_client.put(CARD_ORDER, json={"ids": body})
    assert resp.status_code == 409
    assert resp.json()["detail"] == STALE_CARDS
    assert [c["id"] for c in (await auth_client.get(CARDS)).json()] == [
        ids["Venture X"],
        ids["SavorOne"],
        ids["Old Card"],
    ]


async def test_a_repeated_card_id_422s_naming_it(auth_client, db):
    ids = await seed_cards(db)
    body = [ids["SavorOne"], ids["SavorOne"], ids["Venture X"], ids["Old Card"]]
    resp = await auth_client.put(CARD_ORDER, json={"ids": body})
    assert resp.status_code == 422
    assert resp.json()["detail"] == f"ids lists {ids['SavorOne']} more than once"


async def test_a_card_created_without_a_sort_order_appends(auth_client, db):
    first = await auth_client.post(CARDS, json=card_body("Venture X"))
    assert first.status_code == 201, first.text
    assert first.json()["sort_order"] == 0  # an empty table starts at 0
    db.add(card("Legacy", sort_order=6))
    await db.commit()
    second = await auth_client.post(CARDS, json=card_body("SavorOne"))
    assert second.json()["sort_order"] == 7
    nulled = await auth_client.post(CARDS, json=card_body("Freedom", sort_order=None))
    assert nulled.json()["sort_order"] == 8
    explicit = await auth_client.post(CARDS, json=card_body("Amex Gold", sort_order=2))
    assert explicit.json()["sort_order"] == 2


async def test_a_card_patch_without_a_sort_order_keeps_the_stored_one(auth_client, db):
    created = (await auth_client.post(CARDS, json=card_body("Venture X", sort_order=4))).json()
    url = f"{CARDS}/{created['id']}"
    omitted = await auth_client.patch(url, json=card_body("Venture X", annual_fee="0.00"))
    assert omitted.status_code == 200, omitted.text
    assert (omitted.json()["annual_fee"], omitted.json()["sort_order"]) == ("0.00", 4)
    nulled = await auth_client.patch(url, json=card_body("Venture X", sort_order=None))
    assert nulled.json()["sort_order"] == 4
    explicit = await auth_client.patch(url, json=card_body("Venture X", sort_order=1))
    assert explicit.json()["sort_order"] == 1  # full replace still honours a number


# ── reward categories ────────────────────────────────────────────────────────────────


async def test_reward_category_reorder_renumbers_and_matches_the_get(auth_client, db):
    ids = await seed_reward_categories(db)
    new = [ids["Travel"], ids["Dining"], ids["Groceries"]]
    resp = await auth_client.put(CATEGORY_ORDER, json={"ids": new})
    assert resp.status_code == 200, resp.text
    assert [(c["id"], c["sort_order"]) for c in resp.json()] == [
        (category_id, index) for index, category_id in enumerate(new)
    ]
    assert resp.json() == (await auth_client.get(f"{CARDS}/categories")).json()
    assert (await db.execute(select(ChangeLog))).scalars().all() == []  # unlogged


async def test_an_unchanged_reward_category_order_writes_nothing(auth_client, db):
    ids = await seed_reward_categories(db)
    current = [ids["Dining"], ids["Groceries"], ids["Travel"]]
    with flushed_updates(db, RewardCategory) as written:
        resp = await auth_client.put(CATEGORY_ORDER, json={"ids": current})
    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()] == current
    assert written == set()


async def test_only_reward_categories_whose_number_moves_are_written(auth_client, db):
    ids = await seed_reward_categories(db)
    with flushed_updates(db, RewardCategory) as written:
        resp = await auth_client.put(
            CATEGORY_ORDER, json={"ids": [ids["Groceries"], ids["Dining"], ids["Travel"]]}
        )
    assert resp.status_code == 200, resp.text
    assert written == {ids["Groceries"], ids["Dining"]}


@pytest.mark.parametrize("shape", ["missing", "extra"])
async def test_a_stale_reward_category_list_409s_with_the_sentence(auth_client, db, shape):
    ids = await seed_reward_categories(db)
    body = {
        "missing": [ids["Groceries"], ids["Dining"]],
        "extra": [ids["Groceries"], ids["Dining"], ids["Travel"], 999],
    }[shape]
    resp = await auth_client.put(CATEGORY_ORDER, json={"ids": body})
    assert resp.status_code == 409
    assert resp.json()["detail"] == STALE_REWARD


async def test_a_repeated_reward_category_id_422s_naming_it(auth_client, db):
    ids = await seed_reward_categories(db)
    body = [ids["Dining"], ids["Travel"], ids["Dining"], ids["Groceries"]]
    resp = await auth_client.put(CATEGORY_ORDER, json={"ids": body})
    assert resp.status_code == 422
    assert resp.json()["detail"] == f"ids lists {ids['Dining']} more than once"


async def test_a_reward_category_created_without_a_sort_order_appends(auth_client, db):
    first = await auth_client.post(f"{CARDS}/categories", json={"name": "Dining"})
    assert first.status_code == 201, first.text
    assert first.json()["sort_order"] == 0
    db.add(RewardCategory(name="Travel", slug="travel", sort_order=12))
    await db.commit()
    second = await auth_client.post(f"{CARDS}/categories", json={"name": "Gas"})
    assert second.json()["sort_order"] == 13
    explicit = await auth_client.post(
        f"{CARDS}/categories", json={"name": "Streaming", "sort_order": 3}
    )
    assert explicit.json()["sort_order"] == 3
