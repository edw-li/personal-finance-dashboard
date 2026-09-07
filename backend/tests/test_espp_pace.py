"""The ESPP pace row's purchase-year windows (2026-09-06 spec §1).

Pure module, so no database: plain objects stand in for the profile rows. The golden is
production's own timeline — 11 % until 2026-08-17 then 12 % on 188,930 over 24 checks, no
stored periods, today 2026-09-06 — and each half is twelve semi-monthly paydays priced by
whichever profile was in force on each. H1's twelve are all at 11 %; H2's are all at 11 %
except Aug 31, the first payday on or after the raise.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.services.espp_calc import StoredPeriod, plan_year_rows
from app.services.espp_pace import espp_pace_item

D = Decimal
DISCOUNT = D("0.15")
LIMIT = D("25000.00")
TODAY = date(2026, 9, 6)


@dataclass
class FakeProfile:
    effective_date: date
    annual_salary: Decimal = D("188930.00")
    pay_periods_per_year: int = 24
    espp_pct: Decimal = D("0.110000000")
    # The walk behind this row prices a WHOLE payday now (spec §2.6), so the stand-in carries
    # the other three contribution columns too. Zero here: this file is about the ESPP leg.
    trad_401k_pct: Decimal = D("0")
    roth_401k_pct: Decimal = D("0")
    after_tax_401k_pct: Decimal = D("0")
    hsa_per_check: Decimal = D("0")


EDWARD = [
    FakeProfile(effective_date=date(2026, 1, 1)),
    FakeProfile(effective_date=date(2026, 8, 17), espp_pct=D("0.120000000")),
]


def rows_for(year: int, stored: list | None = None):
    plans, _warnings = plan_year_rows(year, stored or [], [], None, None)
    return plans


def item(**kwargs):
    args = {
        "rows": rows_for(2026),
        "profiles": EDWARD,
        "scenario_from_today": EDWARD[-1],
        "limit": LIMIT,
        "discount": DISCOUNT,
        "today": TODAY,
    }
    return espp_pace_item(**{**args, **kwargs})


def test_the_windows_are_the_purchase_years_two_halves():
    halves = item().halves
    assert [h.label for h in halves] == ["Sep 2025–Feb 2026", "Mar–Aug 2026"]
    assert (halves[0].start, halves[0].end) == (date(2025, 9, 1), date(2026, 2, 27))
    assert (halves[1].start, halves[1].end) == (date(2026, 3, 1), date(2026, 8, 31))
    only = FakeProfile(effective_date=date(2020, 1, 1))
    leap = espp_pace_item(
        rows=rows_for(2024),
        profiles=[only],
        scenario_from_today=only,
        limit=LIMIT,
        discount=DISCOUNT,
        today=date(2024, 9, 6),
    ).halves
    assert leap[0].end == date(2024, 2, 29)  # a Thursday: the last weekday of the month


def test_the_golden_window_and_verdict():
    row = item()
    assert row.key == "limit_espp_423"
    assert row.measure == "window"
    assert row.window_label == "Sep 2025 – Aug 2026 purchases"
    assert [h.amount for h in row.halves] == [D("10391.15"), D("10469.87")]
    assert [h.source for h in row.halves] == ["estimated", "estimated"]
    assert [h.basis for h in row.halves] == ["paydays", "paydays"]
    assert row.annualized == D("20861.02")
    assert (row.limit, row.ratio) == (LIMIT, D("0.8344"))
    assert row.soft_limit == D("21250.00")  # 25,000 x (1 - 0.15)
    assert row.soft_ratio == D("0.9817")
    # Judged on soft_ratio, so the verdict agrees with the tick even though the HARD ratio
    # is a comfortable 0.83.
    assert row.tone == "warn"
    assert row.projected_full_year == D("22671.60")
    assert row.projected_excess == D("1421.60")
    assert row.current_rate == D("0.120000000")  # the scenario's rate, so the note can say "12%"
    # H1 opens 2025-09-01, four months before EDWARD's earliest profile, so its first eight
    # paydays BORROW that profile — which is exactly what the 10,391.15 above is made of.
    # The flag exists to say so out loud rather than let the figure pass as observed.
    assert row.backfilled_from == date(2026, 1, 1)


def test_a_stored_half_wins_only_once_its_purchase_has_happened():
    stored = [
        StoredPeriod(
            id=1,
            label="Sep 2025–Feb 2026",
            period_start=date(2025, 9, 1),
            period_end=date(2026, 2, 27),
            semi_annual_base=D("90000.00"),
            additional_payments=D("0.00"),
            contribution_pct=D("0.100000000"),
        )
    ]
    past = item(rows=rows_for(2026, stored)).halves[0]
    assert past.source == "entered"
    assert past.amount == D("9000.00")  # the number the user typed, not an estimate
    assert past.basis is None
    # The SAME row read before its purchase date is still an estimate: nothing was bought.
    assert item(rows=rows_for(2026, stored), today=date(2026, 1, 5)).halves[0].source == "estimated"


def test_paydays_before_the_earliest_profile_borrow_it_and_say_so():
    row = item(profiles=EDWARD[1:], scenario_from_today=EDWARD[1])
    assert row.backfilled_from == date(2026, 8, 17)
    assert row.annualized == D("22671.60")  # 24 paydays at 12 % of 188,930 / 24


def test_a_non_semi_monthly_cadence_estimates_by_month():
    biweekly = FakeProfile(
        effective_date=date(2020, 1, 1), pay_periods_per_year=26, espp_pct=D("0.120000000")
    )
    row = item(profiles=[biweekly], scenario_from_today=biweekly)
    assert [h.basis for h in row.halves] == ["months", "months"]
    # Six months x 0.12 x 188,930 / 12 = 11,335.80 a half.
    assert [h.amount for h in row.halves] == [D("11335.80"), D("11335.80")]


def test_the_scenario_only_moves_paydays_from_today_onward():
    """The knob answers "if I change NOW, where do this year's purchases land?" — it can
    never rewrite a check that has already been cut."""
    scenario = FakeProfile(effective_date=date(2026, 8, 17), espp_pct=D("0.200000000"))
    row = item(scenario_from_today=scenario, today=date(2026, 6, 1))
    assert row.halves[0].amount == D("10391.15")  # wholly in the past: untouched
    assert row.halves[1].amount > D("10469.87")  # Jun 15 onward at 20 %


def test_a_missing_limit_is_a_call_to_action_with_no_meter():
    row = item(limit=None)
    assert (row.limit, row.ratio, row.soft_limit, row.soft_ratio) == (None, None, None, None)
    assert row.projected_excess is None
    assert row.tone == "ok"
    assert row.annualized == D("20861.02")  # the window is still true without a cap


def test_row_visibility_follows_the_window_and_the_current_rate():
    zero = FakeProfile(effective_date=date(2020, 1, 1), espp_pct=D("0"))
    assert item(profiles=[zero], scenario_from_today=zero) is None
    # A zero window plus a live rate IS the news: the first purchase is still ahead.
    now = FakeProfile(effective_date=TODAY, espp_pct=D("0.100000000"))
    row = item(profiles=[zero, now], scenario_from_today=now)
    assert row is not None
    assert row.annualized == D("0.00")
    assert row.projected_full_year == D("18893.00")


def test_a_window_that_opens_after_the_earliest_profile_borrows_nothing():
    """The cadence probe is not a payday, and only a priced payday can borrow.

    A stored period opening 2025-09-20 under a profile effective 2025-09-25 has exactly one
    September payday inside it, the 30th, and that one is the real profile's. The probe for
    the month's cadence lands on the clamped 20th — before the profile, never priced — so
    the row must not report a backfill it did not make.
    """
    only = FakeProfile(effective_date=date(2025, 9, 25))
    stored = [
        StoredPeriod(
            id=1,
            label="Sep 2025–Feb 2026",
            period_start=date(2025, 9, 20),
            period_end=date(2026, 2, 27),
            semi_annual_base=D("90000.00"),
            additional_payments=D("0.00"),
            contribution_pct=D("0.100000000"),
        )
    ]
    row = espp_pace_item(
        rows=rows_for(2026, stored),
        profiles=[only],
        scenario_from_today=only,
        limit=LIMIT,
        discount=DISCOUNT,
        today=date(2026, 1, 5),
    )
    assert row.halves[0].source == "estimated"  # the February purchase has not happened yet
    assert row.backfilled_from is None


def test_the_window_says_how_much_of_it_is_already_behind_today():
    """`so_far` is the ESPP row's half of §2.6's two figures: the window's paydays before
    today. The whole 2026 window is behind 2026-09-06, so there it IS the window."""
    assert item().so_far == item().annualized == D("20861.02")
    # Nine of H1's twelve paydays are behind 2026-01-20 (Sep 2025 through Jan 15) and H2 has
    # not opened: 9 x 11 % of 188,930 / 24.
    assert item(today=date(2026, 1, 20)).so_far == D("7793.36")


def test_an_entered_half_counts_wholly_toward_so_far():
    """The purchase happened and the user typed the contribution, so all of it is behind us —
    an estimate of the same half would be second-guessing their own number."""
    stored = [
        StoredPeriod(
            id=1,
            label="Sep 2025–Feb 2026",
            period_start=date(2025, 9, 1),
            period_end=date(2026, 2, 27),
            semi_annual_base=D("90000.00"),
            additional_payments=D("0.00"),
            contribution_pct=D("0.100000000"),
        )
    ]
    row = item(rows=rows_for(2026, stored), today=date(2026, 6, 1))
    assert row.halves[0].source == "entered"
    # 9,000 entered + six Mar-through-May paydays at 11 %.
    assert row.so_far == D("14195.58")
