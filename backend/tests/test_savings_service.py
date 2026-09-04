"""The one savings definition (2026-09-04 honest-numbers spec §2), unit-tested.

Mostly pure: dicts in, dataclasses out. The two async tests exist because the loader is
where kinds meet profiles, and that join is the thing every page depends on.
"""

from datetime import date
from decimal import Decimal

import pytest

from app.models import MonthlyCashflow, MonthlySpending, PaycheckProfile, SpendingCategory
from app.services.savings import (
    LIVING,
    TAX,
    TRANSFER,
    compose_months,
    load_month_savings,
    matched_months,
    month_savings,
    payroll_by_month,
    payroll_monthly,
    rollup,
)

D = Decimal


def _profile(**overrides) -> PaycheckProfile:
    """5,000 gross a check (120,000 / 24), 10% traditional + $100 HSA = 600 a check =
    1,200.00 a month of payroll savings. EVERY column is explicit: an un-flushed model
    row has no column defaults, so an omitted pct would be None, not 0."""
    fields = {
        "person_id": 1,
        "effective_date": date(2026, 1, 1),
        "annual_salary": D("120000.00"),
        "pay_periods_per_year": 24,
        "trad_401k_pct": D("0.10"),
        "roth_401k_pct": D("0"),
        "after_tax_401k_pct": D("0"),
        "espp_pct": D("0"),
        "withholding_pct": D("0.20"),
        "dental_vision_per_check": D("0"),
        "hsa_per_check": D("100.00"),
    }
    fields.update(overrides)
    return PaycheckProfile(**fields)


def test_payroll_monthly_is_the_five_saving_lines_at_the_profile_cadence():
    assert payroll_monthly(_profile()) == D("1200")
    # ESPP and Roth ride on GROSS too, so 11% + 3% adds 5,000 * 0.14 = 700 a check.
    richer = _profile(espp_pct=D("0.11"), roth_401k_pct=D("0.03"))
    assert payroll_monthly(richer) == D("2600")


def test_payroll_by_month_uses_the_profile_in_force_on_the_first_of_the_month():
    months = [
        date(2025, 12, 1),
        date(2026, 1, 1),
        date(2026, 2, 1),
        date(2026, 3, 1),
        date(2026, 4, 1),
    ]
    raise_mid_march = _profile(effective_date=date(2026, 3, 15), annual_salary=D("240000.00"))
    by_month = payroll_by_month([_profile(), raise_mid_march], months)
    # Dec: nobody had a profile yet -> 0.00, never a guess. A profile effective MID-month
    # counts from the following month (the 1st-of-month rule, spec §6), so March still
    # reads the old profile and April is the first month of the raise. The raise doubles
    # GROSS (10,000 a check), so the 10% line doubles to 1,000 — but the $100 HSA is a
    # flat per-check dollar amount and does not, hence 2,200.00 rather than twice 1,200.
    assert by_month == {
        date(2025, 12, 1): D("0.00"),
        date(2026, 1, 1): D("1200.00"),
        date(2026, 2, 1): D("1200.00"),
        date(2026, 3, 1): D("1200.00"),
        date(2026, 4, 1): D("2200.00"),
    }


def test_payroll_by_month_sums_people_and_skips_an_unusable_cadence():
    # 2,000 gross a check * 10% = 200 -> 400.00 a month.
    partner = _profile(person_id=2, annual_salary=D("48000.00"), hsa_per_check=D("0"))
    broken = _profile(person_id=3, pay_periods_per_year=0)
    # A stored 0 cadence is a DivisionByZero waiting to happen; a GET degrades, never 500s.
    assert payroll_by_month([_profile(), partner, broken], [date(2026, 1, 1)]) == {
        date(2026, 1, 1): D("1600.00")
    }


def _census_profile() -> PaycheckProfile:
    """The production profile the rounding rule is pinned on: 204,044.40 over 24 periods
    is 8,501.85 gross a check; 13% traditional + 3% after-tax + 9% ESPP + $100 HSA is
    2,225.4625 a check — payroll_monthly of EXACTLY 4,450.925 a month, an exact half."""
    return _profile(
        annual_salary=D("204044.40"),
        trad_401k_pct=D("0.13"),
        after_tax_401k_pct=D("0.03"),
        espp_pct=D("0.09"),
        hsa_per_check=D("100.00"),
    )


def test_the_emitted_month_rounds_half_up_and_a_period_sums_those_months():
    assert payroll_monthly(_census_profile()) == D("4450.925")
    months = [date(2026, m, 1) for m in range(1, 8)]  # Jan-Jul, the census window
    by_month = payroll_by_month([_census_profile()], months)
    # HALF_UP on an exact half: the emitted month is 4,450.93, never 4,450.92.
    assert set(by_month.values()) == {D("4450.93")}

    # Jan-Jul: 44,611.60 of take-home against 45,608.58 of living spend (production's own
    # figures), spread so both sums are exact.
    net_pay = dict.fromkeys(months[:6], D("6373.09")) | {months[6]: D("6373.06")}
    living = dict.fromkeys(months[:6], D("6515.51")) | {months[6]: D("6515.52")}
    rows = compose_months(months, {m: {LIVING: living[m]} for m in months}, net_pay, by_month)
    period = rollup(rows)
    assert period.months_matched == 7
    assert (period.net_pay, period.living_spend) == (D("44611.60"), D("45608.58"))
    assert period.cash_savings == D("-996.98")
    # 7 x 4,450.93 — the SUM of the emitted months, never 7 x 4,450.925 re-rounded.
    assert period.payroll_savings == D("31156.51")
    assert sum((row.payroll_savings for row in rows), D("0.00")) == period.payroll_savings
    assert period.total_savings == D("30159.53")
    assert period.total_rate.quantize(D("0.001")) == D("0.398")  # the 39.8% headline


@pytest.mark.parametrize(
    ("by_kind", "net_pay", "expected"),
    [
        (
            {LIVING: D("3000.00"), TAX: D("500.00"), TRANSFER: D("1000.00")},
            D("8000.00"),
            # cash = 8000 - 3000 - 500; total = cash + 1200; 4500/8000; 5700/9200
            (
                "3000.00",
                "500.00",
                "1000.00",
                "1200.00",
                "4500.00",
                "5700.00",
                "0.562500",
                "0.619565",
            ),
        ),
        (
            # No net pay: no rate, no savings, and NO payroll either — a month nobody
            # entered pay for has no deductions on record (spec §2).
            {LIVING: D("3000.00"), TAX: D("500.00"), TRANSFER: D("1000.00")},
            None,
            ("3000.00", "500.00", "1000.00", "0.00", None, None, None, None),
        ),
        (
            # net_pay = 0: savings computed, both rates None (the division guard).
            {LIVING: D("3000.00"), TAX: D("500.00"), TRANSFER: D("1000.00")},
            D("0.00"),
            ("3000.00", "500.00", "1000.00", "1200.00", "-3500.00", "-2300.00", None, None),
        ),
        (
            # A transfer is NOT spending: it never touches cash savings.
            {TRANSFER: D("4000.00")},
            D("8000.00"),
            ("0.00", "0.00", "4000.00", "1200.00", "8000.00", "9200.00", "1.000000", "1.000000"),
        ),
    ],
)
def test_month_savings_reads_the_kinds(by_kind, net_pay, expected):
    row = month_savings(date(2026, 4, 1), by_kind, net_pay, D("1200.00"))
    actual = (
        row.living_spend,
        row.tax_paid,
        row.transfers,
        row.payroll_savings,
        row.cash_savings,
        row.total_savings,
        row.cash_rate,
        row.total_rate,
    )
    assert actual == tuple(None if e is None else D(e) for e in expected)
    assert row.has_spending_rows is True
    assert row.matched is (net_pay is not None)


def test_month_savings_without_rows_is_not_a_matched_month():
    row = month_savings(date(2026, 4, 1), None, D("8000.00"), D("1200.00"))
    assert (row.living_spend, row.tax_paid, row.transfers) == (D("0.00"), D("0.00"), D("0.00"))
    assert row.cash_savings == D("8000.00")
    # Rows are what make a month averageable: net pay alone has no spend to average.
    assert row.has_spending_rows is False and row.matched is False


def test_compose_and_rollup_count_matched_months_only():
    months = [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)]
    rows = compose_months(
        months,
        {
            date(2026, 1, 1): {LIVING: D("3000.00"), TAX: D("500.00")},
            date(2026, 2, 1): {LIVING: D("9999.00")},  # rows but no net pay
        },
        {date(2026, 1, 1): D("8000.00"), date(2026, 3, 1): D("7000.00")},  # Mar: pay, no rows
        {m: D("1200.00") for m in months},
    )
    assert [r.matched for r in rows] == [True, False, False]
    period = rollup(rows)
    assert period.months_matched == 1
    assert (period.living_spend, period.tax_paid, period.transfers) == (
        D("3000.00"),
        D("500.00"),
        D("0.00"),
    )
    assert period.net_pay == D("8000.00")  # the matched denominator, not every pay month
    assert (period.cash_savings, period.payroll_savings, period.total_savings) == (
        D("4500.00"),
        D("1200.00"),
        D("5700.00"),
    )
    assert (period.cash_rate, period.total_rate) == (D("0.562500"), D("0.619565"))


def test_rollup_of_nothing_matched_is_zeros_and_nulls():
    period = rollup(compose_months([date(2026, 2, 1)], {}, {}, {}))
    assert period.months_matched == 0
    assert period.living_spend == D("0.00") and period.payroll_savings == D("0.00")
    assert (period.cash_savings, period.total_savings) == (None, None)
    assert (period.cash_rate, period.total_rate) == (None, None)


def test_matched_months_takes_the_last_n_ascending():
    months = [date(2026, m, 1) for m in range(1, 6)]
    rows = compose_months(
        months,
        {m: {LIVING: D("100.00")} for m in months},
        {m: D("1000.00") for m in months if m != date(2026, 3, 1)},  # March: no pay
        {},
    )
    window = matched_months(rows, 3)
    assert [r.month for r in window] == [date(2026, 2, 1), date(2026, 4, 1), date(2026, 5, 1)]
    assert matched_months(rows, 99) == [r for r in rows if r.matched]


async def _seed_kinds(db):
    """Three categories, one per kind, over one month with net pay."""
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=1, kind="living")
    taxes = SpendingCategory(name="Taxes", slug="taxes", sort_order=2, kind="tax")
    invest = SpendingCategory(name="Investments", slug="investments", sort_order=3, kind="transfer")
    db.add_all([rent, taxes, invest])
    await db.flush()
    month = date(2026, 4, 1)
    db.add_all(
        [
            MonthlySpending(month=month, category_id=rent.id, amount=D("3000.00")),
            MonthlySpending(month=month, category_id=taxes.id, amount=D("500.00")),
            MonthlySpending(month=month, category_id=invest.id, amount=D("1000.00")),
            MonthlyCashflow(month=month, net_pay=D("8000.00")),
        ]
    )
    await db.commit()
    return rent


async def test_load_month_savings_joins_kinds_cashflow_and_profiles(db):
    await _seed_kinds(db)
    rows = await load_month_savings(db)
    assert len(rows) == 1
    row = rows[0]
    assert (row.living_spend, row.tax_paid, row.transfers) == (
        D("3000.00"),
        D("500.00"),
        D("1000.00"),
    )
    assert row.payroll_savings == D("0.00")  # no profiles on file: zero, not a guess
    assert (row.cash_savings, row.cash_rate) == (D("4500.00"), D("0.562500"))


async def test_flipping_a_kind_moves_exactly_the_expected_figures(db):
    rent = await _seed_kinds(db)
    before = (await load_month_savings(db))[0]

    rent.kind = "tax"
    await db.commit()
    as_tax = (await load_month_savings(db))[0]
    # living -> tax moves the spend line but NOT cash savings: both are subtracted from
    # net pay. That is what makes the projection's annual_spend move while the savings
    # headline stays put.
    assert as_tax.living_spend == D("0.00")
    assert as_tax.tax_paid == D("3500.00")
    assert as_tax.cash_savings == before.cash_savings == D("4500.00")

    rent.kind = "transfer"
    await db.commit()
    as_transfer = (await load_month_savings(db))[0]
    # living -> transfer takes it out of spending altogether: cash savings rise by 3,000.
    assert as_transfer.transfers == D("4000.00")
    assert as_transfer.cash_savings == D("7500.00")
    assert as_transfer.cash_rate == D("0.937500")
