"""Endpoint tests for /credit-cards: validation fences, CRUD behavior, atomic bulk
rate saves. DB-level cascade contracts live in test_models_credit_cards.py."""

from decimal import Decimal

from sqlalchemy import select

from app.models import (
    Account,
    CardCredit,
    CreditCard,
    CreditLimitEvent,
    Person,
    RewardCategory,
    RewardRate,
)
from app.models.credit_cards import CREDIT_RESET_CADENCES
from app.schemas.credit_cards import CreditResetCadence

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
        # NULL is JOINT, never "unknown" — the migration backfilled every pre-existing card
        # to the primary person, so an omitted owner here is a deliberate joint card.
        "person_id": None,
    }
    body.update(over)
    return body


async def test_credit_cards_requires_auth(client):
    # Every route on the router sits behind the same auth dependency — spot-check the
    # collection plus both static sub-paths.
    assert (await client.get(CARDS)).status_code == 401
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


# --- cards --------------------------------------------------------------------------------


async def test_card_create_echoes_defaults_and_slug(auth_client):
    resp = await auth_client.post(CARDS, json=card_body())
    assert resp.status_code == 201, resp.text
    card = resp.json()
    assert card["slug"] == "venture-x"
    assert card["annual_fee"] == "395.00"
    assert card["point_value_cents"] == "1.7000"
    assert card["credits"] == []
    assert card["current_limit"] is None
    assert card["limit_events"] == []


async def test_card_name_and_slug_conflicts(auth_client):
    assert (await auth_client.post(CARDS, json=card_body())).status_code == 201
    same_name = await auth_client.post(CARDS, json=card_body())
    assert same_name.status_code == 409
    same_slug = await auth_client.post(CARDS, json=card_body(name="Venture X!"))
    assert same_slug.status_code == 409


async def test_card_validation_fences(auth_client, db):
    bad_currency = await auth_client.post(CARDS, json=card_body(rewards_currency="crypto"))
    assert bad_currency.status_code == 422
    negative_fee = await auth_client.post(CARDS, json=card_body(annual_fee="-1"))
    assert negative_fee.status_code == 422
    assert "non-negative" in negative_fee.json()["detail"]
    zero_point = await auth_client.post(CARDS, json=card_body(point_value_cents="0"))
    assert zero_point.status_code == 422
    silly_date = await auth_client.post(CARDS, json=card_body(opened_on="3026-01-01"))
    assert silly_date.status_code == 422
    ghost_account = await auth_client.post(CARDS, json=card_body(account_id=999))
    assert ghost_account.status_code == 404
    cash_account = Account(name="Checking", slug="checking", group="cash")
    db.add(cash_account)
    await db.commit()
    wrong_group = await auth_client.post(CARDS, json=card_body(account_id=cash_account.id))
    assert wrong_group.status_code == 422
    assert "liability" in wrong_group.json()["detail"]


async def test_card_patch_full_replace_and_rename_clash(auth_client):
    first = (await auth_client.post(CARDS, json=card_body())).json()
    second = (await auth_client.post(CARDS, json=card_body(name="SavorOne"))).json()
    renamed = await auth_client.patch(
        f"{CARDS}/{second['id']}", json=card_body(name="Savor", annual_fee="0.00")
    )
    assert renamed.status_code == 200
    assert renamed.json()["slug"] == "savor"
    clash = await auth_client.patch(f"{CARDS}/{second['id']}", json=card_body())
    assert clash.status_code == 409
    same_self = await auth_client.patch(f"{CARDS}/{first['id']}", json=card_body())
    assert same_self.status_code == 200  # renaming to your own name is not a clash


async def test_card_owner_roundtrips_and_null_means_joint(auth_client, db):
    me = Person(name="Me", is_primary=True)
    sam = Person(name="Sam", is_primary=False)
    db.add_all([me, sam])
    await db.commit()

    created = await auth_client.post(CARDS, json=card_body(person_id=sam.id))
    assert created.status_code == 201, created.text
    assert created.json()["person_id"] == sam.id
    card_id = created.json()["id"]

    # The list is the page's only card source — the column must ride it too.
    listed = await auth_client.get(CARDS)
    assert [c["person_id"] for c in listed.json()] == [sam.id]

    # Full replace: an explicit null is how a card becomes JOINT (the accounts precedent).
    joint = await auth_client.patch(f"{CARDS}/{card_id}", json=card_body(person_id=None))
    assert joint.status_code == 200
    assert joint.json()["person_id"] is None

    back = await auth_client.patch(f"{CARDS}/{card_id}", json=card_body(person_id=me.id))
    assert back.status_code == 200
    assert back.json()["person_id"] == me.id


async def test_card_owner_must_exist(auth_client):
    ghost = await auth_client.post(CARDS, json=card_body(person_id=999))
    assert ghost.status_code == 422
    # The server's own sentence — the UI renders it verbatim (net_worth.py's wording).
    assert ghost.json()["detail"] == "unknown person_id: 999"


async def test_card_delete_cascades_children(auth_client, db):
    card = (await auth_client.post(CARDS, json=card_body())).json()
    await auth_client.post(
        f"{CARDS}/{card['id']}/credits",
        json={"label": "$300 travel credit", "annual_value": "300.00", "counts": True},
    )
    await auth_client.post(
        f"{CARDS}/{card['id']}/limits",
        json={"effective_date": "2023-05-12", "limit_amount": "20000.00", "note": None},
    )
    resp = await auth_client.delete(f"{CARDS}/{card['id']}")
    assert resp.status_code == 204
    assert (await db.execute(select(CardCredit))).scalars().first() is None
    assert (await db.execute(select(CreditLimitEvent))).scalars().first() is None


# --- credits ------------------------------------------------------------------------------


async def test_credit_crud_and_validation(auth_client):
    card = (await auth_client.post(CARDS, json=card_body())).json()
    blank = await auth_client.post(
        f"{CARDS}/{card['id']}/credits",
        json={"label": "   ", "annual_value": "300.00", "counts": True},
    )
    assert blank.status_code == 422
    negative = await auth_client.post(
        f"{CARDS}/{card['id']}/credits",
        json={"label": "Travel credit", "annual_value": "-5", "counts": True},
    )
    assert negative.status_code == 422
    created = await auth_client.post(
        f"{CARDS}/{card['id']}/credits",
        json={"label": "Travel credit", "annual_value": "300.00", "counts": True},
    )
    assert created.status_code == 201
    credit = created.json()
    toggled = await auth_client.patch(
        f"{CARDS}/credits/{credit['id']}",
        json={"label": "Travel credit", "annual_value": "300.00", "counts": False},
    )
    assert toggled.json()["counts"] is False
    listed = (await auth_client.get(CARDS)).json()
    assert listed[0]["credits"][0]["counts"] is False
    gone = await auth_client.delete(f"{CARDS}/credits/{credit['id']}")
    assert gone.status_code == 204
    assert (await auth_client.delete(f"{CARDS}/credits/{credit['id']}")).status_code == 404


async def test_credit_reset_cadence_round_trips_defaults_and_validates(auth_client):
    # The wire union and the column's check constraint are two copies of the same words;
    # adding a cadence to one and not the other is the drift this catches.
    assert set(CREDIT_RESET_CADENCES) == set(CreditResetCadence.__args__)
    card = (await auth_client.post(CARDS, json=card_body())).json()
    defaulted = await auth_client.post(
        f"{CARDS}/{card['id']}/credits",
        json={"label": "Travel credit", "annual_value": "300.00", "counts": True},
    )
    assert defaulted.status_code == 201, defaulted.text
    assert defaulted.json()["reset_cadence"] == "calendar"  # v1 clients keep working
    credit = defaulted.json()
    flipped = await auth_client.patch(
        f"{CARDS}/credits/{credit['id']}",
        json={
            "label": "Travel credit",
            "annual_value": "300.00",
            "counts": True,
            "reset_cadence": "anniversary",
        },
    )
    assert flipped.status_code == 200, flipped.text
    assert flipped.json()["reset_cadence"] == "anniversary"
    listed = (await auth_client.get(CARDS)).json()
    assert listed[0]["credits"][0]["reset_cadence"] == "anniversary"
    bad = await auth_client.post(
        f"{CARDS}/{card['id']}/credits",
        json={"label": "x", "annual_value": "1", "counts": True, "reset_cadence": "quarterly"},
    )
    assert bad.status_code == 422


# --- limit events -------------------------------------------------------------------------


async def test_limits_history_resolution_and_conflicts(auth_client):
    card = (await auth_client.post(CARDS, json=card_body())).json()
    # Insert out of order: current_limit must follow the latest DATE, not insert order.
    later = await auth_client.post(
        f"{CARDS}/{card['id']}/limits",
        json={"effective_date": "2026-01-15", "limit_amount": "30000.00", "note": "auto"},
    )
    assert later.status_code == 201
    earlier = await auth_client.post(
        f"{CARDS}/{card['id']}/limits",
        json={"effective_date": "2023-05-12", "limit_amount": "20000.00", "note": "opened"},
    )
    assert earlier.status_code == 201
    history = earlier.json()
    assert [event["effective_date"] for event in history] == ["2023-05-12", "2026-01-15"]
    listed = (await auth_client.get(CARDS)).json()
    assert listed[0]["current_limit"] == "30000.00"
    dupe = await auth_client.post(
        f"{CARDS}/{card['id']}/limits",
        json={"effective_date": "2026-01-15", "limit_amount": "31000.00", "note": None},
    )
    assert dupe.status_code == 409
    zero = await auth_client.post(
        f"{CARDS}/{card['id']}/limits",
        json={"effective_date": "2026-02-01", "limit_amount": "0", "note": None},
    )
    assert zero.status_code == 422


async def test_limit_delete_is_scoped_to_the_card(auth_client):
    first = (await auth_client.post(CARDS, json=card_body())).json()
    second = (await auth_client.post(CARDS, json=card_body(name="SavorOne"))).json()
    history = (
        await auth_client.post(
            f"{CARDS}/{first['id']}/limits",
            json={"effective_date": "2024-01-01", "limit_amount": "10000.00", "note": None},
        )
    ).json()
    event_id = history[0]["id"]
    wrong_card = await auth_client.delete(f"{CARDS}/{second['id']}/limits/{event_id}")
    assert wrong_card.status_code == 404
    right_card = await auth_client.delete(f"{CARDS}/{first['id']}/limits/{event_id}")
    assert right_card.status_code == 204
