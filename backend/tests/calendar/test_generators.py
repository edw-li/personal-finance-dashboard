"""One pure module per family, driven by literals (2026-09-03 calendar spec §6 table).
Date facts: 2026-03-18 / 06-17 / 09-16 / 12-16 are third Wednesdays; Aug 15 2026 is a
Saturday (payday → Fri 14th); Aug 31 2026 is a Monday."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.calendar.generators.custom import CustomRow, custom_events
from app.services.calendar.generators.dividends import ExDividend, ex_dividend_events
from app.services.calendar.generators.espp import espp_events
from app.services.calendar.generators.payroll import PaydaySource, PayRate, payday_events
from app.services.calendar.generators.ritual import ritual_events
from app.services.calendar.generators.rsu import SUPPLEMENTAL, vest_events
from app.services.calendar.generators.taxes import tax_deadline_events
from app.services.calendar.model import Item, Window
from app.services.espp_calc import OfferingInfo, StoredPeriod
from app.services.month_review import month_shift
from app.services.month_status import MonthStatus, SpendingEvidence
from app.services.snapshot_state import snapshot_state

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


# --- one payroll start (2026-09-23 spec §W1): a payday on or before a person's first profile
# is not emitted, and each payday is priced by the profile in force on it.


def test_paydays_start_after_the_first_profile():
    grace = PaydaySource(
        "Grace",
        True,
        Decimal("568.75"),
        2,
        timeline=(PayRate(date(2026, 9, 1), True, Decimal("568.75")),),
        starts_on=date(2026, 9, 1),
    )
    events = payday_events([grace], Window(date(2026, 8, 1), date(2026, 9, 30)))
    # Aug 14 and Aug 31 predate the job; Sep 15 is her first check.
    assert [(e.event_date, e.amount) for e in events] == [
        (date(2026, 9, 15), Decimal("568.75")),
        (date(2026, 9, 30), Decimal("568.75")),
    ]


def test_each_payday_is_priced_by_the_profile_in_force_on_it():
    me = PaydaySource(
        "Me",
        True,
        Decimal("6000"),
        1,
        timeline=(
            PayRate(date(2026, 1, 1), True, Decimal("5000")),
            PayRate(date(2026, 8, 17), True, Decimal("6000")),
        ),
        starts_on=date(2026, 1, 1),
    )
    events = payday_events([me], Window(date(2026, 8, 1), date(2026, 8, 31)))
    assert [(e.event_date, e.amount) for e in events] == [
        (date(2026, 8, 14), Decimal("5000.00")),  # before the Aug 17 raise
        (date(2026, 8, 31), Decimal("6000.00")),
    ]


def test_a_timeline_slice_on_another_cadence_emits_nothing():
    me = PaydaySource(
        "Me",
        True,
        Decimal("5000"),
        1,
        timeline=(
            PayRate(date(2026, 1, 1), True, Decimal("5000")),
            PayRate(date(2026, 8, 20), False, Decimal("4000")),
        ),
        starts_on=date(2026, 1, 1),
    )
    events = payday_events([me], Window(date(2026, 8, 1), date(2026, 8, 31)))
    assert [e.event_date for e in events] == [date(2026, 8, 14)]


def test_a_source_whose_current_profile_is_not_semi_monthly_still_pays_its_semi_monthly_past():
    # The source-level flag describes TODAY's profile (the health note); the timeline decides
    # each payday, so the checks of an earlier semi-monthly job still show.
    me = PaydaySource(
        "Me",
        False,
        Decimal("4000"),
        1,
        timeline=(
            PayRate(date(2026, 1, 1), True, Decimal("5000")),
            PayRate(date(2026, 8, 20), False, Decimal("4000")),
        ),
        starts_on=date(2026, 1, 1),
    )
    events = payday_events([me], Window(date(2026, 8, 1), date(2026, 8, 31)))
    assert [e.event_date for e in events] == [date(2026, 8, 14)]


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


SEP, OCT, NOV = date(2026, 9, 1), date(2026, 10, 1), date(2026, 11, 1)
FALL = Window(SEP, date(2026, 11, 30))


def ritual_status(
    today,
    *,
    snapshots,
    spending=(),
    take_home=(),
    written=(),
    saved_on=None,
    reminder_day=1,
    adopted_on=date(2026, 9, 12),
):
    """K3's month status from literals (2026-09-23 spec §T6): `snapshots` are (month,
    recorded_on) pairs; `written` the months with a row-level spending write on record. The
    month review was adopted on Sep 12, 2026 unless told otherwise — the real copy's day."""
    return MonthStatus(
        today=today,
        reminder_day=reminder_day,
        snapshots=tuple(
            snapshot_state(index, month, recorded, today)
            for index, (month, recorded) in enumerate(snapshots, start=1)
        ),
        spending=frozenset(spending),
        take_home=frozenset(take_home),
        closed=frozenset(),
        adopted_on=adopted_on,
        last_complete_month=None,
        empty_book=not (snapshots or spending or take_home),
        evidence=SpendingEvidence(written=frozenset(written), saved_on=saved_on or {}),
    )


# The real-data copy's shape (spec §V4): Sep 1 recorded on the 1st, Oct 1 recorded early on
# Sep 22; September's rent saved on Sep 7 — DURING September — and no take-home.
COPY = {
    "snapshots": [(SEP, SEP), (OCT, date(2026, 9, 22))],
    "spending": {SEP},
    "written": {SEP},
    "saved_on": {SEP: date(2026, 9, 7)},
}


def rows(events):
    return [
        (e.event_date, e.label, e.key, e.detail, [(i.label, i.detail) for i in e.items])
        for e in events
    ]


def test_ritual_lists_both_parts_on_the_reminder_date_and_redates_nothing_before_it():
    """Sep 23 on the copy: the Oct 1 reminder lists both parts ahead of time — the same rule
    answers a month still running — and September's own reminder has nothing left to ask."""
    today = date(2026, 9, 23)
    events = ritual_events(FALL, today, 1, ritual_status(today, **COPY))
    assert rows(events) == [
        (
            OCT,
            "Monthly update — Oct 1 balances · September spending & take-home",
            "ritual:2026-09:2026-10-01",
            None,
            [
                ("Oct 1 balances", "recorded early, on Sep 22 — update them"),
                (
                    "September spending & take-home",
                    "entered during September; add what has posted since · take-home not entered",
                ),
            ],
        ),
        (
            NOV,
            "Monthly update — Nov 1 balances · October spending & take-home",
            "ritual:2026-10:2026-11-01",
            None,
            [
                ("Nov 1 balances", "not recorded yet"),
                ("October spending & take-home", "not entered"),
            ],
        ),
    ]
    assert all(
        (e.href, e.short_label, e.basis, e.amount)
        == ("/update", "Monthly update", "scheduled", None)
        for e in events
    )


def test_ritual_sits_on_today_while_due_and_keeps_its_key():
    today = date(2026, 10, 3)
    first = ritual_events(FALL, today, 1, ritual_status(today, **COPY))[0]
    assert (first.event_date, first.key, first.detail) == (
        today,
        "ritual:2026-09:2026-10-01",
        "Due since Oct 1",
    )


def test_ritual_turns_overdue_part_by_part():
    def detail(day):
        return ritual_events(FALL, day, 1, ritual_status(day, **COPY))[0].detail

    # Balances turn amber from the 7th, the flows from the 16th (spec §0.4(c)) — each named with
    # its own deadline: the balances were due on their 1st, the spending by the grace day before
    # the 16th, as Needs attention, the ribbon and Budgets say it (controller decision, review
    # minor 2).
    assert detail(date(2026, 10, 6)) == "Due since Oct 1"
    assert detail(date(2026, 10, 7)) == "Overdue — Oct 1 balances were due Oct 1"
    assert detail(date(2026, 10, 16)) == (
        "Overdue — Oct 1 balances were due Oct 1; September spending & take-home was due by Oct 15"
    )


def test_ritual_overdue_wording_follows_a_non_default_reminder_day():
    """Reminder day 5 (review minor 10): the balances turn amber from Oct 11 (5 + 6) and still
    were due on their 1st; September's flows from Oct 20 (5 + 15), due by Oct 19."""
    status = ritual_status(date(2026, 10, 21), reminder_day=5, **COPY)
    first = ritual_events(FALL, date(2026, 10, 21), 5, status)[0]
    assert (first.key, first.detail) == (
        "ritual:2026-09:2026-10-05",
        "Overdue — Oct 1 balances were due Oct 1; September spending & take-home was due by Oct 19",
    )
    only_balances = ritual_status(date(2026, 10, 12), reminder_day=5, **COPY)
    assert ritual_events(FALL, date(2026, 10, 12), 5, only_balances)[0].detail == (
        "Overdue — Oct 1 balances were due Oct 1"
    )


def test_ritual_names_only_the_pending_part():
    today = date(2026, 10, 3)
    saved = ritual_status(today, **{**COPY, "snapshots": [(SEP, SEP), (OCT, OCT)]})
    first = ritual_events(FALL, today, 1, saved)[0]
    assert first.label == "Monthly update — September spending & take-home"
    # …and once September is saved again after it ended, only the take-home is left.
    entered = ritual_status(today, **{**COPY, "saved_on": {SEP: date(2026, 10, 2)}})
    first = ritual_events(FALL, today, 1, entered)[0]
    assert rows([first])[0][4] == [
        ("Oct 1 balances", "recorded early, on Sep 22 — update them"),
        ("September spending & take-home", "take-home not entered"),
    ]


def test_ritual_take_home_alone_never_completes_spending():
    """A take-home save leaves September partial (spec §K3): the item keeps the partial
    detail and loses only the take-home clause."""
    today = date(2026, 10, 3)
    first = ritual_events(FALL, today, 1, ritual_status(today, **COPY, take_home={SEP}))[0]
    assert first.items[-1].detail == "entered during September; add what has posted since"


def test_ritual_spending_missing_with_take_home_in():
    today = date(2026, 10, 3)
    status = ritual_status(today, snapshots=[(SEP, SEP), (OCT, OCT)], take_home={SEP})
    first = ritual_events(FALL, today, 1, status)[0]
    assert first.items[-1].detail == "spending not entered"


def test_ritual_is_silent_when_nothing_is_pending():
    today = date(2026, 10, 3)
    done = ritual_status(today, snapshots=[(SEP, SEP), (OCT, OCT)], spending={SEP}, take_home={SEP})
    assert ritual_events(Window(OCT, date(2026, 10, 31)), today, 1, done) == []


def test_ritual_honours_the_reminder_day():
    today = date(2026, 9, 23)
    events = ritual_events(FALL, today, 5, ritual_status(today, reminder_day=5, **COPY))
    assert [(e.event_date, e.key) for e in events] == [
        (date(2026, 10, 5), "ritual:2026-09:2026-10-05"),
        (date(2026, 11, 5), "ritual:2026-10:2026-11-05"),
    ]


def test_ritual_names_the_year_outside_the_current_one():
    today = date(2027, 1, 5)
    status = ritual_status(today, snapshots=[(date(2026, 12, 1), date(2026, 12, 1))])
    first = ritual_events(Window(date(2027, 1, 1), date(2027, 1, 31)), today, 1, status)[0]
    assert first.label == "Monthly update — Jan 1 balances · December 2026 spending & take-home"
    assert first.detail == "Due since Jan 1"


def test_ritual_asks_nothing_before_the_book_began():
    """K3's windows start at the first snapshot month: the month before it has no flows to
    ask for, and no balances either."""
    today = date(2026, 10, 3)
    status = ritual_status(today, snapshots=[(OCT, OCT)])
    events = ritual_events(Window(SEP, date(2026, 10, 31)), today, 1, status)
    assert events == []


def test_ritual_on_an_empty_book_asks_for_the_first_balances_only():
    [event] = ritual_events(Window(OCT, date(2026, 10, 31)), date(2026, 9, 23), 1, None)
    assert (event.label, [i.detail for i in event.items]) == (
        "Monthly update — Oct 1 balances",
        ["not recorded yet"],
    )


# Jul 1 and Aug 1 on file, nothing else, in a book whose month review was adopted in June: on
# Oct 3 K lists July's, August's and September's flows and October's balances as pending, so the
# reminders of August, September and October are all re-dated to today. September's own missing
# balances are not among them — K's balances part is this month's (Oct 1); a past month's gap is
# not a to-do (lane T code review, controller decision (a)).
JUL, AUG = date(2026, 7, 1), date(2026, 8, 1)
BEHIND = {"snapshots": [(JUL, JUL), (AUG, AUG)], "adopted_on": date(2026, 6, 12)}


def test_overdue_ritual_outside_the_window_is_dropped():
    """Viewing September on Oct 3 (code review I3): every pending reminder is re-dated to today,
    which the window does not contain — none is drawn on the wrong day."""
    today = date(2026, 10, 3)
    events = ritual_events(Window(SEP, date(2026, 9, 30)), today, 1, ritual_status(today, **BEHIND))
    assert events == []


def test_a_window_holding_today_shows_every_pending_reminder_on_it():
    """The window is judged on the EVENT's date, not the month (controller decision, review
    minor 1): viewing October on Oct 3 shows September's and August's pending reminders too, on
    today, under their own unchanged keys — a subscribed calendar keeps showing what is due."""
    today = date(2026, 10, 3)
    events = ritual_events(
        Window(OCT, date(2026, 10, 31)), today, 1, ritual_status(today, **BEHIND)
    )
    assert [(e.event_date, e.key) for e in events] == [
        (today, "ritual:2026-07:2026-08-01"),
        (today, "ritual:2026-08:2026-09-01"),
        (today, "ritual:2026-09:2026-10-01"),
    ]
    september = events[1]
    assert (september.label, september.detail) == (
        "Monthly update — August spending & take-home",
        "Overdue — August spending & take-home was due by Sep 15",
    )


def test_the_reminder_asks_only_what_the_month_status_lists():
    """Controller decision (a) on the code review: the reminder considers only the months K's
    month status itself lists as pending — this month's balances part, `provisional_past`,
    `flows_due` — never a second derivation, and never a month before the adoption. The BEHIND
    book adopted on Sep 12 instead: July's and August's flows are legacy history, and
    September's missing balances were never a to-do, so on Oct 3 only October's reminder is left."""
    today = date(2026, 10, 3)
    status = ritual_status(today, **{**BEHIND, "adopted_on": date(2026, 9, 12)})
    [october] = ritual_events(Window(OCT, date(2026, 10, 31)), today, 1, status)
    assert (october.event_date, october.key, october.label) == (
        today,
        "ritual:2026-09:2026-10-01",
        "Monthly update — Oct 1 balances · September spending & take-home",
    )


def test_the_feed_on_jan_5_shows_the_pending_fall_on_today():
    """The copy on 2027-01-05 through the feed's window (30 days back, a year ahead — minor 1):
    October's early balances and September's partial spending, and November's and December's
    missing months, all pending — each reminder on today, none dropped for its month."""
    today = date(2027, 1, 5)
    feed = Window(date(2026, 12, 6), date(2028, 1, 5))
    events = ritual_events(feed, today, 1, ritual_status(today, **COPY))
    on_today = [e.key for e in events if e.event_date == today]
    assert on_today == [
        "ritual:2026-09:2026-10-01",
        "ritual:2026-10:2026-11-01",
        "ritual:2026-11:2026-12-01",
        "ritual:2026-12:2027-01-01",
    ]
    # The months still ahead keep their own dates.
    assert events[len(on_today)].event_date == date(2027, 2, 1)
    # Only what K lists (controller decision (a)): October's early balances (provisional_past),
    # this month's (the balances part) and four months of flows — not November's or December's
    # missing balances, which Needs attention does not ask for either.
    assert [e.label for e in events if e.event_date == today] == [
        "Monthly update — Oct 1, 2026 balances · September 2026 spending & take-home",
        "Monthly update — October 2026 spending & take-home",
        "Monthly update — November 2026 spending & take-home",
        "Monthly update — Jan 1 balances · December 2026 spending & take-home",
    ]


def test_a_legacy_month_recorded_early_is_never_pending():
    """A special case of the adoption rule (controller decision (a)): K4 never restamps a month
    before the adoption (Sep 12 here), so its early balances stay provisional for good — K's
    provisional_past leaves them out, and so does the reminder; the ribbon still hatches it."""
    today = date(2026, 10, 3)
    status = ritual_status(
        today,
        snapshots=[(JUL, date(2026, 6, 28)), (AUG, AUG), (SEP, SEP), (OCT, OCT)],
        spending={JUL, AUG, SEP},
        take_home={JUL, AUG, SEP},
    )
    assert ritual_events(Window(OCT, date(2026, 10, 31)), today, 1, status) == []


# The reviewer's probe shapes (lane T code review, controller decision (a), (c)): the copy's
# span — a snapshot on every 1st from Sep 2023 to Oct 2026 — with a hole in its legacy history,
# seen on Oct 3 through the feed's window (30 days back, a year ahead). The month review was
# adopted on Sep 12, 2026: nothing before September 2026 is ever asked for.
BOOK = [month_shift(date(2023, 9, 1), n) for n in range(38)]
OCT_3_FEED = Window(date(2026, 9, 3), date(2027, 10, 3))


def test_legacy_months_without_take_home_never_nag():
    """Take-home recorded only from Jan 2025 (an import without the early net pay): K's
    flows_due lists sixteen legacy months, and no reminder asks for any of them."""
    today = date(2026, 10, 3)
    status = ritual_status(
        today,
        snapshots=[(month, month) for month in BOOK],
        spending=set(BOOK[:-1]),
        take_home={month for month in BOOK[:-1] if month >= date(2025, 1, 1)},
    )
    assert len(status.time().flows_due) == 16  # K lists them; the reminder does not follow
    events = ritual_events(OCT_3_FEED, today, 1, status)
    assert [e.key for e in events if e.event_date == today] == []
    assert min(e.entity_ref for e in events) == "2026-10"  # the Nov 1 reminder, on its own day


def test_a_missing_legacy_snapshot_never_nags():
    """One 1st never recorded (Mar 1, 2024) in an otherwise complete book: a past month's
    missing balances are not a to-do K lists, and the month is legacy besides — no reminder,
    today or on any later day."""
    today = date(2026, 10, 3)
    status = ritual_status(
        today,
        snapshots=[(month, month) for month in BOOK if month != date(2024, 3, 1)],
        spending=set(BOOK[:-1]),
        take_home=set(BOOK[:-1]),
    )
    events = ritual_events(OCT_3_FEED, today, 1, status)
    assert [e.key for e in events if e.event_date == today] == []
    assert "ritual:2024-02:2024-03-01" not in {e.key for e in events}


def test_balances_recorded_ahead_of_their_date_are_named_so():
    """A snapshot provisional only because its month is still ahead — an import or an API client
    stored it with no earlier recorded date (review minor 10)."""
    today = date(2026, 10, 3)
    status = ritual_status(today, snapshots=[(SEP, SEP), (OCT, OCT), (NOV, None)], take_home={SEP})
    nov = ritual_events(Window(NOV, date(2026, 11, 30)), today, 1, status)[0]
    assert (nov.key, rows([nov])[0][4][0]) == (
        "ritual:2026-10:2026-11-01",
        ("Nov 1 balances", "recorded ahead of their date — update them"),
    )


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
