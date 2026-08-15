from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import MonthlyCashflow, MonthlySpending, SpendingCategory
from app.schemas.spending import (
    AmountEntry,
    CategoryCreate,
    CategoryOut,
    CategorySeries,
    CategoryUpdate,
    MatrixOut,
    SpendingMonthOut,
    SpendingMonthUpsert,
    SpendingUpsertResult,
    YearCategoryTotal,
    YearlyOut,
    YearRollup,
)
from app.services.money import quantize_money, quantize_pct, require_first_of_month
from app.services.net_worth_calc import get_swr_pct, investable_base

router = APIRouter(prefix="/spending", tags=["spending"], dependencies=[Depends(get_current_user)])


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)) -> list[SpendingCategory]:
    result = await db.execute(
        select(SpendingCategory).order_by(SpendingCategory.sort_order, SpendingCategory.id)
    )
    return list(result.scalars().all())


@router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(
    body: CategoryCreate, db: AsyncSession = Depends(get_db)
) -> SpendingCategory:
    slug = slugify(body.name)
    # Same guard as accounts, at this table's String(80): unicode lowercasing can
    # expand, so the slug length is checked here — 422, never a DBAPIError 500.
    if not slug or len(slug) > 80:
        raise HTTPException(
            status_code=422,
            detail="name must contain an ASCII letter or digit and slugify to "
            "at most 80 characters",
        )
    existing = (
        (
            await db.execute(
                select(SpendingCategory).where(
                    (SpendingCategory.slug == slug) | (SpendingCategory.name == body.name)
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"category {slug!r} already exists")
    category = SpendingCategory(name=body.name, slug=slug, sort_order=body.sort_order)
    db.add(category)
    await db.commit()
    return category


async def _get_category(db: AsyncSession, category_id: int) -> SpendingCategory:
    category = await db.get(SpendingCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="category not found")
    return category


@router.patch("/categories/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: int, body: CategoryUpdate, db: AsyncSession = Depends(get_db)
) -> SpendingCategory:
    category = await _get_category(db, category_id)
    # Same explicit-null guard as accounts: all patchable columns are NOT NULL.
    updates = {
        field: value
        for field, value in body.model_dump(exclude_unset=True).items()
        if value is not None
    }
    new_name = updates.get("name")
    if new_name is not None and not slugify(new_name):
        # Same rule as create: PATCH must not produce a blank/whitespace display name.
        raise HTTPException(
            status_code=422,
            detail="name must contain at least one ASCII letter or digit",
        )
    if new_name is not None and new_name != category.name:
        clash = (
            (
                await db.execute(
                    select(SpendingCategory).where(
                        SpendingCategory.name == new_name,
                        SpendingCategory.id != category_id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if clash is not None:
            raise HTTPException(status_code=409, detail="category name already in use")
    for field, value in updates.items():
        setattr(category, field, value)
    await db.commit()
    return category


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(category_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    category = await _get_category(db, category_id)
    row_count = (
        await db.execute(
            select(func.count())
            .select_from(MonthlySpending)
            .where(MonthlySpending.category_id == category_id)
        )
    ).scalar_one()
    if row_count:
        raise HTTPException(
            status_code=409,
            detail=f"category has {row_count} monthly rows — deactivate it instead",
        )
    await db.delete(category)
    await db.commit()
    return Response(status_code=204)


def _savings_rate(net_pay: Decimal | None, total: Decimal) -> Decimal | None:
    if net_pay is None or net_pay == 0:
        return None
    return quantize_pct((net_pay - total) / net_pay)


@router.get("/matrix", response_model=MatrixOut)
async def matrix(
    start: date | None = None,
    end: date | None = None,
    db: AsyncSession = Depends(get_db),
) -> MatrixOut:
    if start is not None:
        require_first_of_month(start)
    if end is not None:
        require_first_of_month(end)
    categories = list(
        (
            await db.execute(
                select(SpendingCategory).order_by(SpendingCategory.sort_order, SpendingCategory.id)
            )
        )
        .scalars()
        .all()
    )
    spend_query = select(MonthlySpending)
    cashflow_query = select(MonthlyCashflow)
    if start is not None:
        spend_query = spend_query.where(MonthlySpending.month >= start)
        cashflow_query = cashflow_query.where(MonthlyCashflow.month >= start)
    if end is not None:
        spend_query = spend_query.where(MonthlySpending.month <= end)
        cashflow_query = cashflow_query.where(MonthlyCashflow.month <= end)
    spend_rows = list((await db.execute(spend_query)).scalars().all())
    cashflow = {row.month: row.net_pay for row in (await db.execute(cashflow_query)).scalars()}
    months = sorted({row.month for row in spend_rows} | set(cashflow))
    month_index = {month: i for i, month in enumerate(months)}
    cells: dict[tuple[int, int], Decimal] = {
        (row.category_id, month_index[row.month]): row.amount for row in spend_rows
    }
    totals = [
        sum(
            (cells.get((c.id, i), Decimal("0.00")) for c in categories),
            Decimal("0.00"),
        )
        for i in range(len(months))
    ]
    net_pay = [cashflow.get(month) for month in months]
    savings = [_savings_rate(net_pay[i], totals[i]) for i in range(len(months))]
    swr = await get_swr_pct(db)
    four_pct: list[Decimal | None] = []
    for month in months:
        base = await investable_base(db, month)
        four_pct.append(None if base is None else quantize_money(base * swr / 12, "four_pct_rule"))
    return MatrixOut(
        months=months,
        categories=[CategoryOut.model_validate(c) for c in categories],
        series=[
            CategorySeries(
                category_id=c.id,
                values=[cells.get((c.id, i)) for i in range(len(months))],
            )
            for c in categories
        ],
        totals=totals,
        net_pay=net_pay,
        savings_rate=savings,
        four_pct_rule=four_pct,
    )


@router.get("/yearly", response_model=YearlyOut)
async def yearly(db: AsyncSession = Depends(get_db)) -> YearlyOut:
    categories = list(
        (
            await db.execute(
                select(SpendingCategory).order_by(SpendingCategory.sort_order, SpendingCategory.id)
            )
        )
        .scalars()
        .all()
    )
    spend_rows = list((await db.execute(select(MonthlySpending))).scalars().all())
    cashflow_rows = list((await db.execute(select(MonthlyCashflow))).scalars().all())
    years = sorted(
        {row.month.year for row in spend_rows} | {row.month.year for row in cashflow_rows}
    )
    rollups = []
    for year in years:
        by_category = {c.id: Decimal("0.00") for c in categories}
        total = Decimal("0.00")
        for row in spend_rows:
            if row.month.year == year:
                by_category[row.category_id] += row.amount
                total += row.amount
        pay_rows = [r.net_pay for r in cashflow_rows if r.month.year == year]
        net_pay_total = sum(pay_rows, Decimal("0.00")) if pay_rows else None
        rollups.append(
            YearRollup(
                year=year,
                by_category=[
                    YearCategoryTotal(category_id=c.id, total=by_category[c.id]) for c in categories
                ],
                total=total,
                net_pay_total=net_pay_total,
                savings_rate=_savings_rate(net_pay_total, total),
            )
        )
    return YearlyOut(years=rollups)


@router.get("/months/{month}", response_model=SpendingMonthOut)
async def get_month(month: date, db: AsyncSession = Depends(get_db)) -> SpendingMonthOut:
    require_first_of_month(month)
    rows = list(
        (
            await db.execute(
                select(MonthlySpending)
                .where(MonthlySpending.month == month)
                .order_by(MonthlySpending.category_id)
            )
        )
        .scalars()
        .all()
    )
    cashflow = await db.get(MonthlyCashflow, month)
    return SpendingMonthOut(
        month=month,
        exists=bool(rows) or cashflow is not None,
        net_pay=None if cashflow is None else cashflow.net_pay,
        amounts=[AmountEntry(category_id=r.category_id, amount=r.amount) for r in rows],
    )


@router.put("/months/{month}", response_model=SpendingUpsertResult)
async def put_month(
    month: date, body: SpendingMonthUpsert, db: AsyncSession = Depends(get_db)
) -> SpendingUpsertResult:
    require_first_of_month(month)
    ids = [entry.category_id for entry in body.amounts]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="duplicate category_id in amounts")
    quantized: dict[int, Decimal] = {
        entry.category_id: quantize_money(entry.amount, f"amount[category_id={entry.category_id}]")
        for entry in body.amounts
    }
    net_pay_provided = "net_pay" in body.model_fields_set and body.net_pay is not None
    net_pay_value = quantize_money(body.net_pay, "net_pay") if net_pay_provided else None
    if net_pay_value is not None and net_pay_value < 0:
        # Take-home pay can't be negative; a typo'd minus sign would flip the
        # savings-rate denominator into flattering nonsense (Task 7 review).
        raise HTTPException(status_code=422, detail="net_pay must be non-negative")
    if ids:
        known = set(
            (
                await db.execute(select(SpendingCategory.id).where(SpendingCategory.id.in_(ids)))
            ).scalars()
        )
        missing = sorted(set(ids) - known)
        if missing:
            raise HTTPException(status_code=422, detail=f"unknown category_id(s): {missing}")

    existing = {
        row.category_id: row
        for row in (
            await db.execute(select(MonthlySpending).where(MonthlySpending.month == month))
        ).scalars()
    }
    created = updated = unchanged = 0
    for category_id, value in quantized.items():
        row = existing.get(category_id)
        if row is None:
            db.add(MonthlySpending(month=month, category_id=category_id, amount=value))
            created += 1
        elif row.amount != value:
            row.amount = value
            updated += 1
        else:
            unchanged += 1
    if net_pay_provided:
        cashflow = await db.get(MonthlyCashflow, month)
        if cashflow is None:
            db.add(MonthlyCashflow(month=month, net_pay=net_pay_value))
        else:
            cashflow.net_pay = net_pay_value
    await db.commit()
    return SpendingUpsertResult(
        month=month,
        created=created,
        updated=updated,
        unchanged=unchanged,
        net_pay_set=net_pay_provided,
    )
