"""Tax-engine goldens: the sheet's 2023-2026 columns, to the cent (spec §9).

Fixtures are the pinned workbook values (== the dev DB's imported `tax_inputs` /
`tax_brackets`, 4dp-quantized). Three families of assertion:

* **canonical goldens** — the clean model the engine ships, one test per year;
* **sheet equality for 2024** — 2024 is the drift-free column, so its canonical values ARE
  the sheet's cached values (the cached cells are 10-significant-figure float renderings,
  so the five derived-from-a-product quantities match within 1e-4 rather than bit-exactly);
* **drift pins** — the sheet's per-year hand-edit drift (D1-D3) reproduced to the cent by
  feeding the engine's own walkers the drifted intermediate, proving every delta is
  understood rather than papered over.

No workbook is opened here: every literal below comes from the Plan 5 Workbook reference.
"""

from decimal import ROUND_HALF_UP, Decimal

import pytest

from app.services.tax_service import (
    ENGINE_INPUT_KEYS,
    JURISDICTION_WARN_MISSING,
    NEGATIVE_STATE_TAX_WARNING,
    compute_breakdown,
    derive_suggestions,
    niit_advisory,
    stack,
    walk,
)
from app.tax_keys import TAX_INPUT_DEFINITIONS

CENT = Decimal("0.01")
YEARS = (2023, 2024, 2025, 2026)


def cents(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------------------
# Pinned fixtures
# --------------------------------------------------------------------------------------

_INPUT_TABLE: dict[str, tuple[str, str, str, str]] = {
    "annual_salary": ("145000", "151000", "162000", "188930"),
    "gross_paycheck": ("6041.6667", "6291.6667", "6750", "7872.0833"),
    "pay_periods": ("9", "18", "20", "20"),
    "latest_w2_income": ("54375", "113250", "135000", "157441.6667"),
    "other_w2_income": ("50690.08", "122474.46", "141176.78", "149252.36"),
    "w2_stock_rsus_sold": ("0", "84029.8", "113757.74", "120000"),
    "w2_bonuses": ("25000", "0", "0", "0"),
    "w2_salary_checkpoint": ("3845.17", "36250.08", "25166.68", "27000"),
    "w2_espp_sale_component": ("0", "0", "0", "0"),
    "w2_employer_hsa": ("666.68", "2000", "2000", "2000"),
    "w2_other": ("21178.23", "194.58", "252.36", "252.36"),
    "stcg_total": ("84", "951.93", "8040.08", "0"),
    "stcg_standard": ("754", "951.93", "8040.08", "0"),
    "stcg_espp_component": ("0", "0", "0", "0"),
    "unqualified_dividends": ("286.65", "833.46", "1653.14", "0"),
    "unq_div_us_treasuries_etf": ("152.45", "824.55", "1621.99", "0"),
    "unq_div_state_exempt_pct": ("0.9645", "0.9753", "0.9514", "0.9753"),
    "unq_div_other": ("134.2", "8.91", "31.15", "0"),
    "interest_total": ("20750.5", "24.76", "62.87", "0"),
    "interest_standard": ("82.5", "24.76", "62.87", "0"),
    "interest_us_treasuries": ("20668", "0", "0", "0"),
    "other_income_1099": ("6", "259.43", "9", "0"),
    "trad_401k_contributions": ("6222.91", "21567.84", "21965.82", "21965.82"),
    "hsa_contributions": ("1500", "2150", "2300", "2300"),
    "hsa_contributions_employer": ("666.68", "2000", "2000", "2000"),
    "capital_loss_deductions": ("0", "0", "0", "0"),
    "other_pretax_deductions": ("76", "300", "300", "300"),
    "pretax_dental": ("76", "228", "228", "228"),
    "pretax_vision": ("0", "72", "72", "72"),
    "standard_deduction": ("13850", "14600", "15750", "16100"),
    "itemized_deduction": ("7579.64", "10016", "27213.282", "29824"),
    "itemized_salt": ("7563.64", "17488.59", "24141.06", "22000"),
    "itemized_donations": ("0", "0", "3050", "7800"),
    "itemized_vehicle_reg": ("16", "16", "16", "16"),
    "itemized_sec199a_div": ("0", "0", "6.222", "8"),
    "itemized_other": ("0", "0", "0", "0"),
    "state_standard_deduction": ("5363", "5540", "5706", "5706"),
    "state_exemption_credits": ("144", "149", "147", "153"),
    "ltcg_total": ("-670", "0", "536.38", "0"),
    "ltcg_brokerage": ("-670", "0", "536.38", "0"),
    "ltcg_espp_component": ("0", "0", "0", "0"),
    "qualified_dividends": ("129", "179.13", "719.81", "0"),
    "other_capital_gains": ("0", "0", "11", "0"),
}

YEAR_INPUTS: dict[int, dict[str, Decimal]] = {
    year: {key: Decimal(column[index]) for key, column in _INPUT_TABLE.items()}
    for index, year in enumerate(YEARS)
}


def _table(rates: tuple[str, ...], thresholds: tuple[str, ...]) -> list[tuple[Decimal, Decimal]]:
    return [(Decimal(r), Decimal(t)) for r, t in zip(rates, thresholds, strict=True)]


_FED_RATES = ("0.10", "0.12", "0.22", "0.24", "0.32", "0.35", "0.37")
_FED_THRESHOLDS = {
    2023: ("0", "11000", "44725", "95375", "182100", "231250", "578125"),
    2024: ("0", "11600", "47150", "100525", "191950", "243725", "609350"),
    2025: ("0", "11925", "48475", "103350", "197300", "250525", "626350"),
}
_FED_THRESHOLDS[2026] = _FED_THRESHOLDS[2025]

_STATE_RATES = ("0.01", "0.02", "0.04", "0.06", "0.08", "0.093", "0.103", "0.113", "0.123")
_STATE_THRESHOLDS = {
    2023: ("0", "10412", "24684", "38959", "54081", "68350", "349137", "418961", "698271"),
    2024: ("0", "10756", "25499", "40245", "55867", "70607", "360659", "432787", "721314"),
    2025: ("0", "11079", "26264", "41452", "57542", "72724", "371479", "445771", "742953"),
}
_STATE_THRESHOLDS[2026] = _STATE_THRESHOLDS[2025]

_MEDICARE_RATES = ("0.0145", "0.0235")
_MEDICARE_THRESHOLDS = ("0", "200000")

_SS_RATES = ("0.062", "0")
_SS_THRESHOLDS = {
    2023: ("0", "160200"),
    2024: ("0", "168600"),
    2025: ("0", "176100"),
    2026: ("0", "176100"),
}

_SDI_RATES = {2023: ("0.009", "0"), 2024: ("0.01", "0"), 2025: ("0.01", "0"), 2026: ("0.01", "0")}
_SDI_THRESHOLDS = {
    2023: ("0", "153164"),
    2024: ("0", "195000"),
    2025: ("0", "270000"),
    2026: ("0", "300000"),
}

# Bracket-2/3 rates fold NIIT in from 2024 (the sheet's IF(agi > 200000, ...) cached values).
_CG_RATES = {
    2023: ("0", "0.15", "0.20"),
    2024: ("0", "0.188", "0.238"),
    2025: ("0", "0.188", "0.238"),
    2026: ("0", "0.188", "0.238"),
}
_CG_THRESHOLDS = {
    2023: ("0", "44625", "492300"),
    2024: ("0", "47026", "518900"),
    2025: ("0", "48351", "533400"),
}
_CG_THRESHOLDS[2026] = _CG_THRESHOLDS[2025]

YEAR_BRACKETS: dict[int, dict[str, list[tuple[Decimal, Decimal]]]] = {
    year: {
        "federal": _table(_FED_RATES, _FED_THRESHOLDS[year]),
        "state": _table(_STATE_RATES, _STATE_THRESHOLDS[year]),
        "medicare": _table(_MEDICARE_RATES, _MEDICARE_THRESHOLDS),
        "social_security": _table(_SS_RATES, _SS_THRESHOLDS[year]),
        "disability": _table(_SDI_RATES[year], _SDI_THRESHOLDS[year]),
        "capital_gains": _table(_CG_RATES[year], _CG_THRESHOLDS[year]),
    }
    for year in YEARS
}

# The canonical model's expected outputs, at cents.
_CANONICAL_TABLE: dict[str, tuple[str, str, str, str]] = {
    "fed_agi": ("117726.64", "211776.20", "259376.05", "280128.21"),
    "fed_deduction": ("13850.00", "14600.00", "27213.28", "29824.00"),
    "fed_ti": ("103876.64", "197176.20", "232162.77", "250304.21"),
    "fed_tax": ("18330.39", "40782.88", "51355.09", "57160.35"),
    "state_agi": ("119746.28", "215122.02", "262132.89", "284428.21"),
    "state_ti": ("114383.28", "209582.02", "256426.89", "278722.21"),
    "state_tax": ("7146.50", "15884.46", "20139.34", "22206.80"),
    "medicare_tax": ("1490.92", "3634.95", "4582.05", "5299.21"),
    "ss_tax": ("6374.99", "10453.20", "10918.20", "10918.20"),
    "sdi_tax": ("944.90", "1950.00", "2700.00", "3000.00"),
    "cg_amount": ("129.00", "179.13", "1267.19", "0.00"),
    "cg_tax": ("19.35", "33.68", "238.23", "0.00"),
    "gross_income": ("126321.23", "237973.17", "287209.06", "306694.03"),
    "total_tax": ("34307.05", "72739.17", "89932.91", "98584.56"),
    "take_home": ("92014.18", "165234.00", "197276.15", "208109.47"),
}

CANONICAL: dict[int, dict[str, Decimal]] = {
    year: {quantity: Decimal(column[index]) for quantity, column in _CANONICAL_TABLE.items()}
    for index, year in enumerate(YEARS)
}


def breakdown_for(year: int) -> object:
    return compute_breakdown(year, YEAR_INPUTS[year], YEAR_BRACKETS[year])


def actuals(breakdown) -> dict[str, Decimal]:
    """Map the breakdown onto the workbook's row names (the deduction is the AGI-to-TI
    step, which the dataclass carries implicitly)."""
    return {
        "fed_agi": breakdown.federal.agi,
        "fed_deduction": breakdown.federal.agi - breakdown.federal.taxable_income,
        "fed_ti": breakdown.federal.taxable_income,
        "fed_tax": breakdown.federal.tax,
        "state_agi": breakdown.state.agi,
        "state_ti": breakdown.state.taxable_income,
        "state_tax": breakdown.state.tax,
        "medicare_tax": breakdown.medicare.tax,
        "ss_tax": breakdown.social_security.tax,
        "sdi_tax": breakdown.disability.tax,
        "cg_amount": breakdown.capital_gains.gains_amount,
        "cg_tax": breakdown.capital_gains.tax,
        "gross_income": breakdown.totals.gross_income,
        "total_tax": breakdown.totals.total_tax,
        "take_home": breakdown.totals.take_home,
    }


def assert_canonical(year: int):
    breakdown = breakdown_for(year)
    assert breakdown.year == year
    assert breakdown.warnings == []
    produced = actuals(breakdown)
    assert set(produced) == set(CANONICAL[year])
    for quantity, expected in CANONICAL[year].items():
        assert cents(produced[quantity]) == expected, f"{year} {quantity}"
    return breakdown


# --------------------------------------------------------------------------------------
# walk()
# --------------------------------------------------------------------------------------


def test_walk_2024_federal():
    # 11600×.10 + 35550×.12 + 53375×.22 + 91425×.24 + 5226.2×.32
    #   = 1160 + 4266 + 11742.50 + 21942 + 1672.384
    assert walk(YEAR_BRACKETS[2024]["federal"], Decimal("197176.20")) == Decimal("40782.884")


def test_walk_income_below_first_threshold():
    # Defensive: a table whose lowest bracket starts above 0 must not tax income that
    # never reaches it (the API guarantees thresholds[0] == 0; the walker does not rely on it).
    brackets = _table(("0.10", "0.20"), ("1000", "2000"))
    assert walk(brackets, Decimal("500")) == Decimal("0")
    assert walk(brackets, Decimal("1000")) == Decimal("0")
    assert walk(brackets, Decimal("1500")) == Decimal("50")


def test_walk_zero_and_negative_income():
    federal = YEAR_BRACKETS[2024]["federal"]
    assert walk(federal, Decimal("0")) == Decimal("0")
    assert walk(federal, Decimal("-25000")) == Decimal("0")


def test_walk_income_inside_first_bracket():
    assert walk(YEAR_BRACKETS[2024]["federal"], Decimal("5000")) == Decimal("500")


def test_walk_exactly_on_threshold():
    # The boundary belongs to the bracket below it: 11600 is entirely taxed at 10%.
    federal = YEAR_BRACKETS[2024]["federal"]
    assert walk(federal, Decimal("11600")) == Decimal("1160")
    assert walk(federal, Decimal("11600.01")) == Decimal("1160") + Decimal("0.01") * Decimal("0.12")


def test_walk_empty_brackets_is_zero():
    # A jurisdiction with no rows contributes nothing (compute_breakdown warns separately).
    assert walk([], Decimal("250000")) == Decimal("0")


def test_walk_sorts_defensively():
    scrambled = list(reversed(YEAR_BRACKETS[2024]["federal"]))
    assert walk(scrambled, Decimal("197176.20")) == Decimal("40782.884")


# --------------------------------------------------------------------------------------
# stack()
# --------------------------------------------------------------------------------------


def test_stack_within_single_bracket():
    # 2025 CG pin — deliberately the SHEET's taxable income (D2 drift), which lands in the
    # same CG bracket (48351..533400) as the canonical TI, so the pin holds either way.
    gains = stack(YEAR_BRACKETS[2025]["capital_gains"], Decimal("233429.958"), Decimal("1267.19"))
    assert gains == Decimal("238.23172")


def test_stack_spans_brackets():
    # 2023 CG table: [40000, 44625) at 0% then [44625, 60000) at 15%.
    gains = stack(YEAR_BRACKETS[2023]["capital_gains"], Decimal("40000"), Decimal("20000"))
    assert gains == Decimal("2306.25")


def test_stack_negative_base_clamps():
    gains = stack(YEAR_BRACKETS[2023]["capital_gains"], Decimal("-5000"), Decimal("1000"))
    assert gains == Decimal("0")


def test_stack_zero_amount():
    capital_gains = YEAR_BRACKETS[2025]["capital_gains"]
    assert stack(capital_gains, Decimal("232162.77"), Decimal("0")) == Decimal("0")
    assert stack(capital_gains, Decimal("232162.77"), Decimal("-4000")) == Decimal("0")


# --------------------------------------------------------------------------------------
# Canonical goldens
# --------------------------------------------------------------------------------------


def test_golden_2023():
    breakdown = assert_canonical(2023)
    # LTCG is a 670 loss that does NOT net against the 129 of qualified dividends: the
    # net would be negative, so the sheet drops the loss and taxes the dividends alone.
    assert breakdown.capital_gains.gains_amount == Decimal("129")
    assert breakdown.capital_gains.taxable_income == breakdown.federal.taxable_income


def test_golden_2024():
    breakdown = assert_canonical(2024)
    assert breakdown.capital_gains.effective_rate == Decimal("0.188")
    assert breakdown.medicare.w2_income == Decimal("235724.46")
    assert breakdown.medicare.taxable_wages == Decimal("231274.46")
    assert breakdown.social_security.taxable_wages == Decimal("168600")
    assert breakdown.disability.taxable_wages == Decimal("235424.46")
    assert breakdown.totals.total_income == breakdown.federal.agi


def test_golden_2024_equals_sheet_cached_values():
    """2024 is the drift-free column, so canonical == sheet, not merely close.

    The five quantities carrying a product (the state chain, which subtracts
    treasuries × exempt-pct, and the totals built on it) are compared against the cached
    cell's 10-significant-figure float rendering; everything else is bit-exact.
    """
    breakdown = breakdown_for(2024)
    produced = actuals(breakdown)
    exact = {
        "fed_agi": "211776.2",
        "fed_ti": "197176.2",
        "fed_tax": "40782.884",
        "medicare_tax": "3634.94981",
        "ss_tax": "10453.2",
        "sdi_tax": "1950",
        "cg_amount": "179.13",
        "cg_tax": "33.67644",
        "gross_income": "237973.17",
    }
    for quantity, cached in exact.items():
        assert produced[quantity] == Decimal(cached), quantity
    assert breakdown.totals.total_income == Decimal("211776.2")
    assert breakdown.medicare.taxable_wages == Decimal("231274.46")
    assert breakdown.social_security.taxable_wages == Decimal("168600")
    assert breakdown.disability.taxable_wages == Decimal("235424.46")

    rendered = {
        "state_agi": "215122.0164",
        "state_ti": "209582.0164",
        "state_tax": "15884.45652",
        "total_tax": "72739.16677",
        "take_home": "165234.0032",
    }
    for quantity, cached in rendered.items():
        assert abs(produced[quantity] - Decimal(cached)) < Decimal("0.0001"), quantity


def test_golden_2025():
    breakdown = assert_canonical(2025)
    # The sheet's 2025 column pulls CG into fed AGI (D2); the canonical AGI does not, so
    # it equals the sheet's own untouched "Total Income" row instead.
    assert cents(breakdown.federal.agi) == Decimal("259376.05")
    assert breakdown.capital_gains.gains_amount == Decimal("1267.19")


def test_golden_2026():
    breakdown = assert_canonical(2026)
    # Itemized (29824) beats the 16100 standard deduction; the sheet hardcoded 15750 (D3).
    assert breakdown.federal.agi - breakdown.federal.taxable_income == Decimal("29824")
    assert breakdown.capital_gains.gains_amount == Decimal("0")
    assert breakdown.capital_gains.effective_rate is None
    assert breakdown.social_security.taxable_wages == Decimal("176100")


def test_effective_rates_are_full_precision_ratios():
    breakdown = breakdown_for(2023)
    assert breakdown.federal.effective_rate == breakdown.federal.tax / breakdown.federal.agi
    assert breakdown.state.effective_rate == breakdown.state.tax / breakdown.state.agi
    assert breakdown.medicare.effective_rate == breakdown.medicare.tax / Decimal("105065.08")
    assert breakdown.social_security.effective_rate == (
        breakdown.social_security.tax / Decimal("105065.08")
    )
    assert breakdown.disability.effective_rate == breakdown.disability.tax / Decimal("105065.08")
    assert breakdown.totals.effective_rate == (
        breakdown.totals.total_tax / breakdown.totals.gross_income
    )


def test_capital_loss_deductions_never_reach_agi():
    """r27 is a modelled line the sheet never wires into any output formula."""
    inputs = dict(YEAR_INPUTS[2024]) | {"capital_loss_deductions": Decimal("-3000")}
    assert (
        breakdown_for(2024).federal.agi
        == compute_breakdown(2024, inputs, YEAR_BRACKETS[2024]).federal.agi
    )


@pytest.mark.parametrize(
    ("ltcg", "qualified", "other", "expected"),
    [
        ("536.38", "719.81", "11", "1267.19"),  # gain: everything nets
        ("-100", "500", "0", "400"),  # loss, net still positive: nets
        ("-670", "129", "0", "129"),  # loss, net negative: loss is dropped
        ("0", "179.13", "0", "179.13"),  # no LTCG line at all
    ],
)
def test_capital_gains_amount_branches(ltcg, qualified, other, expected):
    inputs = {
        "ltcg_total": Decimal(ltcg),
        "qualified_dividends": Decimal(qualified),
        "other_capital_gains": Decimal(other),
    }
    breakdown = compute_breakdown(2025, inputs, YEAR_BRACKETS[2025])
    assert breakdown.capital_gains.gains_amount == Decimal(expected)


# --------------------------------------------------------------------------------------
# Sheet drift pins (D1-D3)
# --------------------------------------------------------------------------------------


def test_sheet_drift_2023_qdiv_minus_one():
    """2023 r97 is `=C96-C43-C41-1`: it subtracts qualified dividends that were never in
    its AGI, plus a stray literal 1 — 130 of phantom deduction, 31.20 of lost tax."""
    breakdown = breakdown_for(2023)
    drifted_ti = breakdown.federal.taxable_income - Decimal("129") - Decimal("1")
    assert drifted_ti == Decimal("103746.64")  # sheet r97c3
    drifted_tax = walk(YEAR_BRACKETS[2023]["federal"], drifted_ti)
    assert drifted_tax == Decimal("18299.1936")  # sheet r98c3
    assert breakdown.federal.tax - drifted_tax == Decimal("31.20")


def test_sheet_drift_2025_cg_in_agi():
    """2025 r96 adds LTCG + qualified dividends + other CG into fed AGI, contradicting its
    own r122 and double-taxing gains that the CG stack already charges."""
    breakdown = breakdown_for(2025)
    doubled = Decimal("1267.19")

    drifted_agi = breakdown.federal.agi + doubled
    assert drifted_agi == Decimal("260643.24")  # sheet r96c5
    drifted_ti = drifted_agi - (breakdown.federal.agi - breakdown.federal.taxable_income)
    assert drifted_ti == Decimal("233429.958")  # sheet r97c5
    drifted_tax = walk(YEAR_BRACKETS[2025]["federal"], drifted_ti)
    assert drifted_tax == Decimal("51760.58656")  # sheet r98c5
    assert cents(drifted_tax - breakdown.federal.tax) == Decimal("405.50")  # 1267.19 × .32

    # The inflated AGI flows into the state chain too.
    drifted_state_ti = breakdown.state.taxable_income + doubled
    drifted_state_tax = (
        walk(YEAR_BRACKETS[2025]["state"], drifted_state_ti)
        - YEAR_INPUTS[2025]["state_exemption_credits"]
    )
    assert abs(drifted_state_tax - Decimal("20257.18732")) < Decimal("0.001")
    assert cents(drifted_state_tax - breakdown.state.tax) == Decimal("117.85")


def test_sheet_drift_2026_stale_deduction():
    """2026 r43 is a hardcoded 15750 (2025's standard deduction) instead of its own
    max(16100, 29824), and r97 keeps 2023's stray `-F41-1` tail."""
    breakdown = breakdown_for(2026)
    drifted_ti = breakdown.federal.agi - Decimal("15750") - Decimal("1")
    assert drifted_ti == Decimal("264377.2067")  # sheet r97c6
    drifted_tax = walk(YEAR_BRACKETS[2026]["federal"], drifted_ti)
    assert abs(drifted_tax - Decimal("62079.27233")) < Decimal("0.001")
    assert cents(drifted_tax) == Decimal("62079.27")
    assert cents(drifted_tax - breakdown.federal.tax) == Decimal("4918.93")


# --------------------------------------------------------------------------------------
# derive_suggestions()
# --------------------------------------------------------------------------------------


def test_suggestions_match_stored_2025():
    """2025 is the year whose stored derived cells are all exactly reproducible (its
    gross_paycheck, 162000/24, is exact at 4dp — 2023/2026 store a rounded paycheck that
    the sheet multiplies at full precision)."""
    suggested = derive_suggestions(2025, YEAR_INPUTS[2025])
    expected = {
        "gross_paycheck": "6750",
        "latest_w2_income": "135000",
        "other_w2_income": "141176.78",
        "stcg_total": "8040.08",
        "unqualified_dividends": "1653.14",
        "interest_total": "62.87",
        "capital_loss_deductions": "0",
        "other_pretax_deductions": "300",
        "itemized_deduction": "27213.282",
        "ltcg_total": "536.38",
    }
    assert set(suggested) == set(expected)
    for key, value in expected.items():
        assert suggested[key] == Decimal(value), key
        assert suggested[key] == YEAR_INPUTS[2025][key], key
        assert suggested[key].as_tuple().exponent == -4, key


def test_suggestion_salt_cap_2024_vs_2025():
    """The SALT cap is 10000 through 2024 and 40000 from 2025 (the sheet hardcodes it per
    column). Same items, different year, different answer."""
    items = {
        "itemized_salt": Decimal("17488.59"),
        "itemized_donations": Decimal("0"),
        "itemized_vehicle_reg": Decimal("16"),
        "itemized_sec199a_div": Decimal("0"),
        "itemized_other": Decimal("0"),
    }
    # Capped: 10000 + 16. Matches the stored 2024 itemized_deduction exactly.
    assert derive_suggestions(2024, items)["itemized_deduction"] == Decimal("10016")
    assert (
        derive_suggestions(2024, items)["itemized_deduction"]
        == YEAR_INPUTS[2024]["itemized_deduction"]
    )
    # Uncapped under 40000: the full 17488.59 + 16.
    assert derive_suggestions(2025, items)["itemized_deduction"] == Decimal("17504.59")
    assert derive_suggestions(2023, items)["itemized_deduction"] == Decimal("10016")


@pytest.mark.parametrize(
    ("standard", "espp", "ltcg", "expected"),
    [
        ("754", "0", "-670", "84"),  # loss nets, net still positive
        ("8040.08", "0", "536.38", "8040.08"),  # LTCG gain never touches the STCG line
        ("951.93", "0", "0", "951.93"),  # no LTCG line
        ("100", "0", "-500", "0"),  # loss swamps the gain: STCG floors at 0
        ("-100", "0", "0", "0"),  # a standalone STCG loss floors at 0 too
        ("600", "154", "-670", "84"),  # the ESPP component joins `s`
    ],
)
def test_suggestion_stcg_netting_branches(standard, espp, ltcg, expected):
    inputs = {
        "stcg_standard": Decimal(standard),
        "stcg_espp_component": Decimal(espp),
        "ltcg_total": Decimal(ltcg),
    }
    assert derive_suggestions(2025, inputs)["stcg_total"] == Decimal(expected)


def test_suggestion_capital_loss_negative():
    inputs = {"ltcg_total": Decimal("-5000"), "stcg_standard": Decimal("1000")}
    suggested = derive_suggestions(2025, inputs)
    assert suggested["capital_loss_deductions"] == Decimal("-4000")
    assert suggested["stcg_total"] == Decimal("0")  # the loss lands on r27, not the STCG line


def test_suggestions_default_missing_references_to_zero():
    """Empty sheet cells are zeros, so every suggestion is always offered."""
    suggested = derive_suggestions(2027, {})
    assert len(suggested) == 10
    assert all(value == Decimal("0") for value in suggested.values())


def test_suggestion_gross_paycheck_always_divides_by_24():
    # pay_periods is the year-to-date count, NOT the annual cadence the sheet divides by.
    inputs = {"annual_salary": Decimal("145000"), "pay_periods": Decimal("9")}
    assert derive_suggestions(2023, inputs)["gross_paycheck"] == Decimal("6041.6667")


def test_social_security_cap_needs_a_zero_rate_top_bracket():
    """r109's min() is a display convenience over a wage base modelled as a terminal
    0-rate bracket. It must never swallow wages a stored table would really tax — the
    API permits any 1..12-row shape."""
    wages = Decimal("231274.46")  # 2024 medicare wages

    single_row = dict(YEAR_BRACKETS[2024]) | {"social_security": _table(("0.062",), ("0",))}
    breakdown = compute_breakdown(2024, YEAR_INPUTS[2024], single_row)
    assert breakdown.social_security.taxable_wages == wages
    assert breakdown.social_security.tax == wages * Decimal("0.062")

    progressive = dict(YEAR_BRACKETS[2024]) | {
        "social_security": _table(("0.062", "0.05"), ("0", "168600"))
    }
    breakdown = compute_breakdown(2024, YEAR_INPUTS[2024], progressive)
    assert breakdown.social_security.taxable_wages == wages
    assert breakdown.social_security.tax == Decimal("168600") * Decimal("0.062") + (
        wages - Decimal("168600")
    ) * Decimal("0.05")


# --------------------------------------------------------------------------------------
# Warnings
# --------------------------------------------------------------------------------------


def test_engine_keys_are_defined_tax_keys():
    defined = [key for key, *_ in TAX_INPUT_DEFINITIONS]
    assert set(ENGINE_INPUT_KEYS) <= set(defined)
    assert list(ENGINE_INPUT_KEYS) == [key for key in defined if key in set(ENGINE_INPUT_KEYS)]


def test_missing_inputs_warning():
    inputs = dict(YEAR_INPUTS[2024])
    del inputs["interest_total"]
    del inputs["qualified_dividends"]
    breakdown = compute_breakdown(2024, inputs, YEAR_BRACKETS[2024])
    assert breakdown.warnings == [
        "missing inputs defaulted to 0: interest_total, qualified_dividends"
    ]
    # Defaulted to 0, not skipped: AGI drops by exactly the missing interest.
    assert breakdown.federal.agi == Decimal("211776.2") - Decimal("24.76")
    assert breakdown.capital_gains.gains_amount == Decimal("0")
    assert breakdown.capital_gains.effective_rate is None


def test_missing_jurisdiction_zero_and_warning():
    full = breakdown_for(2024)
    dropped = dict(YEAR_BRACKETS[2024])
    del dropped["disability"]
    breakdown = compute_breakdown(2024, YEAR_INPUTS[2024], dropped)
    assert breakdown.disability.tax == Decimal("0")
    assert breakdown.disability.effective_rate == Decimal("0")
    assert breakdown.warnings == [
        JURISDICTION_WARN_MISSING.format(j="disability", year=2024),
    ]
    assert breakdown.totals.total_tax == full.totals.total_tax - Decimal("1950")

    # A jurisdiction explicitly replaced with an empty list reads the same way.
    emptied = dict(YEAR_BRACKETS[2024]) | {"disability": []}
    assert compute_breakdown(2024, YEAR_INPUTS[2024], emptied).warnings == breakdown.warnings


def test_negative_state_tax_warning():
    inputs = dict(YEAR_INPUTS[2024]) | {"state_exemption_credits": Decimal("1000000")}
    breakdown = compute_breakdown(2024, inputs, YEAR_BRACKETS[2024])
    assert cents(breakdown.state.tax) == Decimal("15884.46") + Decimal("149") - Decimal("1000000")
    assert NEGATIVE_STATE_TAX_WARNING in breakdown.warnings
    assert breakdown.state.tax < 0


def test_niit_advisory_flags_mismatch():
    base_rates = YEAR_BRACKETS[2023]["capital_gains"]  # .15/.20
    niit_rates = YEAR_BRACKETS[2024]["capital_gains"]  # .188/.238

    assert niit_advisory(Decimal("250000"), base_rates) == (
        "capital-gains rates 0.15/0.20 contradict the sheet's NIIT rule for this AGI "
        "(above 200000 implies 0.188/0.238)"
    )
    assert niit_advisory(Decimal("150000"), base_rates) is None
    assert niit_advisory(Decimal("250000"), niit_rates) is None
    assert niit_advisory(Decimal("150000"), niit_rates) == (
        "capital-gains rates 0.188/0.238 contradict the sheet's NIIT rule for this AGI "
        "(at or below 200000 implies 0.15/0.20)"
    )
    assert niit_advisory(Decimal("200000"), base_rates) is None  # the rule is strictly >


def test_niit_advisory_tolerates_short_tables():
    assert niit_advisory(Decimal("250000"), []) is None
    assert niit_advisory(Decimal("250000"), YEAR_BRACKETS[2023]["capital_gains"][:2]) is None


def test_niit_advisory_reaches_the_breakdown_warnings():
    mismatched = dict(YEAR_BRACKETS[2024]) | {"capital_gains": YEAR_BRACKETS[2023]["capital_gains"]}
    breakdown = compute_breakdown(2024, YEAR_INPUTS[2024], mismatched)
    assert breakdown.warnings == [
        "capital-gains rates 0.15/0.20 contradict the sheet's NIIT rule for this AGI "
        "(above 200000 implies 0.188/0.238)"
    ]
    # The engine still walks the STORED rates verbatim — the advisory never edits them.
    assert breakdown.capital_gains.tax == Decimal("179.13") * Decimal("0.15")
