"""The five deletes that image what hangs off their row lock that row FIRST (2026-09-25 polish
L3c): read FOR UPDATE (changelog.lock_parent) before any dependent is read, so a child another
tab writes in between waits for the delete instead of being removed — or unlinked — by the FK's
ON DELETE without an image. Each route's statement order is proven from the SQL it sends; the
race itself once, on the lock's own mode."""

from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import Account, CardCredit, CreditCard, RewardCategory, Security, SpendingCategory
from app.services.changelog import lock_parent
from tests.ordering_helpers import first_position, recorded_sql

CARD = {
    "name": "Venture X",
    "slug": "venture-x",
    "annual_fee": Decimal("395.00"),
    "rewards_currency": "miles",
    "point_value_cents": Decimal("1.0000"),
}

# model, its fields, its DELETE path, and a fragment of every read of what hangs off it
DELETES = [
    pytest.param(
        CreditCard,
        CARD,
        "/api/v1/credit-cards/{id}",
        (
            "FROM reward_categories",
            "FROM card_credits",
            "FROM reward_rates",
            "FROM credit_limit_events",
        ),
        id="credit card",
    ),
    pytest.param(
        RewardCategory,
        {"name": "Groceries", "slug": "groceries"},
        "/api/v1/credit-cards/categories/{id}",
        ("FROM reward_rates",),
        id="reward category",
    ),
    pytest.param(
        Security,
        {"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "holding_type": "etf"},
        "/api/v1/portfolio/securities/{id}",
        (
            "FROM position_transactions",
            "FROM dividend_payments",
            "FROM security_dividend_events",
            "FROM price_history",
            "FROM latest_prices",
        ),
        id="security",
    ),
    pytest.param(
        SpendingCategory,
        {"name": "Dining", "slug": "dining", "sort_order": 0},
        "/api/v1/spending/categories/{id}",
        ("FROM monthly_spending", "FROM reward_categories", "FROM category_budgets"),
        id="spending category",
    ),
    pytest.param(
        Account,
        {"name": "Checking", "slug": "checking", "group": "cash", "sort_order": 0},
        "/api/v1/net-worth/accounts/{id}",
        ("FROM account_balances", "WHERE accounts.parent_account_id", "FROM credit_cards"),
        id="account",
    ),
]


@pytest.mark.parametrize(("model", "fields", "path", "dependents"), DELETES)
async def test_a_delete_locks_its_row_before_it_reads_what_hangs_off_it(
    auth_client, db, model, fields, path, dependents
):
    row = model(**fields)
    db.add(row)
    await db.commit()
    table = model.__tablename__
    with recorded_sql(db) as statements:
        resp = await auth_client.delete(path.format(id=row.id))
    assert resp.status_code == 204, resp.text
    lock = first_position(statements, "FOR UPDATE")
    assert f"FROM {table} \nWHERE {table}.id = " in statements[lock][0]
    for fragment in dependents:
        assert first_position(statements, fragment) > lock, fragment


async def test_a_child_another_tab_writes_waits_for_the_locked_row(db, engine):
    """The lock's mode is the fix: a child's foreign key takes FOR KEY SHARE on its parent, and
    FOR UPDATE blocks that — so while a delete holds its card, another tab's new credit on it
    waits (here out to a short lock_timeout, having written nothing) instead of slipping in
    under the cascade; once the delete's transaction is over, it goes through."""
    card = CreditCard(**CARD)
    db.add(card)
    await db.commit()
    card_id = card.id
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as deleting:
        assert await lock_parent(deleting, CreditCard, card_id) is not None
        async with sessions() as other_tab:
            await other_tab.execute(text("SET LOCAL lock_timeout = '200ms'"))
            other_tab.add(CardCredit(card_id=card_id, label="Travel", annual_value=Decimal("300")))
            with pytest.raises(DBAPIError, match="lock timeout"):
                await other_tab.flush()
    async with sessions() as other_tab:  # the delete's transaction is over: the row is free
        other_tab.add(CardCredit(card_id=card_id, label="Travel", annual_value=Decimal("300")))
        await other_tab.commit()
