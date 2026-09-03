"""DB-level contracts for the calendar tables (2026-09-03 calendar spec §16): the custom
event defaults, the overlay's unique key, the token's cascade, the credit cadence default."""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import (
    CalendarEventOverride,
    CalendarFeedToken,
    CardCredit,
    CreditCard,
    CustomEvent,
    User,
)
from app.security import hash_password


async def test_custom_event_defaults_to_neutral_and_no_recurrence(db):
    db.add(CustomEvent(event_date=date(2026, 9, 12), label="Car insurance", detail=None))
    await db.commit()
    row = (await db.execute(select(CustomEvent))).scalars().one()
    assert (row.amount, row.direction, row.recurrence, row.until) == (None, "neutral", "none", None)


async def test_custom_event_vocabularies_are_check_constrained(db):
    db.add(CustomEvent(event_date=date(2026, 9, 12), label="x", detail=None, direction="sideways"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
    db.add(CustomEvent(event_date=date(2026, 9, 12), label="x", detail=None, recurrence="daily"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_override_key_is_unique_and_hidden_defaults_false(db):
    db.add(CalendarEventOverride(event_key="rsu:vest:2026-09-16", note="sold 10"))
    await db.commit()
    row = (await db.execute(select(CalendarEventOverride))).scalars().one()
    assert row.hidden is False and row.done_at is None and row.updated_at is not None
    db.add(CalendarEventOverride(event_key="rsu:vest:2026-09-16", amount=Decimal("1.00")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_feed_token_cascades_with_its_user(db):
    user = User(email="feed@example.com", password_hash=hash_password("correct-horse"))
    db.add(user)
    await db.flush()
    db.add(
        CalendarFeedToken(
            user_id=user.id,
            token_hash="a" * 64,
            label="phone",
            last_used_at=datetime(2026, 9, 1, tzinfo=UTC),
        )
    )
    await db.commit()
    assert (await db.execute(select(CalendarFeedToken))).scalars().one().created_at is not None
    await db.delete(user)
    await db.commit()
    assert (await db.execute(select(CalendarFeedToken))).scalars().first() is None


async def test_card_credit_reset_cadence_defaults_to_calendar_and_is_constrained(db):
    card = CreditCard(
        name="Venture X",
        slug="venture-x",
        annual_fee=Decimal("395.00"),
        rewards_currency="miles",
        point_value_cents=Decimal("1.7"),
    )
    db.add(card)
    await db.flush()
    db.add(CardCredit(card_id=card.id, label="$300 travel credit", annual_value=Decimal("300")))
    await db.commit()
    assert (await db.execute(select(CardCredit))).scalars().one().reset_cadence == "calendar"
    db.add(
        CardCredit(card_id=card.id, label="x", annual_value=Decimal("1"), reset_cadence="quarterly")
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
