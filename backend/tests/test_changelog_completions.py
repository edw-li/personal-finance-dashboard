"""The spending and net-worth routes that were already logged, completed (2026-09-25 polish
spec §6.1): every one now answers X-Change-Batch, and the two deletes image what hangs off the
row they remove — a category's budget history and reward-category links, an account's
components and card links — so an Undo restores those too."""

from datetime import date
from decimal import Decimal

from app.models import Account, CategoryBudget, CreditCard, RewardCategory, SpendingCategory
from tests.exact_undo import images, label_of, logged, shape, undo

NW = "/api/v1/net-worth"
SP = "/api/v1/spending"


async def test_account_and_category_writes_answer_their_batch(auth_client, db):
    async def named(resp, label: str) -> None:
        assert resp.status_code in (200, 201), resp.text
        rows = await logged(db, resp.headers["x-change-batch"])
        assert rows and {row.label for row in rows} == {label}

    account = await auth_client.post(
        f"{NW}/accounts", json={"name": "Brokerage", "group": "taxable"}
    )
    await named(account, "Added account Brokerage")
    account_path = f"{NW}/accounts/{account.json()['id']}"
    retire = {"is_active": False}
    await named(await auth_client.patch(account_path, json=retire), "Retired account Brokerage")
    category = await auth_client.post(f"{SP}/categories", json={"name": "Dining"})
    await named(category, "Added category Dining")
    category_path = f"{SP}/categories/{category.json()['id']}"
    kind = {"kind": "transfer"}
    await named(await auth_client.patch(category_path, json=kind), "Edited category Dining")
    budget = {"amount": "400.00", "effective_month": "2026-09-01"}
    await named(
        await auth_client.put(f"{category_path}/budget", json=budget),
        "Set Dining budget from Sep 2026",
    )
    # A write that changes nothing names no batch, so the client offers no Undo.
    for resp in (
        await auth_client.patch(account_path, json=retire),
        await auth_client.patch(category_path, json=kind),
        await auth_client.put(f"{category_path}/budget", json=budget),
    ):
        assert resp.status_code == 200 and "x-change-batch" not in resp.headers


async def test_retire_and_restore_read_in_the_buttons_own_verbs(auth_client, db):
    """Settings' one-click Retire / Restore, named like the cards' Archive and the reward
    categories' Hide (changelog.edit_label): a PATCH that moves only is_active says what the
    button said; any other edit is still "Edited"."""
    account = await auth_client.post(
        f"{NW}/accounts", json={"name": "Brokerage", "group": "taxable"}
    )
    category = await auth_client.post(f"{SP}/categories", json={"name": "Dining"})
    for path, noun in (
        (f"{NW}/accounts/{account.json()['id']}", "account Brokerage"),
        (f"{SP}/categories/{category.json()['id']}", "category Dining"),
    ):
        retired = await auth_client.patch(path, json={"is_active": False})
        assert label_of(await logged(db, retired)) == f"Retired {noun}"
        restored = await auth_client.patch(path, json={"is_active": True})
        assert label_of(await logged(db, restored)) == f"Restored {noun}"
        both = await auth_client.patch(path, json={"is_active": False, "sort_order": 7})
        assert label_of(await logged(db, both)) == f"Edited {noun}"


async def test_deleting_a_category_takes_its_budgets_and_links_and_undo_restores_them(
    auth_client, db
):
    food = SpendingCategory(name="Food", slug="food", sort_order=1)
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=2)
    db.add_all([food, rent])
    await db.flush()
    db.add_all(
        [
            CategoryBudget(
                category_id=food.id, effective_month=date(2026, 7, 1), amount=Decimal("600.00")
            ),
            # The dated "budget ends here" marker is history too.
            CategoryBudget(category_id=food.id, effective_month=date(2026, 9, 1), amount=None),
            CategoryBudget(
                category_id=rent.id, effective_month=date(2026, 7, 1), amount=Decimal("2000.00")
            ),
            RewardCategory(
                name="Dining", slug="dining", sort_order=0, spending_category_id=food.id
            ),
            RewardCategory(
                name="Groceries", slug="groceries", sort_order=1, spending_category_id=food.id
            ),
            RewardCategory(name="Travel", slug="travel", sort_order=2),
        ]
    )
    await db.commit()
    food_id, rent_id = food.id, rent.id
    tables = (SpendingCategory, CategoryBudget, RewardCategory)
    before = {model: await images(db, model) for model in tables}
    deleted = await auth_client.delete(f"{SP}/categories/{food_id}")
    assert deleted.status_code == 204, deleted.text
    batch_id = deleted.headers["x-change-batch"]
    rows = await logged(db, batch_id)
    assert shape(rows) == [
        ("update", "reward_categories"),
        ("update", "reward_categories"),
        ("delete", "category_budgets"),
        ("delete", "category_budgets"),
        ("delete", "spending_categories"),
    ]
    assert [row.after["spending_category_id"] for row in rows[:2]] == [None, None]
    assert [row.month for row in rows] == [None, None, date(2026, 7, 1), date(2026, 9, 1), None]
    assert {row.label for row in rows} == {"Deleted category Food"}
    # Rent's budget and the unlinked Travel row were never touched.
    assert [row["category_id"] for row in await images(db, CategoryBudget)] == [rent_id]
    assert (await undo(auth_client, batch_id)).status_code == 200
    for model in tables:
        assert await images(db, model) == before[model]


async def test_deleting_an_account_unlinks_its_components_and_cards_and_undo_relinks_them(
    auth_client, db
):
    balance = Account(
        name="Sapphire balance", slug="sapphire-balance", group="liability", sort_order=1
    )
    db.add(balance)
    await db.flush()
    db.add_all(
        [
            Account(
                name="Sapphire authorized user",
                slug="sapphire-authorized-user",
                group="liability",
                sort_order=2,
                is_component=True,
                parent_account_id=balance.id,
            ),
            Account(name="Checking", slug="checking", group="cash", sort_order=3),
            CreditCard(
                name="Chase Sapphire Reserve",
                slug="chase-sapphire-reserve",
                annual_fee=Decimal("795.00"),
                rewards_currency="points",
                point_value_cents=Decimal("1.5000"),
                account_id=balance.id,
            ),
            CreditCard(name="Citi Double Cash", slug="citi-double-cash", rewards_currency="cash"),
        ]
    )
    await db.commit()
    balance_id = balance.id
    tables = (Account, CreditCard)
    before = {model: await images(db, model) for model in tables}
    deleted = await auth_client.delete(f"{NW}/accounts/{balance_id}")
    assert deleted.status_code == 204, deleted.text
    batch_id = deleted.headers["x-change-batch"]
    rows = await logged(db, batch_id)
    assert shape(rows) == [
        ("update", "accounts"),
        ("update", "credit_cards"),
        ("delete", "accounts"),
    ]
    assert rows[0].after["parent_account_id"] is None and rows[1].after["account_id"] is None
    assert {row.label for row in rows} == {"Deleted account Sapphire balance"}
    assert (await undo(auth_client, batch_id)).status_code == 200
    for model in tables:
        assert await images(db, model) == before[model]
