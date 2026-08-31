"""Annual money-flow composition for the Overview sankey (2026-08-25 spec §5).

Pure module — no DB, no HTTP (tax_service's posture): the router loads the year's stored
tax inputs/brackets and the calendar year's spending sums, and this module turns them
into ONE reconciled payload. Everything is full-precision Decimal; quantization is the
schema layer's job (the taxes router's `_money` plain-quantize + `+ ZERO`, because half
these figures are engine outputs and engine outputs are unbounded).

Conservation is exact by construction, not by rounding luck:
- `sources.other_income` BALANCES the sources column: engine gross_income minus the four
  named sources, so sources always sum to gross. It naturally carries other_income_1099,
  employer HSA, w2_other, and any stored-total-vs-component drift.
- `retained_equity` is the RESIDUAL of the middle column: gross − taxes − pre-tax savings
  − take-home cash (≈ vest shares kept + ESPP contributions + W-2-vs-cash timing).
A negative balancing/residual node means the stored inputs contradict each other, and a
sankey ribbon cannot be negative — the payload then says renderable=False with a human
`reason` sentence (the paycheck sankey's refusal posture) while still carrying every
figure it could compute, so the card can say what it knows.
"""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from app.services.tax_service import (
    MISSING_INPUTS_WARNING,
    Bracket,
    EarnerWages,
    TaxBreakdown,
    compute_breakdown,
)
from app.tax_keys import SINGLE

ZERO = Decimal("0")
MONTHS_IN_YEAR = 12
# The /spending pages' fold width (SpendingPage's TOP_N): top 7 categories by the year's
# sum, the positive remainder folded into "Other".
TOP_N_CATEGORIES = 7

# The named source definitions (spec §5's node table). Investment income is the engine's
# gross-income COMPONENT definition (stcg_standard/ltcg_brokerage, never the netted
# totals), so the balancing node cannot double-count a total against its components.
SALARY_KEYS = ("latest_w2_income", "w2_bonuses", "w2_salary_checkpoint")
RSU_KEY = "w2_stock_rsus_sold"
ESPP_KEY = "w2_espp_sale_component"
INVESTMENT_KEYS = (
    "stcg_standard",
    "unqualified_dividends",
    "interest_total",
    "ltcg_brokerage",
    "qualified_dividends",
    "other_capital_gains",
)
PRETAX_KEYS = ("trad_401k_contributions", "hsa_contributions", "hsa_contributions_employer")

# The engine's own missing-keys warning is EXCLUDED from the passthrough: it names every
# unset form key (normal for a partially entered year — the engine's missing-key-is-zero
# rule is exactly the zero this module uses too) and belongs to the Taxes editor. An
# entirely empty year gets the single NO_INPUTS_WARNING sentence instead.
_ENGINE_MISSING_PREFIX = MISSING_INPUTS_WARNING.split("{keys}")[0]

NO_INPUTS_WARNING = "no tax inputs stored for {year}"
NO_NET_PAY_WARNING = "no net pay entered for {year}"
NET_PAY_COVERAGE_WARNING = "net pay entered {n}/12 months"
NO_SPENDING_WARNING = "no spending entered for {year}"
SPENDING_COVERAGE_WARNING = "spending entered {n}/12 months"
SALARY_SPLIT_MISMATCH_WARNING = (
    "per-person salary rows sum to {split}, not the year's {total} — showing one salary node"
)
BRACKETS_MISSING_WARNING = "no {status} bracket tables for {year}: {jurisdictions}"

NO_INPUTS_REASON = (
    "No tax inputs are stored for {year} — enter the year on the Taxes page to draw its money flow."
)
NON_POSITIVE_GROSS_REASON = (
    "Gross income for {year} is {gross} — the flow needs a positive gross to draw."
)
NEGATIVE_OTHER_INCOME_REASON = (
    "The named income sources exceed the engine's gross income for {year} by {gap} — "
    "check the W-2 component inputs against the stored totals."
)
NEGATIVE_TAXES_REASON = "Total tax for {year} is {taxes} — a negative ribbon cannot be drawn."
NEGATIVE_PRETAX_REASON = (
    "Pre-tax savings for {year} sum to {pretax} — a negative ribbon cannot be drawn."
)
NEGATIVE_RESIDUAL_REASON = (
    "Taxes, pre-tax savings and take-home cash exceed gross income for {year} by {gap} — "
    "the retained-equity residual would be negative."
)
BRACKETS_MISSING_REASON = (
    "{year} is filed as {status}, and {jurisdictions} have no bracket table for that status — "
    "enter them on the Taxes page to draw its money flow."
)


def _display(value: Decimal) -> Decimal:
    """2dp HALF_UP for embedding a figure in a reason sentence — reasons are prose, and
    prose carries display-rounded numbers (the payload itself is quantized at the schema
    layer, where the router's `_money` also collapses signed zeros)."""
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass
class MoneyFlowPersonSalary:
    """One earner's slice of the salary source node (2026-08-27 spec §4.3)."""

    name: str
    amount: Decimal


@dataclass
class MoneyFlowSources:
    salary_and_bonus: Decimal
    rsu_vests: Decimal
    espp: Decimal
    investment_income: Decimal
    other_income: Decimal
    # EMPTY is today's single `Salary & bonus` node, byte-identically — single years,
    # partner-less years and any year whose split does not reconcile. Two or more entries
    # (primary first) split THAT node per earner: they sum to `salary_and_bonus` above,
    # which stays the household total, so nothing downstream of the sources column moves.
    salary_people: list[MoneyFlowPersonSalary] = field(default_factory=list)


@dataclass
class MoneyFlowTaxes:
    total: Decimal
    federal: Decimal
    state: Decimal
    medicare: Decimal
    social_security: Decimal
    disability: Decimal
    capital_gains: Decimal
    niit: Decimal


@dataclass
class MoneyFlowCategory:
    name: str
    amount: Decimal


@dataclass
class MoneyFlow:
    year: int
    available_years: list[int]
    renderable: bool
    reason: str | None
    sources: MoneyFlowSources
    gross_income: Decimal
    taxes: MoneyFlowTaxes
    pre_tax_savings: Decimal
    take_home_cash: Decimal
    retained_equity: Decimal
    categories: list[MoneyFlowCategory]
    other_spend: Decimal | None
    total_spend: Decimal
    saved: Decimal
    warnings: list[str] = field(default_factory=list)


def compose_money_flow(
    year: int,
    inputs: dict[str, Decimal],
    brackets: dict[str, list[Bracket]],
    category_sums: dict[str, Decimal],
    net_pay_sum: Decimal,
    net_pay_months: int,
    spending_months: int,
    available_years: list[int],
    *,
    filing_status: str = SINGLE,
    earners: list[EarnerWages] | None = None,
    brackets_missing_for_status: list[str] | tuple[str, ...] = (),
    salary_by_person: list[tuple[str, Decimal]] | None = None,
) -> MoneyFlow:
    """One reconciled year of money flow (spec §5's node table).

    `inputs`/`brackets` are the taxes router's stored shapes, handed to the engine
    verbatim; `category_sums` is the calendar year's SIGNED per-category spend by name;
    `net_pay_sum`/`net_pay_months` are the year's monthly_cashflow sum and coverage;
    `spending_months` counts distinct entered spending months. This function never
    re-derives an engine figure: gross income and every tax line are compute_breakdown's
    own outputs (the state-AGI capital-gains fold rides along for free).

    `filing_status`/`earners` are passed STRAIGHT THROUGH to the engine, so the card's tax
    decomposition is the same arithmetic the Taxes summary shows — with the defaults, that
    is byte-for-byte today's answer. `salary_by_person` is the ROUTER's per-earner sum of
    the same SALARY_KEYS this function totals (primary first); this module only checks
    that a split IS a split — same money, more nodes — and declines to draw one that is
    not.
    """

    def value(key: str) -> Decimal:
        found = inputs.get(key)
        return ZERO if found is None else found

    breakdown: TaxBreakdown = compute_breakdown(
        year, inputs, brackets, filing_status=filing_status, earners=earners
    )

    salary_and_bonus = sum((value(key) for key in SALARY_KEYS), ZERO)
    rsu_vests = value(RSU_KEY)
    espp = value(ESPP_KEY)
    investment_income = sum((value(key) for key in INVESTMENT_KEYS), ZERO)
    gross_income = breakdown.totals.gross_income
    named = salary_and_bonus + rsu_vests + espp + investment_income
    other_income = gross_income - named  # BALANCING node: sources sum to gross, always

    taxes = MoneyFlowTaxes(
        total=breakdown.totals.total_tax,
        federal=breakdown.federal.tax,
        state=breakdown.state.tax,
        medicare=breakdown.medicare.tax,
        social_security=breakdown.social_security.tax,
        disability=breakdown.disability.tax,
        capital_gains=breakdown.capital_gains.tax,
        # The Overview Taxes node's tooltip enumerates the per-jurisdiction lines against
        # `taxes.total`, which now carries the NIIT surcharge — a missing line would
        # visibly not sum.
        niit=breakdown.niit.tax,
    )
    pre_tax_savings = sum((value(key) for key in PRETAX_KEYS), ZERO)
    take_home_cash = net_pay_sum
    # RESIDUAL node: the middle column always sums back to gross.
    retained_equity = gross_income - taxes.total - pre_tax_savings - take_home_cash

    # Top-7 + Other fold, positive-only (buildYearSlices' documented rule: a link cannot
    # be negative, so net-refund categories are excluded and the fold restates spending
    # GROSS). Ties break by name so the order — and therefore the palette slots the
    # builder assigns — is deterministic.
    positive = sorted(
        ((name, amount) for name, amount in category_sums.items() if amount > 0),
        key=lambda entry: (-entry[1], entry[0]),
    )
    categories = [
        MoneyFlowCategory(name=name, amount=amount) for name, amount in positive[:TOP_N_CATEGORIES]
    ]
    folded = sum((amount for _name, amount in positive[TOP_N_CATEGORIES:]), ZERO)
    other_spend = folded if folded > 0 else None
    total_spend = sum((entry.amount for entry in categories), ZERO) + (other_spend or ZERO)
    saved = take_home_cash - total_spend  # SIGNED: the builder draws Saved or Drawdown

    # Engine warnings first (the summary serializer's convention), ours appended after.
    warnings: list[str] = [
        warning for warning in breakdown.warnings if not warning.startswith(_ENGINE_MISSING_PREFIX)
    ]
    if brackets_missing_for_status:
        warnings.append(
            BRACKETS_MISSING_WARNING.format(
                year=year,
                status=filing_status,
                jurisdictions=", ".join(brackets_missing_for_status),
            )
        )
    if not inputs:
        warnings.append(NO_INPUTS_WARNING.format(year=year))
    if net_pay_months == 0:
        warnings.append(NO_NET_PAY_WARNING.format(year=year))
    elif net_pay_months < MONTHS_IN_YEAR:
        warnings.append(NET_PAY_COVERAGE_WARNING.format(n=net_pay_months))
    if spending_months == 0:
        warnings.append(NO_SPENDING_WARNING.format(year=year))
    elif spending_months < MONTHS_IN_YEAR:
        warnings.append(SPENDING_COVERAGE_WARNING.format(n=spending_months))

    # The per-person split (spec §4.3). Fewer than two entries is not a split at all —
    # one earner keeps the single node — and a sum that misses `salary_and_bonus` is a
    # bug upstream, so the node stays whole and the warning names the discrepancy rather
    # than drawing a column that does not add up.
    salary_people: list[MoneyFlowPersonSalary] = []
    if salary_by_person is not None and len(salary_by_person) > 1:
        split_total = sum((amount for _name, amount in salary_by_person), ZERO)
        if split_total == salary_and_bonus:
            salary_people = [
                MoneyFlowPersonSalary(name=name, amount=amount) for name, amount in salary_by_person
            ]
        else:
            warnings.append(
                SALARY_SPLIT_MISMATCH_WARNING.format(
                    split=_display(split_total), total=_display(salary_and_bonus)
                )
            )

    # Refusal (spec §5 honesty rules): ONE reason, first structural failure wins. A
    # negative saved is NOT here — a deficit is drawable (red Drawdown source). Negative
    # take_home_cash is unreachable (net_pay writes reject negatives).
    reason: str | None = None
    if brackets_missing_for_status:
        # First, ahead of every data reason: with the wrong-status tables absent, the tax
        # ribbons are zeros and the residual is wrong BECAUSE of that. Naming the residual
        # would send the user hunting for a data error that is not there.
        reason = BRACKETS_MISSING_REASON.format(
            year=year,
            status=filing_status,
            jurisdictions=", ".join(brackets_missing_for_status),
        )
    elif gross_income <= 0:
        reason = (
            NO_INPUTS_REASON.format(year=year)
            if not inputs
            else NON_POSITIVE_GROSS_REASON.format(year=year, gross=_display(gross_income))
        )
    elif other_income < 0:
        reason = NEGATIVE_OTHER_INCOME_REASON.format(year=year, gap=_display(-other_income))
    elif taxes.total < 0:
        reason = NEGATIVE_TAXES_REASON.format(year=year, taxes=_display(taxes.total))
    elif pre_tax_savings < 0:
        reason = NEGATIVE_PRETAX_REASON.format(year=year, pretax=_display(pre_tax_savings))
    elif retained_equity < 0:
        reason = NEGATIVE_RESIDUAL_REASON.format(year=year, gap=_display(-retained_equity))

    return MoneyFlow(
        year=year,
        available_years=available_years,
        renderable=reason is None,
        reason=reason,
        sources=MoneyFlowSources(
            salary_and_bonus=salary_and_bonus,
            rsu_vests=rsu_vests,
            espp=espp,
            investment_income=investment_income,
            other_income=other_income,
            salary_people=salary_people,
        ),
        gross_income=gross_income,
        taxes=taxes,
        pre_tax_savings=pre_tax_savings,
        take_home_cash=take_home_cash,
        retained_equity=retained_equity,
        categories=categories,
        other_spend=other_spend,
        total_spend=total_spend,
        saved=saved,
        warnings=warnings,
    )
