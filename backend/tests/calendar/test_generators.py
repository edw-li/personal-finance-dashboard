"""One pure module per family, driven by literals (2026-09-03 calendar spec §6 table).
Date facts: 2026-03-18 / 06-17 / 09-16 / 12-16 are third Wednesdays; Aug 15 2026 is a
Saturday (payday → Fri 14th); Aug 31 2026 is a Monday."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.calendar.generators.custom import CustomRow, custom_events
from app.services.calendar.generators.dividends import ExDividend, ex_dividend_events
from app.services.calendar.generators.espp import espp_events
from app.services.calendar.generators.payroll import PaydaySource, payday_events
from app.services.calendar.generators.ritual import ritual_events
from app.services.calendar.generators.rsu import SUPPLEMENTAL, vest_events
from app.services.calendar.generators.taxes import tax_deadline_events
from app.services.calendar.model import Item, Window
from app.services.espp_calc import OfferingInfo, StoredPeriod

TODAY = date(2026, 8, 24)
Q3 = Window(date(2026, 8, 1), date(2026, 10, 31))


def grant(label="2025 offer", shares=400, cliff="0.25", first_vest=date(2026, 3, 18)):
    return SimpleNamespace(
        label=label,
        shares=shares,
        cliff_pct=Decimal(cliff),
        first_vest_date=first_vest,
        vest_quantum=1,
    )


# --- rsu ---------------------------------------------------------------------------------


def test_vest_events_are_priced_by_the_quote_and_carry_one_item():
    [event] = vest_events([grant()], Q3, quote=Decimal("500"))
    assert (event.event_date, event.type, event.key) == (
        date(2026, 9, 16),
        "rsu_vest",
        "rsu:vest:2026-09-16",
    )
    assert (event.label, event.short_label) == ("RSU vest — 2025 offer", "RSU vest")
    assert (event.amount, event.direction, event.basis, event.href) == (
        Decimal("12500.00"),
        "in",
        "estimated",
        "/comp",
    )
    assert event.items == (Item("2025 offer", Decimal("12500.00"), None, "25 sh"),)
    # 22% federal + 10.23% CA supplemental — the sell-to-cover legs withholding_calc uses.
    assert SUPPLEMENTAL == Decimal("0.3223")
    assert event.detail == "25 sh — 2025 offer · ≈ $8,471.25 after sell-to-cover"


def test_vest_events_without_a_quote_are_unpriced_and_byte_identical_to_v1_detail():
    [event] = vest_events([grant()], Q3, quote=None)
    assert event.amount is None
    assert event.detail == "25 sh — 2025 offer"
    assert event.items[0].amount is None


def test_bad_grant_degrades_with_a_warning(caplog):
    events = vest_events([grant(label="hand-edited", cliff="0.30"), grant()], Q3, quote=None)
    assert [e.label for e in events] == ["RSU vest — 2025 offer"]
    assert any("hand-edited" in record.message for record in caplog.records)


# --- payroll -----------------------------------------------------------------------------


def test_single_earner_payday_keeps_the_bare_label_and_carries_net_pay():
    events = payday_events(
        [PaydaySource("Me", True, Decimal("5000"), 1)],
        Window(date(2026, 8, 1), date(2026, 8, 31)),
    )
    assert [(e.event_date, e.label, e.amount, e.key) for e in events] == [
        (date(2026, 8, 14), "Payday", Decimal("5000.00"), "payroll:payday:2026-08-14"),
        (date(2026, 8, 31), "Payday", Decimal("5000.00"), "payroll:payday:2026-08-31"),
    ]
    assert events[0].items[0].label == "Me" and events[0].items[0].person_id == 1
    assert (events[0].direction, events[0].basis, events[0].href, events[0].short_label) == (
        "in",
        "scheduled",
        "/paycheck",
        "Payday",
    )


def test_two_profiled_people_are_labelled_and_the_cadence_gate_is_per_person():
    events = payday_events(
        [
            PaydaySource("Me", True, Decimal("5000"), 1),
            PaydaySource("Sam", False, Decimal("3000"), 2),
        ],
        Window(date(2026, 8, 1), date(2026, 8, 31)),
    )
    assert [(e.event_date, e.label, e.detail) for e in events] == [
        (date(2026, 8, 14), "Payday — Me", "Me"),
        (date(2026, 8, 31), "Payday — Me", "Me"),
    ]


def test_payday_without_a_computable_net_is_unpriced():
    [event, _] = payday_events(
        [PaydaySource("Me", True, None, 1)], Window(date(2026, 8, 1), date(2026, 8, 31))
    )
    assert event.amount is None and event.items[0].amount is None


# --- espp --------------------------------------------------------------------------------


def test_espp_events_keep_v1_dates_and_labels_with_stable_keys():
    stored = [
        StoredPeriod(
            1,
            "1H26",
            date(2025, 9, 1),
            date(2026, 2, 27),
            Decimal("60000"),
            Decimal("0"),
            Decimal("0.14"),
        )
    ]
    events = espp_events(
        stored,
        [OfferingInfo(date(2026, 9, 1), Decimal("120"))],
        [(date(2024, 8, 30), date(2026, 9, 1))],
        Window(date(2026, 1, 1), date(2026, 12, 31)),
    )
    by_type = {}
    for e in events:
        by_type.setdefault(e.type, []).append(e)
    assert [(e.event_date, e.label, e.key) for e in by_type["espp_purchase"]] == [
        (date(2026, 2, 27), "ESPP purchase — 1H26", "espp:purchase:2026-02-27"),
        (date(2026, 8, 31), "ESPP purchase — Mar–Aug 2026", "espp:purchase:2026-08-31"),
    ]
    assert [(e.label, e.key) for e in by_type["espp_qualify"]] == [
        ("ESPP lot qualifies — 2024-08-30", "espp:qualify-2024-08-30:2026-09-01")
    ]
    assert [(e.label, e.detail, e.key) for e in by_type["offering_start"]] == [
        ("ESPP offering starts", "subscription price 120", "espp:offering:2026-09-01")
    ]
    assert all(e.href == "/espp" for e in events)
    # The purchase carries the contribution (pinned below); the other two are dates only.
    assert all(e.amount is None for e in events if e.type != "espp_purchase")
    assert by_type["espp_purchase"][0].direction == "neutral"


def test_espp_purchase_carries_the_modelers_contribution_and_stays_null_when_nothing_is_entered():
    stored = [
        StoredPeriod(
            1,
            "1H26",
            date(2025, 9, 1),
            date(2026, 2, 27),
            Decimal("60000"),
            Decimal("2500"),
            Decimal("0.14"),
        )
    ]
    year = Window(date(2026, 1, 1), date(2026, 12, 31))
    events = espp_events(stored, [], [], year)
    purchases = {e.event_date: e for e in events if e.type == "espp_purchase"}
    # (60000 + 2500) x 0.14 = 8750.00 - run_modeler's `contribution` line, no price needed.
    first = purchases[date(2026, 2, 27)]
    assert (first.amount, first.direction, first.basis) == (
        Decimal("8750.00"),
        "neutral",
        "estimated",
    )
    assert first.detail == "1H26 · contribution ≈ $8,750.00"
    # The derived Mar-Aug row seeds from the latest stored period, so it is priced too.
    assert purchases[date(2026, 8, 31)].amount == Decimal("8750.00")
    # Nothing stored: derived rows seed at 0 -> unknowable, not "$0.00".
    bare = {e.event_date: e for e in espp_events([], [], [], year) if e.type == "espp_purchase"}
    assert bare[date(2026, 8, 31)].amount is None
    assert bare[date(2026, 8, 31)].detail == "Mar–Aug 2026"


# --- dividends ---------------------------------------------------------------------------


def test_ex_dividend_estimates_shares_times_per_share_and_stays_null_without_them():
    priced, bare = ex_dividend_events(
        [
            ExDividend("NVDA", date(2026, 9, 3), Decimal("10"), Decimal("0.01")),
            ExDividend("SCHD", date(2026, 9, 10)),
            ExDividend("VTI", date(2026, 11, 1), Decimal("5"), Decimal("1")),  # clipped
        ],
        Q3,
    )
    assert (priced.label, priced.short_label, priced.key) == (
        "Ex-dividend — NVDA",
        "Ex-div NVDA",
        "dividend:NVDA:2026-09-03",
    )
    assert (priced.amount, priced.direction, priced.basis, priced.href) == (
        Decimal("0.10"),
        "in",
        "estimated",
        "/portfolio",
    )
    assert priced.detail == "NVDA · 10 sh × $0.010000"
    assert bare.amount is None and bare.detail == "SCHD"


# --- tax (dates only here; Lane D adds the amounts) ---------------------------------------


def test_tax_deadlines_are_the_five_forward_adjusted_dates_with_stable_refs():
    events = tax_deadline_events(Window(date(2026, 1, 1), date(2026, 12, 31)), TODAY, {})
    assert [(e.event_date, e.detail, e.entity_ref, e.short_label) for e in events] == [
        (date(2026, 1, 15), "Q4 2025 estimated payment", "2025-q4", "Q4 est. tax"),
        (date(2026, 4, 15), "federal filing + Q1 estimated payment", "2026-q1", "Filing + Q1 est."),
        (date(2026, 6, 15), "Q2 estimated payment", "2026-q2", "Q2 est. tax"),
        (date(2026, 9, 15), "Q3 estimated payment", "2026-q3", "Q3 est. tax"),
        (date(2026, 10, 15), "extension filing deadline", "2026-extension", "Extension deadline"),
    ]
    assert all(e.label == f"Tax deadline — {e.detail}" and e.href == "/taxes" for e in events)
    assert all(e.amount is None and e.direction == "out" and e.basis == "scheduled" for e in events)
    assert events[3].key == "tax:2026-q3:2026-09-15"


def test_tax_deadline_rolls_forward_over_weekend_and_holiday():
    events = tax_deadline_events(Window(date(2028, 1, 1), date(2028, 1, 31)), date(2028, 1, 1), {})
    assert [(e.event_date, e.entity_ref) for e in events] == [(date(2028, 1, 18), "2027-q4")]


# --- ritual ------------------------------------------------------------------------------


def test_ritual_emits_per_month_suppresses_entered_and_redates_overdue():
    events = ritual_events(Q3, TODAY, 1, {date(2026, 6, 1)})
    # Aug 1 → enter July (missing, overdue → today, key unchanged); Sep 1 → enter August
    # (scheduled); Oct 1 → enter September.
    assert [(e.event_date, e.label, e.key, e.detail) for e in events] == [
        (
            TODAY,
            "Monthly update — enter July 2026",
            "ritual:2026-07:2026-08-01",
            "Overdue — was due 2026-08-01",
        ),
        (
            date(2026, 9, 1),
            "Monthly update — enter August 2026",
            "ritual:2026-08:2026-09-01",
            "Enter August 2026 balances and spending",
        ),
        (
            date(2026, 10, 1),
            "Monthly update — enter September 2026",
            "ritual:2026-09:2026-10-01",
            "Enter September 2026 balances and spending",
        ),
    ]
    assert all(
        e.href == "/update" and e.short_label == "Monthly update" and e.basis == "scheduled"
        for e in events
    )


def test_ritual_honours_the_due_day_and_an_entered_month():
    events = ritual_events(Q3, TODAY, 5, {date(2026, 7, 1)})
    assert [(e.event_date, e.key) for e in events] == [
        (date(2026, 9, 5), "ritual:2026-08:2026-09-05"),
        (date(2026, 10, 5), "ritual:2026-09:2026-10-05"),
    ]


def test_overdue_ritual_outside_the_window_is_dropped():
    # Viewing a past month: today is not in the window, so the re-dated reminder has nowhere
    # to land and is dropped rather than drawn on the wrong day.
    events = ritual_events(Window(date(2026, 5, 1), date(2026, 5, 31)), TODAY, 1, set())
    assert events == []


# --- custom ------------------------------------------------------------------------------


def test_custom_rows_carry_money_and_expand_recurrence():
    rows = [
        CustomRow(
            7,
            date(2026, 9, 12),
            "Car insurance renewal",
            "policy 8841",
            amount=Decimal("1200"),
            direction="out",
        ),
        CustomRow(
            8,
            date(2026, 8, 5),
            "Piano lesson",
            None,
            recurrence="weekly",
            until=date(2026, 8, 19),
            person_id=2,
            person_name="Sam",
        ),
    ]
    events = custom_events(rows, Q3)
    single = [e for e in events if e.event_id == 7]
    series = [e for e in events if e.event_id == 8]
    assert [(e.key, e.amount, e.direction, e.basis, e.href) for e in single] == [
        ("custom:7:2026-09-12", Decimal("1200.00"), "out", "confirmed", None)
    ]
    assert single[0].short_label == "Car insurance renewal" and single[0].recurrence is None
    assert [(e.event_date, e.key, e.label) for e in series] == [
        (date(2026, 8, 5), "custom:8:2026-08-05", "Piano lesson — Sam"),
        (date(2026, 8, 12), "custom:8:2026-08-12", "Piano lesson — Sam"),
        (date(2026, 8, 19), "custom:8:2026-08-19", "Piano lesson — Sam"),
    ]
    assert (series[0].recurrence, series[0].until, series[0].series_start, series[0].person_id) == (
        "weekly",
        date(2026, 8, 19),
        date(2026, 8, 5),
        2,
    )
