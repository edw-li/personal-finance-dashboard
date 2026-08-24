# Category Budgets with Progress Meters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/spending` from recording into steering — effective-dated per-category budgets (`category_budgets`) whose history never rewrites a past month's verdict, thin HTML/CSS meters against completed months, live "of {budget}" feedback in the wizard at the moment of entry, dashed budget reference lines on the charts, a "vs budget" movers column — plus the sanctioned drive-by: the matrix endpoint's per-month `investable_base` N+1 batched to two queries, byte-identical.

**Architecture:** One new dashboard-only table (`category_budgets`, importer-immune, `ondelete=CASCADE` off `spending_categories`), resolved onto months **by date, never by pointer**: the budget for month M is the amount of the row with the greatest `effective_month <= M` (NULL amount = a dated "budget ends here" marker). Resolution is one query + a Python sorted walk (`_resolve_budgets`), reused by the matrix enrichment (`CategorySeries.budgets`, `MatrixOut.total_budget`) and by the month GET the wizard already calls (the entry month is usually not on the matrix's entered-months axis — see Task 4's note). A `PUT .../budget` upserts one history row and returns the category's FULL history so the editor renders it without a second fetch; a `DELETE .../budget/{month}` removes a mis-dated row. The frontend gets a new plain-HTML `BudgetPanel` (StatTile family, no ECharts) with per-category meters + an inline effective-dated editor, `budgetStepSeries` reference lines wearing the 4%-line's grammar as steps, and a muted wizard subtext that is advice, never validation.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + Postgres 16 (real-DB pytest), React 19 + TypeScript + Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-category-budgets-design.md` — cite it for any ambiguity. One deliberate extension beyond its §3 API list — `SpendingMonthOut.budgets` — is required by its §4.1 promise and documented where it lands (Task 4).

**Overnight protocol:** work happens in the MAIN checkout on branch `category-budgets` (venv + dev Postgres on localhost:5433; the orchestrator creates the branch — this plan starts AFTER an earlier wave merged, so Task 0 verifies a clean `git status`, the correct branch, and both smoke tests before anything else). No file deletions. Never push. Frequent small commits.

**House rules that bind every task:** GETs never reject stored data; server sentences render verbatim; Decimal strings on the wire; plain quantize on read paths; focus-before-reset on save-success paths; `+ ZERO` on wire-bound Decimals; comments explain constraints, not narration.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/alembic/versions/20260824_0900_b7c4e1f2a9d3_category_budgets_table.py` | Migration (create `category_budgets`) |
| `backend/app/models/spending.py` (+`models/__init__.py`) | `CategoryBudget` model |
| `backend/app/schemas/spending.py` | `BudgetPut`, `BudgetHistoryEntry`; `CategorySeries`/`MatrixOut`/`SpendingMonthOut` deltas |
| `backend/app/api/spending.py` | budget PUT/DELETE, `_resolve_budgets`, matrix + month-GET enrichment, four-pct batch swap |
| `backend/app/services/net_worth_calc.py` | `investable_bases` (batched N+1 replacement) |
| `src/types/api.ts`, `src/api/spending.ts` | wire types, `putCategoryBudget`/`deleteCategoryBudget` |
| `src/utils/spending.ts` | `budgetProgress`, `CategoryMover.deltaBudget`, `hasVsBudget` |
| `src/components/spending/budgetChartOptions.ts` | `budgetStepSeries` (dashed MUTED step grammar) |
| `src/components/spending/BudgetPanel.tsx` (+`budgets.css`) | meters, summary line, unbudgeted list, inline editor + history |
| `src/pages/SpendingPage.tsx` | Budget card mount, chart reference lines, movers "vs budget" column |
| `src/pages/MonthlyUpdatePage.tsx` (+`.css`) | wizard step-2 budget subtext + tone |
| Backend tests | `tests/test_models_spending.py`, `test_spending_api.py`, `test_net_worth_calc.py`, `test_importer_apply.py` |
| Frontend tests | `src/utils/spending.test.ts`, `src/components/spending/budgetChartOptions.test.ts`, `BudgetPanel.test.tsx`, `src/pages/MonthlyUpdatePage.test.tsx`, `src/pages/OverviewPage.test.tsx` (fixture only) |
| `docs/superpowers/specs/2026-08-24-category-budgets-design.md` | status line flip (Task 13) |

---

## Phase 0 — Environment & branch verification

### Task 0: Verify the checkout the orchestrator prepared

**Files:** none (environment only)

- [ ] **Step 1: Confirm the branch and a clean tree.**

```bash
git status --porcelain   # expected: EMPTY output
git rev-parse --abbrev-ref HEAD   # expected: category-budgets
```

If the branch is wrong or the tree is dirty, STOP and report — do not "fix" it by switching or stashing; the orchestrator owns branch setup.

- [ ] **Step 2: Backend smoke test** (proves the venv + the 5433 dev Postgres answer).

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_health.py -q`
Expected: PASS. If it errors on connection, bring the container up (`cd backend && docker compose up -d db`) and retry once; if it still fails, read `backend/app/config.py` for the dev DATABASE_URL default before proceeding — do not guess.

- [ ] **Step 3: Frontend smoke.**

Run: `npx vitest run src/utils/months.test.ts` → PASS.

---

## Phase 1 — Backend

### Task 1: `CategoryBudget` model + migration

**Files:**
- Modify: `backend/app/models/spending.py`, `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/20260824_0900_b7c4e1f2a9d3_category_budgets_table.py`
- Test: `backend/tests/test_models_spending.py`

- [ ] **Step 1: Write the failing model tests** (append to `backend/tests/test_models_spending.py`; the file already imports `date`, `Decimal`, `pytest`, `select`, `IntegrityError` — extend its models import line to `from app.models import CategoryBudget, MonthlyCashflow, MonthlySpending, SpendingCategory`):

```python
async def test_category_budget_roundtrip_nullable_amount_and_unique(db):
    cat = SpendingCategory(name="Food", slug="food", sort_order=1)
    db.add(cat)
    await db.flush()
    db.add(
        CategoryBudget(
            category_id=cat.id, effective_month=date(2026, 3, 1), amount=Decimal("400.00")
        )
    )
    # NULL amount is the dated "budget ends here" marker (spec §2) — it must store.
    db.add(CategoryBudget(category_id=cat.id, effective_month=date(2026, 6, 1), amount=None))
    await db.commit()
    rows = (
        (await db.execute(select(CategoryBudget).order_by(CategoryBudget.effective_month)))
        .scalars()
        .all()
    )
    assert [(r.effective_month, r.amount) for r in rows] == [
        (date(2026, 3, 1), Decimal("400.00")),
        (date(2026, 6, 1), None),
    ]
    db.add(
        CategoryBudget(category_id=cat.id, effective_month=date(2026, 3, 1), amount=Decimal("1"))
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_category_budget_first_of_month_check(db):
    cat = SpendingCategory(name="Travel", slug="travel", sort_order=2)
    db.add(cat)
    await db.flush()
    db.add(
        CategoryBudget(category_id=cat.id, effective_month=date(2026, 3, 15), amount=Decimal("1"))
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_category_budget_cascades_with_its_category(db):
    cat = SpendingCategory(name="Pets", slug="pets", sort_order=3)
    db.add(cat)
    await db.flush()
    db.add(
        CategoryBudget(
            category_id=cat.id, effective_month=date(2026, 1, 1), amount=Decimal("50.00")
        )
    )
    await db.commit()
    await db.delete(cat)
    await db.commit()
    assert (await db.execute(select(CategoryBudget))).scalars().all() == []
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_models_spending.py -q` → FAIL (`ImportError: cannot import name 'CategoryBudget'`).

- [ ] **Step 3: Implement the model.** Append to `backend/app/models/spending.py` (after `MonthlyCashflow`):

```python
class CategoryBudget(Base):
    """Effective-dated per-category budget targets (2026-08-24 spec §2).

    Dashboard-only — the workbook has no budgets concept, so the importer never reads or
    writes this table (rsu_grants' posture, pinned in test_importer_apply.py). The budget
    for month M is the amount of the row with the greatest effective_month <= M; no row on
    or before M means unbudgeted, and a NULL amount is the dated "budget ends here" marker,
    so clearing a budget is itself history and last March's verdict stays frozen at what
    the budget WAS in March. ondelete CASCADE: a deleted category takes its budget history
    with it — a budget is advice about a category, meaningless without one.
    """

    __tablename__ = "category_budgets"
    __table_args__ = (
        UniqueConstraint("category_id", "effective_month"),
        CheckConstraint(
            "EXTRACT(DAY FROM effective_month) = 1", name="effective_month_is_first_of_month"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("spending_categories.id", ondelete="CASCADE")
    )
    effective_month: Mapped[date] = mapped_column(Date)  # first of month
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
```

In `backend/app/models/__init__.py`: change the spending import line to
`from app.models.spending import CategoryBudget, MonthlyCashflow, MonthlySpending, SpendingCategory`
and add `"CategoryBudget",` to `__all__` (alphabetical position: after `"AppSetting"`, before `"CompEvent"`).

- [ ] **Step 4: Write the migration** — create `backend/alembic/versions/20260824_0900_b7c4e1f2a9d3_category_budgets_table.py`:

```python
"""category budgets table

Effective-dated per-category budget targets (2026-08-24 spec §2). Dashboard-only and
importer-immune; the budget for month M resolves to the row with the greatest
effective_month <= M, and a NULL amount is the dated "budget ends here" marker.

Revision ID: b7c4e1f2a9d3
Revises: c9e2b7a4d113
Create Date: 2026-08-24 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c4e1f2a9d3"
down_revision: str | Sequence[str] | None = "c9e2b7a4d113"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "category_budgets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("effective_month", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.CheckConstraint(
            "EXTRACT(DAY FROM effective_month) = 1",
            name=op.f("ck_category_budgets_effective_month_is_first_of_month"),
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["spending_categories.id"],
            name=op.f("fk_category_budgets_category_id_spending_categories"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_category_budgets")),
        sa.UniqueConstraint(
            "category_id", "effective_month", name=op.f("uq_category_budgets_category_id")
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("category_budgets")
```

(Constraint names spell out what `database.py`'s NAMING_CONVENTION would derive — `uq_%(table_name)s_%(column_0_name)s` gives `uq_category_budgets_category_id` even for the two-column constraint — so `alembic check` sees no drift.)

- [ ] **Step 5: Run the tests** — `cd backend && .venv/Scripts/python -m pytest tests/test_models_spending.py -q` → PASS (tests build schema from `Base.metadata.create_all`, so the model is what matters; CI's alembic round-trip covers the migration; Task 13 runs it locally too).

- [ ] **Step 6: Alembic sanity** — `cd backend && .venv/Scripts/python -m alembic heads` → exactly `b7c4e1f2a9d3 (head)`.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(budgets): CategoryBudget model + category_budgets migration"`

### Task 2: Budget PUT/DELETE with full-history response

**Files:**
- Modify: `backend/app/schemas/spending.py`, `backend/app/api/spending.py`
- Test: `backend/tests/test_spending_api.py`

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_spending_api.py`; it already has `_seed_spending` and imports `date`/`Decimal`):

```python
async def test_budget_put_upserts_and_returns_full_history(auth_client, db):
    food, _rent = await _seed_spending(db)
    url = f"/api/v1/spending/categories/{food.id}/budget"
    first = await auth_client.put(url, json={"amount": "400.005", "effective_month": "2026-01-01"})
    assert first.status_code == 200, first.text
    assert first.json() == [{"effective_month": "2026-01-01", "amount": "400.01"}]  # HALF_UP

    second = await auth_client.put(url, json={"amount": "450", "effective_month": "2026-03-01"})
    assert second.json() == [
        {"effective_month": "2026-01-01", "amount": "400.01"},
        {"effective_month": "2026-03-01", "amount": "450.00"},
    ]

    # Same (category, month) again = upsert, not a duplicate — last write wins.
    third = await auth_client.put(url, json={"amount": "500", "effective_month": "2026-03-01"})
    assert third.json() == [
        {"effective_month": "2026-01-01", "amount": "400.01"},
        {"effective_month": "2026-03-01", "amount": "500.00"},
    ]

    # NULL amount is the dated end-of-budget marker and stores as a real history row.
    ended = await auth_client.put(url, json={"amount": None, "effective_month": "2026-06-01"})
    assert ended.json()[-1] == {"effective_month": "2026-06-01", "amount": None}


async def test_budget_put_validation(auth_client, db):
    food, _rent = await _seed_spending(db)
    url = f"/api/v1/spending/categories/{food.id}/budget"
    assert (
        await auth_client.put(url, json={"amount": "1", "effective_month": "2026-01-15"})
    ).status_code == 422
    assert (
        await auth_client.put(url, json={"amount": "-1", "effective_month": "2026-01-01"})
    ).status_code == 422
    # Numeric(12,2) holds only 10 integer digits — same pre-write bound as monthly amounts.
    assert (
        await auth_client.put(url, json={"amount": "10000000000", "effective_month": "2026-01-01"})
    ).status_code == 422
    # amount is REQUIRED (nullable, not omittable): {} must 422, not silently mean null.
    assert (
        await auth_client.put(url, json={"effective_month": "2026-01-01"})
    ).status_code == 422
    assert (
        await auth_client.put(
            "/api/v1/spending/categories/999/budget",
            json={"amount": "1", "effective_month": "2026-01-01"},
        )
    ).status_code == 404


async def test_budget_delete_removes_a_history_row(auth_client, db):
    food, _rent = await _seed_spending(db)
    url = f"/api/v1/spending/categories/{food.id}/budget"
    await auth_client.put(url, json={"amount": "400", "effective_month": "2026-01-01"})
    await auth_client.put(url, json={"amount": "450", "effective_month": "2026-03-01"})

    gone = await auth_client.delete(f"{url}/2026-03-01")
    assert gone.status_code == 204
    # The next PUT's echoed history shows only the surviving row.
    after = await auth_client.put(url, json={"amount": "400", "effective_month": "2026-01-01"})
    assert after.json() == [{"effective_month": "2026-01-01", "amount": "400.00"}]

    assert (await auth_client.delete(f"{url}/2026-03-01")).status_code == 404
    assert (await auth_client.delete(f"{url}/2026-03-15")).status_code == 422
    assert (
        await auth_client.delete("/api/v1/spending/categories/999/budget/2026-01-01")
    ).status_code == 404
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_spending_api.py -q` → the three new tests FAIL (405/404 on the routes); everything else PASSES.

- [ ] **Step 3: Schemas.** Append to `backend/app/schemas/spending.py`:

```python
class BudgetPut(BaseModel):
    # amount is REQUIRED but nullable: null is the dated "budget ends here" marker
    # (spec §2), not an omitted field — there is no tri-state here.
    amount: Decimal | None
    effective_month: date


class BudgetHistoryEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    effective_month: date
    amount: Decimal | None
```

- [ ] **Step 4: Routes.** In `backend/app/api/spending.py`: extend the models import to `from app.models import CategoryBudget, MonthlyCashflow, MonthlySpending, SpendingCategory` and the schemas import to include `BudgetHistoryEntry,` and `BudgetPut,` (alphabetical, after `AmountEntry`). Insert between `delete_category` and `_savings_rate`:

```python
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
    category_id: int, body: BudgetPut, db: AsyncSession = Depends(get_db)
) -> list[CategoryBudget]:
    """Upsert one (category, effective_month) budget row — last write wins (single-user
    TOCTOU posture, spec §3). Returns the category's FULL history, ascending by month, so
    the editor renders it without a second fetch."""
    await _get_category(db, category_id)
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
        db.add(
            CategoryBudget(
                category_id=category_id, effective_month=body.effective_month, amount=amount
            )
        )
    else:
        existing.amount = amount
    await db.commit()
    return await _budget_history(db, category_id)


@router.delete("/categories/{category_id}/budget/{effective_month}", status_code=204)
async def delete_category_budget(
    category_id: int, effective_month: date, db: AsyncSession = Depends(get_db)
) -> Response:
    """Remove one HISTORY row (fixing a mis-dated entry) — distinct from the NULL-amount
    "budget ended" marker, which is itself a stored row (spec §3)."""
    await _get_category(db, category_id)
    require_first_of_month(effective_month)
    row = await _get_budget_row(db, category_id, effective_month)
    if row is None:
        raise HTTPException(status_code=404, detail="budget row not found")
    await db.delete(row)
    await db.commit()
    return Response(status_code=204)
```

(No `require_reasonable_date` here on purpose — the month endpoints it sits beside (`get_month`, `put_month`) validate first-of-month only, and this module keeps one validation vocabulary. A mistyped year is visible in the history list and fixable via the DELETE.)

- [ ] **Step 5: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_spending_api.py -q` → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(budgets): budget PUT/DELETE with full-history response"`

### Task 3: Matrix enrichment — `budgets` per series + `total_budget`

**Files:**
- Modify: `backend/app/schemas/spending.py`, `backend/app/api/spending.py`
- Test: `backend/tests/test_spending_api.py`

- [ ] **Step 1: Write the failing tests** (append to `test_spending_api.py` — these seed through the Task 2 PUT so the whole stack is exercised):

```python
async def test_matrix_budgets_resolution_rule_and_total(auth_client, db):
    food, rent = await _seed_spending(db)  # months: 2025-12, 2026-01, 2026-02
    put_food = f"/api/v1/spending/categories/{food.id}/budget"
    put_rent = f"/api/v1/spending/categories/{rent.id}/budget"
    # Food: starts in Jan at 450, steps to 350 in Feb. Rent: never budgeted.
    await auth_client.put(put_food, json={"amount": "450.00", "effective_month": "2026-01-01"})
    await auth_client.put(put_food, json={"amount": "350.00", "effective_month": "2026-02-01"})

    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    by_id = {s["category_id"]: s["budgets"] for s in body["series"]}
    # No row on/before Dec -> None; Jan row -> 450; Feb: the GREATEST effective <= M wins.
    assert by_id[food.id] == [None, "450.00", "350.00"]
    assert by_id[rent.id] == [None, None, None]
    # total_budget: None when NO category has one; else the sum of those that do.
    assert body["total_budget"] == [None, "450.00", "350.00"]

    # Rent joins in Feb: the total adds across categories from that month on.
    await auth_client.put(put_rent, json={"amount": "2000.00", "effective_month": "2026-02-01"})
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert body["total_budget"] == [None, "450.00", "2350.00"]


async def test_matrix_budget_null_marker_and_redated_past_row(auth_client, db):
    food, _rent = await _seed_spending(db)
    url = f"/api/v1/spending/categories/{food.id}/budget"
    await auth_client.put(url, json={"amount": "450.00", "effective_month": "2026-01-01"})
    # NULL from Feb on: Jan keeps its budget (history is frozen), Feb reads unbudgeted.
    await auth_client.put(url, json={"amount": None, "effective_month": "2026-02-01"})
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert {s["category_id"]: s["budgets"] for s in body["series"]}[food.id] == [
        None,
        "450.00",
        None,
    ]
    assert body["total_budget"] == [None, "450.00", None]

    # Re-dating the past: a row placed at Dec 2025 rewrites what THAT era's budget was
    # (spec §4.2's deliberate editor behavior, pinned here at the resolution layer).
    await auth_client.put(url, json={"amount": "500.00", "effective_month": "2025-12-01"})
    body = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert {s["category_id"]: s["budgets"] for s in body["series"]}[food.id] == [
        "500.00",
        "450.00",
        None,
    ]
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_spending_api.py -q` → the two new tests FAIL (`KeyError: 'budgets'`).

- [ ] **Step 3: Schemas.** In `backend/app/schemas/spending.py`, replace `CategorySeries` and `MatrixOut`:

```python
class CategorySeries(BaseModel):
    category_id: int
    values: list[Decimal | None]
    # The category's RESOLVED budget per month (greatest effective_month <= M, spec §2),
    # aligned with MatrixOut.months; None = unbudgeted that month (no row on/before it,
    # or a NULL end-marker).
    budgets: list[Decimal | None]


class MatrixOut(BaseModel):
    months: list[date]
    categories: list[CategoryOut]
    series: list[CategorySeries]
    totals: list[Decimal]
    net_pay: list[Decimal | None]
    savings_rate: list[Decimal | None]
    four_pct_rule: list[Decimal | None]
    # Sum of the resolved category budgets per month; None when NO category has one.
    total_budget: list[Decimal | None]
```

- [ ] **Step 4: Resolution helper + endpoint wiring.** In `backend/app/api/spending.py`, add below `_savings_rate`:

```python
def _resolve_budgets(
    rows: list[CategoryBudget], months: list[date]
) -> dict[int, list[Decimal | None]]:
    """Per category, the resolved budget for each month: the amount of the row with the
    greatest effective_month <= month (spec §2). `months` must be ascending (the matrix's
    order); one sorted walk per category, zero extra queries — the table is tiny."""
    by_category: dict[int, list[CategoryBudget]] = {}
    for row in rows:
        by_category.setdefault(row.category_id, []).append(row)
    resolved: dict[int, list[Decimal | None]] = {}
    for category_id, history in by_category.items():
        history.sort(key=lambda r: r.effective_month)
        values: list[Decimal | None] = []
        pointer = 0
        current: Decimal | None = None
        for month in months:
            while pointer < len(history) and history[pointer].effective_month <= month:
                current = history[pointer].amount
                pointer += 1
            values.append(current)
        resolved[category_id] = values
    return resolved
```

Then in `matrix()`, insert after the `four_pct` block (before the `return`):

```python
    budget_rows = list((await db.execute(select(CategoryBudget))).scalars().all())
    budgets_by_category = _resolve_budgets(budget_rows, months)
    # Shared read-only default for unbudgeted categories; pydantic validation copies it.
    no_budgets: list[Decimal | None] = [None] * len(months)
    total_budget: list[Decimal | None] = []
    for i in range(len(months)):
        month_budgets = [
            values[i] for values in budgets_by_category.values() if values[i] is not None
        ]
        total_budget.append(sum(month_budgets, Decimal("0.00")) if month_budgets else None)
```

and change the `return MatrixOut(...)` to pass the new fields:

```python
        series=[
            CategorySeries(
                category_id=c.id,
                values=[cells.get((c.id, i)) for i in range(len(months))],
                budgets=budgets_by_category.get(c.id, no_budgets),
            )
            for c in categories
        ],
```
plus `total_budget=total_budget,` after `four_pct_rule=four_pct,`.

- [ ] **Step 5: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_spending_api.py -q` → PASS (the pre-existing matrix tests read specific keys, so the new ones ride along).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(budgets): matrix budgets + total_budget enrichment"`

### Task 4: Month GET resolves budgets for the wizard

The spec's §4.1 promises "of {budget}" for **the month being entered**, but its §3 matrix arrays only cover entered months — and the wizard's month usually is not one yet (you set a budget effective next month, then enter next month). The natural carrier is the month GET the wizard already calls; this is the plan's one sanctioned extension beyond §3's endpoint list, additive and read-only.

**Files:**
- Modify: `backend/app/schemas/spending.py`, `backend/app/api/spending.py`
- Test: `backend/tests/test_spending_api.py`

- [ ] **Step 1: Write the failing test** (append):

```python
async def test_get_month_resolves_budgets_for_arbitrary_months(auth_client, db):
    food, _rent = await _seed_spending(db)
    url = f"/api/v1/spending/categories/{food.id}/budget"
    await auth_client.put(url, json={"amount": "450.00", "effective_month": "2026-03-01"})
    # 2026-04 is NOT an entered month (no matrix row) — the wizard's usual case: the
    # budget effective in March must still resolve for it (spec §4.1).
    body = (await auth_client.get("/api/v1/spending/months/2026-04-01")).json()
    assert body["budgets"] == [{"category_id": food.id, "amount": "450.00"}]
    # Before the first effective row: unbudgeted, and unbudgeted categories are OMITTED.
    body = (await auth_client.get("/api/v1/spending/months/2026-02-01")).json()
    assert body["budgets"] == []
    # A NULL end-marker removes it from that month on.
    await auth_client.put(url, json={"amount": None, "effective_month": "2026-05-01"})
    body = (await auth_client.get("/api/v1/spending/months/2026-05-01")).json()
    assert body["budgets"] == []
```

Also update the pre-existing `test_get_spending_month`: its `empty ==` literal compares the WHOLE dict, so add the new key — the expected object becomes:

```python
    assert empty == {
        "month": "2030-01-01",
        "exists": False,
        "net_pay": None,
        "amounts": [],
        "budgets": [],
    }
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_spending_api.py -q` → the new test FAILS (`KeyError: 'budgets'`) and `test_get_spending_month` FAILS on the dict compare.

- [ ] **Step 3: Implement.** In `backend/app/schemas/spending.py`, add to `SpendingMonthOut` (after `amounts`):

```python
    # Resolved budgets for THIS month (spec §2 rule) — the wizard's "of {budget}" subtext
    # needs the ENTRY month, which is usually not on the matrix's entered-months axis
    # (spec §4.1; the one addition beyond §3's endpoint list). Only categories with a
    # non-null resolved budget appear.
    budgets: list[AmountEntry]
```

In `api/spending.py`'s `get_month`, before the `return`:

```python
    budget_rows = list((await db.execute(select(CategoryBudget))).scalars().all())
    resolved = _resolve_budgets(budget_rows, [month])
    budgets = [
        AmountEntry(category_id=category_id, amount=values[0])
        for category_id, values in sorted(resolved.items())
        if values[0] is not None
    ]
```

and pass `budgets=budgets,` to `SpendingMonthOut(...)`.

- [ ] **Step 4: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_spending_api.py -q` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(budgets): month endpoint resolves budgets for the wizard"`

### Task 5: Drive-by N+1 fix — batched `investable_bases`

`matrix()` currently awaits `investable_base(db, month)` per month (~2 queries × months, the 2026-08-24 audit's N+1; spec §3 sanctions the fix). Replace with ONE snapshot list + ONE grouped sum. `investable_base` itself STAYS — `api/projection.py` calls it for a single date.

**Files:**
- Modify: `backend/app/services/net_worth_calc.py`, `backend/app/api/spending.py`
- Test: `backend/tests/test_net_worth_calc.py` (+ the existing `test_spending_api.py` pins)

- [ ] **Step 1: Write the failing parity tests** (append to `backend/tests/test_net_worth_calc.py`; the file already has the `nw_world` fixture, `date`, `Decimal`, and `investable_base` imported — extend its net_worth_calc import to also name `investable_bases`):

```python
async def test_investable_bases_matches_the_per_month_helper(db, nw_world):
    months = [
        date(2025, 12, 1),  # before the first snapshot -> None
        date(2026, 1, 1),   # exactly ON a snapshot month (<=, not <)
        date(2026, 2, 1),   # the later snapshot
        date(2026, 3, 1),   # after the last -> latest prior carries forward
    ]
    batched = await investable_bases(db, months)
    assert batched == [await investable_base(db, month) for month in months]
    assert batched == [None, Decimal("1500.00"), Decimal("1650.00"), Decimal("1650.00")]
    assert await investable_bases(db, []) == []


async def test_investable_bases_without_snapshots_and_with_an_empty_one(db):
    assert await investable_bases(db, [date(2026, 1, 1)]) == [None]
    # A snapshot with NO investable balances sums to zero, exactly as the per-month
    # helper's coalesce(0) does — the grouped query omits it, the .get default covers it.
    db.add(NetWorthSnapshot(month=date(2026, 1, 1)))
    await db.commit()
    batched = await investable_bases(db, [date(2026, 1, 1)])
    assert batched == [await investable_base(db, date(2026, 1, 1))]
    assert batched == [Decimal("0")]
```

- [ ] **Step 2: Run to verify failure** — `cd backend && .venv/Scripts/python -m pytest tests/test_net_worth_calc.py -q` → FAIL (ImportError).

- [ ] **Step 3: Implement.** Append to `backend/app/services/net_worth_calc.py` (below `investable_base`):

```python
async def investable_bases(db: AsyncSession, months: list[date]) -> list[Decimal | None]:
    """investable_base for many months in TWO queries — the spending matrix's per-month
    loop was ~2 queries x months (2026-08-24 audit N+1; spec §3 sanctions the fix).

    Resolution is identical by construction: snapshot months are UNIQUE, so "latest
    snapshot on or before M" is one walk over the ascending list; a snapshot with no
    matching balances is absent from the grouped sum and reads ZERO, matching the
    single-month coalesce. Byte-identical output is pinned in tests against
    investable_base itself and by the matrix endpoint's four_pct assertions.
    """
    if not months:
        return []
    snapshots = list(
        (
            await db.execute(
                select(NetWorthSnapshot.id, NetWorthSnapshot.month).order_by(
                    NetWorthSnapshot.month
                )
            )
        ).all()
    )
    if not snapshots:
        return [None] * len(months)
    totals = {
        snapshot_id: Decimal(total)
        for snapshot_id, total in (
            await db.execute(
                select(
                    AccountBalance.snapshot_id,
                    func.coalesce(func.sum(AccountBalance.balance), 0),
                )
                .join(Account, Account.id == AccountBalance.account_id)
                .where(
                    Account.is_component.is_(False),
                    Account.group.in_(INVESTABLE_GROUPS),
                )
                .group_by(AccountBalance.snapshot_id)
            )
        ).all()
    }
    bases: list[Decimal | None] = []
    for month in months:
        latest: int | None = None
        for snapshot_id, snapshot_month in snapshots:  # ascending; last <= month wins
            if snapshot_month <= month:
                latest = snapshot_id
            else:
                break
        bases.append(None if latest is None else totals.get(latest, ZERO))
    return bases
```

Also update the module docstring's last line from "no aggregate SQL beyond investable_base's single-snapshot sum" to "no aggregate SQL beyond the investable-base sums (single-snapshot and grouped)".

- [ ] **Step 4: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_net_worth_calc.py -q` → PASS.

- [ ] **Step 5: Swap the endpoint loop.** In `backend/app/api/spending.py`, change the net_worth_calc import to `from app.services.net_worth_calc import get_swr_pct, investable_bases` and replace the four-pct block in `matrix()`:

```python
    swr = await get_swr_pct(db)
    # Batched (spec §3 drive-by): two queries for every month instead of two per month.
    bases = await investable_bases(db, months)
    four_pct = [
        None if base is None else quantize_money(base * swr / 12, "four_pct_rule")
        for base in bases
    ]
```

(The local variable was annotated `four_pct: list[Decimal | None] = []` before — the comprehension replaces the annotation and the loop together.)

- [ ] **Step 6: Prove the pin** — `cd backend && .venv/Scripts/python -m pytest tests/test_spending_api.py -q` → PASS, in particular `test_matrix_shapes_totals_savings_and_four_pct`'s `[None, "1000.00", "1000.00"]` byte-identical. Then the full suite: `cd backend && .venv/Scripts/python -m pytest -q` → PASS.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "perf(spending): batch the matrix four-pct investable-base loop"`

### Task 6: Importer-immunity pin for `category_budgets`

**Files:**
- Test: `backend/tests/test_importer_apply.py`

- [ ] **Step 1: Add the pin**, modeled on the file's `test_importer_never_writes_espp_offerings` (full-tuple compare via a local helper). Extend the file's `from app.models import (...)` block with `CategoryBudget,` (alphabetical: after `AccountBalance`). Append:

```python
def budget_row(row: CategoryBudget) -> tuple:
    """EVERY stored column, as grant_row above — a budgets column added later is covered
    by the pin below without anyone editing it."""
    return tuple(getattr(row, column.key) for column in CategoryBudget.__table__.columns)


async def test_importer_never_writes_category_budgets(db):
    """category_budgets is dashboard-only (2026-08-24 spec §2, the rsu_grants posture):
    the workbook has no budgets concept, so a re-import must neither create, update nor
    delete a row — even while it UPDATES the very category the budget hangs off."""
    from app.importer.service import run_import

    # Slug "food" matches the workbook's Food column, and sort_order 99 does NOT match:
    # the import diff-updates the category row itself, which makes the pin sharp — the
    # parent table moves, the budgets table must not (categories are upserted by slug,
    # never deleted, so the CASCADE can't fire through an import).
    cat = SpendingCategory(name="Food", slug="food", sort_order=99)
    db.add(cat)
    await db.flush()
    db.add(
        CategoryBudget(
            category_id=cat.id, effective_month=date(2026, 1, 1), amount=Decimal("400.00")
        )
    )
    db.add(CategoryBudget(category_id=cat.id, effective_month=date(2026, 6, 1), amount=None))
    await db.commit()
    before = {
        row.id: budget_row(row) for row in (await db.execute(select(CategoryBudget))).scalars()
    }
    assert len(before) == 2

    for _ in range(2):
        report = await run_import(build_workbook(), db, dry_run=False)
        assert report.applied is True  # a blocked import would pin nothing

    # populate_existing, or the identity map would hand back the pre-import objects and
    # this would pass even if the import had rewritten every column (the dividends pin's
    # note).
    after = {
        row.id: budget_row(row)
        for row in (
            await db.execute(select(CategoryBudget).execution_options(populate_existing=True))
        ).scalars()
    }
    assert after == before
    assert all("category_budgets" not in sheet.entities for sheet in report.sheets.values())
```

- [ ] **Step 2: Run** — `cd backend && .venv/Scripts/python -m pytest tests/test_importer_apply.py -q` → PASS (the importer has no code path touching the table; this is a pin, not a fix).
- [ ] **Step 3: Ruff the backend** — `cd backend && .venv/Scripts/python -m ruff check app tests` → clean; `cd backend && .venv/Scripts/python -m ruff format app tests` → no reformats (or commit them).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "test(importer): pin category_budgets importer immunity"`

---

## Phase 2 — Frontend

### Task 7: Wire types + API client (+ fixture repairs)

The new matrix/month fields are REQUIRED on the wire types (the server always sends them), so every typed fixture in the test suite must gain them in this same task — the tree stays compiling.

**Files:**
- Modify: `src/types/api.ts`, `src/api/spending.ts`
- Fixture repairs: `src/utils/spending.test.ts`, `src/pages/MonthlyUpdatePage.test.tsx`, `src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: types/api.ts.** Replace `SpendingMatrix` and `SpendingMonth`, and add `CategoryBudgetEntry` right after `SpendingMonth`:

```ts
export interface SpendingMatrix {
  months: string[]
  categories: CategoryOut[]
  // budgets: the category's RESOLVED budget per month (greatest effective_month <= M,
  // spec §2), aligned with months; null = unbudgeted that month.
  series: { category_id: number; values: (string | null)[]; budgets: (string | null)[] }[]
  totals: string[]
  net_pay: (string | null)[]
  savings_rate: (string | null)[]
  four_pct_rule: (string | null)[]
  /** Sum of the resolved category budgets per month; null when NO category has one. */
  total_budget: (string | null)[]
}

export interface SpendingMonth {
  month: string
  exists: boolean
  net_pay: string | null
  amounts: AmountEntry[]
  /** Budgets RESOLVED for this month — only categories with one appear (wizard subtext). */
  budgets: AmountEntry[]
}

export interface CategoryBudgetEntry {
  effective_month: string
  /** null = the dated "budget ends here" marker (spec §2), not a missing value. */
  amount: string | null
}
```

- [ ] **Step 2: api/spending.ts.** Add `CategoryBudgetEntry` to the type import and append:

```ts
// The response is the category's FULL budget history, ascending by month — the editor
// renders it without a second fetch (spec §3).
export function putCategoryBudget(
  categoryId: number,
  // amount null = "no budget from this month on" (a stored, dated end-marker).
  body: { amount: string | null; effective_month: string },
): Promise<CategoryBudgetEntry[]> {
  return api<CategoryBudgetEntry[]>(`/spending/categories/${categoryId}/budget`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

// Removes one history ROW (a mis-dated entry) — distinct from the null-amount marker.
export function deleteCategoryBudget(categoryId: number, effectiveMonth: string): Promise<void> {
  return api<void>(`/spending/categories/${categoryId}/budget/${effectiveMonth}`, {
    method: 'DELETE',
  })
}
```

- [ ] **Step 3: Fixture repairs** (compile errors are the to-do list; these are all of them):
  1. `src/utils/spending.test.ts` — the `matrix()` helper gains a budgets param with a null-filled default (Task 8's tests use it):
```ts
function matrix(
  values: Record<number, (string | null)[]>,
  budgets: Record<number, (string | null)[]> = {},
) {
  return {
    categories,
    series: Object.entries(values).map(([id, v]) => ({
      category_id: Number(id),
      values: v,
      budgets: budgets[Number(id)] ?? v.map(() => null),
    })),
  }
}
```
  Also the `typicalSpend` describe-block's full-matrix literal: each of its two series entries gains `budgets: [null, null, null, null]`, and the object gains `total_budget: [null, null, null, null]`. The `buildMonthSlices` fallback test's inline series object (`{ category_id: 9, values: ['12.00'] }`) gains `budgets: [null]`.
  2. `src/pages/MonthlyUpdatePage.test.tsx` — the `beforeEach` `fetchMatrix` mock: its series entry gains `budgets: [null]` and the object gains `total_budget: [null]`; the `fetchSpendingMonth` mock gains `budgets: []`. The exactly-typical test's inline `fetchMatrix` mock (~line 563): series entry gains `budgets: [null, null]`, object gains `total_budget: [null, null]`. Then grep the file for any OTHER `fetchSpendingMonth`/`fetchMatrix` `mockResolvedValue` literals and give each the same treatment (`budgets` aligned with its `values`, `total_budget` aligned with `months`, `budgets: []` on month payloads).
  3. `src/pages/OverviewPage.test.tsx` — `matrixOut()` gains `total_budget: [],` beside its other empty arrays (its `series` is empty, nothing else to touch).

- [ ] **Step 4: Verify** — `npx vitest run src/utils/spending.test.ts src/pages/MonthlyUpdatePage.test.tsx src/pages/OverviewPage.test.tsx` → PASS; `npm run build` → clean (tsc runs inside it).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(budgets): wire types + budget API client"`

### Task 8: Budget math — `budgetProgress`, `deltaBudget`, `hasVsBudget`

**Files:**
- Modify: `src/utils/spending.ts`
- Test: `src/utils/spending.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `src/utils/spending.test.ts`; extend its import line to `import { budgetProgress, buildMonthSlices, hasVsBudget, monthMovers, typicalSpend } from './spending'`):

```ts
describe('budget movers', () => {
  it('adds a vs-budget delta when the month has a resolved budget', () => {
    const m = matrix(
      { 1: ['100.00', '400.00'], 2: ['50.00', '20.00'] },
      { 1: ['300.00', '300.00'] },
    )
    const movers = monthMovers(m, 1)
    expect(movers.find((mv) => mv.categoryId === 1)?.deltaBudget).toBe(100) // 400 - 300
    expect(movers.find((mv) => mv.categoryId === 2)?.deltaBudget).toBeNull()
    expect(hasVsBudget(movers)).toBe(true)
  })

  it('hides the column when no mover has a budget that month', () => {
    const m = matrix({ 1: ['100.00', '400.00'] })
    expect(hasVsBudget(monthMovers(m, 1))).toBe(false)
    expect(hasVsBudget([])).toBe(false)
  })
})

describe('budgetProgress', () => {
  it('fills proportionally and clamps at 100%', () => {
    expect(budgetProgress('200.00', '400.00')).toEqual({
      spent: 200,
      budget: 400,
      fillPct: 50,
      over: false,
    })
    expect(budgetProgress('600.00', '400.00')).toEqual({
      spent: 600,
      budget: 400,
      fillPct: 100,
      over: true,
    })
  })

  it('treats a missing month value as zero spend and floors refund months at empty', () => {
    expect(budgetProgress(null, '400.00')).toEqual({
      spent: 0,
      budget: 400,
      fillPct: 0,
      over: false,
    })
    expect(budgetProgress('-25.00', '400.00')).toEqual({
      spent: -25,
      budget: 400,
      fillPct: 0,
      over: false,
    })
  })

  it('returns null for an unbudgeted category', () => {
    expect(budgetProgress('200.00', null)).toBeNull()
  })

  it('handles a zero budget: any spend is over, none is empty', () => {
    expect(budgetProgress('10.00', '0.00')).toEqual({
      spent: 10,
      budget: 0,
      fillPct: 100,
      over: true,
    })
    expect(budgetProgress('0.00', '0.00')).toEqual({
      spent: 0,
      budget: 0,
      fillPct: 0,
      over: false,
    })
  })
})
```

Also update the THREE existing `monthMovers` tests: every expected mover object gains `deltaBudget: null` (the helper's default budgets are null-filled) — the `toEqual` compares whole objects.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/utils/spending.test.ts` → FAIL (no exported `budgetProgress`/`hasVsBudget`; missing `deltaBudget`).

- [ ] **Step 3: Implement.** In `src/utils/spending.ts`:
  1. Extend `CategoryMover` (after `deltaAvg`):
```ts
  /** vs the month's resolved budget; null when the category has none that month. */
  deltaBudget: number | null
```
  2. In `monthMovers`'s map callback, read the budget and emit the delta (ranking stays prior/avg only — a budget is a reference the month is judged against, not a mover):
```ts
    const budget = s.budgets[monthIndex] ?? null
```
  and add to the returned object:
```ts
      deltaBudget: budget === null ? null : value - Number(budget),
```
  3. Append at the end of the file:

```ts
/** The movers table's "vs budget" column appears only when it has something to say. */
export function hasVsBudget(movers: CategoryMover[]): boolean {
  return movers.some((m) => m.deltaBudget !== null)
}

export interface BudgetProgress {
  spent: number
  budget: number
  /** min(spent/budget, 1) as a 0–100 width; floored at 0 so a refund month reads empty. */
  fillPct: number
  over: boolean
}

/**
 * One meter's math (spec §4.2): fill = min(spent/budget, 1), the beyond-100% overflow is
 * a separate boolean the panel renders as a negative-toned tick. null budget = no meter.
 * A zero budget cannot scale a bar, so it degenerates honestly: any positive spend shows
 * a full bar and reads over; no spend reads empty. Number() is display-side math on
 * server strings (format.ts's license) — nothing here goes back to the API.
 */
export function budgetProgress(spent: string | null, budget: string | null): BudgetProgress | null {
  if (budget === null) return null
  const budgetN = Number(budget)
  const spentN = spent === null ? 0 : Number(spent)
  if (!Number.isFinite(budgetN) || budgetN <= 0) {
    return { spent: spentN, budget: budgetN, fillPct: spentN > 0 ? 100 : 0, over: spentN > budgetN }
  }
  return {
    spent: spentN,
    budget: budgetN,
    fillPct: Math.max(0, Math.min(1, spentN / budgetN)) * 100,
    over: spentN > budgetN,
  }
}
```

- [ ] **Step 4: Run** — `npx vitest run src/utils/spending.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(budgets): budget progress math + movers vs-budget delta"`

### Task 9: Budget step-line series builder

**Files:**
- Create: `src/components/spending/budgetChartOptions.ts`
- Test: `src/components/spending/budgetChartOptions.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/components/spending/budgetChartOptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MUTED } from '../../charts/theme'
import { budgetStepSeries } from './budgetChartOptions'

describe('budgetStepSeries', () => {
  it('wears the 4%-line grammar as a step: dashed MUTED, no symbols, gaps not bridged', () => {
    const s = budgetStepSeries('Food budget', ['400.00', null, '350.00'])
    expect(s.id).toBe('budget-Food budget')
    expect(s.name).toBe('Food budget')
    expect(s.type).toBe('line')
    expect(s.step).toBe('end') // holds its level across the month, jumps AT the change
    expect(s.lineStyle).toEqual({ width: 2, type: 'dashed' })
    expect(s.color).toBe(MUTED)
    expect(s.symbol).toBe('none')
    expect(s.connectNulls).toBe(false)
    expect(s.z).toBe(9)
    expect(s.data).toEqual([400, null, 350])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/spending/budgetChartOptions.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/components/spending/budgetChartOptions.ts`:

```ts
import { MUTED } from '../../charts/theme'

/**
 * A budget reference line: the 4%-rule line's exact styling grammar (dashed, MUTED,
 * symbol none, connectNulls false, z 9 — SpendingPage's four-pct series) PLUS
 * step: 'end', because budget changes are steps, not slopes (spec §4.3): each point
 * already carries its month's RESOLVED value, so the line holds level across the month
 * it applies to and jumps at the month a new effective row lands.
 */
export function budgetStepSeries(name: string, budgets: (string | null)[]) {
  return {
    id: `budget-${name}`,
    name,
    type: 'line' as const,
    symbol: 'none' as const,
    step: 'end' as const,
    lineStyle: { width: 2, type: 'dashed' as const },
    color: MUTED,
    z: 9,
    connectNulls: false,
    data: budgets.map((v) => (v === null ? null : Number(v))),
  }
}
```

- [ ] **Step 4: Run** — `npx vitest run src/components/spending/budgetChartOptions.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(budgets): budget step-line series builder"`

### Task 10: `BudgetPanel` — meters + inline effective-dated editor

**Files:**
- Create: `src/components/spending/BudgetPanel.tsx`, `src/components/spending/budgets.css`
- Test: `src/components/spending/BudgetPanel.test.tsx`

- [ ] **Step 1: Write the failing tests** — create `src/components/spending/BudgetPanel.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BudgetPanel from './BudgetPanel'

vi.mock('../../api/spending', () => ({
  putCategoryBudget: vi.fn(),
  deleteCategoryBudget: vi.fn(),
}))

import { deleteCategoryBudget, putCategoryBudget } from '../../api/spending'
import type { SpendingMatrix } from '../../types/api'
import { addMonths, currentMonthIso } from '../../utils/months'

const matrix: SpendingMatrix = {
  months: ['2026-01-01', '2026-02-01'],
  categories: [
    { id: 1, name: 'Food', slug: 'food', sort_order: 1, is_active: true },
    { id: 2, name: 'Rent', slug: 'rent', sort_order: 2, is_active: true },
    { id: 3, name: 'Old', slug: 'old', sort_order: 3, is_active: false },
  ],
  series: [
    { category_id: 1, values: ['300.00', '450.00'], budgets: ['400.00', '400.00'] },
    { category_id: 2, values: ['2000.00', '2000.00'], budgets: [null, null] },
    { category_id: 3, values: [null, null], budgets: [null, null] },
  ],
  totals: ['2300.00', '2450.00'],
  net_pay: [null, null],
  savings_rate: [null, null],
  four_pct_rule: [null, null],
  total_budget: ['400.00', '400.00'],
}

const onBudgetsChanged = vi.fn()

beforeEach(() => {
  vi.mocked(putCategoryBudget).mockResolvedValue([
    { effective_month: '2026-03-01', amount: '425.00' },
    { effective_month: '2026-09-01', amount: null },
  ])
  vi.mocked(deleteCategoryBudget).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPanel(monthIndex: number) {
  return render(
    <BudgetPanel matrix={matrix} monthIndex={monthIndex} onBudgetsChanged={onBudgetsChanged} />,
  )
}

function foodRow(): HTMLElement {
  return screen.getByText('Food').closest('.budget-row') as HTMLElement
}

it('meters a within-budget month: proportional fill, no tick, calm summary', () => {
  renderPanel(0)
  const meter = screen.getByRole('meter', { name: 'Food spend vs budget' })
  expect(meter.getAttribute('aria-valuenow')).toBe('75') // 300 / 400
  expect(meter.getAttribute('aria-valuetext')).toBe('$300.00 of $400.00')
  expect(meter.querySelector('.budget-overflow-tick')).toBeNull()
  expect(within(foodRow()).getByText('$300.00 / $400.00')).toBeDefined()
  expect(screen.getByText('0 of 1 budgeted categories over in Jan 2026')).toBeDefined()
})

it('meters an over month: clamped fill, overflow tick, toned figures, summary counts it', () => {
  renderPanel(1)
  const meter = screen.getByRole('meter', { name: 'Food spend vs budget' })
  expect(meter.getAttribute('aria-valuenow')).toBe('100') // clamp: 450 / 400
  expect(meter.querySelector('.budget-overflow-tick')).not.toBeNull()
  expect(within(foodRow()).getByText('$450.00 / $400.00').className).toContain('delta-negative')
  expect(screen.getByText('1 of 1 budgeted categories over in Feb 2026')).toBeDefined()
})

it('lists unbudgeted ACTIVE categories collapsed, without meters or inactive ones', () => {
  renderPanel(0)
  const collapsed = screen.getByText('No budget — set one (1)').closest('details') as HTMLElement
  expect(within(collapsed).getByText('Rent')).toBeDefined()
  expect(within(collapsed).queryByText('Old')).toBeNull()
  expect(screen.queryByRole('meter', { name: 'Rent spend vs budget' })).toBeNull()
})

it('saves through the PUT (editor defaults to next month) and renders the returned history', async () => {
  renderPanel(0)
  const expectedDefault = addMonths(currentMonthIso(), 1).slice(0, 7)
  const monthBox = screen.getByLabelText('Food budget effective from') as HTMLInputElement
  expect(monthBox.value).toBe(expectedDefault)
  // The amount box prefills with the month's resolved budget.
  const amountBox = screen.getByLabelText('Food budget amount') as HTMLInputElement
  expect(amountBox.value).toBe('$400.00') // AmountInput's blurred echo of '400.00'
  fireEvent.change(amountBox, { target: { value: '425.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  await waitFor(() =>
    expect(putCategoryBudget).toHaveBeenCalledWith(1, {
      amount: '425.00',
      effective_month: `${expectedDefault}-01`,
    }),
  )
  // The response's history renders, null amount reading as the end marker.
  expect(await screen.findByText('Mar 2026 — $425.00')).toBeDefined()
  expect(screen.getByText('Sep 2026 — budget ends')).toBeDefined()
  expect(onBudgetsChanged).toHaveBeenCalled()
  // The re-dating hint is the editor's contract with history (spec §4.2).
  expect(screen.getAllByText(/re-writes what that era/).length).toBeGreaterThan(0)
})

it('a blank amount saves the null end-marker', async () => {
  renderPanel(0)
  fireEvent.change(screen.getByLabelText('Food budget amount'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  await waitFor(() =>
    expect(putCategoryBudget).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ amount: null }),
    ),
  )
})

it('deletes a history row through the DELETE and drops it from the list', async () => {
  renderPanel(0)
  fireEvent.change(screen.getByLabelText('Food budget amount'), { target: { value: '425.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  await screen.findByText('Mar 2026 — $425.00')
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete the Mar 2026 budget row for Food' }),
  )
  await waitFor(() => expect(deleteCategoryBudget).toHaveBeenCalledWith(1, '2026-03-01'))
  await waitFor(() => expect(screen.queryByText('Mar 2026 — $425.00')).toBeNull())
})

it('rejects a negative amount client-side without calling the API', () => {
  renderPanel(0)
  fireEvent.change(screen.getByLabelText('Food budget amount'), { target: { value: '-5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Food budget' }))
  expect(putCategoryBudget).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toMatch(/non-negative/)
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/spending/BudgetPanel.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement the panel** — create `src/components/spending/BudgetPanel.tsx`:

```tsx
import { useState } from 'react'
import { ApiError } from '../../api/client'
import { deleteCategoryBudget, putCategoryBudget } from '../../api/spending'
import type { CategoryBudgetEntry, CategoryOut, SpendingMatrix } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatMonth } from '../../utils/format'
import { addMonths, currentMonthIso } from '../../utils/months'
import { budgetProgress } from '../../utils/spending'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import '../panels.css'
import './budgets.css'

interface EditorState {
  amount: string
  effectiveFrom: string // YYYY-MM; '-01' is appended at save (budgets are month-dated)
}

function failMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * The Budget card (spec §4.2): one 4px meter per BUDGETED category for the page's focused
 * month, unbudgeted actives collapsed below, and the app's first budget-management
 * surface — an inline effective-dated editor whose PUT response is the history it renders.
 * Plain HTML/CSS in the StatTile family, no ECharts.
 */
export default function BudgetPanel({
  matrix,
  monthIndex,
  onBudgetsChanged,
}: {
  matrix: SpendingMatrix
  monthIndex: number
  onBudgetsChanged: () => void
}) {
  const [editors, setEditors] = useState<Record<number, EditorState>>({})
  // Histories arrive ONLY as PUT responses (spec §3 — no history GET exists), so the
  // expandable list appears per category once this session has saved it.
  const [histories, setHistories] = useState<Record<number, CategoryBudgetEntry[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const month = matrix.months[monthIndex]
  // Next calendar month: the forward-looking default — changing a budget mid-month
  // usually means "from now on", and past months' verdicts stay frozen.
  const defaultEffectiveFrom = addMonths(currentMonthIso(), 1).slice(0, 7)

  const seriesById = new Map(matrix.series.map((s) => [s.category_id, s]))
  const rows = matrix.categories
    .filter((c) => c.is_active)
    .map((category) => {
      const series = seriesById.get(category.id)
      const spent = series?.values[monthIndex] ?? null
      const budget = series?.budgets[monthIndex] ?? null
      return { category, budget, progress: budgetProgress(spent, budget) }
    })
  const budgeted = rows.flatMap((row) =>
    row.progress === null ? [] : [{ ...row, progress: row.progress }],
  )
  const unbudgeted = rows.filter((row) => row.progress === null)
  const overCount = budgeted.filter((row) => row.progress.over).length

  const save = (category: CategoryOut, editor: EditorState) => {
    const trimmed = editor.amount.trim()
    // Blank ENDS the budget from that month (the stored null marker, spec §2); anything
    // else must be a non-negative amount — mirrors the server's 422s so the round trip
    // never surprises.
    const amount = trimmed === '' ? null : canonicalAmount(trimmed)
    if (amount !== null && (!isAmount(trimmed) || Number(amount) < 0)) {
      setError('Budget must be a non-negative amount (or blank to end the budget)')
      return
    }
    if (!/^\d{4}-\d{2}$/.test(editor.effectiveFrom)) {
      setError('Pick an effective-from month')
      return
    }
    setBusy(true)
    setError(null)
    putCategoryBudget(category.id, {
      amount,
      effective_month: `${editor.effectiveFrom}-01`,
    })
      .then((history) => {
        setHistories((cur) => ({ ...cur, [category.id]: history }))
        setEditors((cur) => {
          const next = { ...cur }
          delete next[category.id]
          return next
        })
        onBudgetsChanged()
      })
      .catch((err: unknown) => setError(failMessage(err, 'Failed to save the budget')))
      .finally(() => setBusy(false))
  }

  const removeRow = (category: CategoryOut, effectiveMonth: string) => {
    setBusy(true)
    setError(null)
    deleteCategoryBudget(category.id, effectiveMonth)
      .then(() => {
        setHistories((cur) => ({
          ...cur,
          [category.id]: (cur[category.id] ?? []).filter(
            (h) => h.effective_month !== effectiveMonth,
          ),
        }))
        onBudgetsChanged()
      })
      .catch((err: unknown) => setError(failMessage(err, 'Failed to delete the budget row')))
      .finally(() => setBusy(false))
  }

  const editorBlock = (category: CategoryOut, budget: string | null) => {
    const editor = editors[category.id] ?? {
      amount: budget ?? '',
      effectiveFrom: defaultEffectiveFrom,
    }
    const setEditor = (patch: Partial<EditorState>) =>
      setEditors((cur) => ({ ...cur, [category.id]: { ...editor, ...patch } }))
    const history = histories[category.id]
    return (
      <details className="budget-editor">
        <summary>Set budget</summary>
        <div className="budget-editor-form">
          <label>
            Monthly budget
            <AmountInput
              value={editor.amount}
              onValueChange={(next) => setEditor({ amount: next })}
              placeholder="blank ends the budget"
              aria-label={`${category.name} budget amount`}
            />
          </label>
          <label>
            Effective from
            <input
              type="month"
              className="field-input"
              aria-label={`${category.name} budget effective from`}
              value={editor.effectiveFrom}
              onChange={(e) => setEditor({ effectiveFrom: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="button"
            aria-label={`Save ${category.name} budget`}
            disabled={busy}
            onClick={() => save(category, editor)}
          >
            Save
          </button>
        </div>
        <p className="drill-hint">
          Defaults to next month. Dating it in the past deliberately re-writes what that
          era&apos;s budget was — past months&apos; meters will re-judge against it.
        </p>
        {history !== undefined && (
          <ul className="budget-history">
            {history.map((entry) => (
              <li key={entry.effective_month}>
                <span>
                  {`${formatMonth(entry.effective_month)} — ${
                    entry.amount === null ? 'budget ends' : formatCurrency(entry.amount)
                  }`}
                </span>
                <button
                  type="button"
                  className="button"
                  aria-label={`Delete the ${formatMonth(entry.effective_month)} budget row for ${category.name}`}
                  disabled={busy}
                  onClick={() => removeRow(category, entry.effective_month)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    )
  }

  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        Budgets — {formatMonth(month)}
        <InfoHint text="Each budgeted category's spend against its budget for the focused month. Budgets are effective-dated: a change applies from its month forward and never rewrites history. With no transaction feed there is no mid-month pacing — meters describe completed months and the live wizard entry." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {budgeted.length > 0 ? (
        <>
          <p className="drill-hint" role="status">
            {`${overCount} of ${budgeted.length} budgeted categories over in ${formatMonth(month)}`}
          </p>
          <div className="budget-rows">
            {budgeted.map(({ category, budget, progress }) => (
              <div className="budget-row" key={category.id}>
                <span className="budget-name">{category.name}</span>
                <div
                  className="budget-meter"
                  role="meter"
                  aria-label={`${category.name} spend vs budget`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress.fillPct)}
                  aria-valuetext={`${formatCurrency(progress.spent)} of ${formatCurrency(progress.budget)}`}
                >
                  <div
                    className={`budget-fill${progress.over ? ' is-over' : ''}`}
                    style={{ width: `${progress.fillPct.toFixed(2)}%` }}
                  />
                  {/* Over-ness rides a POSITION channel (the tick past the track's end),
                      not colour alone — the summary line carries it in words too. */}
                  {progress.over && <span className="budget-overflow-tick" aria-hidden="true" />}
                </div>
                <span className={`budget-figures${progress.over ? ' delta-negative' : ''}`}>
                  {`${formatCurrency(progress.spent)} / ${formatCurrency(progress.budget)}`}
                </span>
                {editorBlock(category, budget)}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="empty-note">
          No budgets yet — set one below and the meters appear from that month on.
        </p>
      )}
      {unbudgeted.length > 0 && (
        <details className="budget-unbudgeted">
          <summary>{`No budget — set one (${unbudgeted.length})`}</summary>
          <div className="budget-rows">
            {unbudgeted.map(({ category, budget }) => (
              <div className="budget-row" key={category.id}>
                <span className="budget-name">{category.name}</span>
                {editorBlock(category, budget)}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
```

- [ ] **Step 4: CSS** — create `src/components/spending/budgets.css`:

```css
/* Budget meters (2026-08-24 spec §4.2): plain HTML/CSS in the StatTile family — thin
   4px rounded tracks, figures in the app's text tokens, tone only where over. */

.budget-rows {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.budget-row {
  display: grid;
  grid-template-columns: minmax(110px, 160px) 1fr minmax(150px, auto) auto;
  align-items: center;
  gap: 0.75rem;
}

.budget-name {
  font-size: 0.85rem;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.budget-meter {
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-2);
}

.budget-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
}

.budget-fill.is-over {
  background: var(--negative);
}

/* The beyond-100% marker: a small negative-toned tick just past the track's end —
   a POSITION channel for over-ness, redundant with the colour (CVD-safe). */
.budget-overflow-tick {
  position: absolute;
  top: -3px;
  right: -6px;
  width: 3px;
  height: 10px;
  border-radius: 1px;
  background: var(--negative);
}

.budget-figures {
  font-family: ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
  text-align: right;
  color: var(--muted);
}

.budget-figures.delta-negative {
  color: var(--negative);
}

.budget-editor summary,
.budget-unbudgeted summary {
  cursor: pointer;
  font-size: 0.75rem;
  color: var(--muted);
}

.budget-unbudgeted summary {
  font-size: 0.8rem;
  margin-top: 0.75rem;
}

.budget-editor-form {
  display: flex;
  align-items: end;
  gap: 0.75rem;
  margin: 0.5rem 0;
  flex-wrap: wrap;
}

.budget-editor-form label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.72rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
}

.budget-editor-form .field-input {
  width: 150px;
}

.budget-history {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  font-size: 0.8rem;
}

.budget-history li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.2rem 0;
}

@media (max-width: 720px) {
  .budget-row {
    grid-template-columns: 1fr;
    gap: 0.3rem;
  }
}
```

- [ ] **Step 5: Run** — `npx vitest run src/components/spending/BudgetPanel.test.tsx` → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(budgets): BudgetPanel meters + inline effective-dated editor"`

### Task 11: SpendingPage integration — card, chart lines, movers column

The pure pieces are already test-covered (Tasks 8–10); this task is wiring inside `src/pages/SpendingPage.tsx`, verified by lint + build + the full suite staying green.

**Files:**
- Modify: `src/pages/SpendingPage.tsx`

- [ ] **Step 1: Imports + focused-month rename.** Add:

```ts
import BudgetPanel from '../components/spending/BudgetPanel'
import { budgetStepSeries } from '../components/spending/budgetChartOptions'
```

and extend the utils/spending import to `import { buildMonthSlices, hasVsBudget, monthMovers } from '../utils/spending'`. Rename `moversIndex` → `focusIndex` at EVERY occurrence in the file (the definition, the `movers` useMemo argument, the movers-card heading, and the two table-header reads — grep the file for `moversIndex` afterwards; it must return nothing). It already IS the page's focused month — the drilled month when the pie is open, the latest otherwise — and the Budget card now shares it; update the definition comment to say so.

- [ ] **Step 2: Stacked chart — total budget line.** In `barsOption`:
  - change `legend: { top: 0 }` to:
```ts
      // 'Total budget' ships DESELECTED: it wears the same dashed-MUTED grammar as the
      // 4% line (spec §4.3 — one reference-line language), so both on at once would be
      // ambiguous; the legend chip is the summon. notMerge resets legend picks on option
      // rebuild — the page's existing behavior for every series.
      legend: { top: 0, selected: { 'Total budget': false } },
```
  - append AFTER the four-pct series object (LAST in the series array — the heatmap-hover
    `seriesIndex` math indexes the bar stack positionally, so nothing may be inserted
    before it):
```ts
        ...(matrix.total_budget.some((v) => v !== null)
          ? [budgetStepSeries('Total budget', matrix.total_budget)]
          : []),
```

- [ ] **Step 3: Trend chart — per-category budget steps.** In `trendOption`, replace the `series:` value with:

```ts
      series: [
        ...trend.map(({ categoryId, slot }) => ({
          name: nameById.get(categoryId) ?? String(categoryId),
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 2 },
          color: PALETTE[slot],
          connectNulls: false,
          data: (valuesById.get(categoryId) ?? []).map((v) => (v === null ? null : Number(v))),
        })),
        // A picked category's budget as a dashed MUTED step (spec §4.3) — named
        // "{category} budget" so the axis tooltip disambiguates when several show.
        ...trend.flatMap(({ categoryId }) => {
          const s = matrix.series.find((x) => x.category_id === categoryId)
          if (!s || !s.budgets.some((v) => v !== null)) return []
          const name = nameById.get(categoryId) ?? String(categoryId)
          return [budgetStepSeries(`${name} budget`, s.budgets)]
        }),
      ],
```

(The existing `trend.map` body is unchanged — only wrapped by the new array literal.)

- [ ] **Step 4: Movers "vs budget" column.** Above the movers card's JSX add `const showVsBudget = hasVsBudget(movers)` (beside the `movers` useMemo). In the table: after the `vs 12-mo avg` `<th>` add

```tsx
                  {showVsBudget && <th className="num">vs budget</th>}
```

and after the `moverCell(m.deltaAvg)` cell add

```tsx
                    {showVsBudget && <td className="num">{moverCell(m.deltaBudget)}</td>}
```

(`moverCell`'s tone inversion is already right: over budget = up = bad.)

- [ ] **Step 5: Mount the Budget card** — insert between the movers card block and the heatmap card:

```tsx
        {matrix && matrix.months.length > 0 && (
          <BudgetPanel matrix={matrix} monthIndex={focusIndex} onBudgetsChanged={load} />
        )}
```

(`load` refetches the matrix so a saved budget re-draws meters, chart lines and the movers column together; BudgetPanel's own section carries `card span-12`.)

- [ ] **Step 6: Verify** — `npm run lint` → clean; `npm run build` → clean; `npx vitest run` → ALL PASS (nothing yet asserts on SpendingPage internals; the suite guards the shared modules).

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(budgets): spending page budget card, chart reference lines, movers column"`

### Task 12: Wizard step 2 — budget subtext + tone (never a gate)

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx`, `src/pages/MonthlyUpdatePage.css`
- Test: `src/pages/MonthlyUpdatePage.test.tsx`

- [ ] **Step 1: Write the failing tests** (append to `src/pages/MonthlyUpdatePage.test.tsx`):

```tsx
it('shows the budget subtext, tones it when over, and never blocks the save', async () => {
  vi.mocked(spendingApi.fetchSpendingMonth).mockResolvedValue({
    month: '2026-08-01',
    exists: false,
    net_pay: null,
    amounts: [],
    budgets: [{ category_id: 7, amount: '200.00' }],
  })
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  const food = await screen.findByLabelText('Food')
  const row = food.closest('tr') as HTMLElement
  // Within budget (seeded 0.00): muted subtext, no tone.
  expect(within(row).getByText('of $200.00').className).toBe('entry-budget')
  // Typing past the budget tones the subtext — and only the subtext.
  fireEvent.change(food, { target: { value: '250.00' } })
  expect(within(row).getByText('of $200.00').className).toBe('entry-budget delta-negative')
  // Advice, not validation (spec §4.1): the step advances and the PUT carries the amount.
  const next = screen.getByRole('button', { name: /next: review/i }) as HTMLButtonElement
  expect(next.disabled).toBe(false)
  fireEvent.click(next)
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() => {
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({ amounts: [{ category_id: 7, amount: '250.00' }] }),
    )
  })
})

it('leaves unbudgeted rows without the subtext', async () => {
  renderWizard() // the default fetchSpendingMonth mock ships budgets: []
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  const food = await screen.findByLabelText('Food')
  expect(within(food.closest('tr') as HTMLElement).queryByText(/^of \$/)).toBeNull()
})
```

(`within(row).getByText('of $200.00')` lands on the subtext span, never the `<td>`: RTL's default matcher reads an element's DIRECT text nodes only, and the over-state glyph lives in a nested `aria-hidden` span.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/pages/MonthlyUpdatePage.test.tsx` → the two new tests FAIL (no subtext rendered); the rest PASS.

- [ ] **Step 3: Implement.** In `src/pages/MonthlyUpdatePage.tsx`:
  1. State (beside `hadNetPay` — server-derived, deliberately NOT part of the draft snapshot, like `matrix`):
```ts
  // Resolved budgets for the month being entered (GET /spending/months payload) —
  // the "of {budget}" subtext's source; advice, never a gate (spec §4.1).
  const [monthBudgets, setMonthBudgets] = useState<Record<number, string>>({})
```
  2. In the `[month]` load effect's `.then`, next to `setHadNetPay(...)`:
```ts
        setMonthBudgets(
          Object.fromEntries(spendMonth.budgets.map((b) => [b.category_id, b.amount])),
        )
```
  3. In the spending-step `categories.map` callback, after the `deltaCents` const:
```ts
                const budget = monthBudgets[category.id]
                const overBudget =
                  budget !== undefined && (Number(canonicalAmount(value)) || 0) > Number(budget)
```
  and inside the amount `<td className="num entry-cell-col">`, directly after the `<AmountInput …/>`:
```tsx
                      {budget !== undefined && (
                        <span className={`entry-budget${overBudget ? ' delta-negative' : ''}`}>
                          {/* Glyph + colour, never colour alone (StatTile's grammar):
                              the amount went UP past the budget — the bad direction. */}
                          {overBudget && <span aria-hidden="true">▲ </span>}
                          {`of ${formatCurrency(budget)}`}
                        </span>
                      )}
```
  4. Append to `src/pages/MonthlyUpdatePage.css`:
```css
/* The budget subtext under the amount cell (2026-08-24 spec §4.1): advice, never a gate —
   muted within budget, negative-toned (with the ▲ glyph, never colour alone) when the
   typed amount exceeds it. The Δ-vs-typical column keeps its own independent signal. */
.entry-budget {
  display: block;
  margin-top: 2px;
  font-size: 0.7rem;
  text-align: right;
  color: var(--muted);
}

.entry-budget.delta-negative {
  color: var(--negative);
}
```

- [ ] **Step 4: Run** — `npx vitest run src/pages/MonthlyUpdatePage.test.tsx` → ALL PASS (the pre-existing walkthrough and paste tests must be untouched by the new cell content).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(budgets): wizard budget subtext + over tone"`

---

## Phase 3 — Verification

### Task 13: Full verification + spec status (STOP here — the orchestrator merges)

**Files:**
- Modify: `docs/superpowers/specs/2026-08-24-category-budgets-design.md` (status line only)

- [ ] **Step 1: Full backend suite** — `cd backend && .venv/Scripts/python -m pytest -q` → ALL PASS (record the count).
- [ ] **Step 2: Ruff** — `cd backend && .venv/Scripts/python -m ruff check app tests` → clean; `cd backend && .venv/Scripts/python -m ruff format app tests` → if anything reformats, re-run the touched test files and commit the reflow.
- [ ] **Step 3: Alembic round-trip** (CI's drift guard, run locally against the dev DB):
```bash
cd backend && .venv/Scripts/python -m alembic upgrade head && .venv/Scripts/python -m alembic check && .venv/Scripts/python -m alembic downgrade c9e2b7a4d113 && .venv/Scripts/python -m alembic upgrade head
```
Expected: no errors; `alembic check` reports no new upgrade operations; `alembic heads` → `b7c4e1f2a9d3 (head)`.
- [ ] **Step 4: Full frontend** — `npx vitest run` → ALL PASS (record the count); `npm run lint` → clean; `npm run build` → clean, and note the printed chunk sizes — the echarts chunk must not regress (no new chart dependencies; the budget lines are plain series options).
- [ ] **Step 5: Spec status** — in `docs/superpowers/specs/2026-08-24-category-budgets-design.md`, change the status line from `**Status:** approved, not yet implemented` to `**Status:** implemented 2026-08-24 (branch category-budgets)`.
- [ ] **Step 6: Commit everything** — `git add -A && git commit -m "docs: category-budgets spec status — implemented"`, then `git status --porcelain` → EMPTY.
- [ ] **Step 7: STOP.** Do not merge, do not push, do not delete anything — the orchestrator reviews and merges this branch. Leave a summary listing: the migration id (`b7c4e1f2a9d3`), both test counts, the one spec extension (`SpendingMonthOut.budgets`, Task 4's note), and the reminder that the `Total budget` chart line ships legend-deselected by design.
