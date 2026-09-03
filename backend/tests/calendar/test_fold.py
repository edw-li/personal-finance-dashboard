"""Same-day folding (2026-09-03 calendar spec §7): vests and paydays merge, everything
else passes through."""

from dataclasses import replace
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.calendar.fold import fold_same_day
from app.services.calendar.generators.payroll import PaydaySource, payday_events
from app.services.calendar.generators.rsu import vest_events
from app.services.calendar.model import Window

SEP = Window(date(2026, 9, 1), date(2026, 9, 30))


def grant(label, shares):
    # All four vest quarterly from 2026-03-18 at a 25% cliff: Sep 16 carries 6.25% each.
    return SimpleNamespace(
        label=label,
        shares=shares,
        cliff_pct=Decimal("0.25"),
        first_vest_date=date(2026, 3, 18),
        vest_quantum=1,
    )


FOUR = [
    grant("2025 offer", 400),
    grant("2026 refresh", 160),
    grant("2024 refresh", 160),
    grant("2023 refresh", 80),
]


def test_four_grants_on_one_date_fold_into_one_priced_event_with_sorted_items():
    [folded] = fold_same_day(vest_events(FOUR, SEP, quote=Decimal("500")))
    assert (folded.event_date, folded.type, folded.key) == (
        date(2026, 9, 16),
        "rsu_vest",
        "rsu:vest:2026-09-16",
    )
    assert (folded.label, folded.short_label) == ("RSU vest — 4 grants", "RSU vest · 4 grants")
    assert folded.amount == Decimal("25000.00")  # (25 + 10 + 10 + 5) sh × $500
    assert [(i.label, i.amount, i.detail) for i in folded.items] == [
        ("2023 refresh", Decimal("2500.00"), "5 sh"),
        ("2024 refresh", Decimal("5000.00"), "10 sh"),
        ("2025 offer", Decimal("12500.00"), "25 sh"),
        ("2026 refresh", Decimal("5000.00"), "10 sh"),
    ]
    assert folded.detail == (
        "2023 refresh: 5 sh; 2024 refresh: 10 sh; 2025 offer: 25 sh; 2026 refresh: 10 sh"
        " · ≈ $16,942.50 after sell-to-cover"
    )
    assert (folded.direction, folded.basis, folded.href) == ("in", "estimated", "/comp")


def test_a_folded_total_is_null_when_any_constituent_is_unpriced():
    events = vest_events(FOUR[:2], SEP, quote=Decimal("500"))
    # The unpriced shape a missing quote really produces: the ITEM carries no amount, and
    # the fold sums items — one null constituent nulls the whole total.
    unpriced = replace(events[1], amount=None, items=(replace(events[1].items[0], amount=None),))
    [folded] = fold_same_day([events[0], unpriced])
    assert folded.amount is None
    assert folded.detail.endswith("2026 refresh: 10 sh")  # no after-tax sentence without a total


def test_a_single_grant_is_left_exactly_as_generated():
    [single] = vest_events(FOUR[:1], SEP, quote=None)
    assert fold_same_day([single]) == [single]


def test_two_people_fold_into_one_payday_with_per_person_items():
    events = payday_events(
        [
            PaydaySource("Me", True, Decimal("5000"), 1),
            PaydaySource("Sam", True, Decimal("3750"), 2),
        ],
        Window(date(2026, 8, 1), date(2026, 8, 31)),
    )
    folded = fold_same_day(events)
    assert [(e.event_date, e.label, e.short_label, e.amount, e.detail) for e in folded] == [
        (date(2026, 8, 14), "Payday — Me & Sam", "Payday · 2", Decimal("8750.00"), "2 paychecks"),
        (date(2026, 8, 31), "Payday — Me & Sam", "Payday · 2", Decimal("8750.00"), "2 paychecks"),
    ]
    assert [(i.label, i.amount, i.person_id) for i in folded[0].items] == [
        ("Me", Decimal("5000.00"), 1),
        ("Sam", Decimal("3750.00"), 2),
    ]
    assert folded[0].key == "payroll:payday:2026-08-14"


def test_single_earner_label_stays_byte_identical():
    events = payday_events(
        [PaydaySource("Me", True, Decimal("5000"), 1)], Window(date(2026, 8, 1), date(2026, 8, 31))
    )
    assert [e.label for e in fold_same_day(events)] == ["Payday", "Payday"]


def test_other_families_never_fold():
    from app.services.calendar.generators.custom import CustomRow, custom_events

    rows = [CustomRow(1, date(2026, 9, 12), "a", None), CustomRow(2, date(2026, 9, 12), "b", None)]
    assert len(fold_same_day(custom_events(rows, SEP))) == 2
