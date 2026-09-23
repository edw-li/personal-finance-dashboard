from datetime import date
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


class MoneyFlowCategoryTotalOut(BaseModel):
    """One category's total over the matched months (2026-09-23 spec §C1) — SIGNED: a
    refund category can net negative. The card folds these by the Spending page's own
    category set (by id), so a category keeps one colour on every chart."""

    category_id: int
    name: str
    # "living" or "tax": the kinds cash saved subtracts — transfers are never listed.
    kind: str
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
    # The take-home of the year's months that have NOT been entered, estimated from the
    # mean of the ones that have (2026-09-04 honest-numbers spec §3). 0.00 on a complete
    # year. The sankey draws it as a muted dashed node beside take-home.
    take_home_pending: Decimal
    take_home_months_entered: int
    # RESIDUAL: gross − taxes − pre-tax − take-home − take-home not yet entered (≈ vest
    # shares kept + ESPP contributions + W-2-vs-cash timing).
    retained_equity: Decimal
    # THE RIGHT SIDE covers the MATCHED months only — take-home and spending both entered
    # (2026-09-23 spec §C1), the months the Overview YTD card's cash saved is summed over.
    # Top-7 by the matched months' sum, biggest first, positive-only.
    categories: list[MoneyFlowCategoryOut]
    # The folded positive remainder beyond the top 7; None when nothing folded.
    other_spend: Decimal | None
    # What the fold draws: the matched months' positive category totals.
    total_spend: Decimal
    # SIGNED: the YTD card's cash saved for the same months — matched take-home minus the
    # matched months' living + tax spending, refunds netted, transfers excluded. Identity:
    # take_home_matched + refunds − total_spend == saved. Negative = the builder draws a red
    # Drawdown source with the spending sankey's pro-rata semantics.
    saved: Decimal
    # The take-home of the matched months (the fan's funding) — take_home_cash minus
    # take_home_unmatched.
    take_home_matched: Decimal
    # Minus the sum of net-negative category totals: money that came back, drawn as an
    # explicit inflow beside take-home so the fan conserves with Saved netted.
    refunds: Decimal
    matched_months: list[date] = Field(default_factory=list)
    # The months take_home_pending estimates (no take-home row) — the card names them.
    take_home_pending_months: list[date] = Field(default_factory=list)
    # Take-home of months with no spending rows: a named terminal, not part of Saved.
    take_home_unmatched: Decimal
    take_home_unmatched_months: list[date] = Field(default_factory=list)
    # Spending of months with no take-home (the month in progress): left out of the fan and
    # named in the card's footer. Living + tax, netted — the kinds Saved subtracts.
    spending_unmatched_months: list[date] = Field(default_factory=list)
    spending_unmatched_total: Decimal
    # Every living and tax category's matched-month total — transfers excluded (they stay
    # yours, as the YTD card's cash saved has it), exact zeros omitted — biggest first.
    category_totals: list[MoneyFlowCategoryTotalOut] = Field(default_factory=list)
    # The book's first take-home month: pending months before it predate tracking.
    tracking_start: date | None = None
