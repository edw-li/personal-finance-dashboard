from decimal import Decimal

from pydantic import BaseModel, Field


class MoneyFlowPersonSalaryOut(BaseModel):
    name: str
    amount: Decimal


class MoneyFlowSourcesOut(BaseModel):
    salary_and_bonus: Decimal
    rsu_vests: Decimal
    espp: Decimal
    investment_income: Decimal
    # BALANCING node: engine gross minus the four named sources (1099 income, employer
    # HSA, w2_other, and any stored-total-vs-component drift live here).
    other_income: Decimal
    # EMPTY on single, MFS and partner-less years — the card draws today's ONE salary node.
    # Two or more entries (primary first) split it per earner; they sum to
    # `salary_and_bonus`, which stays the household total.
    salary_people: list[MoneyFlowPersonSalaryOut] = Field(default_factory=list)


class MoneyFlowTaxesOut(BaseModel):
    total: Decimal
    federal: Decimal
    state: Decimal
    medicare: Decimal
    social_security: Decimal
    disability: Decimal
    capital_gains: Decimal
    niit: Decimal


class MoneyFlowCategoryOut(BaseModel):
    name: str
    amount: Decimal


class MoneyFlowOut(BaseModel):
    year: int
    # Years having any stored tax inputs — the card's chip row (spec §5).
    available_years: list[int]
    # False + reason when a structural node went negative or the year has no positive
    # gross: the card renders the reason sentence VERBATIM instead of a chart. The
    # figures below are still populated — a refusal explains itself with the numbers it
    # refused over.
    renderable: bool
    reason: str | None
    warnings: list[str]
    sources: MoneyFlowSourcesOut
    gross_income: Decimal
    taxes: MoneyFlowTaxesOut
    pre_tax_savings: Decimal
    take_home_cash: Decimal
    # RESIDUAL: gross − taxes − pre-tax − take-home (≈ vest shares kept + ESPP
    # contributions + W-2-vs-cash timing).
    retained_equity: Decimal
    # Top-7 by the year's sum, biggest first, positive-only (the /spending fold).
    categories: list[MoneyFlowCategoryOut]
    # The folded positive remainder beyond the top 7; None when nothing folded.
    other_spend: Decimal | None
    total_spend: Decimal
    # SIGNED: take_home_cash − total_spend. Negative = the builder draws a red Drawdown
    # source with the spending sankey's pro-rata semantics.
    saved: Decimal
