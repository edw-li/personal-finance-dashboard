"""Annual money-flow composition for the Overview sankey (2026-08-25 spec §5).

Pure module — no DB, no HTTP (tax_service's posture): the router loads the year's stored
tax inputs/brackets and the calendar year's spending sums, and this module turns them
into ONE reconciled payload. Everything is full-precision Decimal; quantization is the
schema layer's job (the taxes router's `_money` plain-quantize + `+ ZERO`, because half
these figures are engine outputs and engine outputs are unbounded). The ONE exception is
`take_home_pending`: it is an estimate the residual subtracts, so it is rounded before the
subtraction — see the note at its computation.

Conservation is exact by construction, not by rounding luck:
- `sources.other_income` BALANCES the sources column: engine gross_income minus the four
  named sources, so sources always sum to gross. It naturally carries other_income_1099,
  employer HSA, w2_other, and any stored-total-vs-component drift.
- `retained_equity` is the RESIDUAL of the middle column: gross − taxes − pre-tax savings
  − take-home cash − take-home not yet entered (≈ vest shares kept + ESPP contributions +
  W-2-vs-cash timing).
A negative balancing/residual node means the stored inputs contradict each other, and a
sankey ribbon cannot be negative — the payload then says renderable=False with a human
`reason` sentence (the paycheck sankey's refusal posture) while still carrying every
figure it could compute, so the card can say what it knows.

ONE WINDOW ON THE RIGHT (2026-09-23 spec §C1). Income and taxes are the full-year engine
figures and the middle column conserves against them (take-home cash = every entered month,
plus the named estimate for the rest). The spending fan and Saved, though, cover only the
MATCHED months — take-home and spending both entered, the savings module's own rule — so
`saved` IS the Overview YTD card's cash saved for the same months, by construction rather
than by coincidence. A month with pay but no spending sends its take-home to a named
terminal; a month with spending but no pay (the month in progress) is left out and named.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.services.savings import LIVING, TAX, compose_months, rollup
from app.services.tax_service import (
    MISSING_INPUTS_WARNING,
    Bracket,
    EarnerWages,
    TaxBreakdown,
    compute_breakdown,
)
from app.tax_keys import SINGLE

ZERO = Decimal("0")
CENT = Decimal("0.01")
# The wire's two places for a sum that may be empty — an empty window still says 0.00.
ZERO_CENTS = Decimal("0.00")
# The kinds the YTD card's cash saved subtracts (services/savings.py): living spend and tax
# paid from take-home. Transfers are money that stayed yours, so they are not spending here.
CASH_OUTFLOW_KINDS = (LIVING, TAX)
MONTHS_IN_YEAR = 12
# The payload's OWN fold (`categories` + `other_spend`): the top 7 categories by the window's
# sum, the positive remainder folded into "Other". It is the legacy shape, kept for older
# clients and the export. The card re-folds `category_totals` by the Spending page's all-time
# fold (charts/entities.ts, 2026-09-23 spec §C2), so this width no longer mirrors any page.
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
# The same refusal when part of the take-home is an ESTIMATE: it is a real term of the
# subtraction, so leaving it unnamed would send the user hunting for a data error among
# figures that are all correct, when entering the remaining months is the actual fix.
NEGATIVE_RESIDUAL_PENDING_REASON = (
    "Taxes, pre-tax savings, take-home cash and the estimated {pending} of take-home not "
    "yet entered exceed gross income for {year} by {gap} — the retained-equity residual "
    "would be negative. Enter the year's remaining take-home to replace the estimate."
)
BRACKETS_MISSING_REASON = (
    "{year} is filed as {status}, and {jurisdictions} have no bracket table for that status — "
    "enter them on the Taxes page to draw its money flow."
)


def _display(value: Decimal) -> Decimal:
    """2dp HALF_UP for embedding a figure in a reason sentence — reasons are prose, and
    prose carries display-rounded numbers (the payload itself is quantized at the schema
    layer, where the router's `_money` also collapses signed zeros)."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


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


@dataclass(frozen=True)
class FlowSpendingRow:
    """One stored spending cell, with the category facts the window needs."""

    category_id: int
    name: str
    kind: str
    amount: Decimal


@dataclass(frozen=True)
class FlowMonth:
    """One calendar month: its take-home row (None = none entered) and its spending rows
    (None = no rows at all — distinct from rows that are all $0.00, which is a real month
    of spending nothing and matches like any other)."""

    month: date
    net_pay: Decimal | None
    spending: tuple[FlowSpendingRow, ...] | None


@dataclass
class MoneyFlowCategoryTotal:
    """A category's matched-month total — signed (a refund category can net negative).
    `category_id` is what the card folds by (the Spending page's all-time category set)."""

    category_id: int
    name: str
    kind: str
    amount: Decimal


@dataclass
class MatchedWindow:
    """The right-hand side's months (spec §C1). `cash_savings` is `savings.rollup` over the
    matched months — the YTD card's own figure — and `take_home_matched` minus the sum of
    `category_totals` equals it to the cent (both are sums of the same stored cents)."""

    matched_months: list[date]
    take_home_matched: Decimal
    take_home_unmatched: Decimal
    take_home_unmatched_months: list[date]
    spending_unmatched_months: list[date]
    spending_unmatched_total: Decimal
    take_home_pending_months: list[date]
    category_totals: list[MoneyFlowCategoryTotal]
    cash_savings: Decimal
    tracking_start: date | None


def matched_window(
    year: int, months: Sequence[FlowMonth], tracking_start: date | None
) -> MatchedWindow:
    """Split one calendar year's months by which feeds they carry (spec §C1).

    MATCHED = spending rows AND a take-home row — `savings.MonthSavings.matched`, reached by
    calling the savings module itself so the definition cannot drift from the YTD card's.
    Pay-only months are UNMATCHED take-home (the card's named terminal); spending-only
    months are UNMATCHED spending (left out of the fan and named in the card's footer).
    PENDING months are the year's months with no take-home row — exactly the ones
    `take_home_pending` estimates. `tracking_start` (the book's first take-home month) rides
    along so the card can say which of them predate tracking. Rows outside `year` are ignored.
    """
    in_year = sorted((m for m in months if m.month.year == year), key=lambda m: m.month)
    by_kind: dict[date, dict[str, Decimal]] = {}
    for m in in_year:
        if m.spending is None:
            continue
        kinds = by_kind.setdefault(m.month, {})
        for cell in m.spending:
            kinds[cell.kind] = kinds.get(cell.kind, ZERO_CENTS) + cell.amount
    pay = {m.month: m.net_pay for m in in_year if m.net_pay is not None}
    rows = compose_months([m.month for m in in_year], by_kind, pay, {})
    matched = [row.month for row in rows if row.matched]
    matched_set = set(matched)
    # Cash saved is the savings module's figure, never re-derived here: `rollup` sums the
    # months' EMITTED cents exactly as /spending/yearly does for the YTD card.
    period = rollup(rows)

    totals: dict[int, MoneyFlowCategoryTotal] = {}
    for m in in_year:
        if m.month not in matched_set:
            continue
        for cell in m.spending or ():
            if cell.kind not in CASH_OUTFLOW_KINDS:
                continue
            entry = totals.setdefault(
                cell.category_id,
                MoneyFlowCategoryTotal(cell.category_id, cell.name, cell.kind, ZERO_CENTS),
            )
            entry.amount += cell.amount
    # An exact-zero total draws nothing; biggest first, so the payload reads like the card.
    category_totals = sorted(
        (entry for entry in totals.values() if entry.amount != 0),
        key=lambda entry: (-entry.amount, entry.name, entry.category_id),
    )
    pay_only = [m for m in in_year if m.net_pay is not None and m.spending is None]
    spend_only = [m for m in in_year if m.net_pay is None and m.spending is not None]
    return MatchedWindow(
        matched_months=matched,
        take_home_matched=sum((pay[month] for month in matched), ZERO_CENTS),
        take_home_unmatched=sum((pay[m.month] for m in pay_only), ZERO_CENTS),
        take_home_unmatched_months=[m.month for m in pay_only],
        spending_unmatched_months=[m.month for m in spend_only],
        spending_unmatched_total=sum(
            (
                cell.amount
                for m in spend_only
                for cell in m.spending or ()
                if cell.kind in CASH_OUTFLOW_KINDS
            ),
            ZERO_CENTS,
        ),
        take_home_pending_months=[
            date(year, number, 1) for number in range(1, 13) if date(year, number, 1) not in pay
        ],
        category_totals=category_totals,
        cash_savings=ZERO_CENTS if period.cash_savings is None else period.cash_savings,
        tracking_start=tracking_start,
    )


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
    # The year's take-home that HAS been earned but not yet entered: mean of the entered
    # months x the months still missing (2026-09-04 honest-numbers spec §3). Zero on a
    # complete year and on a year with nothing entered — there is no mean to extrapolate.
    # Already CENTS, unlike its siblings: the residual is computed from this rounded
    # figure, so the middle column conserves after the schema layer rounds the rest.
    take_home_pending: Decimal
    take_home_months_entered: int
    retained_equity: Decimal
    # The RIGHT side, over the matched months only (2026-09-23 spec §C1). `categories` /
    # `other_spend` keep their meaning — the top-7 positive fold and its remainder — and
    # `total_spend` is what that fold draws (gross positive). `saved` is the YTD card's cash
    # saved: matched take-home minus matched living + tax spending, refunds netted, so
    # take_home_matched + refunds - total_spend == saved.
    categories: list[MoneyFlowCategory]
    other_spend: Decimal | None
    total_spend: Decimal
    saved: Decimal
    warnings: list[str] = field(default_factory=list)
    take_home_matched: Decimal = ZERO_CENTS
    refunds: Decimal = ZERO_CENTS
    matched_months: list[date] = field(default_factory=list)
    take_home_pending_months: list[date] = field(default_factory=list)
    take_home_unmatched: Decimal = ZERO_CENTS
    take_home_unmatched_months: list[date] = field(default_factory=list)
    spending_unmatched_months: list[date] = field(default_factory=list)
    spending_unmatched_total: Decimal = ZERO_CENTS
    category_totals: list[MoneyFlowCategoryTotal] = field(default_factory=list)
    tracking_start: date | None = None


def compose_money_flow(
    year: int,
    inputs: dict[str, Decimal],
    brackets: dict[str, list[Bracket]],
    net_pay_sum: Decimal,
    net_pay_months: int,
    spending_months: int,
    available_years: list[int],
    *,
    window: MatchedWindow,
    filing_status: str = SINGLE,
    earners: list[EarnerWages] | None = None,
    brackets_missing_for_status: list[str] | tuple[str, ...] = (),
    salary_by_person: list[tuple[str, Decimal]] | None = None,
) -> MoneyFlow:
    """One reconciled year of money flow (spec §5's node table).

    `inputs`/`brackets` are the taxes router's stored shapes, handed to the engine
    verbatim; `net_pay_sum`/`net_pay_months` are the year's monthly_cashflow sum and
    coverage (take-home cash and its estimate — every entered month); `spending_months`
    counts distinct entered spending months. This function never re-derives an engine
    figure: gross income and every tax line are compute_breakdown's own outputs (the
    state-AGI capital-gains fold rides along for free).

    The right-hand side comes from `window` (2026-09-23 spec §C1): its matched-month
    category totals, take-home and cash saved. It is required — the one right side there
    is (the 2026-09-23 code review retired a window-less, name-keyed shorthand that only the
    pure tests used; they build a complete-year window instead).

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
    # A half-entered year used to dump every un-entered month of pay into the residual,
    # so "retained equity" silently meant "equity plus the take-home I have not typed in
    # yet". Naming the estimate is the honest version — the card draws it as its own
    # muted node. ONE division, quantized here rather than at the schema edge (below).
    take_home_pending = ZERO
    if 0 < net_pay_months < MONTHS_IN_YEAR:
        # Quantized HERE, once, rather than at the schema edge like every other figure in
        # this module: the mean repeats, so the estimate and the residual carry mirror-
        # image fractions, and rounding them apart at the wire sends BOTH up — the middle
        # column then overshoots gross by a cent. Rounding before the subtraction makes
        # the residual absorb the remainder, so conservation survives quantization.
        take_home_pending = (
            (net_pay_sum / net_pay_months) * (MONTHS_IN_YEAR - net_pay_months)
        ).quantize(CENT, rounding=ROUND_HALF_UP)
    # RESIDUAL node: the middle column still sums back to gross, now with one more term.
    retained_equity = (
        gross_income - taxes.total - pre_tax_savings - take_home_cash - take_home_pending
    )

    # The right-hand side (spec §C1): one window — the matched months — for the fan AND for
    # Saved. It used to be every entered spending month against every entered take-home
    # month, so a rent-only month in progress was charged against pay that had not been
    # entered for it (production 2026: Saved $148.74 beside the YTD card's $2,220.97).
    right = list(window.category_totals)
    take_home_matched = window.take_home_matched

    # Top-7 + Other fold, positive-only (buildYearSlices' documented rule: a link cannot
    # be negative, so net-refund categories are excluded and the fold restates spending
    # GROSS). Ties break by name so the order is deterministic. The CARD folds by the
    # Spending page's category set instead (from `category_totals`); this list stays for
    # readers of the payload that want the year's own top seven.
    positive = sorted(
        ((entry.name, entry.amount) for entry in right if entry.amount > 0),
        key=lambda entry: (-entry[1], entry[0]),
    )
    categories = [
        MoneyFlowCategory(name=name, amount=amount) for name, amount in positive[:TOP_N_CATEGORIES]
    ]
    folded = sum((amount for _name, amount in positive[TOP_N_CATEGORIES:]), ZERO)
    other_spend = folded if folded > 0 else None
    total_spend = sum((entry.amount for entry in categories), ZERO) + (other_spend or ZERO)
    # A net-refund category cannot be a link; its money came BACK, so it funds the fan as
    # an explicit inflow beside take-home, and the right side conserves with Saved netted.
    refunds = -sum((entry.amount for entry in right if entry.amount < 0), ZERO)
    # SIGNED: the builder draws Saved or Drawdown. This is the savings module's own cash
    # saved — the YTD card's figure — taken verbatim, never re-derived.
    saved = window.cash_savings

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
        reason = (
            NEGATIVE_RESIDUAL_PENDING_REASON.format(
                year=year, gap=_display(-retained_equity), pending=_display(take_home_pending)
            )
            if take_home_pending > 0
            else NEGATIVE_RESIDUAL_REASON.format(year=year, gap=_display(-retained_equity))
        )

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
        take_home_pending=take_home_pending,
        take_home_months_entered=net_pay_months,
        retained_equity=retained_equity,
        categories=categories,
        other_spend=other_spend,
        total_spend=total_spend,
        saved=saved,
        warnings=warnings,
        take_home_matched=take_home_matched,
        refunds=refunds,
        matched_months=list(window.matched_months),
        take_home_pending_months=list(window.take_home_pending_months),
        take_home_unmatched=window.take_home_unmatched,
        take_home_unmatched_months=list(window.take_home_unmatched_months),
        spending_unmatched_months=list(window.spending_unmatched_months),
        spending_unmatched_total=window.spending_unmatched_total,
        category_totals=[entry for entry in right if entry.amount != 0],
        tracking_start=window.tracking_start,
    )
