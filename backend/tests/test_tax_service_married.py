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
    derive_suggestions,
    earner_from_inputs,
    materialize_household,
    salt_cap,
    shift_earners,
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
    must read like a year with no W-2 rather than crash a sum.

    It now reads that way in the INCOME chain too (2026-09-11 spec §1.3): the engine takes
    its wage and other-pre-tax terms from the bundles, so no bundles means no wages
    anywhere, not wages in AGI and none in FICA. 2024's 211776.20 of ordinary AGI less the
    235724.46 of W-2 income and plus the 300 of dental/vision that left with it.
    """
    breakdown = compute_breakdown(2024, YEAR_INPUTS[2024], YEAR_BRACKETS[2024], earners=[])
    assert breakdown.medicare.w2_income == Decimal("0")
    assert breakdown.social_security.tax == Decimal("0")
    assert breakdown.disability.tax == Decimal("0")
    assert breakdown.totals.total_income == Decimal("211776.2") - Decimal("235724.46") + Decimal(
        "300"
    )


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
    # base rates: the folded pair is the advisory's business, not a fixture's
    "capital_gains": [(D("0"), D("0")), (D("0.15"), D("100000")), (D("0.20"), D("600000"))],
}

# Household-level lines (one row each in the DB, person_id NULL). COMPONENTS only since
# 2026-09-11: the five household totals are computed by `materialize_household`, so a
# fixture that typed one would be pinning a figure nothing stores.
MFJ_HOUSEHOLD = {
    "stcg_standard": D("0"),
    "capital_loss_deductions": D("0"),
    "unq_div_us_treasuries_etf": D("0"),
    "unq_div_state_exempt_pct": D("0"),
    "unq_div_other": D("1000"),
    # Zero, so the state chain's treasury-interest exemption (2026-09-09 spec 4b) has
    # nothing to back out of this reference year: the MFJ figures below stay hand-checkable.
    "interest_us_treasuries": D("0"),
    "interest_standard": D("2000"),
    "other_income_1099": D("0"),
    "standard_deduction": D("30000"),
    # An entered ZERO, which is how a year says "no itemized deductions" now that the total
    # is computed: an absent component reads as absent and names the total in the muted
    # missing-inputs list (spec 1.3's rule).
    "itemized_salt": D("0"),
    # Zero, so §199A's below-the-line deduction (2026-09-09 spec 4h) leaves the MFJ
    # reference figures hand-checkable.
    "itemized_sec199a_div": D("0"),
    "state_standard_deduction": D("11000"),
    "state_exemption_credits": D("300"),
    "ltcg_brokerage": D("40000"),
    "qualified_dividends": D("5000"),
    "other_capital_gains": D("0"),
}

# Per-person lines. A is over the 180000 SS wage base, B is well under it — the two cases
# the aggregate model could not tell apart.
# Their four derived totals are COMPONENTS here for the same reason: `earner_from_inputs`
# materializes each bucket, so A's 150000 of salary wages is 20 checks against a 180000
# salary and their 300 of other pre-tax is dental + vision.
EARNER_A = {
    "annual_salary": D("180000"),  # -> latest_w2_income 20 x 7500 = 150000
    "pay_periods": D("20"),
    "w2_bonuses": D("50000"),  # -> other_w2_income 50000
    "trad_401k_contributions": D("20000"),
    "hsa_contributions": D("5000"),
    "hsa_contributions_employer": D("1000"),
    "pretax_dental": D("228"),  # -> other_pretax_deductions 300
    "pretax_vision": D("72"),
}
EARNER_B = {
    "annual_salary": D("120000"),  # -> latest_w2_income 20 x 5000 = 100000
    "pay_periods": D("20"),
    "trad_401k_contributions": D("10000"),
    "hsa_contributions": D("0"),
    "hsa_contributions_employer": D("0"),
    "pretax_dental": D("200"),  # -> other_pretax_deductions 200
    "pretax_vision": D("0"),
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
    # + 500 = 36500 -> ordinary AGI 266500. Deduction max(30000, 0). TI 236500.
    # Tax = 100000x.10 + 136500x.22 = 10000 + 30030.
    assert breakdown.totals.total_income == D("266500")
    # The reported federal Base is true AGI (2026-09-09 spec 4f): 266500 + the 45000 of
    # netted gains = 311500, where it used to read 266500.
    assert breakdown.federal.agi == D("311500")
    assert breakdown.federal.taxable_income == D("236500")
    assert cents(breakdown.federal.tax) == D("40030.00")

    # Capital gains: LTCG 40000 is a gain, so everything nets -> 40000 + 5000 + 0.
    assert breakdown.capital_gains.gains_amount == D("45000")
    # Stacked on TI 236500 -> [236500, 281500], entirely inside the 15% tier.
    assert cents(breakdown.capital_gains.tax) == D("6750.00")

    # NIIT: NII = interest 2000 + unq div 1000 + max(stcg 0, 0) + max(cg 45000, 0)
    # = 48000; MAGI = 266500 + 45000 = 311500 -> excess 61500 over MFJ's 250000; NII
    # binds: 0.038 x 48000 = 1824.
    assert breakdown.niit.gains_amount == D("48000")
    assert breakdown.niit.taxable_income == D("48000")
    assert cents(breakdown.niit.tax) == D("1824.00")

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
    # 93829.85 - 8460 folded CG + 6750 base CG + 1824 NIIT
    assert cents(breakdown.totals.total_tax) == D("93943.85")
    assert cents(breakdown.totals.take_home) == D("254056.15")


def test_one_shared_wage_base_would_understate_social_security():
    """The wrong-money bug this parameter exists to kill (audit §3.2).

    The old aggregate path was ONE bundle for the whole household — spelled out here,
    because the flat dict can no longer express it: per-person components are summed into
    it, and 24 checks against two salaries is not a person."""
    household = [EarnerWages(w2_wages=D("300000"), pretax_hsa=D("6000"), other_pretax=D("500"))]
    aggregate = compute_breakdown(
        MFJ_YEAR, MFJ_INPUTS, MFJ_BRACKETS, filing_status=MARRIED_JOINT, earners=household
    )
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
    # No W-2 rows in the flat dict at all: the wages below are the bundles', which is the
    # only place the engine reads them from.
    inputs = dict(MFJ_HOUSEHOLD) | {
        "trad_401k_contributions": D("0"),
        "hsa_contributions": D("0"),
        "hsa_contributions_employer": D("0"),
    }
    earners = [EarnerWages(w2_wages=D("120000")), EarnerWages(w2_wages=D("110000"))]
    breakdown = compute_breakdown(
        MFJ_YEAR, inputs, MFJ_BRACKETS, filing_status=MARRIED_JOINT, earners=earners
    )
    assert breakdown.social_security.taxable_wages == D("230000")
    assert cents(breakdown.social_security.tax) == D("14260.00")
    assert cents(breakdown.disability.tax) == D("2300.00")  # 230000 x .01, both under cap


def test_one_earner_over_the_wage_base_caps_only_that_earner():
    # No W-2 rows in the flat dict at all: the wages below are the bundles', which is the
    # only place the engine reads them from.
    inputs = dict(MFJ_HOUSEHOLD) | {
        "trad_401k_contributions": D("0"),
        "hsa_contributions": D("0"),
        "hsa_contributions_employer": D("0"),
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


def test_two_earner_wages_come_from_the_bundles():
    """The four per-person totals are NEVER read from the flat dict (spec §1.3).

    Strip every W-2 and pre-tax-benefit row out of it — salary, checks, bonuses, dental,
    vision — and the reference year is unchanged, because the wages and the other-pre-tax
    leg both come from the bundles. This is what makes the API's partner column real: a
    person's figures follow their own rows, not the household's sum.
    """
    wageless = {
        key: value
        for key, value in MFJ_INPUTS.items()
        if key
        not in ("annual_salary", "pay_periods", "w2_bonuses", "pretax_dental", "pretax_vision")
    }
    breakdown = compute_breakdown(
        MFJ_YEAR, wageless, MFJ_BRACKETS, filing_status=MARRIED_JOINT, earners=MFJ_EARNERS
    )
    assert breakdown.medicare.w2_income == D("300000")
    assert breakdown.totals.gross_income == D("348000")
    assert breakdown.federal.agi == D("311500")
    assert actuals(breakdown) == actuals(mfj_breakdown())
    # ...and the three totals whose components really are absent are named as missing,
    # which is the honest reading of a dict with no W-2 rows in it.
    muted = breakdown.warnings[0].removeprefix("missing inputs defaulted to 0: ").split(", ")
    assert muted == ["latest_w2_income", "other_w2_income", "other_pretax_deductions"]


def test_shift_earners_rebuilds_the_primary_bundle_from_components():
    """A what-if leg lands on the PRIMARY's bundle, and lands there by re-materializing
    their component bucket rather than by adding deltas of derived keys — the partner's
    wage base is untouched beside it (2026-08-26 spec §5.3's rule, spec §1.4's mechanism).
    """
    after = dict(EARNER_A) | {"w2_bonuses": D("60000")}  # a 10000 ESPP ordinary leg
    shifted = shift_earners(MFJ_EARNERS, after)
    assert shifted[0].w2_wages == MFJ_EARNERS[0].w2_wages + D("10000")
    assert shifted[0].pretax_hsa == MFJ_EARNERS[0].pretax_hsa
    assert shifted[0].other_pretax == MFJ_EARNERS[0].other_pretax
    assert shifted[1:] == MFJ_EARNERS[1:]
    # None and the empty list pass straight through: a single-earner year keeps taking the
    # engine's own synthesis path and stays byte-identical.
    assert shift_earners(None, after) is None
    assert shift_earners([], after) == []


# --------------------------------------------------------------------------------------
# NIIT thresholds by status
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("w2", "status", "base", "tax"),
    [
        ("140000", SINGLE, "0", "0"),  # MAGI 150000 <= 200000
        ("140000", MARRIED_JOINT, "0", "0"),  # <= 250000
        ("140000", MARRIED_SEPARATE, "10000", "380"),  # excess 25000; NII 10000 binds
        ("210000", SINGLE, "10000", "380"),  # MAGI 220000 -> excess 20000; NII binds
        ("210000", MARRIED_JOINT, "0", "0"),  # 220000 <= 250000
        ("240000", MARRIED_JOINT, "0", "0"),  # MAGI exactly 250000: excess is 0
        ("140000", "head_of_household", "0", "0"),  # unknown status reads single's 200000
    ],
)
def test_niit_threshold_follows_the_filing_status(w2, status, base, tax):
    """The engine's own NIIT line selects the status threshold (the map the old advisory
    read); an unknown status degrades to single's constant — a pure read over stored
    data must never raise on it."""
    # Components, not totals: 24 checks against a salary of `w2` IS `w2` of wages.
    inputs = {
        "pay_periods": D("24"),
        "annual_salary": D(w2),
        "interest_standard": D("10000"),
    }
    breakdown = compute_breakdown(2025, inputs, YEAR_BRACKETS[2025], filing_status=status)
    assert breakdown.niit.taxable_income == D(base)
    assert breakdown.niit.tax == D(tax)


# --------------------------------------------------------------------------------------
# materialize_household: SALT cap by status + the OBBBA phase-down
# derive_suggestions: the capital-loss clamp
# --------------------------------------------------------------------------------------

SALT_ITEMS = {
    "itemized_salt": D("50000"),
    "itemized_donations": D("0"),
    "itemized_vehicle_reg": D("0"),
    "itemized_sec199a_div": D("0"),
    "itemized_other": D("0"),
}


def salt_year(year: int, status: str, magi: Decimal) -> Decimal:
    """The itemized TOTAL with 50000 of SALT and one W-2 line carrying the MAGI, so the
    answer IS the applied cap."""
    inputs = dict(SALT_ITEMS) | {"latest_w2_income": magi}
    return materialize_household(year, inputs, status)["itemized_deduction"]


def test_salt_cap_halves_for_married_filing_separately():
    # Below every phase-down threshold, so this is the base cap alone.
    assert salt_year(2024, SINGLE, D("0")) == D("10000")
    assert salt_year(2024, MARRIED_SEPARATE, D("0")) == D("5000")
    assert salt_year(2025, SINGLE, D("0")) == D("40000")
    assert salt_year(2025, MARRIED_JOINT, D("0")) == D("40000")  # MFJ is NOT 2x single
    assert salt_year(2025, MARRIED_SEPARATE, D("0")) == D("20000")


def test_salt_phase_down_boundaries():
    # Strictly ">": exactly 500000 of MAGI keeps the whole cap.
    assert salt_year(2025, SINGLE, D("500000")) == D("40000")
    # 40000 - 30% x 50000 = 25000.
    assert salt_year(2025, SINGLE, D("550000")) == D("25000")
    # 40000 - 30% x 100000 = 10000, exactly the floor.
    assert salt_year(2025, SINGLE, D("600000")) == D("10000")
    # Far past it: the floor holds rather than going negative.
    assert salt_year(2025, SINGLE, D("900000")) == D("10000")
    # MFS halves the threshold, the cap AND the floor: 20000 - 30% x 50000 = 5000.
    assert salt_year(2025, MARRIED_SEPARATE, D("250000")) == D("20000")
    assert salt_year(2025, MARRIED_SEPARATE, D("300000")) == D("5000")
    assert salt_year(2025, MARRIED_SEPARATE, D("400000")) == D("5000")
    # Pre-2025 the cap is already the floor, so no phase-down applies at any MAGI.
    assert salt_year(2024, SINGLE, D("900000")) == D("10000")
    assert salt_year(2024, MARRIED_SEPARATE, D("900000")) == D("5000")


def test_salt_phase_down_magi_includes_capital_gains():
    """C1's third consumer: the phase-down MAGI is `_magi` (fed AGI + cg_amount), so a
    CG-heavy year sheds cap even when ordinary AGI alone sits under 500000. Approved
    behavior change (spec C1): CG-year SALT totals may shrink toward the floor.

    The gains arrive as their COMPONENT since 2026-09-11: `ltcg_total` is rebuilt inside
    the same call, which is what makes the dependency order load-bearing rather than tidy.
    """
    # fed AGI 450000; cg_amount 100000 (a pure LTCG gain nets whole); MAGI 550000 ->
    # phased cap = 40000 - 0.30 x 50000 = 25000. SALT_ITEMS stores 50000 of SALT and no
    # other itemized lines, so the total IS the applied cap.
    inputs = dict(SALT_ITEMS) | {"latest_w2_income": D("450000"), "ltcg_brokerage": D("100000")}
    assert materialize_household(2025, inputs, SINGLE)["itemized_deduction"] == D("25000")
    # Without the gains the same wages stay under the threshold: the full 40000 cap.
    no_cg = dict(SALT_ITEMS) | {"latest_w2_income": D("450000")}
    assert materialize_household(2025, no_cg, SINGLE)["itemized_deduction"] == D("40000")


def test_salt_cap_reads_the_engine_definition_of_agi():
    """MAGI reaches the engine's own federal AGI through `_magi` — pre-tax deductions pull
    it down, so a 401(k) can rescue the cap. No CG key is stored here, so `_magi` equals
    `_federal_agi` and this pins the AGI half of that sum."""
    assert salt_cap(2025, SINGLE, D("560000")) == D("22000")
    inputs = dict(SALT_ITEMS) | {
        "latest_w2_income": D("560000"),
        "trad_401k_contributions": D("60000"),
    }
    # AGI 500000 -> no phase-down at all.
    assert materialize_household(2025, inputs, SINGLE)["itemized_deduction"] == D("40000")


def test_salt_cap_never_raises_the_total_above_the_entered_amount():
    """The cap is a ceiling, not a floor: 3000 of SALT stays 3000 under a 40000 cap."""
    items = dict(SALT_ITEMS) | {"itemized_salt": D("3000"), "itemized_donations": D("250")}
    assert materialize_household(2025, items, SINGLE)["itemized_deduction"] == D("3250")


def test_capital_loss_suggestion_is_clamped_by_status():
    """The deductible loss per return: 3000, or 1500 filing separately (spec §5.3). This
    is the SUGGESTION's clamp; since 2026-08-31 (spec C3) the engine reads the stored key
    too, but it never clamps — it warns, and the two share this one statutory figure.

    The loss is entered as `ltcg_brokerage` since 2026-09-11: the long-term TOTAL it feeds
    is computed, so a test that typed it would be testing a figure nothing stores.
    """
    big = {"ltcg_brokerage": D("-5000"), "stcg_standard": D("1000")}  # nets to -4000
    assert derive_suggestions(2025, big, SINGLE)["capital_loss_deductions"] == D("-3000")
    assert derive_suggestions(2025, big, MARRIED_JOINT)["capital_loss_deductions"] == D("-3000")
    assert derive_suggestions(2025, big, MARRIED_SEPARATE)["capital_loss_deductions"] == D("-1500")

    # A loss under the cap is untouched, and MFS clamps it only once it passes 1500.
    small = {"ltcg_brokerage": D("-1000")}
    assert derive_suggestions(2025, small, SINGLE)["capital_loss_deductions"] == D("-1000")
    assert derive_suggestions(2025, small, MARRIED_SEPARATE)["capital_loss_deductions"] == D(
        "-1000"
    )
    mid = {"ltcg_brokerage": D("-2000")}
    assert derive_suggestions(2025, mid, SINGLE)["capital_loss_deductions"] == D("-2000")
    assert derive_suggestions(2025, mid, MARRIED_SEPARATE)["capital_loss_deductions"] == D("-1500")

    # A gain still suggests 0, not a clamp.
    assert derive_suggestions(2025, {"ltcg_brokerage": D("500")}, SINGLE)[
        "capital_loss_deductions"
    ] == D("0")


def test_capital_loss_clamp_is_the_suggestions_alone():
    """The clamp belongs to derive_suggestions; the engine never clamps (spec C3). Feeding
    the UNCLAMPED loss to compute_breakdown lowers AGI by every cent of it and buys one
    advisory sentence — a GET reports stored data, it does not reject it."""
    inputs = dict(MFJ_INPUTS) | {"capital_loss_deductions": D("-99999")}
    lossy = compute_breakdown(
        MFJ_YEAR, inputs, MFJ_BRACKETS, filing_status=MARRIED_JOINT, earners=MFJ_EARNERS
    )
    assert mfj_breakdown().federal.agi - lossy.federal.agi == D("99999")
    assert lossy.warnings == [
        "capital_loss_deductions (-99999) exceeds the statutory cap (-3000); used verbatim"
    ]


def test_capital_loss_cap_warning_halves_for_married_filing_separately():
    """The engine's over-cap warning reads the same halved statutory figure the
    suggestion clamp does: -2000 is clean on a single return, over MFS's -1500."""
    inputs = {"capital_loss_deductions": D("-2000")}
    single = compute_breakdown(2025, inputs, YEAR_BRACKETS[2025], filing_status=SINGLE)
    assert not any("statutory cap" in w for w in single.warnings)
    mfs = compute_breakdown(2025, inputs, YEAR_BRACKETS[2025], filing_status=MARRIED_SEPARATE)
    assert (
        "capital_loss_deductions (-2000) exceeds the statutory cap (-1500); used verbatim"
        in mfs.warnings
    )


def test_derive_suggestions_defaults_to_single():
    """No status argument is single's answer — the shipped call sites (and the golden
    suite) pass two arguments and must keep meaning what they meant."""
    items = {"ltcg_brokerage": D("-5000")}
    assert derive_suggestions(2025, items) == derive_suggestions(2025, items, SINGLE)
    assert derive_suggestions(2025, items) != derive_suggestions(2025, items, MARRIED_SEPARATE)


# --------------------------------------------------------------------------------------
# Per-worker tables per earner (2026-09-11 spec §2.2)
# --------------------------------------------------------------------------------------

# The production shape this exists for: the household's DEFAULT Disability table is one
# spouse's employer Voluntary Plan (1% to a 300000 ceiling), while the other spouse's
# payroll withholds California statutory SDI (1.3%, no ceiling since SB 951). One table
# cannot hold both.
VP_BRACKETS = dict(MFJ_BRACKETS) | {"disability": [(D("0.01"), D("0")), (D("0"), D("300000"))]}
CA_SDI = [(D("0.013"), D("0"))]


def bundles(*earners: EarnerWages) -> list[EarnerWages]:
    return list(earners)


def test_own_disability_table_replaces_the_default_for_that_earner():
    """A's Voluntary Plan is the year's default; B walks their own statutory SDI table."""
    a, b = (
        MFJ_EARNERS[0],
        MFJ_EARNERS[1].__class__(
            w2_wages=MFJ_EARNERS[1].w2_wages,
            pretax_hsa=MFJ_EARNERS[1].pretax_hsa,
            other_pretax=MFJ_EARNERS[1].other_pretax,
            payroll_tables={"disability": CA_SDI},
        ),
    )
    breakdown = compute_breakdown(
        MFJ_YEAR, MFJ_INPUTS, VP_BRACKETS, filing_status=MARRIED_JOINT, earners=[a, b]
    )
    # A: 199700 x .01 under the VP's 300000 ceiling. B: 99800 x .013, no ceiling at all.
    assert cents(breakdown.disability.tax) == D("1997.00") + D("1297.40")
    assert breakdown.disability.taxable_wages == D("299500")  # uncapped, as today
    first, second = breakdown.disability.per_person
    assert (first.own_table, cents(first.tax)) == (False, D("1997.00"))
    assert (second.own_table, cents(second.tax)) == (True, D("1297.40"))


def test_own_social_security_cap_is_per_table():
    """Two earners, two wage bases, two DIFFERENT ceilings — the cap is a property of the
    table each of them walks, not of the year."""
    tables = dict(MFJ_BRACKETS) | {"social_security": [(D("0.062"), D("0")), (D("0"), D("184500"))]}
    a = EarnerWages(w2_wages=D("250000"))
    b = EarnerWages(
        w2_wages=D("150000"),
        payroll_tables={"social_security": [(D("0.062"), D("0")), (D("0"), D("100000"))]},
    )
    breakdown = compute_breakdown(
        MFJ_YEAR, MFJ_HOUSEHOLD, tables, filing_status=MARRIED_JOINT, earners=[a, b]
    )
    first, second = breakdown.social_security.per_person
    assert first.taxable_wages == D("184500")
    assert second.taxable_wages == D("100000")
    assert breakdown.social_security.taxable_wages == D("284500")
    assert cents(breakdown.social_security.tax) == cents(D("284500") * D("0.062"))


def test_all_zero_table_taxes_nothing_and_reports_nothing_taxable():
    """The SS-exempt job: a table whose every rate is 0 is not a 0% walk over real wages,
    it is a person with no wage base at all — so the aggregate excludes them too."""
    a = EarnerWages(w2_wages=D("120000"))
    b = EarnerWages(w2_wages=D("90000"), payroll_tables={"social_security": [(D("0"), D("0"))]})
    breakdown = compute_breakdown(
        MFJ_YEAR, MFJ_HOUSEHOLD, MFJ_BRACKETS, filing_status=MARRIED_JOINT, earners=[a, b]
    )
    exempt = breakdown.social_security.per_person[1]
    assert (exempt.tax, exempt.taxable_wages, exempt.own_table) == (D("0"), D("0"), True)
    assert exempt.w2_income == D("90000")  # their W-2 is real; their wage base is not
    assert breakdown.social_security.taxable_wages == D("120000")
    assert cents(breakdown.social_security.tax) == cents(D("120000") * D("0.062"))


def test_an_all_zero_default_table_is_not_an_exemption():
    """The exempt rule reads an earner's OWN table, never the year's default.

    A default table of nothing but 0-rate rows is a jurisdiction this household is simply
    not charged by — and what shipped before per-person tables is the whole UNCAPPED wage
    base beside a 0 tax, which is what `_payroll_line`'s "walks exactly what it walked
    before" promises. Read as an exemption it would erase the reported wage base of every
    earner on the return.
    """
    tables = dict(MFJ_BRACKETS) | {"social_security": [(D("0"), D("0"))]}
    breakdown = compute_breakdown(
        MFJ_YEAR, MFJ_INPUTS, tables, filing_status=MARRIED_JOINT, earners=MFJ_EARNERS
    )
    assert breakdown.social_security.tax == D("0")
    # 193700 + 99800: both earners' FICA wages, uncapped and reported in full.
    assert breakdown.social_security.taxable_wages == D("293500")
    assert [line.taxable_wages for line in breakdown.social_security.per_person] == [
        D("193700"),
        D("99800"),
    ]
    assert [line.own_table for line in breakdown.social_security.per_person] == [False, False]


def test_empty_mapping_is_the_default_path():
    """No person tables anywhere is byte-identical to the two-earner engine that shipped
    before them — and an EMPTY list for a jurisdiction still means "no table"."""
    reference = mfj_breakdown()
    assert all(earner.payroll_tables == {} for earner in MFJ_EARNERS)
    assert cents(reference.social_security.tax) == D("17347.60")
    assert cents(reference.disability.tax) == D("2995.00")

    blank = [
        EarnerWages(
            w2_wages=earner.w2_wages,
            pretax_hsa=earner.pretax_hsa,
            other_pretax=earner.other_pretax,
            payroll_tables={"social_security": [], "disability": []},
        )
        for earner in MFJ_EARNERS
    ]
    fallen_back = compute_breakdown(
        MFJ_YEAR, MFJ_INPUTS, MFJ_BRACKETS, filing_status=MARRIED_JOINT, earners=blank
    )
    assert actuals(fallen_back) == actuals(reference)
    assert [line.own_table for line in fallen_back.social_security.per_person] == [False, False]


def test_per_person_results_follow_bundle_order():
    breakdown = mfj_breakdown()
    assert breakdown.medicare.per_person == []  # combined by statute, never split
    for family, expected in (
        ("social_security", [D("180000"), D("99800")]),
        ("disability", [D("199700"), D("99800")]),
    ):
        result = getattr(breakdown, family)
        assert len(result.per_person) == len(MFJ_EARNERS), family
        for line, earner, taxable in zip(result.per_person, MFJ_EARNERS, expected, strict=True):
            assert line.w2_income == earner.w2_wages, family
            assert line.taxable_wages == taxable, family
            assert line.own_table is False, family
            assert line.effective_rate == line.tax / earner.w2_wages, family
        assert sum(line.tax for line in result.per_person) == result.tax, family
        assert sum(line.taxable_wages for line in result.per_person) == result.taxable_wages


def test_shift_earners_preserves_payroll_tables():
    """A what-if re-bases the primary's WAGES from their components; their own per-worker
    tables are not a wage and must survive the rebuild."""
    head = EarnerWages(
        w2_wages=MFJ_EARNERS[0].w2_wages,
        pretax_hsa=MFJ_EARNERS[0].pretax_hsa,
        other_pretax=MFJ_EARNERS[0].other_pretax,
        payroll_tables={"disability": CA_SDI},
    )
    after = dict(EARNER_A) | {"w2_bonuses": D("60000")}
    shifted = shift_earners([head, MFJ_EARNERS[1]], after)
    assert shifted[0].w2_wages == head.w2_wages + D("10000")
    assert shifted[0].payroll_tables == {"disability": CA_SDI}
    assert shifted[1] == MFJ_EARNERS[1]
