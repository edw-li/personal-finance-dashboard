from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    sort_order: int
    is_active: bool


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    # int32-safe and generous; sheet column indexes top out at 20.
    sort_order: int = Field(default=0, ge=0, le=1_000_000)


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
    is_active: bool | None = None


class AmountEntry(BaseModel):
    category_id: int
    amount: Decimal


class SpendingMonthUpsert(BaseModel):
    net_pay: Decimal | None = None
    amounts: list[AmountEntry] = []


class SpendingMonthOut(BaseModel):
    month: date
    exists: bool
    net_pay: Decimal | None
    amounts: list[AmountEntry]


class SpendingUpsertResult(BaseModel):
    month: date
    created: int
    updated: int
    unchanged: int
    net_pay_set: bool


class CategorySeries(BaseModel):
    category_id: int
    values: list[Decimal | None]


class MatrixOut(BaseModel):
    months: list[date]
    categories: list[CategoryOut]
    series: list[CategorySeries]
    totals: list[Decimal]
    net_pay: list[Decimal | None]
    savings_rate: list[Decimal | None]
    four_pct_rule: list[Decimal | None]


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
