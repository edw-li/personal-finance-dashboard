"""The honest-numbers before/after proof (2026-09-04 spec §7), on a LOCAL copy of the
production census taken read-only on 2026-09-04.

These are the real household's figures, seeded into the disposable test database — never
read from production at test time and never written back to it. The dates are ABSOLUTE on
purpose: this file's job is to reproduce one specific production shape (a zero September, a
missing August, twelve real months behind them), and a relative fixture would drift off the
very shape it exists to pin. Only two figures are clock-coupled — the projection's
`start_month` and `base_month` — and they are RECORDED, never asserted.
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.models import (
    Account,
    AccountBalance,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    SpendingCategory,
    TaxBracket,
    TaxInput,
    TaxYear,
)
from app.seed import seed_tax_definitions

COVERAGE = "/api/v1/coverage"
MATRIX = "/api/v1/spending/matrix"
YEARLY = "/api/v1/spending/yearly"
PROJECTION = "/api/v1/projection"
MONEY_FLOW = "/api/v1/overview/money-flow"

# --- the census (production, 2026-09-04, read-only) --------------------------------------

# Twelve REAL spending months. Aug 2026 is deliberately absent from this dict (production has
# no rows for it); Sep 2026 is seeded separately as 19 zero rows.
SPENDING_TOTALS = {
    date(2025, 8, 1): Decimal("4274.63"),
    date(2025, 9, 1): Decimal("5993.18"),
    date(2025, 10, 1): Decimal("3924.80"),
    date(2025, 11, 1): Decimal("5373.86"),
    date(2025, 12, 1): Decimal("4878.72"),
    date(2026, 1, 1): Decimal("7206.82"),
    date(2026, 2, 1): Decimal("4592.97"),
    date(2026, 3, 1): Decimal("5190.43"),
    date(2026, 4, 1): Decimal("9802.63"),
    date(2026, 5, 1): Decimal("8850.75"),
    date(2026, 6, 1): Decimal("4873.01"),
    date(2026, 7, 1): Decimal("5091.97"),
}
# The one non-living row in the whole book: April's income-tax payment.
APRIL = date(2026, 4, 1)
APRIL_TAX = Decimal("5044.00")
EMPTY_MONTH = date(2026, 9, 1)  # 19 rows of $0.00, no net pay — a balances-only save
MISSING_MONTH = date(2026, 8, 1)  # no rows at all, inside the balances window

NET_PAY = {
    date(2025, 8, 1): Decimal("5427.86"),
    date(2025, 9, 1): Decimal("7806.70"),
    date(2025, 10, 1): Decimal("6284.60"),
    date(2025, 11, 1): Decimal("6132.98"),
    date(2025, 12, 1): Decimal("7264.46"),
    date(2026, 1, 1): Decimal("5251.59"),
    date(2026, 2, 1): Decimal("5476.20"),
    date(2026, 3, 1): Decimal("6765.03"),
    date(2026, 4, 1): Decimal("6609.08"),
    date(2026, 5, 1): Decimal("6609.08"),
    date(2026, 6, 1): Decimal("7291.53"),
    date(2026, 7, 1): Decimal("6609.09"),
}

# 19 categories, because the empty September is 19 rows of $0.00. Exactly one is "Taxes"
# (the migration seeds it `tax` by name, case-insensitive); none is named Investments or
# Financial, so the book carries NO transfer money and `transfer_total` must be 0.00
# everywhere — which is what makes cash_savings == net_pay − total_spend checkable by eye.
LIVING_NAMES = [
    "Housing",
    "Groceries",
    "Dining",
    "Transport",
    "Utilities",
    "Insurance",
    "Health",
    "Childcare",
    "Travel",
    "Shopping",
    "Subscriptions",
    "Gifts",
    "Education",
    "Pets",
    "Home",
    "Personal",
    "Fees",
    "Misc",
]
TAX_NAME = "Taxes"

# The balances window (spec §3: "first snapshot month … latest snapshot month"). Fourteen
# months, so Aug 2026 is INSIDE the window with no rows = missing, and Sep 2026 is inside
# it with zero rows = empty.
WINDOW = (
    [date(2025, 8, 1)]
    + [date(2025, m, 1) for m in range(9, 13)]
    + [date(2026, m, 1) for m in range(1, 10)]
)

SALARY = Decimal("188930.00")
SWR = Decimal("0.04")
SINGLE_BRACKETS = (
    ("federal", [("0.1000", "0.00")]),
    ("state", [("0.0500", "0.00")]),
    ("medicare", [("0.0145", "0.00"), ("0.0235", "250000.00")]),
    ("social_security", [("0.0620", "0.00"), ("0.0000", "168600.00")]),
    ("disability", [("0.0110", "0.00")]),
    ("capital_gains", [("0.1500", "0.00")]),
)


async def seed_census(db) -> dict:
    """Seed the production shape. Returns {'categories': {...}, 'person': id}."""
    # Categories. The living total of a month goes entirely into Housing: the arithmetic
    # under test is per-KIND, never per-category, and one row per month keeps every figure
    # exact to the cent instead of introducing a split-rounding of our own. The other
    # seventeen exist because September's emptiness is 19 rows wide.
    categories = {}
    for order, name in enumerate([TAX_NAME] + LIVING_NAMES, start=1):
        row = SpendingCategory(name=name, slug=name.lower(), sort_order=order)
        db.add(row)
        categories[name] = row
    await db.flush()

    # create_all never runs a migration, so the by-name seeding of spec 1 does not fire on
    # the test database. Set the one non-living kind explicitly; every other row takes the
    # column's 'living' default, exactly as production will after the upgrade.
    categories[TAX_NAME].kind = "tax"
    await db.flush()

    for month, total in SPENDING_TOTALS.items():
        living = total - APRIL_TAX if month == APRIL else total
        db.add(MonthlySpending(month=month, category_id=categories["Housing"].id, amount=living))
    db.add(MonthlySpending(month=APRIL, category_id=categories[TAX_NAME].id, amount=APRIL_TAX))
    # September 2026: the balances-only save that started this whole program.
    for row in categories.values():
        db.add(MonthlySpending(month=EMPTY_MONTH, category_id=row.id, amount=Decimal("0.00")))
    for month, net_pay in NET_PAY.items():
        db.add(MonthlyCashflow(month=month, net_pay=net_pay))

    # Balances: one taxable account across the whole window, flat. The window is what makes
    # Aug 2026 "missing" rather than "not yet"; the balance itself only feeds the
    # projection's starting point, which this file records rather than asserts.
    account = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    db.add(account)
    await db.flush()
    for month in WINDOW:
        snapshot = NetWorthSnapshot(month=month)
        db.add(snapshot)
        await db.flush()
        db.add(
            AccountBalance(
                snapshot_id=snapshot.id,
                account_id=account.id,
                balance=Decimal("500000.00"),
            )
        )

    person = Person(name="Earner", is_primary=True)
    db.add(person)
    await db.flush()
    common = dict(
        annual_salary=SALARY,
        pay_periods_per_year=24,
        trad_401k_pct=Decimal("0.13"),
        roth_401k_pct=Decimal("0"),
        after_tax_401k_pct=Decimal("0.03"),
        withholding_pct=Decimal("0.22"),
        dental_vision_per_check=Decimal("0"),
        hsa_per_check=Decimal("100.00"),
        hsa_coverage="self",
    )
    db.add(
        PaycheckProfile(
            person_id=person.id,
            effective_date=date(2026, 1, 1),
            espp_pct=Decimal("0.11"),
            **common,
        )
    )
    # Effective MID-month: by the 1st-of-month rule (spec 6) it governs Sep 2026 onward,
    # so it must NOT move any 2026 rollup figure - which is exactly what Task 6 asserts.
    db.add(
        PaycheckProfile(
            person_id=person.id,
            effective_date=date(2026, 8, 17),
            espp_pct=Decimal("0.12"),
            **common,
        )
    )

    # A minimal single-filer 2026 so the money-flow card has a gross to reconcile against.
    await seed_tax_definitions(db)
    db.add(TaxYear(year=2026, filing_status="single"))
    await db.flush()
    db.add_all(
        [
            TaxInput(year=2026, key="latest_w2_income", value=SALARY, person_id=person.id),
            TaxInput(
                year=2026,
                key="trad_401k_contributions",
                value=Decimal("24560.90"),
                person_id=person.id,
            ),
        ]
    )
    for name, table in SINGLE_BRACKETS:
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(
                TaxBracket(
                    year=2026,
                    jurisdiction=name,
                    bracket_index=index,
                    rate=Decimal(rate),
                    threshold=Decimal(threshold),
                    filing_status="single",
                )
            )
    await db.commit()
    return {"categories": {n: r.id for n, r in categories.items()}, "person": person.id}


@pytest.fixture
async def census(db):
    return await seed_census(db)


async def test_the_fixture_is_the_census(census, db):
    """The seeder reproduces the production shape EXACTLY — asserted before anything is
    computed from it, so a later figure can never be wrong because the book was."""
    total = (await db.execute(select(func.sum(MonthlySpending.amount)))).scalar_one()
    assert Decimal(total) == Decimal("70053.77")  # the 12 real months, taxes in
    months = (
        (await db.execute(select(MonthlySpending.month).distinct().order_by(MonthlySpending.month)))
        .scalars()
        .all()
    )
    assert list(months) == sorted(SPENDING_TOTALS) + [EMPTY_MONTH]
    assert MISSING_MONTH not in months
    empty_rows = (
        await db.execute(
            select(func.count(), func.sum(MonthlySpending.amount)).where(
                MonthlySpending.month == EMPTY_MONTH
            )
        )
    ).one()
    assert empty_rows == (19, Decimal("0.00"))
    pay = (await db.execute(select(func.sum(MonthlyCashflow.net_pay)))).scalar_one()
    assert Decimal(pay) == Decimal("77528.20")  # 32,916.60 in 2025 + 44,611.60 in 2026
    assert (await db.execute(select(func.count(MonthlyCashflow.month)))).scalar_one() == 12
    snaps = (
        (await db.execute(select(NetWorthSnapshot.month).order_by(NetWorthSnapshot.month)))
        .scalars()
        .all()
    )
    assert list(snaps) == WINDOW
    profiles = (
        (await db.execute(select(PaycheckProfile).order_by(PaycheckProfile.effective_date)))
        .scalars()
        .all()
    )
    assert [p.effective_date for p in profiles] == [date(2026, 1, 1), date(2026, 8, 17)]
    assert [p.espp_pct for p in profiles] == [Decimal("0.11"), Decimal("0.12")]
