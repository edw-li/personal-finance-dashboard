from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# The write side's vocabulary (2026-09-04 honest-numbers spec §1). CategoryOut deliberately
# types `kind` as a plain str: a GET must never 422 on a value the database already holds.
CategoryKind = Literal["living", "tax", "transfer"]


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    sort_order: int
    is_active: bool
    kind: str


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    # int32-safe and generous; sheet column indexes top out at 20.
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
    kind: CategoryKind = "living"


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
    is_active: bool | None = None
    kind: CategoryKind | None = None


class AmountEntry(BaseModel):
    # int32-bounded so a garbage id 422s instead of surfacing asyncpg's DataError.
    category_id: int = Field(ge=1, le=2_147_483_647)
    # Signed on purpose: refunds/credits can make a category month negative.
    amount: Decimal


class SpendingMonthUpsert(BaseModel):
    net_pay: Decimal | None = None
    amounts: list[AmountEntry] = []


class SpendingMonthOut(BaseModel):
    month: date
    exists: bool
    net_pay: Decimal | None
    amounts: list[AmountEntry]
    # Resolved budgets for THIS month (spec §2 rule) — the wizard's "of {budget}" subtext
    # needs the ENTRY month, which is usually not on the matrix's entered-months axis
    # (spec §4.1; the one addition beyond §3's endpoint list). Only categories with a
    # non-null resolved budget appear.
    budgets: list[AmountEntry]


class SpendingUpsertResult(BaseModel):
    month: date
    created: int
    updated: int
    unchanged: int
    net_pay_set: bool
    # True only when an explicit null actually deleted a cashflow row; a null on a
    # month that had none is a harmless no-op, so it reports False.
    net_pay_cleared: bool = False
    # The change batch this save wrote (2026-09-03 data-lifecycle spec §9) — None until the
    # router records one, and None when nothing changed (an all-unchanged PUT logs nothing).
    batch_id: UUID | None = None


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


class YearCategoryTotal(BaseModel):
    category_id: int
    total: Decimal


class YearRollup(BaseModel):
    year: int
    by_category: list[YearCategoryTotal]
    total: Decimal
    net_pay_total: Decimal | None
    savings_rate: Decimal | None


class YearlyOut(BaseModel):
    years: list[YearRollup]


class BudgetPut(BaseModel):
    # amount is REQUIRED but nullable: null is the dated "budget ends here" marker
    # (spec §2), not an omitted field — there is no tri-state here.
    amount: Decimal | None
    effective_month: date


class BudgetHistoryEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    effective_month: date
    amount: Decimal | None
