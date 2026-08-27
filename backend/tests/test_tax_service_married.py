"""Married-filing engine goldens: per-earner payroll walks + status-selected thresholds.

Hand-computed against a SYNTHETIC year with deliberately round MFJ tables — nothing here
comes from the workbook, because the workbook is a single filer. The arithmetic is spelled
out in comments so a moved number points at a specific term rather than at "the engine".

The single-filer path is pinned next door in test_tax_service.py and must not move: the
first test below is the byte-identity proof — every golden year, computed through the new
`earners` parameter, equals the same year computed the old way, field for field.
"""

from decimal import ROUND_HALF_UP, Decimal

import pytest

from app.services.tax_service import (
    EarnerWages,
    compute_breakdown,
    earner_from_inputs,
    niit_advisory,
)
from app.tax_keys import MARRIED_JOINT, MARRIED_SEPARATE, SINGLE
from tests.test_tax_service import YEAR_BRACKETS, YEAR_INPUTS, YEARS, actuals

CENT = Decimal("0.01")
D = Decimal


def cents(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------------------
# The default path is the synthesized single bundle, exactly
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("year", YEARS)
def test_explicit_single_earner_equals_the_default_path(year):
    """`earners=None` must be indistinguishable from handing the engine the one bundle it
    would have synthesized — this is what keeps the golden suite honest."""
    default = compute_breakdown(year, YEAR_INPUTS[year], YEAR_BRACKETS[year])
    explicit = compute_breakdown(
        year,
        YEAR_INPUTS[year],
        YEAR_BRACKETS[year],
        filing_status=SINGLE,
        earners=[earner_from_inputs(YEAR_INPUTS[year])],
    )
    assert actuals(explicit) == actuals(default)
    assert explicit.warnings == default.warnings
    for family in ("medicare", "social_security", "disability"):
        one, two = getattr(default, family), getattr(explicit, family)
        assert (one.w2_income, one.taxable_wages, one.tax, one.effective_rate) == (
            two.w2_income,
            two.taxable_wages,
            two.tax,
            two.effective_rate,
        ), family


def test_empty_earner_list_is_not_a_bundle():
    """An empty list is not "one earner with nothing" — it is no wage data at all, and it
    must read like a year with no W-2 rather than crash a sum."""
    breakdown = compute_breakdown(2024, YEAR_INPUTS[2024], YEAR_BRACKETS[2024], earners=[])
    assert breakdown.medicare.w2_income == Decimal("0")
    assert breakdown.social_security.tax == Decimal("0")
    assert breakdown.disability.tax == Decimal("0")
    # The income chains are untouched: FICA is the only thing earners describe.
    assert breakdown.federal.agi == Decimal("211776.2")


# --------------------------------------------------------------------------------------
# The MFJ reference year
# --------------------------------------------------------------------------------------

MFJ_YEAR = 2026

# Round tables so every walk below is checkable by hand. The three status-sensitive
# thresholds are the point: the medicare additional tier sits at MFJ's 250000 (a single
# filer's table would put it at 200000), and the SS wage base / SDI pseudo-cap are per
# PERSON parameters that the aggregate model applied once.
MFJ_BRACKETS: dict[str, list[tuple[Decimal, Decimal]]] = {
    "federal": [(D("0.10"), D("0")), (D("0.22"), D("100000")), (D("0.32"), D("300000"))],
    "state": [(D("0.02"), D("0")), (D("0.06"), D("50000")), (D("0.10"), D("200000"))],
    "medicare": [(D("0.0145"), D("0")), (D("0.0235"), D("250000"))],
    "social_security": [(D("0.062"), D("0")), (D("0"), D("180000"))],
    "disability": [(D("0.01"), D("0")), (D("0"), D("200000"))],
    "capital_gains": [(D("0"), D("0")), (D("0.188"), D("100000")), (D("0.238"), D("600000"))],
}

# Household-level lines (one row each in the DB, person_id NULL).
MFJ_HOUSEHOLD = {
    "stcg_total": D("0"),
    "stcg_standard": D("0"),
    "unqualified_dividends": D("1000"),
    "unq_div_us_treasuries_etf": D("0"),
    "unq_div_state_exempt_pct": D("0"),
    "interest_total": D("2000"),
    "other_income_1099": D("0"),
    "standard_deduction": D("30000"),
    "itemized_deduction": D("0"),
    "state_standard_deduction": D("11000"),
    "state_exemption_credits": D("300"),
    "ltcg_total": D("40000"),
    "ltcg_brokerage": D("40000"),
    "qualified_dividends": D("5000"),
    "other_capital_gains": D("0"),
}

# Per-person lines. A is over the 180000 SS wage base, B is well under it — the two cases
# the aggregate model could not tell apart.
EARNER_A = {
    "latest_w2_income": D("150000"),
    "other_w2_income": D("50000"),
    "trad_401k_contributions": D("20000"),
    "hsa_contributions": D("5000"),
    "hsa_contributions_employer": D("1000"),
    "other_pretax_deductions": D("300"),
}
EARNER_B = {
    "latest_w2_income": D("100000"),
    "other_w2_income": D("0"),
    "trad_401k_contributions": D("10000"),
    "hsa_contributions": D("0"),
    "hsa_contributions_employer": D("0"),
    "other_pretax_deductions": D("200"),
}


def summed(*bundles: dict[str, Decimal]) -> dict[str, Decimal]:
    """What the API's per-key SUM hands the engine: household rows plus every person's."""
    values = dict(MFJ_HOUSEHOLD)
    for bundle in bundles:
        for key, amount in bundle.items():
            values[key] = values.get(key, D("0")) + amount
    return values


MFJ_INPUTS = summed(EARNER_A, EARNER_B)
MFJ_EARNERS = [earner_from_inputs(EARNER_A), earner_from_inputs(EARNER_B)]


def mfj_breakdown():
    return compute_breakdown(
        MFJ_YEAR,
        MFJ_INPUTS,
        MFJ_BRACKETS,
        filing_status=MARRIED_JOINT,
        earners=MFJ_EARNERS,
    )


def test_mfj_reference_year_to_the_cent():
    breakdown = mfj_breakdown()
    assert breakdown.warnings == []  # every key present, every table present, rates agree

    # Federal: income 250000 + 50000 + 1000 + 2000 = 303000; pre-tax 30000 + 5000 + 1000
    # + 500 = 36500 -> AGI 266500. Deduction max(30000, 0). TI 236500.
    # Tax = 100000x.10 + 136500x.22 = 10000 + 30030.
    assert breakdown.federal.agi == D("266500")
    assert breakdown.federal.taxable_income == D("236500")
    assert cents(breakdown.federal.tax) == D("40030.00")

    # Capital gains: LTCG 40000 is a gain, so everything nets -> 40000 + 5000 + 0.
    assert breakdown.capital_gains.gains_amount == D("45000")
    # Stacked on TI 236500 -> [236500, 281500], entirely inside the 18.8% tier.
    assert cents(breakdown.capital_gains.tax) == D("8460.00")

    # State: AGI = 266500 - 0 (no treasury slice) + 5000 + 1000 (HSA addbacks) + 45000
    # (the CA capital-gains fold) = 317500. TI = 306500.
    # Tax = 50000x.02 + 150000x.06 + 106500x.10 - 300 = 1000 + 9000 + 10650 - 300.
    assert breakdown.state.agi == D("317500")
    assert breakdown.state.taxable_income == D("306500")
    assert cents(breakdown.state.tax) == D("20350.00")

    # Medicare stays a COMBINED walk: 193700 + 99800 = 293500 of FICA wages, and the
    # additional tier is the MFJ table's 250000. 250000x.0145 + 43500x.0235.
    assert breakdown.medicare.w2_income == D("300000")
    assert breakdown.medicare.taxable_wages == D("293500")
    assert cents(breakdown.medicare.tax) == D("4647.25")

    # Social Security: PER EARNER against the 180000 base. A caps at 180000, B brings its
    # whole 99800. 180000x.062 + 99800x.062 = 11160 + 6187.60.
    assert breakdown.social_security.taxable_wages == D("279800")
    assert cents(breakdown.social_security.tax) == D("17347.60")

    # SDI: per earner over wages net of dental/vision only (the CA quirk), both under the
    # 200000 pseudo-cap. 199700x.01 + 99800x.01. Reported wages stay the UNCAPPED sum.
    assert breakdown.disability.taxable_wages == D("299500")
    assert cents(breakdown.disability.tax) == D("2995.00")

    # Totals: gross sums the COMPONENTS (250000 + 50000 + 1000 + 2000 + 40000 + 5000).
    assert breakdown.totals.gross_income == D("348000")
    assert cents(breakdown.totals.total_tax) == D("93829.85")
    assert cents(breakdown.totals.take_home) == D("254170.15")


def test_one_shared_wage_base_would_understate_social_security():
    """The wrong-money bug this parameter exists to kill (audit §3.2).

    Same inputs, same tables, no earner bundles: the aggregate path caps 293500 of
    combined wages ONCE at 180000 and loses B's entire contribution."""
    aggregate = compute_breakdown(MFJ_YEAR, MFJ_INPUTS, MFJ_BRACKETS, filing_status=MARRIED_JOINT)
    assert cents(aggregate.social_security.tax) == D("11160.00")
    assert cents(mfj_breakdown().social_security.tax - aggregate.social_security.tax) == D(
        "6187.60"
    )


def test_single_tables_would_fire_the_medicare_surtax_too_early():
    """Correctness comes from the STATUS-SELECTED table, not from splitting the wages: the
    same combined 293500 meets the surtax at 200000 on a single-filer table."""
    single_tables = dict(MFJ_BRACKETS) | {
        "medicare": [(D("0.0145"), D("0")), (D("0.0235"), D("200000"))]
    }
    single = compute_breakdown(
        MFJ_YEAR, MFJ_INPUTS, single_tables, filing_status=SINGLE, earners=MFJ_EARNERS
    )
    # 200000x.0145 + 93500x.0235 = 2900 + 2197.25
    assert cents(single.medicare.tax) == D("5097.25")
    assert cents(single.medicare.tax - mfj_breakdown().medicare.tax) == D("450.00")


def test_both_earners_under_the_wage_base_pay_two_full_caps():
    """Neither earner reaches 180000, so nothing is capped and the whole combined wage is
    taxed — 230000x.062, not the aggregate model's 180000x.062."""
    inputs = dict(MFJ_HOUSEHOLD) | {
        "latest_w2_income": D("230000"),
        "other_w2_income": D("0"),
        "trad_401k_contributions": D("0"),
        "hsa_contributions": D("0"),
        "hsa_contributions_employer": D("0"),
        "other_pretax_deductions": D("0"),
    }
    earners = [EarnerWages(w2_wages=D("120000")), EarnerWages(w2_wages=D("110000"))]
    breakdown = compute_breakdown(
        MFJ_YEAR, inputs, MFJ_BRACKETS, filing_status=MARRIED_JOINT, earners=earners
    )
    assert breakdown.social_security.taxable_wages == D("230000")
    assert cents(breakdown.social_security.tax) == D("14260.00")
    assert cents(breakdown.disability.tax) == D("2300.00")  # 230000 x .01, both under cap


def test_one_earner_over_the_wage_base_caps_only_that_earner():
    inputs = dict(MFJ_HOUSEHOLD) | {
        "latest_w2_income": D("260000"),
        "other_w2_income": D("0"),
        "trad_401k_contributions": D("0"),
        "hsa_contributions": D("0"),
        "hsa_contributions_employer": D("0"),
        "other_pretax_deductions": D("0"),
    }
    earners = [EarnerWages(w2_wages=D("200000")), EarnerWages(w2_wages=D("60000"))]
    breakdown = compute_breakdown(
        MFJ_YEAR, inputs, MFJ_BRACKETS, filing_status=MARRIED_JOINT, earners=earners
    )
    # 180000 (capped) + 60000 (whole) reported; 11160 + 3720 taxed.
    assert breakdown.social_security.taxable_wages == D("240000")
    assert cents(breakdown.social_security.tax) == D("14880.00")
    # SDI's pseudo-cap is per person too: A stops at 200000, B brings all 60000.
    assert cents(breakdown.disability.tax) == D("2600.00")
    assert breakdown.disability.taxable_wages == D("260000")  # reported UNCAPPED, as today


def test_sdi_subtracts_dental_and_vision_but_not_hsa_per_earner():
    """The CA quirk survives the per-earner split: SS/Medicare net HSA out, SDI does not."""
    breakdown = mfj_breakdown()
    # A: 200000 - 300; B: 100000 - 200.
    assert breakdown.disability.taxable_wages == D("199700") + D("99800")
    # A: 200000 - (6000 + 300); B: 100000 - (0 + 200).
    assert breakdown.medicare.taxable_wages == D("193700") + D("99800")


# --------------------------------------------------------------------------------------
# NIIT advisory thresholds by status
# --------------------------------------------------------------------------------------

BASE_CG = [(D("0"), D("0")), (D("0.15"), D("100000")), (D("0.20"), D("600000"))]


def test_niit_threshold_follows_the_filing_status():
    # 220000 is above single's 200000 but at or below MFJ's 250000.
    assert niit_advisory(D("220000"), BASE_CG, SINGLE) is not None
    assert niit_advisory(D("220000"), BASE_CG, MARRIED_JOINT) is None
    # 150000 is below single's threshold but above MFS's 125000.
    assert niit_advisory(D("150000"), BASE_CG, SINGLE) is None
    assert niit_advisory(D("150000"), BASE_CG, MARRIED_SEPARATE) is not None
    # The message names the threshold that was actually applied.
    assert "250000" in niit_advisory(D("300000"), BASE_CG, MARRIED_JOINT)
    assert "125000" in niit_advisory(D("150000"), BASE_CG, MARRIED_SEPARATE)
    # An unknown status degrades to single's constant rather than raising: the engine is a
    # pure function over stored data and never rejects it.
    assert niit_advisory(D("220000"), BASE_CG, "nonsense") is not None


def test_niit_status_reaches_the_breakdown_warnings():
    tables = dict(MFJ_BRACKETS) | {"capital_gains": BASE_CG}
    joint = compute_breakdown(
        MFJ_YEAR, MFJ_INPUTS, tables, filing_status=MARRIED_JOINT, earners=MFJ_EARNERS
    )
    # AGI 266500 > 250000, so the stored 0.15/0.20 pair contradicts the NIIT rule.
    flagged = [w for w in joint.warnings if w.startswith("capital-gains rates 0.15/0.2 contradict")]
    assert len(flagged) == 1
    assert "250000" in flagged[0]
