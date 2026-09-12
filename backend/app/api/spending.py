from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import CategoryBudget, MonthlyCashflow, MonthlySpending, SpendingCategory
from app.schemas.projection import DerivedWindowOut
from app.schemas.spending import (
    AmountEntry,
    BudgetHistoryEntry,
    BudgetPut,
    BudgetSeedIn,
    BudgetSeedOut,
    BudgetSkip,
    BudgetSuggestion,
    BudgetSuggestionsOut,
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
from app.services import clock
from app.services.budgets import MIN_SEED_MONTHS, load_suggestions, resolve_budgets
from app.services.changelog import ChangeBatch, batch_header, change_batch, row_image
from app.services.metrics import average_evidence, category_comparison
from app.services.money import (
    MONEY_MAX_ABS_12_2,
    quantize_money,
    require_first_of_month,
)
from app.services.month_review import load_review_book
from app.services.month_writes import write_spending
from app.services.net_worth_calc import get_swr_pct, investable_bases
from app.services.savings import (
    LIVING,
    MonthSavings,
    compose_months,
    load_month_savings,
    load_payroll_by_month,
    rollup,
)

router = APIRouter(prefix="/spending", tags=["spending"], dependencies=[Depends(get_current_user)])


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)) -> list[SpendingCategory]:
    result = await db.execute(
        select(SpendingCategory).order_by(SpendingCategory.sort_order, SpendingCategory.id)
    )
    return list(result.scalars().all())


@router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(
    body: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
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
    category = SpendingCategory(
        name=body.name, slug=slug, sort_order=body.sort_order, kind=body.kind
    )
    db.add(category)
    await db.flush()
    batch.record_insert(category)
    batch.label = f"Created category {category.name}"
    await batch.commit()
    return category


async def _get_category(db: AsyncSession, category_id: int) -> SpendingCategory:
    category = await db.get(SpendingCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="category not found")
    return category


@router.patch("/categories/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: int,
    body: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
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
    before = row_image(category)
    for field, value in updates.items():
        setattr(category, field, value)
    batch.record_update(category, before)
    batch.label = f"Updated category {category.name}"
    await batch.commit()
    return category


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
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
    batch.record_delete(category)
    batch.label = f"Deleted category {category.name}"
    await db.delete(category)
    await batch.commit()
    return Response(status_code=204, headers=batch_header(batch.id if batch.rows else None))


# --- category budgets ---


async def _budget_history(db: AsyncSession, category_id: int) -> list[CategoryBudget]:
    return list(
        (
            await db.execute(
                select(CategoryBudget)
                .where(CategoryBudget.category_id == category_id)
                .order_by(CategoryBudget.effective_month)
            )
        )
        .scalars()
        .all()
    )


async def _get_budget_row(
    db: AsyncSession, category_id: int, effective_month: date
) -> CategoryBudget | None:
    return (
        (
            await db.execute(
                select(CategoryBudget).where(
                    CategoryBudget.category_id == category_id,
                    CategoryBudget.effective_month == effective_month,
                )
            )
        )
        .scalars()
        .first()
    )


@router.put("/categories/{category_id}/budget", response_model=list[BudgetHistoryEntry])
async def put_category_budget(
    category_id: int,
    body: BudgetPut,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> list[CategoryBudget]:
    """Upsert one (category, effective_month) budget row — last write wins (single-user
    TOCTOU posture, spec §3). Returns the category's FULL history, ascending by month, so
    the editor renders it without a second fetch."""
    # A named category, not a bare await: the batch label needs the name.
    category = await _get_category(db, category_id)
    require_first_of_month(body.effective_month)
    amount: Decimal | None = None
    if body.amount is not None:
        amount = quantize_money(body.amount, "amount", max_abs=MONEY_MAX_ABS_12_2)
        if amount < 0:
            # Unlike monthly amounts (signed: refunds), a budget is a target — a
            # negative target is nonsense, not data.
            raise HTTPException(status_code=422, detail="amount must be non-negative")
    existing = await _get_budget_row(db, category_id, body.effective_month)
    if existing is None:
        row = CategoryBudget(
            category_id=category_id, effective_month=body.effective_month, amount=amount
        )
        db.add(row)
        await db.flush()
        batch.record_insert(row, month=body.effective_month)
    else:
        before = row_image(existing)
        existing.amount = amount
        batch.record_update(existing, before, month=body.effective_month)
    batch.label = f"Set {category.name} budget from {body.effective_month:%b %Y}"
    await batch.commit()
    return await _budget_history(db, category_id)


@router.delete("/categories/{category_id}/budget/{effective_month}", status_code=204)
async def delete_category_budget(
    category_id: int,
    effective_month: date,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """Remove one HISTORY row (fixing a mis-dated entry) — distinct from the NULL-amount
    "budget ended" marker, which is itself a stored row (spec §3)."""
    category = await _get_category(db, category_id)
    require_first_of_month(effective_month)
    row = await _get_budget_row(db, category_id, effective_month)
    if row is None:
        raise HTTPException(status_code=404, detail="budget row not found")
    batch.record_delete(row, month=effective_month)
    batch.label = f"Removed {category.name} budget row for {effective_month:%b %Y}"
    await db.delete(row)
    await batch.commit()
    return Response(status_code=204, headers=batch_header(batch.id if batch.rows else None))


def _window_out(window: list[date]) -> DerivedWindowOut | None:
    return (
        DerivedWindowOut(from_month=window[0], to_month=window[-1], months=len(window))
        if window
        else None
    )


@router.get("/budgets/suggestions", response_model=BudgetSuggestionsOut)
async def budget_suggestions(db: AsyncSession = Depends(get_db)) -> BudgetSuggestionsOut:
    """The Budget card's figures (spec §2): read-only, no batch. The product clock, never
    the container's UTC day: the window's "current month" must agree with the rest of
    the ritual's clock."""
    window, suggestions = await load_suggestions(db, clock.product_today())
    return BudgetSuggestionsOut(
        window=_window_out(window),
        suggestions=[BudgetSuggestion.model_validate(s) for s in suggestions],
    )


# spec §2 wording; the number is MIN_SEED_MONTHS (3) — pinned by test_budgets_service.py
SEED_NEEDS_HISTORY = (
    "needs at least three complete months of spending before a budget can be suggested"
)


@router.post("/budgets/seed", response_model=BudgetSeedOut)
async def seed_budgets(
    body: BudgetSeedIn,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> BudgetSeedOut:
    """The one-click seed (spec §2): every suggestion with a seed becomes the category's
    budget row at `effective_month` — inserted, or updated in place when a row already sits on
    that month — in ONE change batch, so the Activity card's undo reverts it as a unit. A
    category whose budget already RESOLVES to the seed for that month is skipped as
    `unchanged` rather than given a redundant history step. History before the month is
    never touched: that is what effective-dated rows are for."""
    require_first_of_month(body.effective_month)
    window, suggestions = await load_suggestions(db, clock.product_today())
    if len(window) < MIN_SEED_MONTHS:
        raise HTTPException(status_code=422, detail=SEED_NEEDS_HISTORY)
    budget_rows = list((await db.execute(select(CategoryBudget))).scalars().all())
    resolved = resolve_budgets(budget_rows, [body.effective_month])
    at_month = {r.category_id: r for r in budget_rows if r.effective_month == body.effective_month}
    written: list[AmountEntry] = []
    skipped: list[BudgetSkip] = []
    for s in suggestions:
        if s.seed is None:
            # `suggest` never returns a seedless suggestion without a reason (spec §2), so the
            # `or` only narrows the type for the checker — it is not a live fallback.
            skipped.append(BudgetSkip(category_id=s.category_id, reason=s.skip_reason or "dormant"))
            continue
        if resolved.get(s.category_id, [None])[0] == s.seed:
            skipped.append(BudgetSkip(category_id=s.category_id, reason="unchanged"))
            continue
        existing = at_month.get(s.category_id)
        if existing is None:
            row = CategoryBudget(
                category_id=s.category_id, effective_month=body.effective_month, amount=s.seed
            )
            db.add(row)
            await db.flush()
            batch.record_insert(row, month=body.effective_month)
        else:
            before = row_image(existing)
            existing.amount = s.seed
            batch.record_update(existing, before, month=body.effective_month)
        written.append(AmountEntry(category_id=s.category_id, amount=s.seed))
    batch.label = f"Seeded {len(written)} budgets from averages, from {body.effective_month:%b %Y}"
    batch_id = await batch.commit()
    return BudgetSeedOut(
        effective_month=body.effective_month,
        window=_window_out(window),
        written=written,
        skipped=skipped,
        batch_id=batch_id,
    )


def _kind_split(
    spend_rows: list[MonthlySpending], categories: list[SpendingCategory]
) -> dict[date, dict[str, Decimal]]:
    """Per month, the amounts summed by category KIND — the matrix's and the yearly
    rollup's shared input to services/savings.py (spec §2).

    Built from rows both routes have already loaded, so it costs no query. A row whose
    category vanished mid-request reads as 'living', the honest default (spec §1).
    Presence of a month in the result IS "this month has spending rows", which is what
    `compose_months` reads to tell an empty month from a missing one.
    """
    kind_by_category = {c.id: c.kind for c in categories}
    by_kind: dict[date, dict[str, Decimal]] = {row.month: {} for row in spend_rows}
    for row in spend_rows:
        bucket = by_kind[row.month]
        kind = kind_by_category.get(row.category_id, LIVING)
        bucket[kind] = bucket.get(kind, Decimal("0.00")) + row.amount
    return by_kind


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
    # One savings definition for every page (spec §2): the router does no arithmetic.
    savings_rows = compose_months(
        months,
        _kind_split(spend_rows, categories),
        cashflow,
        await load_payroll_by_month(db, months),
    )
    swr = await get_swr_pct(db)
    # Batched (spec §3 drive-by): two queries for every month instead of two per month.
    bases = await investable_bases(db, months)
    four_pct = [
        None if base is None else quantize_money(base * swr / 12, "four_pct_rule") for base in bases
    ]
    budget_rows = list((await db.execute(select(CategoryBudget))).scalars().all())
    budgets_by_category = resolve_budgets(budget_rows, months)
    # Shared read-only default for unbudgeted categories; pydantic validation copies it.
    no_budgets: list[Decimal | None] = [None] * len(months)
    total_budget: list[Decimal | None] = []
    for i in range(len(months)):
        month_budgets = [
            values[i] for values in budgets_by_category.values() if values[i] is not None
        ]
        total_budget.append(sum(month_budgets, Decimal("0.00")) if month_budgets else None)
    review_book = await load_review_book(db)
    full_history = await load_month_savings(db)
    comparisons = [average_evidence(full_history, review_book, month) for month in months]
    category_averages = {
        c.id: [category_comparison(review_book, c.id, month) for month in months]
        for c in categories
    }
    return MatrixOut(
        months=months,
        categories=[CategoryOut.model_validate(c) for c in categories],
        series=[
            CategorySeries(
                category_id=c.id,
                values=[cells.get((c.id, i)) for i in range(len(months))],
                budgets=budgets_by_category.get(c.id, no_budgets),
                comparison_average=[item[0] for item in category_averages[c.id]],
                comparison_count=[item[1] for item in category_averages[c.id]],
            )
            for c in categories
        ],
        totals=totals,
        net_pay=net_pay,
        savings_rate=[row.cash_rate for row in savings_rows],
        four_pct_rule=four_pct,
        total_budget=total_budget,
        living_total=[row.living_spend for row in savings_rows],
        tax_total=[row.tax_paid for row in savings_rows],
        transfer_total=[row.transfers for row in savings_rows],
        cash_savings=[row.cash_savings for row in savings_rows],
        payroll_savings=[row.payroll_savings for row in savings_rows],
        total_savings=[row.total_savings for row in savings_rows],
        total_savings_rate=[row.total_rate for row in savings_rows],
        cash_outflow=[row.living_spend + row.tax_paid for row in savings_rows],
        comparison_average=[item.value for item in comparisons],
        comparison_count=[len(item.window.included) if item.window else 0 for item in comparisons],
        review_state=[review_book.months[month].state for month in months],
        eligible_spending=[review_book.months[month].eligible_spending for month in months],
        eligible_savings=[review_book.months[month].eligible_savings for month in months],
        default_month=review_book.default_month,
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
    by_kind = _kind_split(spend_rows, categories)
    net_pay_by_month = {row.month: row.net_pay for row in cashflow_rows}
    months = sorted(set(by_kind) | set(net_pay_by_month))
    savings_rows = compose_months(
        months, by_kind, net_pay_by_month, await load_payroll_by_month(db, months)
    )
    rows_by_year: dict[int, list[MonthSavings]] = {}
    for row in savings_rows:
        rows_by_year.setdefault(row.month.year, []).append(row)

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
        period = rollup(rows_by_year.get(year, []))
        rollups.append(
            YearRollup(
                year=year,
                by_category=[
                    YearCategoryTotal(category_id=c.id, total=by_category[c.id]) for c in categories
                ],
                total=total,
                net_pay_total=net_pay_total,
                savings_rate=period.cash_rate,
                months_matched=period.months_matched,
                living_total=period.living_spend,
                tax_total=period.tax_paid,
                transfer_total=period.transfers,
                cash_savings=period.cash_savings,
                payroll_savings=period.payroll_savings,
                total_savings=period.total_savings,
                total_savings_rate=period.total_rate,
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
    budget_rows = list((await db.execute(select(CategoryBudget))).scalars().all())
    resolved = resolve_budgets(budget_rows, [month])
    budgets = [
        AmountEntry(category_id=category_id, amount=values[0])
        for category_id, values in sorted(resolved.items())
        if values[0] is not None
    ]
    return SpendingMonthOut(
        month=month,
        exists=bool(rows) or cashflow is not None,
        net_pay=None if cashflow is None else cashflow.net_pay,
        amounts=[AmountEntry(category_id=r.category_id, amount=r.amount) for r in rows],
        budgets=budgets,
    )


@router.put("/months/{month}", response_model=SpendingUpsertResult)
async def put_month(
    month: date,
    body: SpendingMonthUpsert,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> SpendingUpsertResult:
    result = await write_spending(month, body, db, batch)
    result.batch_id = await batch.commit()
    return result


@router.delete("/months/{month}", status_code=204)
async def delete_month(
    month: date,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """Remove a month's spending wholesale (2026-08-31 spec §B2): every monthly_spending
    row AND the monthly_cashflow row. 404 only when NEITHER exists — a cashflow-only
    month (net pay entered, no categories) still deletes cleanly, and vice versa.

    One exception, and it is the reason `X-Change-Source` is worth reading here: a REPAIR
    (`source='repair'` — the Data-health card's zero-filled fix and the wizard's own empty-
    month button) deletes the category rows ONLY and leaves the take-home standing. The
    repair's whole subject is the phantom $0.00 rows (2026-09-09 audit item 1), and since
    that check now also flags a month whose zeros sit BESIDE a real take-home figure, a
    wholesale delete there would throw away the one figure the user did enter. For the
    empty months the repair used to be offered on there is no cashflow row at all, so this
    changes nothing about them; afterwards such a month reads as "take-home entered,
    spending missing", which is exactly what it is.
    """
    require_first_of_month(month)
    rows_only = batch.source == "repair"
    rows = (
        (await db.execute(select(MonthlySpending).where(MonthlySpending.month == month)))
        .scalars()
        .all()
    )
    cashflow = None if rows_only else await db.get(MonthlyCashflow, month)
    if not rows and cashflow is None:
        raise HTTPException(
            status_code=404, detail="no spending or net pay recorded for this month"
        )
    for row in rows:
        batch.record_delete(row, month=month)
        await db.delete(row)
    if cashflow is not None:
        batch.record_delete(cashflow, month=month)
        await db.delete(cashflow)
    batch.label = (
        f"Deleted {month:%b %Y} zero-filled spending rows"
        if rows_only
        else f"Deleted {month:%b %Y} spending"
    )
    batch_id = await batch.commit()
    return Response(status_code=204, headers=batch_header(batch_id))
