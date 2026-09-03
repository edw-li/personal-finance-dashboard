"""Tax amounts (2026-09-03 calendar spec §6 tax row): the safe-harbor shortfall split evenly
across the REMAINING current-year payment dates, the verdict in the detail, the prior year's
positive balance on Apr 15, nulls everywhere the tracker cannot see."""

from datetime import date
from decimal import Decimal

from app.services.calendar.generators.taxes import TaxFacts, payment_dates, tax_deadline_events
from app.services.calendar.model import Window

TODAY = date(2026, 8, 24)
YEAR = Window(date(2026, 1, 1), date(2027, 1, 31))


def by_ref(events):
    return {e.entity_ref: e for e in events}


def test_payment_dates_are_the_four_estimated_dates_forward_adjusted():
    assert payment_dates(2026) == [
        date(2026, 4, 15),
        date(2026, 6, 15),
        date(2026, 9, 15),
        date(2027, 1, 15),
    ]
    assert payment_dates(2027)[3] == date(2028, 1, 18)  # Sat Jan 15 → Sun → MLK Mon → Tue


def test_shortfall_splits_across_remaining_dates_with_the_verdict_and_leaves_past_dates_null():
    facts = {
        2026: TaxFacts(
            2026,
            effective_threshold=Decimal("30000"),
            total_projected=Decimal("27600"),
            effective_leg="prior-year",
        )
    }
    events = by_ref(tax_deadline_events(YEAR, TODAY, facts))
    # Remaining as of Aug 24: Sep 15 2026 and Jan 15 2027 → 2400 / 2 each.
    assert (events["2026-q3"].amount, events["2026-q3"].basis, events["2026-q3"].direction) == (
        Decimal("1200.00"),
        "estimated",
        "out",
    )
    assert (
        events["2026-q3"].detail
        == "Shortfall $2,400.00 to the prior-year leg — $1,200.00 of it here"
    )
    assert (events["2026-q4"].event_date, events["2026-q4"].amount) == (
        date(2027, 1, 15),
        Decimal("1200.00"),
    )
    # Past dates are history: null amount, the plain v1 detail, scheduled basis.
    assert (events["2026-q1"].amount, events["2026-q1"].detail, events["2026-q1"].basis) == (
        None,
        "federal filing + Q1 estimated payment",
        "scheduled",
    )
    assert events["2026-q2"].amount is None
    assert events["2026-extension"].amount is None
    assert events["2025-q4"].amount is None  # last year's Q4, due Jan 15 2026 — history too


def test_uneven_split_puts_the_remainder_on_the_last_date():
    facts = {2026: TaxFacts(2026, Decimal("1000.01"), Decimal("0"), "current-year")}
    events = by_ref(tax_deadline_events(YEAR, TODAY, facts))
    assert (events["2026-q3"].amount, events["2026-q4"].amount) == (
        Decimal("500.00"),
        Decimal("500.01"),
    )


def test_harbor_met_is_zero_with_the_verdict():
    facts = {2026: TaxFacts(2026, Decimal("30000"), Decimal("31000"), "current-year")}
    q3 = by_ref(tax_deadline_events(YEAR, TODAY, facts))["2026-q3"]
    assert (q3.amount, q3.detail) == (Decimal("0.00"), "Safe harbor met — no payment needed")


def test_apr_15_carries_the_prior_years_balance_plus_its_q1_share():
    early = date(2026, 2, 1)  # every 2026 payment date is still ahead
    facts = {
        2026: TaxFacts(
            2026, Decimal("4000"), Decimal("0"), "prior-year", prior_year_balance=Decimal("1500")
        )
    }
    q1 = by_ref(tax_deadline_events(YEAR, early, facts))["2026-q1"]
    assert q1.amount == Decimal("2500.00")  # 4000 / 4 + 1500
    assert q1.detail == (
        "Shortfall $4,000.00 to the prior-year leg — $1,000.00 of it here"
        " · files 2025: balance ≈ $1,500.00"
    )
    # Balance known, harbor unknown: the filing balance stands alone.
    only_balance = {2026: TaxFacts(2026, None, None, None, prior_year_balance=Decimal("1500"))}
    q1 = by_ref(tax_deadline_events(YEAR, early, only_balance))["2026-q1"]
    assert (q1.amount, q1.detail) == (Decimal("1500.00"), "files 2025: balance ≈ $1,500.00")


def test_no_facts_or_incomplete_facts_leave_v1_dates_only():
    events = tax_deadline_events(YEAR, TODAY, {})
    assert all(e.amount is None and e.basis == "scheduled" for e in events)
    partial = {2026: TaxFacts(2026, None, Decimal("27600"), None)}
    assert all(e.amount is None for e in tax_deadline_events(YEAR, TODAY, partial))
