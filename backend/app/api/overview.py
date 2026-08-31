"""Overview API: cross-domain, server-composed payloads for the dashboard's cards.

Reads only. `GET /overview/money-flow` (2026-08-25 spec §5) loads one year's tax inputs +
brackets exactly the way the taxes router does — its `_engine_feed`, IMPORTED, one loader
per concept (app_settings.py's cross-router-borrow precedent) —
sums the calendar year's spending/cashflow, and hands everything to the pure
services.money_flow.compose_money_flow. GETs never reject stored data: an unknown or
empty year answers 200 with renderable=False and a reason sentence, never a 404.
"""

from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.taxes import YEAR_MAX, YEAR_MIN, EngineFeed, _engine_feed, _money, _return_people
from app.database import get_db
from app.models import MonthlyCashflow, MonthlySpending, Person, SpendingCategory, TaxInput
from app.schemas.overview import (
    MoneyFlowCategoryOut,
    MoneyFlowOut,
    MoneyFlowPersonSalaryOut,
    MoneyFlowSourcesOut,
    MoneyFlowTaxesOut,
)
from app.services.money_flow import SALARY_KEYS, MoneyFlow, compose_money_flow
from app.services.people import load_people
from app.services.scheduler import product_today

router = APIRouter(prefix="/overview", tags=["overview"], dependencies=[Depends(get_current_user)])

# The taxes routes' century guard, on a QUERY param this time: tax_years.year is int4 and
# the spending window below builds date(year, 1, 1) — either would 500 on a garbage year.
YearQuery = Annotated[int | None, Query(ge=YEAR_MIN, le=YEAR_MAX)]

ZERO = Decimal("0")


def _salary_by_person(feed: EngineFeed, people: list[Person]) -> list[tuple[str, Decimal]] | None:
    """Each earner's salary-source sum, primary first — or None when there is no split.

    The people are the ones `_engine_feed` put on THIS return (`_return_people`), so a
    single or MFS year has one column and never splits. A NULL `person_id` is the
    pre-household spelling of "the primary" and folds onto the first column exactly as
    `_owner_column` does for the engine's own inputs, which is what makes the two sums
    reconcile to the cent — the service refuses a split that does not.

    Only POSITIVE sums are entries: a partner with no W-2 rows would otherwise contribute
    a zero node the chart drops anyway, leaving a lone `Salary — Me` where today's plain
    node belongs.
    """
    columns = _return_people(people, feed.filing_status)
    if len(columns) < 2:
        return None
    ids = [person.id for person in columns]
    sums: dict[int, Decimal] = {}
    for row in feed.rows:
        if row.key not in SALARY_KEYS:
            continue
        owner = ids[0] if row.person_id is None else row.person_id
        if owner not in ids:
            continue  # a person this return does not cover — off it, like their inputs
        sums[owner] = sums.get(owner, ZERO) + row.value
    pairs = [(person.name, sums[person.id]) for person in columns if sums.get(person.id, ZERO) > 0]
    return pairs if len(pairs) > 1 else None


def _money_flow_out(flow: MoneyFlow) -> MoneyFlowOut:
    """Quantize the service's full-precision figures to 2dp at the schema boundary.

    `_money` (borrowed from the taxes router) is the plain-quantize + `+ ZERO`
    serializer for ENGINE-DERIVED figures — they are unbounded, so money.py's bounded
    quantizers would 422 a GET on data the API itself accepted."""
    return MoneyFlowOut(
        year=flow.year,
        available_years=flow.available_years,
        renderable=flow.renderable,
        reason=flow.reason,
        warnings=flow.warnings,
        sources=MoneyFlowSourcesOut(
            salary_and_bonus=_money(flow.sources.salary_and_bonus),
            rsu_vests=_money(flow.sources.rsu_vests),
            espp=_money(flow.sources.espp),
            investment_income=_money(flow.sources.investment_income),
            other_income=_money(flow.sources.other_income),
            salary_people=[
                MoneyFlowPersonSalaryOut(name=entry.name, amount=_money(entry.amount))
                for entry in flow.sources.salary_people
            ],
        ),
        gross_income=_money(flow.gross_income),
        taxes=MoneyFlowTaxesOut(
            total=_money(flow.taxes.total),
            federal=_money(flow.taxes.federal),
            state=_money(flow.taxes.state),
            medicare=_money(flow.taxes.medicare),
            social_security=_money(flow.taxes.social_security),
            disability=_money(flow.taxes.disability),
            capital_gains=_money(flow.taxes.capital_gains),
            niit=_money(flow.taxes.niit),
        ),
        pre_tax_savings=_money(flow.pre_tax_savings),
        take_home_cash=_money(flow.take_home_cash),
        retained_equity=_money(flow.retained_equity),
        categories=[
            MoneyFlowCategoryOut(name=entry.name, amount=_money(entry.amount))
            for entry in flow.categories
        ],
        other_spend=None if flow.other_spend is None else _money(flow.other_spend),
        total_spend=_money(flow.total_spend),
        saved=_money(flow.saved),
    )


@router.get("/money-flow", response_model=MoneyFlowOut)
async def money_flow(year: YearQuery = None, db: AsyncSession = Depends(get_db)) -> MoneyFlowOut:
    if year is None:
        # The product clock, not date.today(): the prod container runs UTC, where a PT
        # evening is already tomorrow — and on Dec 31 that would be next YEAR.
        year = product_today().year

    # The roster is loaded HERE and handed down, so the feed's own columns and the salary
    # split below are decided by one read of `people` rather than two that could straddle
    # a write.
    people = await load_people(db)
    feed = await _engine_feed(db, year, people)

    # Calendar-year window as [Jan 1, next Jan 1): months are first-of-month dates, so
    # the half-open bound can never leak a neighbouring December in.
    start, end = date(year, 1, 1), date(year + 1, 1, 1)
    category_rows = (
        await db.execute(
            select(SpendingCategory.name, func.sum(MonthlySpending.amount))
            .join(SpendingCategory, SpendingCategory.id == MonthlySpending.category_id)
            .where(MonthlySpending.month >= start, MonthlySpending.month < end)
            .group_by(SpendingCategory.name)
        )
    ).all()
    category_sums = {name: Decimal(total) for name, total in category_rows}
    spending_months = (
        await db.execute(
            select(func.count(func.distinct(MonthlySpending.month))).where(
                MonthlySpending.month >= start, MonthlySpending.month < end
            )
        )
    ).scalar_one()
    # monthly_cashflow.month is the PK, so one row per month: len() IS the coverage.
    pay_rows = list(
        (
            await db.execute(
                select(MonthlyCashflow.net_pay).where(
                    MonthlyCashflow.month >= start, MonthlyCashflow.month < end
                )
            )
        ).scalars()
    )
    net_pay_sum = sum(pay_rows, Decimal("0.00"))
    # "Years having any tax inputs" (spec §5) — the same membership rule the taxes trend
    # feed applies (a bare tax_years row or a brackets-only year is not a data year).
    available_years = sorted((await db.execute(select(TaxInput.year).distinct())).scalars().all())

    flow = compose_money_flow(
        year=year,
        inputs=feed.inputs,
        brackets=feed.tables,
        category_sums=category_sums,
        net_pay_sum=net_pay_sum,
        net_pay_months=len(pay_rows),
        spending_months=spending_months,
        available_years=available_years,
        filing_status=feed.filing_status,
        earners=feed.earners,
        brackets_missing_for_status=feed.brackets_missing_for_status,
        salary_by_person=_salary_by_person(feed, people),
    )
    return _money_flow_out(flow)
