"""The event model, the key grammar and the two text helpers (2026-09-03 calendar spec §6).
Pure — literals in, literals out."""

from datetime import date
from decimal import Decimal

import pytest

from app.services.calendar.model import (
    DEADLINE_TYPES,
    EVENT_TYPES,
    FOLDABLE_TYPES,
    SOURCE_FAMILIES,
    TYPE_SOURCE,
    Item,
    Window,
    key,
    make_event,
    money,
    shorten,
)


def test_vocabularies_are_the_spec_lists():
    assert EVENT_TYPES == (
        "rsu_vest",
        "espp_purchase",
        "espp_qualify",
        "ex_dividend",
        "payday",
        "offering_start",
        "tax_deadline",
        "update_due",
        "custom",
        "card_fee",
        "card_credit",
        "card_anniversary",
    )
    assert SOURCE_FAMILIES == (
        "rsu",
        "espp",
        "dividend",
        "payroll",
        "tax",
        "card",
        "ritual",
        "custom",
    )
    assert set(TYPE_SOURCE) == set(EVENT_TYPES)
    assert set(TYPE_SOURCE.values()) == set(SOURCE_FAMILIES)
    assert FOLDABLE_TYPES == ("rsu_vest", "payday")
    assert DEADLINE_TYPES == ("tax_deadline", "update_due", "card_fee")


def test_key_is_source_ref_date_and_never_the_label():
    assert key("rsu", "vest", date(2026, 9, 16)) == "rsu:vest:2026-09-16"
    assert key("ritual", "2026-08", date(2026, 9, 1)) == "ritual:2026-08:2026-09-01"
    with pytest.raises(ValueError):
        key("rsu", "has:colon", date(2026, 9, 16))


def test_make_event_derives_source_and_key_and_validates():
    event = make_event(
        date(2026, 9, 16),
        "rsu_vest",
        "vest",
        "RSU vest — 2025 offer",
        "RSU vest",
        amount=Decimal("12500"),
        direction="in",
        basis="estimated",
        href="/comp",
        items=(Item("2025 offer", Decimal("12500.00"), detail="25 sh"),),
    )
    assert (event.source, event.key) == ("rsu", "rsu:vest:2026-09-16")
    assert event.amount == Decimal("12500.00")  # quantized to cents on the way in
    assert (event.done, event.hidden, event.note, event.amount_overridden) == (
        False,
        False,
        None,
        False,
    )
    # The ritual reminder keys on its NOMINAL due date even when re-dated to today.
    redated = make_event(
        date(2026, 9, 3),
        "update_due",
        "2026-08",
        "Monthly update — enter August 2026",
        "Monthly update",
        key_date=date(2026, 9, 1),
        href="/update",
    )
    assert redated.key == "ritual:2026-08:2026-09-01" and redated.event_date == date(2026, 9, 3)
    with pytest.raises(ValueError):
        make_event(date(2026, 9, 16), "rsu_vest", "vest", "x", "y", direction="sideways")
    with pytest.raises(ValueError):
        make_event(date(2026, 9, 16), "not_a_type", "vest", "x", "y")
    with pytest.raises(ValueError):
        make_event(date(2026, 9, 16), "rsu_vest", "vest", "x", "a" * 25)  # short_label > 24


def test_money_and_shorten():
    assert money(Decimal("12.345")) == Decimal("12.35")
    assert str(money(Decimal("-0.001"))) == "0.00"  # signed zero collapsed
    assert shorten("Car insurance renewal — policy 8841") == "Car insurance renewal …"
    assert shorten("Dentist") == "Dentist"
    assert len(shorten("x" * 80)) == 24


def test_window_contains_and_months():
    window = Window(date(2026, 8, 1), date(2026, 10, 31))
    assert window.contains(date(2026, 8, 1)) and window.contains(date(2026, 10, 31))
    assert not window.contains(date(2026, 11, 1))
    assert window.months() == [date(2026, 8, 1), date(2026, 9, 1), date(2026, 10, 1)]
    assert Window(date(2026, 12, 15), date(2027, 1, 10)).months() == [
        date(2026, 12, 1),
        date(2027, 1, 1),
    ]
