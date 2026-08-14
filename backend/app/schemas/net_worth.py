from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import ACCOUNT_GROUPS


def _check_group(value: str) -> str:
    if value not in ACCOUNT_GROUPS:
        raise ValueError(f"group must be one of {sorted(ACCOUNT_GROUPS)}")
    return value


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    group: str
    sort_order: int
    is_active: bool
    is_component: bool


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    group: str
    sort_order: int = 0
    is_component: bool = False

    group_known = field_validator("group")(_check_group)


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    group: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    is_component: bool | None = None

    @field_validator("group")
    @classmethod
    def group_known(cls, value: str | None) -> str | None:
        return None if value is None else _check_group(value)


class BalanceEntry(BaseModel):
    account_id: int
    balance: Decimal


class MonthUpsert(BaseModel):
    recorded_on: date | None = None
    notes: str | None = None
    balances: list[BalanceEntry] = []


class MonthUpsertResult(BaseModel):
    month: date
    snapshot_created: bool
    created: int
    updated: int
    unchanged: int


class MonthBalancesOut(BaseModel):
    month: date
    exists: bool
    recorded_on: date | None
    notes: str | None
    balances: list[BalanceEntry]


class AccountSeries(BaseModel):
    account_id: int
    values: list[Decimal | None]


class TimeseriesOut(BaseModel):
    months: list[date]
    accounts: list[AccountOut]
    series: list[AccountSeries]
    group_totals: dict[str, list[Decimal]]
    net_worth: list[Decimal]
    mom_pct: list[Decimal | None]


class GroupSummary(BaseModel):
    group: str
    total: Decimal
    mom_delta: Decimal | None


class SummaryOut(BaseModel):
    month: date | None
    net_worth: Decimal | None
    mom_delta: Decimal | None
    mom_pct: Decimal | None
    groups: list[GroupSummary]
