"""Endpoint tests for /credit-cards: validation fences, CRUD behavior, atomic bulk
rate saves. DB-level cascade contracts live in test_models_credit_cards.py."""

from decimal import Decimal

from sqlalchemy import select

from app.models import CreditCard, RewardCategory, RewardRate

CARDS = "/api/v1/credit-cards"


def card_body(name: str = "Venture X", **over) -> dict:
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
        "sort_order": 0,
    }
    body.update(over)
    return body


async def test_credit_cards_requires_auth(client):
    # The bare CARDS collection route ships with the cards half — a missing route 404s
    # before the router's auth dependency can run, so it is asserted alongside it.
    assert (await client.get(f"{CARDS}/categories")).status_code == 401
    assert (await client.get(f"{CARDS}/rates")).status_code == 401


# --- categories ---------------------------------------------------------------------------


async def test_category_create_list_and_slug_conflict(auth_client):
    created = await auth_client.post(f"{CARDS}/categories", json={"name": "Travel: Flights"})
    assert created.status_code == 201, created.text
    assert created.json()["slug"] == "travel-flights"
    dupe = await auth_client.post(f"{CARDS}/categories", json={"name": "Travel: Flights!"})
    assert dupe.status_code == 409
    listed = await auth_client.get(f"{CARDS}/categories")
    assert [c["name"] for c in listed.json()] == ["Travel: Flights"]


async def test_category_validates_weight_and_refs(auth_client):
    negative = await auth_client.post(
        f"{CARDS}/categories", json={"name": "Gas", "annual_spend": "-1"}
    )
    assert negative.status_code == 422
    assert "non-negative" in negative.json()["detail"]
    ghost_mapping = await auth_client.post(
        f"{CARDS}/categories", json={"name": "Gas", "spending_category_id": 999}
    )
    assert ghost_mapping.status_code == 404
    ghost_pin = await auth_client.post(
        f"{CARDS}/categories", json={"name": "Gas", "pinned_card_id": 999}
    )
    assert ghost_pin.status_code == 404


async def test_category_patch_null_clears_but_omitted_keeps(auth_client, db):
    card = CreditCard(
        name="SavorOne",
        slug="savorone",
        annual_fee=Decimal("0"),
        rewards_currency="cash",
        point_value_cents=Decimal("1"),
    )
    db.add(card)
    await db.commit()
    created = await auth_client.post(
        f"{CARDS}/categories",
        json={"name": "Dining", "annual_spend": "6000.00", "pinned_card_id": card.id},
    )
    category_id = created.json()["id"]
    # Omitted fields untouched.
    renamed = await auth_client.patch(
        f"{CARDS}/categories/{category_id}", json={"name": "Dining out"}
    )
    assert renamed.json()["annual_spend"] == "6000.00"
    assert renamed.json()["pinned_card_id"] == card.id
    assert renamed.json()["slug"] == "dining-out"
    # Explicit nulls clear the nullable columns.
    cleared = await auth_client.patch(
        f"{CARDS}/categories/{category_id}",
        json={"annual_spend": None, "pinned_card_id": None},
    )
    assert cleared.json()["annual_spend"] is None
    assert cleared.json()["pinned_card_id"] is None
    # Explicit null on a NOT NULL field is ignored.
    ignored = await auth_client.patch(f"{CARDS}/categories/{category_id}", json={"name": None})
    assert ignored.status_code == 200
    assert ignored.json()["name"] == "Dining out"


async def test_category_delete_cascades_cells(auth_client, db):
    card = CreditCard(
        name="Citi CC",
        slug="citi-cc",
        annual_fee=Decimal("0"),
        rewards_currency="cash",
        point_value_cents=Decimal("1"),
    )
    category = RewardCategory(name="Gas", slug="gas")
    db.add_all([card, category])
    await db.flush()
    db.add(RewardRate(card_id=card.id, category_id=category.id, multiplier=Decimal("5")))
    await db.commit()
    resp = await auth_client.delete(f"{CARDS}/categories/{category.id}")
    assert resp.status_code == 204
    assert (await db.execute(select(RewardRate))).scalars().first() is None
    missing = await auth_client.delete(f"{CARDS}/categories/{category.id}")
    assert missing.status_code == 404


# --- rates --------------------------------------------------------------------------------


async def _seed_matrix(db) -> tuple[int, int]:
    card = CreditCard(
        name="Citi CC",
        slug="citi-cc",
        annual_fee=Decimal("0"),
        rewards_currency="cash",
        point_value_cents=Decimal("1"),
    )
    category = RewardCategory(name="Gas", slug="gas")
    db.add_all([card, category])
    await db.commit()
    return card.id, category.id


async def test_rates_put_upserts_deletes_and_lists(auth_client, db):
    card_id, category_id = await _seed_matrix(db)
    put = await auth_client.put(
        f"{CARDS}/rates",
        json=[
            {
                "card_id": card_id,
                "category_id": category_id,
                "multiplier": "5",
                "note": "  top category  ",
                "monthly_cap": "500",
            }
        ],
    )
    assert put.status_code == 200, put.text
    [cell] = put.json()
    assert cell["multiplier"] == "5.00"
    assert cell["note"] == "top category"  # schema strips
    assert cell["monthly_cap"] == "500.00"
    # Upsert in place: same pair, new multiplier — still one row.
    again = await auth_client.put(
        f"{CARDS}/rates",
        json=[
            {
                "card_id": card_id,
                "category_id": category_id,
                "multiplier": "4",
                "note": None,
                "monthly_cap": None,
            }
        ],
    )
    [cell] = again.json()
    assert cell["multiplier"] == "4.00"
    assert cell["monthly_cap"] is None
    # Null multiplier deletes.
    gone = await auth_client.put(
        f"{CARDS}/rates",
        json=[
            {
                "card_id": card_id,
                "category_id": category_id,
                "multiplier": None,
                "note": None,
                "monthly_cap": None,
            }
        ],
    )
    assert gone.json() == []
    listed = await auth_client.get(f"{CARDS}/rates")
    assert listed.json() == []


async def test_rates_put_is_atomic_on_unknown_ids(auth_client, db):
    card_id, category_id = await _seed_matrix(db)
    resp = await auth_client.put(
        f"{CARDS}/rates",
        json=[
            {
                "card_id": card_id,
                "category_id": category_id,
                "multiplier": "5",
                "note": None,
                "monthly_cap": None,
            },
            {
                "card_id": 999,
                "category_id": category_id,
                "multiplier": "3",
                "note": None,
                "monthly_cap": None,
            },
        ],
    )
    assert resp.status_code == 404
    assert "card 999 not found" in resp.json()["detail"]
    # Nothing applied — the valid first entry must NOT have landed.
    assert (await db.execute(select(RewardRate))).scalars().first() is None


async def test_rates_put_validation(auth_client, db):
    card_id, category_id = await _seed_matrix(db)
    dupe = await auth_client.put(
        f"{CARDS}/rates",
        json=[
            {
                "card_id": card_id,
                "category_id": category_id,
                "multiplier": "5",
                "note": None,
                "monthly_cap": None,
            },
            {
                "card_id": card_id,
                "category_id": category_id,
                "multiplier": "3",
                "note": None,
                "monthly_cap": None,
            },
        ],
    )
    assert dupe.status_code == 422
    assert "duplicate cell" in dupe.json()["detail"]
    zero = await auth_client.put(
        f"{CARDS}/rates",
        json=[
            {
                "card_id": card_id,
                "category_id": category_id,
                "multiplier": "0",
                "note": None,
                "monthly_cap": None,
            }
        ],
    )
    assert zero.status_code == 422
    assert "positive" in zero.json()["detail"]
    bad_cap = await auth_client.put(
        f"{CARDS}/rates",
        json=[
            {
                "card_id": card_id,
                "category_id": category_id,
                "multiplier": "5",
                "note": None,
                "monthly_cap": "0",
            }
        ],
    )
    assert bad_cap.status_code == 422
