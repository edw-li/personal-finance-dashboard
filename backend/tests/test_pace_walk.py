"""The payday walk behind every pace row (2026-09-06 spec §2.6).

Pure module, so no database: plain objects stand in for the profile rows. The golden is
production's own timeline — 13 % traditional, 3 % after-tax, 100 a check to the HSA and
11 % ESPP until the 2026-08-17 raise takes ESPP to 12 %, on 188,930 over 24 checks — walked
across the calendar year with today at 2026-09-07, which is 16 paydays in and 8 to go.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.services.pace_walk import first_payday, walk

D = Decimal
TODAY = date(2026, 9, 7)
JAN = date(2026, 1, 1)
DEC = date(2026, 12, 31)


@dataclass
class FakeProfile:
    effective_date: date
    annual_salary: Decimal = D("188930.00")
    pay_periods_per_year: int = 24
    trad_401k_pct: Decimal = D("0.130000000")
    roth_401k_pct: Decimal = D("0")
    after_tax_401k_pct: Decimal = D("0.030000000")
    espp_pct: Decimal = D("0.110000000")
    hsa_per_check: Decimal = D("100.00")


EDWARD = [
    FakeProfile(effective_date=date(2026, 1, 1)),
    FakeProfile(effective_date=date(2026, 8, 17), espp_pct=D("0.120000000")),
]


def year(profiles=None, scenario=None, today=TODAY, start=JAN, end=DEC):
    rows = EDWARD if profiles is None else profiles
    return walk(rows, rows[-1] if scenario is None else scenario, today, start, end)


def test_the_year_splits_into_what_has_gone_in_and_where_it_lands():
    walked = year()
    # 16 of 24 semi-monthly paydays are behind 2026-09-07, so every per-check leg is two
    # thirds of its year — the answer to "why does the HSA row read 2,400 in September".
    assert walked.so_far["elective"] == D("16373.93")
    assert walked.projected["elective"] == D("24560.90")
    assert walked.so_far["after_tax"] == D("3778.60")
    assert walked.projected["after_tax"] == D("5667.90")
    assert walked.so_far["hsa_employee"] == D("1600.00")
    assert walked.projected["hsa_employee"] == D("2400.00")
    # ESPP is the one leg the raise moves: 15 paydays at 11 % and Aug 31 at 12 %.
    assert walked.so_far["espp"] == D("13933.59")
    assert walked.projected["espp"] == D("21490.79")
    assert walked.basis == "paydays"
    assert walked.backfilled_from is None


def test_only_paydays_from_today_onward_are_priced_by_the_scenario():
    """The sandbox's question is "if I change now", never "what if I had changed in March"."""
    scenario = FakeProfile(effective_date=date(2026, 8, 17), trad_401k_pct=D("0.200000000"))
    walked = year(scenario=scenario)
    assert walked.so_far["elective"] == D("16373.93")  # untouched by a change made today
    # ...and the remaining 8 paydays defer at 20 %.
    assert walked.projected["elective"] == D("28969.27")


def test_a_cadence_without_a_payday_calendar_falls_back_to_the_month_basis():
    """`semi_monthly_paydays` describes 24 checks and nothing else, so a 26-check profile is
    walked one twelfth of the annual rate per month, probed on the 15th (espp_pace's rule)."""
    biweekly = [FakeProfile(effective_date=date(2026, 1, 1), pay_periods_per_year=26)]
    walked = year(profiles=biweekly)
    assert walked.basis == "months"
    # Eight months' 15ths are behind today; the twelve add back to the full-year rate.
    assert walked.so_far["elective"] == D("16373.93")
    assert walked.projected["elective"] == D("24560.90")
    # The HSA leg is per CHECK, so the month basis has to re-cadence it: 100 x 26 / 12.
    assert walked.so_far["hsa_employee"] == D("1733.33")
    assert walked.projected["hsa_employee"] == D("2600.00")


def test_paydays_before_the_earliest_profile_borrow_it_and_the_walk_says_so():
    late = [FakeProfile(effective_date=date(2026, 3, 1))]
    walked = year(profiles=late)
    assert walked.backfilled_from == date(2026, 3, 1)
    # Borrowed or not, the figure is the whole year at that rate — the flag is the caveat,
    # not a different number.
    assert walked.projected["elective"] == D("24560.90")


def test_a_window_that_borrows_nothing_never_claims_it_did():
    walked = year(profiles=[FakeProfile(effective_date=date(2020, 1, 1))])
    assert walked.backfilled_from is None
    # Nor does a window entirely in the future, where every payday is the scenario's.
    ahead = walk(EDWARD, EDWARD[-1], TODAY, date(2026, 10, 1), DEC)
    assert ahead.backfilled_from is None
    assert ahead.so_far["elective"] == D("0.00")


def test_first_payday_is_the_business_day_on_or_before_january_15():
    # Semi-monthly payroll pays BACKWARD over a weekend or holiday; 2026-01-15 is a Thursday.
    assert first_payday(2026, 24) == date(2026, 1, 15)
    # 2027-01-15 is a Friday; 2021-01-15 was a Friday too, so the step-back shows on 2022,
    # whose January 15 fell on a Saturday.
    assert first_payday(2022, 24) == date(2022, 1, 14)
    # Any other cadence has no payday calendar at all: the 15th is the probe date the month
    # basis uses, so it is the day the first month's money is credited to.
    assert first_payday(2022, 26) == date(2022, 1, 15)


def test_the_walk_says_whether_the_years_first_payday_has_gone_by():
    """The employer's HSA deposit rides that check (spec §2.6), and `paycheck_pace` is pure —
    it has no clock of its own, so the walk answers this where `today` is already in hand."""
    assert year().first_payday_passed is True
    # Read on January 2nd, the 15th has not come: nothing has been deposited yet.
    assert year(today=date(2026, 1, 2)).first_payday_passed is False
