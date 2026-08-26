"""DB-level contracts for the credit-card tables: cascades, SET NULLs, uniqueness.

API behavior lives in test_credit_cards_api.py; these pin what the SCHEMA promises
(spec §2) independent of any router."""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import (
    Account,
    CardCredit,
    CreditCard,
    CreditLimitEvent,
    RewardCategory,
    RewardRate,
    SpendingCategory,
)


def _card(name: str = "Venture X", **over) -> CreditCard:
    fields = dict(
        name=name,
        slug=name.lower().replace(" ", "-"),
        annual_fee=Decimal("395.00"),
        rewards_currency="miles",
        point_value_cents=Decimal("1.7"),
    )
    fields.update(over)
    return CreditCard(**fields)


async def test_card_delete_cascades_children_but_not_categories(db):
    card = _card()
    category = RewardCategory(name="Hotels", slug="hotels")
    db.add_all([card, category])
    await db.flush()
    db.add(CardCredit(card_id=card.id, label="$300 travel credit", annual_value=Decimal("300")))
    db.add(RewardRate(card_id=card.id, category_id=category.id, multiplier=Decimal("10")))
    db.add(
        CreditLimitEvent(
            card_id=card.id, effective_date=date(2023, 5, 12), limit_amount=Decimal("20000")
        )
    )
    await db.commit()

    await db.delete(card)
    await db.commit()

    assert (await db.execute(select(CardCredit))).scalars().first() is None
    assert (await db.execute(select(RewardRate))).scalars().first() is None
    assert (await db.execute(select(CreditLimitEvent))).scalars().first() is None
    # The category survives its cells.
    assert (await db.execute(select(RewardCategory))).scalars().first() is not None


async def test_category_delete_cascades_rates_only(db):
    card = _card()
    category = RewardCategory(name="Gas", slug="gas")
    db.add_all([card, category])
    await db.flush()
    db.add(RewardRate(card_id=card.id, category_id=category.id, multiplier=Decimal("5")))
    await db.commit()

    await db.delete(category)
    await db.commit()

    assert (await db.execute(select(RewardRate))).scalars().first() is None
    assert (await db.execute(select(CreditCard))).scalars().first() is not None


async def test_account_delete_nulls_card_link(db):
    account = Account(name="CapOne VX", slug="capone-vx", group="liability")
    db.add(account)
    await db.flush()
    card = _card(account_id=account.id)
    db.add(card)
    await db.commit()

    await db.delete(account)
    await db.commit()
    db.expire_all()

    stored = (await db.execute(select(CreditCard))).scalars().one()
    assert stored.account_id is None


async def test_pinned_card_delete_nulls_the_pin(db):
    card = _card()
    db.add(card)
    await db.flush()
    category = RewardCategory(name="Dining", slug="dining", pinned_card_id=card.id)
    db.add(category)
    await db.commit()

    await db.delete(card)
    await db.commit()
    db.expire_all()

    stored = (await db.execute(select(RewardCategory))).scalars().one()
    assert stored.pinned_card_id is None


async def test_spending_category_delete_nulls_the_mapping(db):
    spending = SpendingCategory(name="Travel", slug="travel")
    db.add(spending)
    await db.flush()
    category = RewardCategory(name="Flights", slug="flights", spending_category_id=spending.id)
    db.add(category)
    await db.commit()

    await db.delete(spending)
    await db.commit()
    db.expire_all()

    stored = (await db.execute(select(RewardCategory))).scalars().one()
    assert stored.spending_category_id is None


async def test_one_cell_per_card_category_pair(db):
    card = _card()
    category = RewardCategory(name="Groceries", slug="groceries")
    db.add_all([card, category])
    await db.flush()
    db.add(RewardRate(card_id=card.id, category_id=category.id, multiplier=Decimal("2")))
    await db.commit()
    db.add(RewardRate(card_id=card.id, category_id=category.id, multiplier=Decimal("3")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_one_limit_event_per_card_date(db):
    card = _card()
    db.add(card)
    await db.flush()
    db.add(
        CreditLimitEvent(
            card_id=card.id, effective_date=date(2024, 8, 1), limit_amount=Decimal("25000")
        )
    )
    await db.commit()
    db.add(
        CreditLimitEvent(
            card_id=card.id, effective_date=date(2024, 8, 1), limit_amount=Decimal("30000")
        )
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
