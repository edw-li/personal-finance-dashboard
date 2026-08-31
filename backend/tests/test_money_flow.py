"""Pure-service tests for the Overview money-flow composition (2026-08-25 spec §5).

No DB, no HTTP — compose_money_flow is handed dicts. Engine-derived expectations are
asserted THROUGH compute_breakdown (never hand-derived: state AGI now folds capital
gains in, and these tests must not re-implement the engine); the plain input sums (the
named sources, pre-tax savings) are hand-checkable because they never touch the engine,
and the main fixture is deliberately CG-free so even its engine figures are stable.
"""

from decimal import ROUND_HALF_UP, Decimal

from app.services.money_flow import (
    NEGATIVE_RESIDUAL_REASON,
    NEGATIVE_TAXES_REASON,
    NET_PAY_COVERAGE_WARNING,
    NO_INPUTS_REASON,
    NO_INPUTS_WARNING,
    NO_NET_PAY_WARNING,
    NO_SPENDING_WARNING,
    SPENDING_COVERAGE_WARNING,
    compose_money_flow,
)
from app.services.tax_service import compute_breakdown

D = Decimal

# Flat single-bracket tables for every jurisdiction: no cap rows, no NIIT advisory
# (it needs >= 3 capital-gains brackets), no missing-jurisdiction warnings.
BRACKETS = {
    "federal": [(D("0.10"), D("0"))],
    "state": [(D("0.05"), D("0"))],
    "medicare": [(D("0.0145"), D("0"))],
    "social_security": [(D("0.062"), D("0"))],
    "disability": [(D("0.011"), D("0"))],
    "capital_gains": [(D("0.15"), D("0"))],
}

# CG-free (every capital-gains key absent): the state-AGI capital-gains fold cannot move
# these figures, whatever the engine does to CG years.
INPUTS = {
    "latest_w2_income": D("200000"),
    "w2_bonuses": D("15000"),
    "w2_salary_checkpoint": D("5000"),
    "w2_stock_rsus_sold": D("80000"),
    "w2_espp_sale_component": D("4000"),
    # Exactly the sheet's other_w2_income component sum (rsu + bonuses + checkpoint +
    # espp, employer-HSA/w2_other at 0), so the balancing node below reduces to the one
    # income line the named sources do NOT carry: other_income_1099 = 1000.
    "other_w2_income": D("104000"),
    "stcg_standard": D("1200"),
    "stcg_total": D("1200"),
    "unqualified_dividends": D("800"),
    "interest_total": D("500"),
    "other_income_1099": D("1000"),
    "trad_401k_contributions": D("23000"),
    "hsa_contributions": D("4000"),
    "hsa_contributions_employer": D("300"),
    "standard_deduction": D("15000"),
}

CATEGORY_SUMS = {
    "Rent": D("24000.00"),
    "Food": D("6000.00"),
    "Travel": D("4200.00"),
    "Utilities": D("3000.00"),
    "Insurance": D("2400.00"),
    "Fun": D("1800.00"),
    "Fitness": D("1200.00"),
    "Gifts": D("900.00"),
    "Misc": D("500.00"),
    "Refunds": D("-25.00"),  # net-refund year: excluded by the positive-only fold
}


def compose(**over):
    kwargs = dict(
        year=2026,
        inputs=INPUTS,
        brackets=BRACKETS,
        category_sums=CATEGORY_SUMS,
        net_pay_sum=D("120000.00"),
        net_pay_months=12,
        spending_months=12,
        available_years=[2024, 2025, 2026],
    )
    kwargs.update(over)
    return compose_money_flow(**kwargs)


def test_named_sources_balancing_node_and_engine_figures():
    flow = compose()
    assert flow.year == 2026
    assert flow.available_years == [2024, 2025, 2026]
    # Named sources are plain input sums (spec §5's node table) — hand-checkable.
    assert flow.sources.salary_and_bonus == D("220000")  # 200000 + 15000 + 5000
    assert flow.sources.rsu_vests == D("80000")
    assert flow.sources.espp == D("4000")
    assert flow.sources.investment_income == D("2500")  # 1200 + 800 + 500 (+ 0 CG keys)
    # Gross and every tax line are ENGINE outputs, asserted through the engine itself.
    breakdown = compute_breakdown(2026, INPUTS, BRACKETS)
    assert flow.gross_income == breakdown.totals.gross_income
    # The BALANCING node: with other_w2_income stored at its component sum, exactly the
    # 1099 line remains.
    assert flow.sources.other_income == D("1000")
    assert flow.taxes.total == breakdown.totals.total_tax
    assert flow.taxes.federal == breakdown.federal.tax
    assert flow.taxes.state == breakdown.state.tax
    assert flow.taxes.medicare == breakdown.medicare.tax
    assert flow.taxes.social_security == breakdown.social_security.tax
    assert flow.taxes.disability == breakdown.disability.tax
    assert flow.taxes.capital_gains == breakdown.capital_gains.tax
    assert flow.taxes.niit == breakdown.niit.tax
    assert flow.pre_tax_savings == D("27300")  # 23000 + 4000 + 300
    assert flow.take_home_cash == D("120000.00")
    assert flow.renderable is True
    assert flow.reason is None
    assert flow.warnings == []


def test_conservation_is_exact_by_construction():
    flow = compose()
    sources = flow.sources
    assert (
        sources.salary_and_bonus
        + sources.rsu_vests
        + sources.espp
        + sources.investment_income
        + sources.other_income
        == flow.gross_income
    )
    assert (
        flow.taxes.total + flow.pre_tax_savings + flow.take_home_cash + flow.retained_equity
        == flow.gross_income
    )
    assert flow.saved == flow.take_home_cash - flow.total_spend


def test_conservation_holds_on_a_cg_carrying_year_too():
    # CG inputs present: every engine figure is taken FROM the engine (state AGI now
    # folds cg_amount in — hand-derived goldens are banned here), and both identities
    # must still be exact at full precision.
    inputs = {
        **INPUTS,
        "ltcg_total": D("30000"),
        "ltcg_brokerage": D("30000"),
        "qualified_dividends": D("2000"),
        "other_capital_gains": D("500"),
    }
    flow = compose(inputs=inputs)
    breakdown = compute_breakdown(2026, inputs, BRACKETS)
    assert flow.gross_income == breakdown.totals.gross_income
    assert flow.taxes.total == breakdown.totals.total_tax
    assert flow.taxes.state == breakdown.state.tax
    # investment_income gains the three CG components: 2500 + 30000 + 2000 + 500.
    assert flow.sources.investment_income == D("35000")
    sources = flow.sources
    assert (
        sources.salary_and_bonus
        + sources.rsu_vests
        + sources.espp
        + sources.investment_income
        + sources.other_income
        == flow.gross_income
    )
    assert (
        flow.taxes.total + flow.pre_tax_savings + flow.take_home_cash + flow.retained_equity
        == flow.gross_income
    )
    assert flow.renderable is True


def test_category_fold_top7_plus_other_positive_only():
    flow = compose()
    assert [(c.name, c.amount) for c in flow.categories] == [
        ("Rent", D("24000.00")),
        ("Food", D("6000.00")),
        ("Travel", D("4200.00")),
        ("Utilities", D("3000.00")),
        ("Insurance", D("2400.00")),
        ("Fun", D("1800.00")),
        ("Fitness", D("1200.00")),
    ]
    # Gifts + Misc fold into Other; the net-refund category is EXCLUDED — a link cannot
    # be negative, so the fold restates spending GROSS (buildYearSlices' documented rule).
    assert flow.other_spend == D("1400.00")
    assert flow.total_spend == D("44000.00")
    assert flow.saved == D("76000.00")


def test_fold_with_seven_or_fewer_categories_has_no_other():
    flow = compose(category_sums={"Rent": D("2000.00"), "Food": D("500.00")})
    assert [c.name for c in flow.categories] == ["Rent", "Food"]
    assert flow.other_spend is None
    assert flow.total_spend == D("2500.00")


def test_saved_goes_negative_as_a_drawdown_figure_not_a_refusal():
    flow = compose(net_pay_sum=D("40000.00"))
    assert flow.saved == D("-4000.00")
    # Nothing STRUCTURAL broke: a deficit year is drawable (the builder adds a red
    # Drawdown source, the spending sankey's semantics), so no refusal here.
    assert flow.renderable is True


def test_negative_other_income_refuses_with_reason_and_still_carries_figures():
    # Dropping the stored other_w2_income total below its own components makes the named
    # sources exceed engine gross — the classic stored-total-vs-component drift.
    inputs = {**INPUTS, "other_w2_income": D("0")}
    flow = compose(inputs=inputs)
    assert flow.renderable is False
    assert flow.sources.other_income == D("-103000")
    assert flow.reason == (
        "The named income sources exceed the engine's gross income for 2026 by 103000.00 "
        "— check the W-2 component inputs against the stored totals."
    )
    # The refusal still returns every figure it could compute (spec §5).
    assert flow.gross_income == compute_breakdown(2026, inputs, BRACKETS).totals.gross_income
    assert flow.take_home_cash == D("120000.00")
    assert flow.total_spend == D("44000.00")


def test_negative_pretax_savings_refuses():
    # A negative stored contribution (a correction entry keyed the wrong way) drags the
    # pre-tax sum below zero. Plain input sums, so the figure is hand-checkable:
    # -5000 + 4000 + 300. It reaches its own branch because every earlier one is clean —
    # gross is positive, other_income is still 1000, and the flat brackets keep total tax
    # positive.
    flow = compose(inputs={**INPUTS, "trad_401k_contributions": D("-5000")})
    assert flow.renderable is False
    assert flow.pre_tax_savings == D("-700")
    assert flow.reason == (
        "Pre-tax savings for 2026 sum to -700.00 — a negative ribbon cannot be drawn."
    )
    # A refusal still carries what it could compute (spec §5).
    assert flow.sources.other_income == D("1000")
    assert flow.total_spend == D("44000.00")


def test_negative_total_tax_refuses():
    # NOT a defensive branch: the engine subtracts state_exemption_credits from the state
    # walk WITHOUT clamping (it only warns), and total_tax sums that raw — so a large
    # enough credit really does drive the total negative. Engine-derived, so the figure in
    # the sentence is taken FROM the engine.
    inputs = {"latest_w2_income": D("100000"), "state_exemption_credits": D("500000")}
    flow = compose(inputs=inputs)
    breakdown = compute_breakdown(2026, inputs, BRACKETS)
    assert flow.renderable is False
    assert flow.taxes.total == breakdown.totals.total_tax
    assert flow.taxes.total < 0
    assert flow.reason == NEGATIVE_TAXES_REASON.format(
        year=2026,
        taxes=breakdown.totals.total_tax.quantize(D("0.01"), rounding=ROUND_HALF_UP),
    )
    # The engine's own advisory rides along on the passthrough.
    assert "state tax negative after exemption credits" in flow.warnings
    # The sources column is still balanced — this refusal is about the middle column only.
    assert flow.sources.other_income == D("0")


def test_negative_residual_refuses():
    flow = compose(net_pay_sum=D("400000.00"))
    assert flow.renderable is False
    assert flow.retained_equity < 0
    # The gap is engine-derived, so derive it through the engine here too.
    breakdown = compute_breakdown(2026, INPUTS, BRACKETS)
    gap = -(
        breakdown.totals.gross_income - breakdown.totals.total_tax - D("27300") - D("400000.00")
    )
    assert flow.reason == NEGATIVE_RESIDUAL_REASON.format(
        year=2026, gap=gap.quantize(D("0.01"), rounding=ROUND_HALF_UP)
    )


def test_non_positive_gross_with_data_present_refuses():
    flow = compose(inputs={"latest_w2_income": D("-50000")})
    assert flow.renderable is False
    assert flow.reason == (
        "Gross income for 2026 is -50000.00 — the flow needs a positive gross to draw."
    )


def test_empty_year_refuses_with_the_no_inputs_sentence():
    flow = compose(
        inputs={},
        category_sums={},
        net_pay_sum=D("0.00"),
        net_pay_months=0,
        spending_months=0,
        available_years=[],
    )
    assert flow.renderable is False
    assert flow.reason == NO_INPUTS_REASON.format(year=2026)
    assert NO_INPUTS_WARNING.format(year=2026) in flow.warnings
    assert flow.available_years == []
    assert flow.gross_income == D("0")


def test_coverage_warnings_partial_months_in_order():
    flow = compose(net_pay_months=7, spending_months=5)
    # Full-list equality pins the warning ORDER: engine passthrough (none here) first,
    # then net-pay coverage, then spending coverage.
    assert flow.warnings == [
        NET_PAY_COVERAGE_WARNING.format(n=7),
        SPENDING_COVERAGE_WARNING.format(n=5),
    ]
    assert flow.renderable is True


def test_coverage_warnings_zero_months():
    flow = compose(net_pay_sum=D("0.00"), net_pay_months=0, category_sums={}, spending_months=0)
    assert NO_NET_PAY_WARNING.format(year=2026) in flow.warnings
    assert NO_SPENDING_WARNING.format(year=2026) in flow.warnings
    # Take-home 0 is NOT a refusal: the left half still draws; Saved/Drawdown and the
    # category fan simply vanish (zero branches are omitted by the builder).
    assert flow.renderable is True
    assert flow.take_home_cash == D("0.00")
    assert flow.saved == D("0.00")


def test_engine_bracket_warnings_pass_through_and_missing_keys_do_not():
    brackets = {name: table for name, table in BRACKETS.items() if name != "state"}
    flow = compose(brackets=brackets)
    assert "no state brackets for 2026: state tax computed as 0" in flow.warnings
    # The engine's missing-keys sentence is the Taxes editor's, not this card's: INPUTS
    # leaves several engine keys unset, so the engine DID emit it — and it must not
    # reach the payload.
    assert not any(w.startswith("missing inputs defaulted to 0") for w in flow.warnings)


# --- filing status passthrough (2026-08-26 spec §5.5) ---


def test_filing_status_and_earners_reach_the_engine():
    """The card's tax decomposition IS compute_breakdown's output, so it has to be handed
    the same status and the same wage split the summary uses — otherwise the Overview
    total and the Taxes total disagree on a married year."""
    from app.services.tax_service import EarnerWages

    earners = [EarnerWages(w2_wages=D("120000")), EarnerWages(w2_wages=D("110000"))]
    brackets = dict(BRACKETS) | {"social_security": [(D("0.062"), D("0")), (D("0"), D("150000"))]}
    inputs = dict(INPUTS) | {"latest_w2_income": D("230000"), "other_w2_income": D("0")}

    shared = compose_money_flow(
        year=2026,
        inputs=inputs,
        brackets=brackets,
        category_sums={},
        net_pay_sum=D("0"),
        net_pay_months=0,
        spending_months=0,
        available_years=[2026],
    )
    split = compose_money_flow(
        year=2026,
        inputs=inputs,
        brackets=brackets,
        category_sums={},
        net_pay_sum=D("0"),
        net_pay_months=0,
        spending_months=0,
        available_years=[2026],
        filing_status="married_joint",
        earners=earners,
    )
    # One shared base: 150000 x .062. Two bases: 230000 x .062.
    assert shared.taxes.social_security == D("150000") * D("0.062")
    assert split.taxes.social_security == D("230000") * D("0.062")
    assert split.taxes.total > shared.taxes.total


def test_missing_status_brackets_refuse_to_render():
    from app.services.money_flow import BRACKETS_MISSING_REASON, BRACKETS_MISSING_WARNING

    flow = compose_money_flow(
        year=2026,
        inputs=INPUTS,
        brackets={},
        category_sums={"Groceries": D("1000")},
        net_pay_sum=D("50000"),
        net_pay_months=12,
        spending_months=12,
        available_years=[2026],
        filing_status="married_joint",
        brackets_missing_for_status=["federal", "medicare"],
    )
    assert flow.renderable is False
    assert flow.reason == BRACKETS_MISSING_REASON.format(
        year=2026, status="married_joint", jurisdictions="federal, medicare"
    )
    # It wins the ladder: with no tables the residual would ALSO be wrong, and naming the
    # residual would send the user hunting for a data error that is not there.
    assert (
        BRACKETS_MISSING_WARNING.format(
            year=2026, status="married_joint", jurisdictions="federal, medicare"
        )
        in flow.warnings
    )
    # Everything it COULD compute still rides along (the module's stated posture).
    assert flow.take_home_cash == D("50000")
    assert flow.total_spend == D("1000")


# --- the per-person salary split (2026-08-27 spec §4.3) ---


def test_salary_splits_per_person_without_touching_conservation():
    flow = compose(salary_by_person=[("Me", D("160000")), ("Sam", D("60000"))])
    # The SPLIT is new; the node it splits is not: 200000 + 15000 + 5000 unchanged.
    assert flow.sources.salary_and_bonus == D("220000")
    assert [(entry.name, entry.amount) for entry in flow.sources.salary_people] == [
        ("Me", D("160000")),
        ("Sam", D("60000")),
    ]
    # Conservation is the whole contract and it is one node split in two, nothing else.
    named = (
        flow.sources.salary_and_bonus
        + flow.sources.rsu_vests
        + flow.sources.espp
        + flow.sources.investment_income
        + flow.sources.other_income
    )
    assert named == flow.gross_income
    assert (
        flow.taxes.total + flow.pre_tax_savings + flow.take_home_cash + flow.retained_equity
        == flow.gross_income
    )
    assert flow.renderable is True
    assert flow.warnings == compose().warnings


def test_a_single_entry_is_not_a_split():
    # One earner is not two nodes with one missing — it is today's single node.
    assert compose(salary_by_person=[("Me", D("220000"))]).sources.salary_people == []
    assert compose(salary_by_person=[]).sources.salary_people == []
    assert compose().sources.salary_people == []


def test_a_split_that_does_not_sum_to_the_salary_node_is_refused_with_a_warning():
    # Not a refusal to RENDER: the card still draws, with the one node it can prove. A
    # split that does not add up would put a lie in the chart's own conservation.
    flow = compose(salary_by_person=[("Me", D("160000")), ("Sam", D("50000"))])
    assert flow.sources.salary_people == []
    assert flow.renderable is True
    assert (
        "per-person salary rows sum to 210000.00, not the year's 220000.00 — "
        "showing one salary node"
    ) in flow.warnings
