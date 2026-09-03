from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.credit_cards import REWARDS_CURRENCIES


def _stripped_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


# The wire vocabulary, spelled as a Literal so a bad value 422s in the parser and the
# OpenAPI schema carries the union. models.credit_cards.CREDIT_RESET_CADENCES is the same
# two words at the DB check constraint; test_credit_cards_api pins them against each other.
CreditResetCadence = Literal["calendar", "anniversary"]


class CardCreditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    annual_value: Decimal
    counts: bool
    reset_cadence: CreditResetCadence


class CardCreditIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    annual_value: Decimal
    counts: bool = True
    # When the credit resets (2026-09-03 calendar spec §6): the calendar year (Jan 1) or the
    # card's opened_on anniversary. The default keeps v1 clients valid.
    reset_cadence: CreditResetCadence = "calendar"

    @field_validator("label")
    @classmethod
    def _label_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("label must not be blank")
        return value


class CreditLimitEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    effective_date: date
    limit_amount: Decimal
    note: str | None


class CreditLimitEventIn(BaseModel):
    effective_date: date
    limit_amount: Decimal
    note: str | None = Field(default=None, max_length=120)

    @field_validator("note")
    @classmethod
    def _note_blank_to_none(cls, value: str | None) -> str | None:
        return _stripped_or_none(value)


class CreditCardOut(BaseModel):
    id: int
    name: str
    slug: str
    annual_fee: Decimal
    rewards_currency: str
    point_value_cents: Decimal
    person_id: int | None
    primary_holder: str | None
    authorized_users: str | None
    opened_on: date | None
    is_active: bool
    account_id: int | None
    notes: str | None
    sort_order: int
    credits: list[CardCreditOut]
    current_limit: Decimal | None
    limit_events: list[CreditLimitEventOut]


class CreditCardIn(BaseModel):
    """POST and PATCH body — the FULL card, house full-replace style."""

    name: str = Field(min_length=1, max_length=120)
    annual_fee: Decimal = Decimal("0")
    rewards_currency: str
    point_value_cents: Decimal = Decimal("1")
    # NULL = joint. The bound mirrors account_id's: a person id is a plain int PK, and a
    # 10-digit garbage value must 422 in the parser rather than reach the FK.
    person_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    primary_holder: str | None = Field(default=None, max_length=80)
    authorized_users: str | None = Field(default=None, max_length=200)
    opened_on: date | None = None
    is_active: bool = True
    account_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    notes: str | None = Field(default=None, max_length=300)
    sort_order: int = Field(default=0, ge=0, le=1_000_000)

    @field_validator("rewards_currency")
    @classmethod
    def _known_currency(cls, value: str) -> str:
        if value not in REWARDS_CURRENCIES:
            raise ValueError(f"rewards_currency must be one of {', '.join(REWARDS_CURRENCIES)}")
        return value

    @field_validator("primary_holder", "authorized_users", "notes")
    @classmethod
    def _blank_to_none(cls, value: str | None) -> str | None:
        return _stripped_or_none(value)


class RewardCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    sort_order: int
    is_active: bool
    annual_spend: Decimal | None
    spending_category_id: int | None
    pinned_card_id: int | None


class RewardCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
    annual_spend: Decimal | None = None
    spending_category_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    pinned_card_id: int | None = Field(default=None, ge=1, le=2_147_483_647)


class RewardCategoryUpdate(BaseModel):
    """PATCH semantics: OMITTED = untouched; explicit null CLEARS a nullable column
    (annual_spend / spending_category_id / pinned_card_id). The three NOT NULL fields
    ignore explicit nulls (the spending-categories precedent)."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
    is_active: bool | None = None
    annual_spend: Decimal | None = None
    spending_category_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
    pinned_card_id: int | None = Field(default=None, ge=1, le=2_147_483_647)


class RewardRateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    card_id: int
    category_id: int
    multiplier: Decimal
    note: str | None
    monthly_cap: Decimal | None


class RewardRatePut(BaseModel):
    """One bulk-save cell. multiplier null = DELETE the cell (back to N/A)."""

    card_id: int = Field(ge=1, le=2_147_483_647)
    category_id: int = Field(ge=1, le=2_147_483_647)
    multiplier: Decimal | None
    note: str | None = Field(default=None, max_length=120)
    monthly_cap: Decimal | None = None

    @field_validator("note")
    @classmethod
    def _note_blank_to_none(cls, value: str | None) -> str | None:
        return _stripped_or_none(value)
