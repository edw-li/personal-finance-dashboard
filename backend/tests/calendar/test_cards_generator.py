"""The card family (2026-09-03 calendar spec §6 card row): opened_on anniversaries → fee
and anniversary events, counted credits → reset events by cadence, NULL opened_on → nothing."""

from datetime import date
from decimal import Decimal

from app.services.calendar import Sources, compose
from app.services.calendar.generators.cards import (
    CardCreditFacts,
    CardFacts,
    anniversary,
    card_events,
)
from app.services.calendar.model import Window

YEAR_2026 = Window(date(2026, 1, 1), date(2026, 12, 31))
TODAY = date(2026, 8, 24)


def venture_x(**over) -> CardFacts:
    fields = dict(
        card_id=7,
        name="Venture X",
        annual_fee=Decimal("395.00"),
        opened_on=date(2024, 5, 12),
        credits=(CardCreditFacts(5, "$300 travel credit", Decimal("300.00"), "calendar"),),
    )
    fields.update(over)
    return CardFacts(**fields)


def test_anniversary_clamps_feb_29():
    assert anniversary(date(2024, 2, 29), 2025) == date(2025, 2, 28)
    assert anniversary(date(2024, 2, 29), 2028) == date(2028, 2, 29)
    assert anniversary(date(2024, 5, 12), 2026) == date(2026, 5, 12)


def test_fee_and_anniversary_on_the_opened_on_anniversary_year_two_falls_off_5_24():
    events = card_events([venture_x()], YEAR_2026, TODAY)
    fee = next(e for e in events if e.type == "card_fee")
    anniv = next(e for e in events if e.type == "card_anniversary")
    assert (fee.event_date, fee.key, fee.label, fee.short_label) == (
        date(2026, 5, 12),
        "card:7-fee:2026-05-12",
        "Venture X annual fee",
        "Card fee",
    )
    assert (fee.amount, fee.direction, fee.basis, fee.href) == (
        Decimal("395.00"),
        "out",
        "confirmed",
        "/credit-cards",
    )
    assert fee.detail == "$395.00 annual fee — year 2"
    assert (anniv.key, anniv.amount, anniv.direction) == ("card:7:2026-05-12", None, "neutral")
    assert anniv.detail == "Year 2 with Venture X — falls off 5/24"
    year_three = card_events([venture_x()], Window(date(2027, 1, 1), date(2027, 12, 31)), TODAY)
    assert (
        next(e for e in year_three if e.type == "card_anniversary").detail
        == "Year 3 with Venture X"
    )


def test_no_fee_event_for_a_no_fee_card_and_no_anniversary_in_the_opening_year():
    events = card_events([venture_x(annual_fee=Decimal("0"))], YEAR_2026, TODAY)
    assert [e.type for e in events if e.type != "card_credit"] == ["card_anniversary"]
    # Opened May 12 2024: the first anniversary is a year off, and Jan 1 2024 is BEFORE the
    # card existed — that year's calendar-cadence reset never happened.
    opening_year = card_events([venture_x()], Window(date(2024, 1, 1), date(2024, 12, 31)), TODAY)
    assert opening_year == []


def test_credit_resets_by_cadence():
    calendar_reset = card_events([venture_x()], YEAR_2026, TODAY)
    credit = next(e for e in calendar_reset if e.type == "card_credit")
    assert (credit.event_date, credit.key, credit.label, credit.short_label) == (
        date(2026, 1, 1),
        "card:credit-5:2026-01-01",
        "Venture X — $300 travel credit resets",
        "Credit resets",
    )
    assert (credit.amount, credit.direction, credit.basis, credit.detail) == (
        Decimal("300.00"),
        "neutral",
        "confirmed",
        "$300.00 to use this year",
    )
    yearly = CardCreditFacts(5, "$300 travel credit", Decimal("300.00"), "anniversary")
    on_anniversary = card_events([venture_x(credits=(yearly,))], YEAR_2026, TODAY)
    assert [e.event_date for e in on_anniversary if e.type == "card_credit"] == [date(2026, 5, 12)]


def test_a_card_without_opened_on_emits_nothing_but_a_calendar_credit_still_resets():
    events = card_events([venture_x(opened_on=None)], YEAR_2026, TODAY)
    assert [e.type for e in events] == ["card_credit"]
    anniversary_credit = venture_x(
        opened_on=None, credits=(CardCreditFacts(5, "x", Decimal("1"), "anniversary"),)
    )
    assert card_events([anniversary_credit], YEAR_2026, TODAY) == []


def test_compose_runs_the_card_generator_and_never_folds_a_fee_with_a_credit():
    same_day = venture_x(
        opened_on=date(2024, 1, 1),
        credits=(CardCreditFacts(5, "credit", Decimal("300"), "calendar"),),
    )
    events = compose(
        Window(date(2026, 1, 1), date(2026, 1, 1)), today=TODAY, sources=Sources(cards=[same_day])
    )
    assert sorted(e.type for e in events if e.source == "card") == [
        "card_anniversary",
        "card_credit",
        "card_fee",
    ]
