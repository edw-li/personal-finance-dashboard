"""Month status — the monthly update's two parts, due and overdue (2026-09-23 spec §K3,
§0.4(c)). Pure: MonthStatus is built from rows and change-log evidence already read."""

from datetime import date

from app.services.month_status import (
    MonthStatus,
    SpendingEvidence,
    balances_overdue_from,
    flows_overdue_from,
    overdue_through,
    reminder_date,
)
from app.services.snapshot_state import snapshot_state

ADOPTED = date(2026, 9, 12)  # the copy's adoption day: months before September are history


def m(year: int, month: int) -> date:
    return date(year, month, 1)


SEP, OCT, NOV = m(2026, 9), m(2026, 10), m(2026, 11)


def book(
    today,
    *,
    snapshots=(),
    spending=(),
    take_home=(),
    closed=(),
    adopted_on=ADOPTED,
    reminder_day=1,
    evidence=None,
    last_complete_month=None,
    empty_book=False,
) -> MonthStatus:
    states = tuple(
        snapshot_state(i, month, recorded_on, today)
        for i, (month, recorded_on) in enumerate(sorted(snapshots), start=1)
    )
    return MonthStatus(
        today=today,
        reminder_day=reminder_day,
        snapshots=states,
        spending=frozenset(spending),
        take_home=frozenset(take_home),
        closed=frozenset(closed),
        adopted_on=adopted_on,
        last_complete_month=last_complete_month,
        empty_book=empty_book,
        evidence=evidence or SpendingEvidence(),
    )


# The copy's shape: Jun-Sep 1 recorded on their 1sts, Oct 1 recorded early on Sep 22; spending
# every month Jun-Sep, take-home Jun-Aug; September's rent saved DURING September.
HISTORY = [(m(2026, month), m(2026, month)) for month in range(6, 10)] + [(OCT, date(2026, 9, 22))]
RENT_SAVED_SEP_5 = SpendingEvidence(written=frozenset({SEP}), saved_on={SEP: date(2026, 9, 5)})


def copy_book(today, **overrides) -> MonthStatus:
    return book(
        today,
        **{
            "snapshots": HISTORY,
            "spending": {m(2026, month) for month in range(6, 10)},
            "take_home": {m(2026, month) for month in range(6, 9)},
            "evidence": RENT_SAVED_SEP_5,
            "last_complete_month": m(2026, 8),
            **overrides,
        },
    )


def test_thresholds_are_date_arithmetic_from_the_reminder_day():
    assert reminder_date(OCT, 1) == date(2026, 10, 1)
    assert balances_overdue_from(OCT, 1) == date(2026, 10, 7)  # the 7th by default
    assert balances_overdue_from(OCT, 28) == date(2026, 10, 31)  # capped at the month's end
    assert balances_overdue_from(m(2026, 2), 25) == date(2026, 2, 28)
    assert flows_overdue_from(SEP, 1) == date(2026, 10, 16)  # the 16th of the next month
    # A day-28 reminder in February puts January's flows threshold on Mar 15.
    assert flows_overdue_from(m(2026, 1), 28) == date(2026, 3, 15)


def test_the_missing_window_ends_at_the_newest_overdue_month():
    assert overdue_through(date(2026, 9, 23), 1) == m(2026, 8)
    assert overdue_through(date(2026, 10, 15), 1) == m(2026, 8)
    assert overdue_through(date(2026, 10, 16), 1) == SEP
    # Day 28: August is overdue only from Oct 13, so on Oct 3 the window ends at July.
    assert overdue_through(date(2026, 10, 3), 28) == m(2026, 7)


def test_sep_23_balances_final_and_nothing_due():
    time = copy_book(date(2026, 9, 23)).time()
    assert (time.current_month, time.balances.month, time.balances.status) == (SEP, SEP, "final")
    assert time.balances.overdue is False and time.flows_due == []
    assert (time.current_snapshot.month, time.current_snapshot.provisional) == (OCT, True)
    assert time.current_snapshot.as_of == date(2026, 9, 22)
    assert time.previous_snapshot.month == SEP
    assert time.provisional_past == [] and time.last_complete_month == m(2026, 8)


def test_oct_1_balances_provisional_and_september_partial_without_take_home():
    time = copy_book(date(2026, 10, 1)).time()
    assert (time.balances.status, time.balances.overdue) == ("provisional", False)
    assert (time.balances.due_on, time.balances.overdue_from) == (OCT, date(2026, 10, 7))
    assert time.balances.snapshot.as_of == date(2026, 9, 22)
    (september,) = time.flows_due
    assert september.model_dump() == {
        "month": SEP,
        "spending": "partial",
        "spending_entered": False,
        "spending_saved_on": date(2026, 9, 5),
        "take_home_entered": False,
        "due_on": OCT,
        "overdue_from": date(2026, 10, 16),
        "overdue": False,
    }


def test_oct_7_provisional_balances_turn_overdue_and_day_28_waits_for_the_month_end():
    assert copy_book(date(2026, 10, 7)).time().balances.overdue is True
    late = copy_book(date(2026, 10, 7), reminder_day=28).time().balances
    assert (late.overdue_from, late.overdue) == (date(2026, 10, 31), False)
    assert copy_book(date(2026, 10, 31), reminder_day=28).time().balances.overdue is True


def test_oct_15_versus_oct_16():
    assert copy_book(date(2026, 10, 15)).time().flows_due[0].overdue is False
    assert copy_book(date(2026, 10, 16)).time().flows_due[0].overdue is True


def test_take_home_without_spending_and_spending_without_take_home():
    only_pay = book(date(2026, 10, 3), snapshots=[(SEP, SEP)], take_home={SEP}).time()
    assert [(p.spending, p.take_home_entered) for p in only_pay.flows_due] == [("missing", True)]
    no_log = book(date(2026, 10, 3), snapshots=[(SEP, SEP)], spending={SEP}).time()
    # No spending write on record (clause b): entered — only the take-home is due.
    assert [(p.spending, p.take_home_entered) for p in no_log.flows_due] == [("entered", False)]


def test_a_confirmed_zero_month_counts_as_spending():
    # `spending` is "a non-zero amount or a confirmed zero" — load_coverage builds it that way.
    time = book(date(2026, 10, 3), snapshots=[(SEP, SEP)], spending={SEP}, take_home={SEP}).time()
    assert time.flows_due == []


def test_three_missing_months_are_listed_newest_first():
    june = m(2026, 6)
    time = book(
        date(2026, 10, 20), snapshots=[(june, june)], spending={june}, take_home={june}
    ).time()
    assert [(p.month, p.spending, p.overdue) for p in time.flows_due] == [
        (SEP, "missing", True),
        (m(2026, 8), "missing", True),
        (m(2026, 7), "missing", True),
    ]


def test_dec_to_jan_the_jan_1_balances_and_december_s_flows():
    dec = m(2026, 12)
    time = book(
        date(2027, 1, 5), snapshots=[(NOV, NOV), (dec, dec)], spending={NOV}, take_home={NOV}
    ).time()
    assert (time.balances.month, time.balances.status, time.balances.overdue) == (
        m(2027, 1),
        "missing",
        False,
    )
    assert [(p.month, p.due_on, p.overdue_from, p.overdue) for p in time.flows_due] == [
        (dec, m(2027, 1), date(2027, 1, 16), False)
    ]


def test_the_first_snapshot_recorded_mid_month_starts_the_window():
    first = m(2023, 9)
    early = book(date(2023, 9, 28), snapshots=[(first, date(2023, 9, 24))], adopted_on=None)
    early_time = early.time()
    assert (early_time.balances.status, early_time.current_snapshot.as_of) == ("final", first)
    assert early_time.flows_due == []
    later = book(date(2023, 10, 2), snapshots=[(first, date(2023, 9, 24))], adopted_on=None)
    assert [p.month for p in later.time().flows_due] == [first]


def test_an_early_snapshot_never_saved_again_is_named_after_its_month_but_legacy_ones_are_not():
    snapshots = [(SEP, SEP), (OCT, date(2026, 9, 22)), (NOV, NOV)]
    feeds = {"spending": {SEP, OCT}, "take_home": {SEP, OCT}}
    time = book(date(2026, 11, 5), snapshots=snapshots, **feeds).time()
    assert time.balances.status == "final"
    assert [(s.month, s.as_of) for s in time.provisional_past] == [(OCT, date(2026, 9, 22))]
    # The same early snapshot on a month before the adoption month is legacy history: left out.
    legacy = book(date(2026, 11, 5), snapshots=snapshots, adopted_on=date(2026, 11, 2), **feeds)
    assert legacy.time().provisional_past == []


def test_every_provisional_snapshot_month_is_listed_legacy_and_ahead_included():
    """T8 (spec review M9): the ribbon's balances half follows snapshot_state's flag for EVERY
    snapshot — the server's one rule. provisional_past leaves legacy months out (Needs attention
    does not nag about history); the chip must still read a legacy month recorded early as
    provisional, and balances filed ahead of their month too."""
    snapshots = [(SEP, SEP), (OCT, date(2026, 9, 22)), (NOV, NOV), (m(2027, 2), date(2026, 11, 3))]
    feeds = {"spending": {SEP, OCT}, "take_home": {SEP, OCT}}
    legacy = book(date(2026, 11, 5), snapshots=snapshots, adopted_on=date(2026, 11, 2), **feeds)
    time = legacy.time()
    assert time.provisional_past == []
    assert time.provisional_months == [OCT, m(2027, 2)]


def test_an_empty_book_has_no_time_status():
    assert book(date(2026, 9, 23), empty_book=True).time() is None


def test_the_running_month_answers_through_clauses_a_and_b_only():
    """T6's reminder asks about a month still under way: rent saved on Sep 5 reads partial on
    Sep 23 (the log holds an in-month write); with no write on record it reads entered."""
    assert copy_book(date(2026, 9, 23)).spending_state(SEP) == "partial"
    no_log = copy_book(date(2026, 9, 23), evidence=SpendingEvidence())
    assert no_log.spending_state(SEP) == "entered"


def test_certified_months_are_entered_and_never_candidates():
    status = copy_book(date(2026, 10, 3), closed={SEP})
    assert status.spending_state(SEP) == "entered"  # closed at some point (clause a)
    assert status.spending_state(m(2026, 7)) == "entered"  # before the adoption month
    assert status.candidates() == []
    assert copy_book(date(2026, 10, 3)).candidates() == [SEP]
    assert status.spending_state(m(2026, 5)) == "missing"  # nothing on file at all


def test_balances_missing_on_oct_3_without_an_oct_snapshot():
    time = book(date(2026, 10, 3), snapshots=[(SEP, SEP)], spending={SEP}, take_home={SEP}).time()
    assert (time.balances.status, time.balances.snapshot) == ("missing", None)
    assert time.balances.overdue_from == date(2026, 10, 7)
