import re
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import ACCOUNT_GROUPS

# The two suggestion kinds shipped in v1 (spec 2026-08-21 §5.2): a portfolio bucket keyed
# by its transactions `account` label, and the vesting schedule's unvested value. The
# label is free text, so anything non-empty passes; the kind vocabulary is closed.
SUGGEST_SOURCE_SHAPE = re.compile(r"^(portfolio:.+|vesting:unvested)$")


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
    suggest_source: str | None


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    group: str
    # int32-safe and generous; sheet column indexes top out at 51.
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
    is_component: bool = False

    group_known = field_validator("group")(_check_group)


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    group: str | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
    is_active: bool | None = None
    is_component: bool | None = None
    # Bounded to the column width (name's rule): an over-long label must 422 here, never
    # surface asyncpg's "value too long for type character varying(200)" as a 500.
    suggest_source: str | None = Field(default=None, max_length=200)

    @field_validator("group")
    @classmethod
    def group_known(cls, value: str | None) -> str | None:
        return None if value is None else _check_group(value)

    @field_validator("suggest_source")
    @classmethod
    def suggest_source_known(cls, value: str | None) -> str | None:
        # The two shipped kinds (spec §5.2). An explicit null is the CLEAR and is
        # distinguished from omitted by model_fields_set in the handler.
        if value is None or SUGGEST_SOURCE_SHAPE.fullmatch(value):
            return value
        raise ValueError("suggest_source must be 'portfolio:<account-label>' or 'vesting:unvested'")


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


class SuggestionOut(BaseModel):
    account_id: int
    # Echoed back so the client can label the chip without re-reading the account list.
    source: str
    value: Decimal


class SuggestionsOut(BaseModel):
    suggestions: list[SuggestionOut]
    # One line per mapping that could not be resolved, naming the account. Advisory: the
    # wizard shows them above the table and still renders every other chip.
    warnings: list[str]
