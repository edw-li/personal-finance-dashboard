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
    parent_account_id: int | None
    # NULL = JOINT/household (2026-08-26 spec §4), never "unknown": migration a8d24b6e9107
    # backfilled every pre-existing account to the primary person.
    person_id: int | None


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    group: str
    # int32-safe and generous; sheet column indexes top out at 51.
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
    is_component: bool = False
    # Both int32-bounded so a garbage id 422s instead of surfacing asyncpg's DataError
    # (BalanceEntry's rule). Omitted or null = joint / no parent; the API never guesses
    # the primary person for a new account.
    person_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    parent_account_id: int | None = Field(default=None, ge=1, le=2_147_483_647)

    group_known = field_validator("group")(_check_group)


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    group: str | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
    is_active: bool | None = None
    is_component: bool | None = None
    # The two NULLABLE account columns. An explicit null here is a WRITE — retag to joint,
    # unlink a component — not the no-op the router's drop-nulls rule applies to the rest.
    person_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    parent_account_id: int | None = Field(default=None, ge=1, le=2_147_483_647)

    @field_validator("group")
    @classmethod
    def group_known(cls, value: str | None) -> str | None:
        return None if value is None else _check_group(value)


class BalanceEntry(BaseModel):
    # int32-bounded so a garbage id 422s instead of surfacing asyncpg's DataError.
    account_id: int = Field(ge=1, le=2_147_483_647)
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


class OwnerSeries(BaseModel):
    """One EXCLUSIVE owner column, aligned with `months`. `name` is null for the joint
    (NULL-owned) row — the client owns that label, the server does not invent a person."""

    person_id: int | None
    name: str | None
    values: list[Decimal]


class TimeseriesOut(BaseModel):
    months: list[date]
    accounts: list[AccountOut]
    series: list[AccountSeries]
    group_totals: dict[str, list[Decimal]]
    net_worth: list[Decimal]
    mom_pct: list[Decimal | None]
    # Aligned with months, like every other parallel list here: the wizard has collected
    # snapshot notes since Plan 3, and this is what finally lets a chart show them.
    notes: list[str | None]
    # Exclusive per-owner net worth, primary person first and Joint last. Sums to
    # `net_worth` month by month by construction — that is what lets the page stack it.
    owner_series: list[OwnerSeries]


class GroupSummary(BaseModel):
    group: str
    total: Decimal
    mom_delta: Decimal | None


class OwnerTotal(BaseModel):
    person_id: int | None
    name: str | None
    total: Decimal


class SummaryOut(BaseModel):
    month: date | None
    net_worth: Decimal | None
    mom_delta: Decimal | None
    mom_pct: Decimal | None
    groups: list[GroupSummary]
    # Beside `groups`, never instead of it: the same latest snapshot split the other way.
    # Empty when there are no snapshots. Sums to `net_worth`.
    owner_totals: list[OwnerTotal]
