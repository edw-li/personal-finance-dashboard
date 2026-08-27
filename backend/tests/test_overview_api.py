"""Overview money-flow endpoint (2026-08-25 spec §5): loading, windows, quantization.

Node math is pinned in test_money_flow.py; here the year's inputs/brackets go through the
REAL taxes PUTs and the spending tables, and the payload is cross-checked against the
taxes summary endpoint — never against hand-derived engine numbers (state AGI now folds
capital gains in; these fixtures are CG-free anyway, so the flat-bracket figures are
exact cents and the conservation identities survive 2dp quantization verbatim).
"""

from datetime import date
from decimal import Decimal

import pytest

from app.models import MonthlyCashflow, MonthlySpending, SpendingCategory
from app.seed import seed_tax_definitions
from app.services.scheduler import product_today

MONEY_FLOW = "/api/v1/overview/money-flow"
YEARS = "/api/v1/taxes/years"


@pytest.fixture
async def definitions(db):
    """tax_input_definitions rows — tax_inputs FK to them, so they precede every PUT."""
    await seed_tax_definitions(db)
    await db.commit()


INPUT_VALUES = {
    "latest_w2_income": "200000",
    "w2_bonuses": "15000",
    "w2_salary_checkpoint": "5000",
    "w2_stock_rsus_sold": "80000",
    "w2_espp_sale_component": "4000",
    "other_w2_income": "104000",
    "stcg_standard": "1200",
    "stcg_total": "1200",
    "unqualified_dividends": "800",
    "interest_total": "500",
    "other_income_1099": "1000",
    "trad_401k_contributions": "23000",
    "hsa_contributions": "4000",
    "hsa_contributions_employer": "300",
    "standard_deduction": "15000",
}

BRACKET_TABLES = {
    "federal": [{"rate": "0.10", "threshold": "0"}],
    "state": [{"rate": "0.05", "threshold": "0"}],
    "medicare": [{"rate": "0.0145", "threshold": "0"}],
    "social_security": [{"rate": "0.062", "threshold": "0"}],
    "disability": [{"rate": "0.011", "threshold": "0"}],
    "capital_gains": [{"rate": "0.15", "threshold": "0"}],
}


async def seed_tax_year(auth_client, year: int) -> None:
    resp = await auth_client.put(f"{YEARS}/{year}/inputs", json={"values": INPUT_VALUES})
    assert resp.status_code == 200, resp.text
    resp = await auth_client.put(f"{YEARS}/{year}/brackets", json={"jurisdictions": BRACKET_TABLES})
    assert resp.status_code == 200, resp.text


async def seed_spending_year(db, year: int) -> None:
    """8 positive categories + 1 net-refund, 2 spending months and 7 net-pay months
    inside `year`, plus December-of-the-PRIOR-year rows that a sloppy calendar window
    would let in."""
    amounts = {
        "Rent": "24000.00",
        "Food": "6000.00",
        "Travel": "4200.00",
        "Utilities": "3000.00",
        "Insurance": "2400.00",
        "Fun": "1800.00",
        "Fitness": "1200.00",
        "Gifts": "900.00",
        "Refunds": "-25.00",
    }
    for i, (name, amount) in enumerate(amounts.items(), start=1):
        cat = SpendingCategory(name=name, slug=name.lower(), sort_order=i)
        db.add(cat)
        await db.flush()
        db.add(MonthlySpending(month=date(year, 1, 1), category_id=cat.id, amount=Decimal(amount)))
        if name == "Rent":
            db.add(
                MonthlySpending(month=date(year, 2, 1), category_id=cat.id, amount=Decimal("0.00"))
            )
            db.add(
                MonthlySpending(
                    month=date(year - 1, 12, 1), category_id=cat.id, amount=Decimal("999.00")
                )
            )
    for month in range(1, 8):  # 7/12 months of net pay
        db.add(MonthlyCashflow(month=date(year, month, 1), net_pay=Decimal("10000.00")))
    db.add(MonthlyCashflow(month=date(year - 1, 12, 1), net_pay=Decimal("55555.00")))
    await db.commit()


async def test_money_flow_requires_auth(client):
    assert (await client.get(MONEY_FLOW)).status_code == 401


async def test_money_flow_composes_the_year_and_cross_checks_the_engine(
    auth_client, db, definitions
):
    await seed_tax_year(auth_client, 2026)
    await seed_spending_year(db, 2026)
    resp = await auth_client.get(f"{MONEY_FLOW}?year=2026")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["year"] == 2026
    assert body["available_years"] == [2026]
    assert body["renderable"] is True
    assert body["reason"] is None
    # Plain input sums as 2dp Decimal strings on the wire.
    assert body["sources"]["salary_and_bonus"] == "220000.00"
    assert body["sources"]["rsu_vests"] == "80000.00"
    assert body["sources"]["espp"] == "4000.00"
    assert body["sources"]["investment_income"] == "2500.00"
    assert body["sources"]["other_income"] == "1000.00"
    assert body["pre_tax_savings"] == "27300.00"
    # Engine figures cross-checked against the taxes summary endpoint — same stored
    # rows, same loaders, same cents.
    summary = (await auth_client.get(f"{YEARS}/2026/summary")).json()
    assert body["gross_income"] == summary["totals"]["gross_income"]
    assert body["taxes"]["total"] == summary["totals"]["total_tax"]
    assert body["taxes"]["federal"] == summary["federal"]["tax"]
    assert body["taxes"]["state"] == summary["state"]["tax"]
    assert body["taxes"]["medicare"] == summary["medicare"]["tax"]
    assert body["taxes"]["social_security"] == summary["social_security"]["tax"]
    assert body["taxes"]["disability"] == summary["disability"]["tax"]
    assert body["taxes"]["capital_gains"] == summary["capital_gains"]["tax"]
    # Calendar-year windows: 7 x 10000 net pay INSIDE the year; the prior-December rows
    # (net pay 55555, Rent 999) stay out.
    assert body["take_home_cash"] == "70000.00"
    assert "net pay entered 7/12 months" in body["warnings"]
    assert "spending entered 2/12 months" in body["warnings"]
    # Top-7 fold + Other; Gifts folds, the refund row is excluded.
    assert [c["name"] for c in body["categories"]] == [
        "Rent",
        "Food",
        "Travel",
        "Utilities",
        "Insurance",
        "Fun",
        "Fitness",
    ]
    assert body["categories"][0]["amount"] == "24000.00"
    assert body["other_spend"] == "900.00"
    assert body["total_spend"] == "43500.00"
    assert body["saved"] == "26500.00"
    # Conservation at the WIRE: with flat brackets every term is exact cents, so both
    # identities survive quantization verbatim (in general the wire tolerates the
    # paycheck sankey's documented ±$0.01 reconciliation drift).
    sources_sum = sum(Decimal(v) for v in body["sources"].values())
    assert sources_sum == Decimal(body["gross_income"])
    mid = (
        Decimal(body["taxes"]["total"])
        + Decimal(body["pre_tax_savings"])
        + Decimal(body["take_home_cash"])
        + Decimal(body["retained_equity"])
    )
    assert mid == Decimal(body["gross_income"])


async def test_money_flow_defaults_to_the_current_product_year(auth_client, definitions):
    year = product_today().year
    await seed_tax_year(auth_client, year)
    body = (await auth_client.get(MONEY_FLOW)).json()
    assert body["year"] == year
    assert body["renderable"] is True


async def test_money_flow_unknown_year_is_200_with_a_reason(auth_client, definitions):
    await seed_tax_year(auth_client, 2026)
    resp = await auth_client.get(f"{MONEY_FLOW}?year=2031")
    assert resp.status_code == 200  # GETs never reject: the payload explains instead
    body = resp.json()
    assert body["renderable"] is False
    assert body["reason"] == (
        "No tax inputs are stored for 2031 — enter the year on the Taxes page to draw "
        "its money flow."
    )
    assert "no tax inputs stored for 2031" in body["warnings"]
    assert body["available_years"] == [2026]  # the selector still knows where data lives
    assert body["gross_income"] == "0.00"


async def test_money_flow_on_an_empty_database(auth_client):
    body = (await auth_client.get(MONEY_FLOW)).json()
    assert body["year"] == product_today().year
    assert body["renderable"] is False
    assert body["available_years"] == []


async def test_money_flow_year_bounds(auth_client):
    # The taxes routers' century guard, on the query param: an unstorable year can hold
    # no data, and date(year, 1, 1) below must never see garbage.
    assert (await auth_client.get(f"{MONEY_FLOW}?year=1899")).status_code == 422
    assert (await auth_client.get(f"{MONEY_FLOW}?year=2101")).status_code == 422
    assert (await auth_client.get(f"{MONEY_FLOW}?year=abc")).status_code == 422


async def test_money_flow_available_years_lists_every_inputs_year(auth_client, definitions):
    await seed_tax_year(auth_client, 2024)
    await seed_tax_year(auth_client, 2026)
    # A year with BRACKETS only (no inputs) must not appear — "years having any tax
    # inputs" (spec §5), the same rule the trend feed uses.
    resp = await auth_client.put(
        f"{YEARS}/2025/brackets",
        json={"jurisdictions": {"federal": [{"rate": "0.10", "threshold": "0"}]}},
    )
    assert resp.status_code == 200
    body = (await auth_client.get(f"{MONEY_FLOW}?year=2026")).json()
    assert body["available_years"] == [2024, 2026]


async def test_money_flow_refuses_a_married_year_without_its_tables(auth_client, db):
    """The Overview card inherits the engine's refusal instead of drawing a single
    filer's numbers under a married heading."""
    from app.models import TaxInput, TaxInputDefinition, TaxYear
    from app.seed import seed_tax_definitions

    await seed_tax_definitions(db)
    db.add(TaxYear(year=2026, filing_status="married_joint"))
    await db.flush()
    db.add(TaxInput(year=2026, key="latest_w2_income", value=Decimal("200000.0000")))
    await db.commit()
    assert (await db.get(TaxInputDefinition, "latest_w2_income")) is not None

    body = (await auth_client.get("/api/v1/overview/money-flow", params={"year": 2026})).json()
    assert body["renderable"] is False
    assert "married_joint" in body["reason"]
    assert any("married_joint" in warning for warning in body["warnings"])
