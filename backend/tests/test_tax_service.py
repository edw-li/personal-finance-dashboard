"""Tax-engine goldens: the sheet's 2023-2026 columns, to the cent (spec §9).

Fixtures are the pinned workbook values (== the dev DB's imported `tax_inputs` /
`tax_brackets`, 4dp-quantized). Three families of assertion:

* **canonical goldens** — the clean model the engine ships, one test per year (NIIT and
  the base-rate CG stack included since 2026-08-31 — the fixtures model the
  post-f7d3b2a91c40 database);
* **sheet equality for 2024** — 2024 is the drift-free column, so its canonical values ARE
  the sheet's cached values everywhere but the state chain, which sits exactly one CA
  capital-gains divergence above them (2026-08-25 spec §1), and the CG/NIIT split, which
  sits exactly one NIIT unfold apart (2026-08-31 spec C2); both are pinned as sheet value
  + delta, the cached cells being 10-significant-figure float renderings compared within
  1e-4;
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
    SUGGESTION_KEYS,
    ZERO,
    compute_breakdown,
    derive_suggestions,
    materialize_household,
    materialize_person,
    niit_advisory,
    stack,
    walk,
)
from app.tax_keys import (
    DERIVED_KEYS,
    INPUT_UNITS,
    PER_PERSON_DERIVED_KEYS,
    TAX_INPUT_DEFINITIONS,
    TAX_INPUT_UNITS,
    unit_for,
)

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

# Base rates in every year: the sheet folded NIIT into brackets 2/3 from 2024
# (IF(agi > 200000, 18.8%, 15%) cached values), and migration f7d3b2a91c40 rewrote the
# exact folded pair back to 15/20 — the engine computes NIIT as its own line, so these
# fixtures are the post-migration database. The folded pair survives only in the
# advisory/importer tests, which exist to catch it.
_CG_RATES = {
    2023: ("0", "0.15", "0.20"),
    2024: ("0", "0.15", "0.20"),
    2025: ("0", "0.15", "0.20"),
    2026: ("0", "0.15", "0.20"),
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
    # NEW ROW 2026-09-09 (spec 4f). `fed_agi` above is the sheet's r96, the ORDINARY income
    # the federal brackets walk; the federal line's reported Base is now true AGI, which
    # carries the netted gains as every real 1040 does. The two differ by exactly
    # cg_amount, so 2026 (no gains) is the control.
    "fed_base": ("117855.64", "211955.33", "260643.24", "280128.21"),
    # `fed_deduction` is the AGI-to-TI step, which since 2026-09-09 (spec 4h) carries
    # §199A as well as max(standard, itemized).
    #
    # MOVED BACK 2026-09-11 (spec §1.3), the ONLY golden movement of that batch: 4h left
    # §199A below the line while the STORED itemized totals still had it inside them, so
    # 2025/2026 deducted the same dollars twice (+6.222 / +8) — the drift production's
    # census found and `check_sec199a_in_itemized` existed to name. The engine now REBUILDS
    # the itemized total from its components, which excludes §199A by construction, so the
    # line is counted exactly once and these three rows return to their pre-4h figures:
    # 2025 deduction 27219.50 -> 27213.28 (== the sheet's own cached itemized cell), TI
    # 232156.55 -> 232162.77, tax 51353.09 -> 51355.09; 2026 deduction 29832.00 ->
    # 29824.00, TI 250296.21 -> 250304.21, tax 57157.79 -> 57160.35. 2023/2024 store no QBI
    # dividends and are byte-identical controls, `test_golden_2024_equals_sheet_cached_values`
    # included. The INPUT fixtures did not move: `_INPUT_TABLE` is still the imported
    # database, and is now the oracle `test_materialize_reproduces_every_derived_fixture_cell`
    # reads.
    "fed_deduction": ("13850.00", "14600.00", "27213.28", "29824.00"),
    "fed_ti": ("103876.64", "197176.20", "232162.77", "250304.21"),
    "fed_tax": ("18330.39", "40782.88", "51355.09", "57160.35"),
    # 2023 moved 2026-09-09 (spec 4b): California does not tax interest on US Treasury
    # obligations, and state AGI subtracted only the exempt slice of treasury-FUND
    # dividends. 2023 is the only pinned year with a direct treasury-interest line
    # (20668.00), so it is the only column that moves: state AGI 119875.28 -> 99207.28,
    # state TI 114512.28 -> 93844.28, state tax 7158.49 -> 5236.37.
    "state_agi": ("99207.28", "215301.15", "263400.08", "284428.21"),
    "state_ti": ("93844.28", "209761.15", "257694.08", "278722.21"),
    "state_tax": ("5236.37", "15901.12", "20257.19", "22206.80"),
    "medicare_tax": ("1490.92", "3634.95", "4582.05", "5299.21"),
    "ss_tax": ("6374.99", "10453.20", "10918.20", "10918.20"),
    "sdi_tax": ("944.90", "1950.00", "2700.00", "3000.00"),
    "cg_amount": ("129.00", "179.13", "1267.19", "0.00"),
    "cg_tax": ("19.35", "26.87", "190.08", "0.00"),
    # NIIT = 0.038 x min(NII, max(0, MAGI - 200000)); NII = interest + unq divs
    # + max(stcg, 0) + max(cg_amount, 0); MAGI = fed AGI + cg_amount.
    #   2023: MAGI 117855.64 <= 200000 -> 0 (NII 21250.15 never consulted).
    #   2024: NII 24.76+833.46+951.93+179.13 = 1989.28; excess 11955.33; NII binds ->
    #         0.038 x 1989.28 = 75.59264.
    #   2025: NII 62.87+1653.14+8040.08+1267.19 = 11023.28; excess 60643.24; NII binds ->
    #         0.038 x 11023.28 = 418.88464.
    #   2026: NII 0 -> 0.
    "niit": ("0.00", "75.59", "418.88", "0.00"),
    "gross_income": ("126321.23", "237973.17", "287209.06", "306694.03"),
    # 2024: 72755.83 - (33.68 - 26.87 cg unfold, exactly 179.13 x 0.038 = 6.80694 at full
    # precision) + 75.59264 NIIT = 72824.61; take_home moves opposite. 2025: 90050.76
    # - 1267.19 x 0.038 (48.15322) + 418.88464 = 90421.49. 2026: unchanged control.
    # 2023 moved with its state tax (spec 4b): 34319.05 - 1922.124 = 32396.93, and
    # take_home 92002.18 -> 93924.30 by the same amount in the other direction. 2025/2026
    # moved with §199A (spec 4h) and moved BACK with the computed itemized total
    # (2026-09-11 spec §1.3, see fed_deduction above): total tax 90419.50 -> 90421.49 and
    # 98582.00 -> 98584.56, take_home 196789.56 -> 196787.57 and 208112.03 -> 208109.47.
    "total_tax": ("32396.93", "72824.61", "90421.49", "98584.56"),
    "take_home": ("93924.30", "165148.56", "196787.57", "208109.47"),
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
        # The workbook's r96 is ORDINARY AGI, which the engine reports as totals.total_income;
        # federal.agi is the true-AGI Base (spec 4f), pinned on its own row.
        "fed_agi": breakdown.totals.total_income,
        "fed_base": breakdown.federal.agi,
        "fed_deduction": breakdown.totals.total_income - breakdown.federal.taxable_income,
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
        "niit": breakdown.niit.tax,
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
    # 1267.19 x 0.15 at the post-migration base rate; the drift-TI base still lands in the
    # same 48351..533400 tier.
    assert gains == Decimal("190.07850")


def test_stack_spans_brackets():
    # 2023 CG table: [40000, 44625) at 0% then [44625, 60000) at 15%.
    gains = stack(YEAR_BRACKETS[2023]["capital_gains"], Decimal("40000"), Decimal("20000"))
    assert gains == Decimal("2306.25")


def test_stack_negative_base_clamps():
    capital_gains = YEAR_BRACKETS[2023]["capital_gains"]
    assert stack(capital_gains, Decimal("-5000"), Decimal("1000")) == Decimal("0")
    # The clamp is load-bearing here: the gains occupy [0, 50000], so 44625 of them are at
    # 0% and (50000-44625)×.15 = 806.25 is taxed. Sliding the interval down to
    # [-5000, 45000] instead would tax only 375 × .15 = 56.25.
    assert stack(capital_gains, Decimal("-5000"), Decimal("50000")) == Decimal("806.25")


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
    assert breakdown.capital_gains.effective_rate == Decimal("0.15")
    assert breakdown.medicare.w2_income == Decimal("235724.46")
    assert breakdown.medicare.taxable_wages == Decimal("231274.46")
    assert breakdown.social_security.taxable_wages == Decimal("168600")
    assert breakdown.disability.taxable_wages == Decimal("235424.46")
    # The sheet's Total Income row is ORDINARY AGI; the federal Base sits exactly the
    # netted gains above it (spec 4f).
    assert breakdown.totals.total_income == Decimal("211776.2")
    assert breakdown.federal.agi - breakdown.totals.total_income == Decimal("179.13")


def test_golden_2024_equals_sheet_cached_values():
    """2024 is the drift-free column, so canonical == sheet — EXCEPT the state chain and
    the CG/NIIT split.

    The five state-chain quantities diverge by exactly the CA capital-gains fix
    (2026-08-25 spec §1: state AGI carries cg_amount; the sheet's never did), and the CG
    line diverges by exactly the NIIT unfold (2026-08-31 spec C2), so they are pinned as
    the sheet's cached value PLUS the fix's delta — the divergence itself stays exact.
    Everything else is the cached cell: bit-exact where no product is involved,
    within 1e-4 where one is (cached cells are 10-significant-figure float renderings).
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
        "gross_income": "237973.17",
    }
    for quantity, cached in exact.items():
        assert produced[quantity] == Decimal(cached), quantity
    assert breakdown.totals.total_income == Decimal("211776.2")
    assert breakdown.medicare.taxable_wages == Decimal("231274.46")
    assert breakdown.social_security.taxable_wages == Decimal("168600")
    assert breakdown.disability.taxable_wages == Decimal("235424.46")

    # The state chain vs the sheet: AGI/TI sit exactly cg_amount above the cached cells,
    # and the three money outcomes exactly one 9.3%-bracket walk above/below — the
    # documented direction (the app's state tax >= the sheet's for a CG year).
    cg = Decimal("179.13")
    state_delta = walk(YEAR_BRACKETS[2024]["state"], produced["state_ti"]) - walk(
        YEAR_BRACKETS[2024]["state"], produced["state_ti"] - cg
    )
    assert state_delta == cg * Decimal("0.093")  # no bracket boundary crossed
    # The CG/NIIT split vs the sheet (2026-08-31 spec C2): the sheet folded the 3.8%
    # surcharge into its 18.8% CG rate; the app stores the base 15% and charges NIIT as
    # its own line. cg_tax = sheet's 33.67644 minus the folded 179.13 x 0.038; the NIIT
    # line is 0.038 x min(NII 1989.28, MAGI excess 11955.33) = 75.59264 — MORE than the
    # unfold, because NIIT reaches interest/dividends/STCG the CG bracket never taxed.
    unfold = cg * Decimal("0.038")  # 6.80694
    niit = Decimal("75.59264")
    assert produced["cg_tax"] == Decimal("33.67644") - unfold
    assert produced["niit"] == niit
    sheet = {
        "state_agi": (Decimal("215122.0164"), cg),
        "state_ti": (Decimal("209582.0164"), cg),
        "state_tax": (Decimal("15884.45652"), state_delta),
        "total_tax": (Decimal("72739.16677"), state_delta - unfold + niit),
        "take_home": (Decimal("165234.0032"), -(state_delta - unfold + niit)),
    }
    for quantity, (cached, delta) in sheet.items():
        assert abs(produced[quantity] - (cached + delta)) < Decimal("0.0001"), quantity


def test_golden_2025():
    breakdown = assert_canonical(2025)
    # The sheet's 2025 column pulls CG into the AGI it then WALKS THE BRACKETS OVER (D2);
    # the canonical ordinary AGI does not, so it equals the sheet's own untouched "Total
    # Income" row instead. The reported Base does carry the gains (spec 4f) and so happens
    # to land on the sheet's drifted figure — same number, different job: the drift taxes
    # the gains at ordinary rates, the Base only reports them.
    assert cents(breakdown.totals.total_income) == Decimal("259376.05")
    assert cents(breakdown.federal.agi) == Decimal("260643.24")
    assert breakdown.capital_gains.gains_amount == Decimal("1267.19")


def test_golden_2026():
    breakdown = assert_canonical(2026)
    # Itemized (29824) beats the 16100 standard deduction; the sheet hardcoded 15750 (D3).
    # The AGI-to-TI step is 29832 rather than 29824 since 2026-09-09 (spec 4h): §199A's 8
    # of QBI dividends is a below-the-line deduction of its own, on top of the itemized
    # total the sheet had already folded it into.
    # 29824 = max(16100, the computed 29816) + the 8 of §199A, counted once: before the
    # totals were computed the stored itemized carried the same 8 inside it (spec §1.3).
    assert breakdown.federal.agi - breakdown.federal.taxable_income == Decimal("29824")
    assert breakdown.capital_gains.gains_amount == Decimal("0")
    assert breakdown.capital_gains.effective_rate is None
    assert breakdown.social_security.taxable_wages == Decimal("176100")


def test_federal_base_is_true_agi_and_the_rate_divides_by_it():
    """4f (2026-09-09 spec): the federal line reports AGI the way a 1040 does.

    `_federal_agi` keeps long-term gains and qualified dividends OUT so the brackets can be
    walked over ordinary income and the gains stacked separately — a bracket-walking device,
    not a definition of AGI. Reporting it as the federal "Base" understated the base by
    every dollar of preferential income and flattered the effective rate on exactly the
    years that had the most of it. Base 2025: 259376.05 -> 260643.24.
    """
    breakdown = breakdown_for(2025)
    assert breakdown.federal.agi == (
        breakdown.totals.total_income + breakdown.capital_gains.gains_amount
    )
    assert breakdown.federal.effective_rate == breakdown.federal.tax / breakdown.federal.agi
    # Lower than the old ratio over ordinary AGI alone, by construction: same tax, bigger
    # base.
    assert breakdown.federal.effective_rate < (
        breakdown.federal.tax / breakdown.totals.total_income
    )
    # A year with no preferential income is the control: the two are the same figure.
    control = breakdown_for(2026)
    assert control.federal.agi == control.totals.total_income


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


def test_effective_rate_never_serializes_negative_zero():
    """0 / negative-base is Decimal("-0"), which would render as "-0.000000" downstream."""
    breakdown = compute_breakdown(
        2024, {"trad_401k_contributions": Decimal("23000")}, YEAR_BRACKETS[2024]
    )
    assert breakdown.federal.agi == Decimal("-23000")
    assert breakdown.federal.tax == Decimal("0")
    assert breakdown.federal.effective_rate == Decimal("0")
    assert not breakdown.federal.effective_rate.is_signed()
    assert not breakdown.state.effective_rate.is_signed()

    # Only a base of exactly 0 is the sheet's #DIV/0! — no wages here, so no wage rates.
    assert breakdown.medicare.w2_income == Decimal("0")
    assert breakdown.medicare.effective_rate is None
    assert breakdown.social_security.effective_rate is None
    assert breakdown.disability.effective_rate is None
    assert breakdown.totals.gross_income == Decimal("0")
    assert breakdown.totals.effective_rate is None
    assert breakdown.niit.gains_amount == Decimal("0")
    assert breakdown.niit.effective_rate is None  # NII of 0 is the sheet's #DIV/0!


def test_effective_rate_over_a_negative_base_is_computed_not_none():
    """A negative base divides; only base == 0 is None. The sign semantics are the sheet's:
    a negative tax over a negative base reads as a positive rate, exactly as Excel would."""
    inputs = {
        "trad_401k_contributions": Decimal("10000"),
        "state_exemption_credits": Decimal("500"),
    }
    breakdown = compute_breakdown(2024, inputs, YEAR_BRACKETS[2024])
    assert breakdown.state.agi == Decimal("-10000")
    assert breakdown.state.tax == Decimal("-500")  # credits with no tax to offset
    assert breakdown.state.effective_rate == Decimal("0.05")


def test_capital_loss_deductions_reach_agi_and_the_state_chain():
    """r27 joined AGI on 2026-08-31 (spec C3): the sheet modelled the line and read it
    nowhere; the app reads it. Stored -3000 lowers federal AGI by exactly 3000 and the
    state chain inherits it through fed_agi (CA conforms to the $3k rule)."""
    inputs = dict(YEAR_INPUTS[2024]) | {"capital_loss_deductions": Decimal("-3000")}
    base = breakdown_for(2024)
    lossy = compute_breakdown(2024, inputs, YEAR_BRACKETS[2024])
    assert lossy.warnings == []  # negative and inside the cap: clean
    assert base.federal.agi - lossy.federal.agi == Decimal("3000")
    assert base.state.agi - lossy.state.agi == Decimal("3000")
    # A deduction, not income: gross income and NII are untouched...
    assert lossy.totals.gross_income == base.totals.gross_income
    assert lossy.niit.gains_amount == base.niit.gains_amount
    # ...and MAGI inherits the loss via fed AGI: 211955.33 - 3000 = 208955.33, whose
    # excess 8955.33 still exceeds NII 1989.28, so the NIIT line happens not to move here
    # (the visible MAGI shift is pinned in the next test).
    assert lossy.niit.tax == base.niit.tax


def test_capital_loss_pulls_magi_under_the_niit_threshold():
    """The C3->C2 interaction, stated: MAGI = _federal_agi + cg_amount and _federal_agi
    now carries the loss — statutorily correct (the §1211 deduction is inside AGI) — so a
    large enough loss zeroes the NIIT line. -13000 is over the cap ON PURPOSE: stored
    data is used verbatim and only warned about (GET never rejects stored data)."""
    inputs = dict(YEAR_INPUTS[2024]) | {"capital_loss_deductions": Decimal("-13000")}
    breakdown = compute_breakdown(2024, inputs, YEAR_BRACKETS[2024])
    # MAGI 211955.33 - 13000 = 198955.33 < 200000 -> excess 0.
    assert breakdown.niit.taxable_income == Decimal("0")
    assert breakdown.niit.tax == Decimal("0")
    assert breakdown.warnings == [
        "capital_loss_deductions (-13000) exceeds the statutory cap (-3000); used verbatim"
    ]


def test_capital_loss_stored_positive_warns_and_is_used_verbatim():
    inputs = dict(YEAR_INPUTS[2024]) | {"capital_loss_deductions": Decimal("500")}
    breakdown = compute_breakdown(2024, inputs, YEAR_BRACKETS[2024])
    assert breakdown.warnings == [
        "capital_loss_deductions is stored positive (500) — the deductible capital loss "
        "is entered negative; used verbatim"
    ]
    # Verbatim means ADDED: a positive value RAISES AGI rather than being rejected.
    assert breakdown.federal.agi == breakdown_for(2024).federal.agi + Decimal("500")


@pytest.mark.parametrize(
    ("ltcg", "qualified", "other", "expected"),
    [
        ("536.38", "719.81", "11", "1267.19"),  # gain: everything nets
        ("-100", "500", "0", "400"),  # loss, net still positive: nets
        ("-670", "129", "0", "129"),  # loss, net negative: loss is dropped
        ("-129", "129", "0", "129"),  # loss, net EXACTLY 0: dropped too, not netted to 0
        ("0", "179.13", "0", "179.13"),  # no LTCG line at all
    ],
)
def test_capital_gains_amount_branches(ltcg, qualified, other, expected):
    inputs = {
        # The long-term line is computed, so the branch is driven by its component.
        "ltcg_brokerage": Decimal(ltcg),
        "qualified_dividends": Decimal(qualified),
        "other_capital_gains": Decimal(other),
    }
    breakdown = compute_breakdown(2025, inputs, YEAR_BRACKETS[2025])
    assert breakdown.capital_gains.gains_amount == Decimal(expected)


def test_unused_deduction_comes_off_the_stacked_gains():
    """4a (2026-09-09 spec): a deduction larger than ordinary AGI is not thrown away.

    GOLDEN MOVED. This test used to be `test_capital_gains_stack_clamps_a_negative_taxable_
    income` and pinned federal.taxable_income == -80000 with a capital-gains tax of
    5306.25. Both were wrong in the same direction: `walk` clamps a negative income to 0
    and `stack` clamps a negative base to 0, so the 80000 of deduction AGI could not use
    simply evaporated and the whole 80000 of gains was stacked and taxed. It now absorbs
    the gains first — ordinary taxable income max(agi - deduction, 0) = 0, excess
    max(deduction - agi, 0) = 80000, stacked gains max(80000 - 80000, 0) = 0 — so the
    capital-gains tax is 0.00 (was 5306.25).
    """
    inputs = {
        # Wages and the long-term line are computed totals: both arrive as components.
        "pay_periods": Decimal("24"),
        "annual_salary": Decimal("20000"),
        "standard_deduction": Decimal("100000"),
        "ltcg_brokerage": Decimal("80000"),
    }
    breakdown = compute_breakdown(2023, inputs, YEAR_BRACKETS[2023])
    # Reported, not just walked: a negative taxable income was a figure nothing consumed.
    assert breakdown.federal.taxable_income == Decimal("0")
    assert breakdown.federal.tax == Decimal("0")  # the walker never taxes a loss
    # The netted gains line is untouched — state AGI, MAGI and NIIT all read it, and the
    # absorption is a FEDERAL stacking rule, not a re-netting of the gains themselves.
    assert breakdown.capital_gains.gains_amount == Decimal("80000")
    assert breakdown.capital_gains.taxable_income == Decimal("0")
    assert breakdown.capital_gains.tax == Decimal("0")


def test_unused_deduction_only_partly_absorbs_a_larger_gain():
    """The remainder stacks from zero, at the CG rates it really meets.

    Same 80000 of unused deduction against 150000 of long-term gain: 70000 survives it and
    stacks from an ordinary taxable income of 0 — 44625 in 2023's 0% tier, then 25375 at
    15%.
    """
    inputs = {
        # Wages and the long-term line are computed totals: both arrive as components.
        "pay_periods": Decimal("24"),
        "annual_salary": Decimal("20000"),
        "standard_deduction": Decimal("100000"),
        "ltcg_brokerage": Decimal("150000"),
    }
    breakdown = compute_breakdown(2023, inputs, YEAR_BRACKETS[2023])
    assert breakdown.capital_gains.gains_amount == Decimal("150000")
    assert breakdown.capital_gains.tax == Decimal("25375") * Decimal("0.15")
    # The effective rate divides by the FULL netted gains, so absorption shows up as a rate
    # below the tier the survivors met.
    assert breakdown.capital_gains.effective_rate == Decimal("3806.25") / Decimal("150000")


def test_gains_still_stack_on_ordinary_income_when_the_deduction_is_used_up():
    """The unchanged path: AGI above the deduction leaves no excess, so the gains stack on
    ordinary taxable income exactly as they always did."""
    inputs = {
        # Wages and the long-term line are computed totals: both arrive as components.
        "pay_periods": Decimal("24"),
        "annual_salary": Decimal("120000"),
        "standard_deduction": Decimal("100000"),
        "ltcg_brokerage": Decimal("80000"),
    }
    breakdown = compute_breakdown(2023, inputs, YEAR_BRACKETS[2023])
    assert breakdown.federal.taxable_income == Decimal("20000")
    # [20000, 100000] against 2023's (0, 44625, 492300): 24625 at 0%, 55375 at 15%.
    assert breakdown.capital_gains.tax == Decimal("55375") * Decimal("0.15")


def test_sec199a_is_deducted_under_the_standard_deduction_too():
    """4h (2026-09-09 spec): the QBI deduction is taken WHETHER OR NOT the filer itemizes.

    The sheet modelled §199A as an itemized component, so it vanished for every year the
    standard deduction won — which is most years, and every year in this workbook but two.
    It is a below-the-line deduction of its own now: taxable income drops by it in both
    branches, and by it exactly once in the itemizing one.
    """
    base = {
        "pay_periods": Decimal("24"),
        "annual_salary": Decimal("100000"),
        "standard_deduction": Decimal("15000"),
    }
    qbi = {"itemized_sec199a_div": Decimal("1000")}

    standard = compute_breakdown(2025, base, YEAR_BRACKETS[2025])
    standard_qbi = compute_breakdown(2025, base | qbi, YEAR_BRACKETS[2025])
    assert standard.federal.taxable_income == Decimal("85000")
    assert standard_qbi.federal.taxable_income == Decimal("84000")
    assert standard_qbi.federal.tax == walk(YEAR_BRACKETS[2025]["federal"], Decimal("84000"))

    # Itemizing: the larger of the two deductions, then §199A once on top of it.
    itemizing = compute_breakdown(
        2025, base | qbi | {"itemized_salt": Decimal("20000")}, YEAR_BRACKETS[2025]
    )
    assert itemizing.federal.taxable_income == Decimal("79000")


def test_sec199a_left_the_itemized_total():
    """The other half of 4h: the sheet's itemized formula added the §199A line, and leaving
    it there beside a below-the-line deduction would deduct the same dollars twice."""
    items = {
        "itemized_salt": Decimal("5000"),
        "itemized_donations": Decimal("1000"),
        "itemized_vehicle_reg": Decimal("16"),
        "itemized_other": Decimal("0"),
    }
    assert materialize_household(2025, items)["itemized_deduction"] == Decimal("6016")
    with_qbi = materialize_household(2025, items | {"itemized_sec199a_div": Decimal("250")})
    assert with_qbi["itemized_deduction"] == Decimal("6016")


def test_state_agi_carries_cg_amount_every_year():
    """CA taxes capital gains and ALL dividends as ordinary income (2026-08-25 spec §1):
    state AGI = fed AGI - treasury slice - treasury interest + HSA addbacks + cg_amount, in
    EVERY year, unconditionally — the same netted quantity the federal CG stack taxes, never
    a second definition. 2026 rides along as the zero-gains control: its state chain must
    not move. The treasury-INTEREST term joined on 2026-09-09 (spec 4b)."""
    for year in YEARS:
        breakdown = breakdown_for(year)
        values = YEAR_INPUTS[year]
        # From ORDINARY AGI (totals.total_income): the state chain starts where the federal
        # brackets do and adds the gains itself, so federal.agi's true-AGI Base would
        # double-count them (spec 4f).
        assert breakdown.state.agi == (
            breakdown.totals.total_income
            - values["unq_div_us_treasuries_etf"] * values["unq_div_state_exempt_pct"]
            - values["interest_us_treasuries"]
            + values["hsa_contributions"]
            + values["hsa_contributions_employer"]
            + breakdown.capital_gains.gains_amount
        ), year


def test_state_agi_exempts_us_treasury_interest():
    """4b (2026-09-09 spec): California does not tax interest on US Treasury obligations.

    The state chain already backed out the exempt slice of treasury-FUND dividends and
    stopped there, so a year holding Treasuries DIRECTLY — 2023's 20668.00 of the 20750.50
    interest line — paid California income tax on federally-exempt interest. The line is a
    stored input the sheet only ever used to derive interest_total; the engine reads it now.
    """
    values = YEAR_INPUTS[2023]
    assert values["interest_us_treasuries"] == Decimal("20668")
    breakdown = breakdown_for(2023)
    # Federal is untouched: the exemption is California's alone.
    assert cents(breakdown.totals.total_income) == Decimal("117726.64")
    # The same 20750.50 interest line, all of it STANDARD: the total is computed from its
    # two components now, so zeroing the treasury slice without moving it into the standard
    # slice would shrink the federal interest line too — a different experiment.
    exempted = compute_breakdown(
        2023,
        dict(values)
        | {"interest_standard": values["interest_total"], "interest_us_treasuries": ZERO},
        YEAR_BRACKETS[2023],
    )
    assert exempted.state.agi - breakdown.state.agi == Decimal("20668")
    # One 9.3%-bracket walk apart: no boundary is crossed between the two taxable incomes.
    assert exempted.state.tax - breakdown.state.tax == Decimal("20668") * Decimal("0.093")


def test_state_tax_walks_the_capital_gains_increment():
    """Two input sets identical except ltcg_brokerage: state tax must differ by EXACTLY
    state-bracket walk over the cg_amount increment (the fix's contract, spec §1), while
    the federal income chain stays put — CG never enters fed AGI."""
    increment = Decimal("10000")
    base = dict(YEAR_INPUTS[2025])
    bumped = base | {"ltcg_brokerage": base["ltcg_brokerage"] + increment}
    before = compute_breakdown(2025, base, YEAR_BRACKETS[2025])
    after = compute_breakdown(2025, bumped, YEAR_BRACKETS[2025])

    # The netting rules are unchanged: a bigger long-term gain lands 1:1 on cg_amount...
    assert after.capital_gains.gains_amount - before.capital_gains.gains_amount == increment
    # ...and 1:1 on the state chain ALONE. The federal BASE moves with it too (it reports
    # the gains, spec 4f); what must not move is the ordinary income and the tax on it.
    assert after.totals.total_income == before.totals.total_income
    assert after.federal.agi - before.federal.agi == increment
    assert after.federal.tax == before.federal.tax
    assert after.state.agi - before.state.agi == increment
    assert after.state.taxable_income - before.state.taxable_income == increment
    expected = walk(YEAR_BRACKETS[2025]["state"], before.state.taxable_income + increment) - walk(
        YEAR_BRACKETS[2025]["state"], before.state.taxable_income
    )
    assert expected > 0
    assert after.state.tax - before.state.tax == expected


def test_niit_line_2024_hand_derivation():
    """NII = interest 24.76 + unq div 833.46 + max(stcg 951.93, 0) + max(cg 179.13, 0)
    = 1989.28; MAGI = 211776.20 + 179.13 = 211955.33 -> 11955.33 over the single 200000
    threshold; NII binds: 0.038 x 1989.28 = 75.59264, at an exact 3.8% over NII."""
    breakdown = breakdown_for(2024)
    assert breakdown.niit.gains_amount == Decimal("1989.28")  # NII rides gains_amount
    assert breakdown.niit.taxable_income == Decimal("1989.28")  # the surcharged base
    assert breakdown.niit.tax == Decimal("75.59264")
    assert breakdown.niit.effective_rate == Decimal("0.038")
    # The seventh line really is inside both totals.
    assert breakdown.totals.total_tax == (
        breakdown.federal.tax
        + breakdown.state.tax
        + breakdown.medicare.tax
        + breakdown.social_security.tax
        + breakdown.disability.tax
        + breakdown.capital_gains.tax
        + breakdown.niit.tax
    )
    assert breakdown.totals.take_home == breakdown.totals.gross_income - breakdown.totals.total_tax


def test_niit_excess_binds_when_magi_barely_crosses():
    """195000 wages + 60000 interest: MAGI 255000, NII 60000, excess 55000 — the excess
    leg binds, so the effective rate over NII drops under 0.038."""
    inputs = {
        "pay_periods": Decimal("24"),
        "annual_salary": Decimal("195000"),
        "interest_standard": Decimal("60000"),
    }
    breakdown = compute_breakdown(2025, inputs, YEAR_BRACKETS[2025])
    assert breakdown.niit.gains_amount == Decimal("60000")
    assert breakdown.niit.taxable_income == Decimal("55000")
    assert breakdown.niit.tax == Decimal("2090")  # 0.038 x 55000
    assert breakdown.niit.effective_rate == breakdown.niit.tax / Decimal("60000")


def test_niit_clamps_negative_components_out_of_nii():
    """Spec C2's clamps: a short-term LOSS and a negative netted CG line reduce AGI,
    never NII — and a pathological net-negative NII never surfaces as a negative tax."""
    inputs = {
        "pay_periods": Decimal("24"),
        "annual_salary": Decimal("300000"),
        "stcg_standard": Decimal("-5000"),
        "other_capital_gains": Decimal("-400"),
        "interest_standard": Decimal("1000"),
    }
    breakdown = compute_breakdown(2025, inputs, YEAR_BRACKETS[2025])
    # The STCG LINE floors at 0 now that it is computed (the netting rule's else branch),
    # so a standalone short-term loss reaches the return as the capital-loss carryforward
    # rather than as a negative line, and the clamp below it is a belt.
    assert breakdown.capital_gains.gains_amount == Decimal("-400")
    # ltcg 0 -> else branch nets qualified 0 + other -400: cg_amount is -400. It joins
    # MAGI (300600 = 301000 fed AGI - 400) but is clamped out of NII.
    assert breakdown.niit.gains_amount == Decimal("1000")  # interest alone
    assert breakdown.niit.tax == Decimal("38.000")  # excess 100600 dwarfs NII 1000

    negative_nii = compute_breakdown(
        2025,
        {
            "pay_periods": Decimal("24"),
            "annual_salary": Decimal("300000"),
            "interest_standard": Decimal("-9000"),
        },
        YEAR_BRACKETS[2025],
    )
    assert negative_nii.niit.gains_amount == Decimal("-9000")  # reported as stored
    assert negative_nii.niit.taxable_income == Decimal("0")  # the max(0, .) belt
    assert negative_nii.niit.tax == Decimal("0")


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
    own r122 and double-taxing gains that the CG stack already charges. The FEDERAL chain
    is still the drift; the state chain it feeds stopped being one — the canonical model
    now adds cg_amount to state AGI on purpose (2026-08-25 spec §1), so the sheet's 2025
    state figures agree with the app by accident: right answer, wrong door."""
    breakdown = breakdown_for(2025)
    doubled = Decimal("1267.19")

    drifted_agi = breakdown.totals.total_income + doubled
    assert drifted_agi == Decimal("260643.24")  # sheet r96c5
    # The sheet's own deduction, read from the stored input rather than from the engine's
    # AGI-to-TI step: since 2026-09-09 (spec 4h) that step also carries §199A, which the
    # sheet's r97 never subtracted separately.
    drifted_ti = drifted_agi - YEAR_INPUTS[2025]["itemized_deduction"]
    assert drifted_ti == Decimal("233429.958")  # sheet r97c5
    drifted_tax = walk(YEAR_BRACKETS[2025]["federal"], drifted_ti)
    assert drifted_tax == Decimal("51760.58656")  # sheet r98c5
    # 1267.19 of double-taxed gains in the 32% bracket: 1267.19 x .32 = 405.50. The §199A
    # term left this gap again on 2026-09-11 (spec §1.3): the sheet's r97 deduction and the
    # engine's are the same 27213.282 once the itemized total is computed rather than read
    # from a stored cell that still carried the QBI line.
    assert cents(drifted_tax - breakdown.federal.tax) == Decimal("405.50")

    # The sheet's state chain, rebuilt from ITS drifted fed AGI, lands exactly on the
    # canonical one — both add the same 1267.19 (the sheet through fed AGI, the app
    # through the deliberate cg_amount term), so the old +117.85 state drift is retired.
    values = YEAR_INPUTS[2025]
    sheet_state_ti = (
        drifted_agi
        - values["unq_div_us_treasuries_etf"] * values["unq_div_state_exempt_pct"]
        + values["hsa_contributions"]
        + values["hsa_contributions_employer"]
        - values["state_standard_deduction"]
    )
    assert sheet_state_ti == breakdown.state.taxable_income
    sheet_state_tax = (
        walk(YEAR_BRACKETS[2025]["state"], sheet_state_ti) - values["state_exemption_credits"]
    )
    assert sheet_state_tax == breakdown.state.tax
    assert abs(sheet_state_tax - Decimal("20257.18732")) < Decimal("0.001")  # sheet's cache


def test_sheet_drift_2026_stale_deduction():
    """2026 r43 is a hardcoded 15750 (2025's standard deduction) instead of its own
    max(16100, 29824), and r97 keeps 2023's stray `-F41-1` tail."""
    breakdown = breakdown_for(2026)
    drifted_ti = breakdown.totals.total_income - Decimal("15750") - Decimal("1")
    assert drifted_ti == Decimal("264377.2067")  # sheet r97c6
    drifted_tax = walk(YEAR_BRACKETS[2026]["federal"], drifted_ti)
    assert abs(drifted_tax - Decimal("62079.27233")) < Decimal("0.001")
    assert cents(drifted_tax) == Decimal("62079.27")
    # 4921.49 between 2026-09-09 and 2026-09-11: §199A briefly counted twice (once inside
    # the STORED itemized total, once below the line), which lowered the canonical federal
    # tax by 8 x .32. The computed total counts it once and the gap is back to 4918.93.
    assert cents(drifted_tax - breakdown.federal.tax) == Decimal("4918.93")


# --------------------------------------------------------------------------------------
# materialize_person() / materialize_household()
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("year", YEARS)
def test_materialize_reproduces_every_derived_fixture_cell(year):
    """The sheet's own cached grey cells are the ORACLE (2026-09-11 spec §1.3): the two
    materializers reproduce every derived cell of every golden year from its components.

    `_INPUT_TABLE` keeps those rows for exactly this reason even though nothing stores them
    any more. The one subtraction is 2025/2026's itemized total, which still carries the
    §199A line the formula dropped on 2026-09-09 (spec 4h) — the only drift production ever
    showed, and precisely the hazard that ends when the figure is never stored again. It is
    unconditional because the other two years' §199A line is zero.
    """
    values = materialize_household(year, materialize_person(YEAR_INPUTS[year]))
    for key in DERIVED_KEYS:
        expected = YEAR_INPUTS[year][key] - (
            YEAR_INPUTS[year]["itemized_sec199a_div"] if key == "itemized_deduction" else ZERO
        )
        assert values[key] == expected, f"{year} {key}"
        # Numeric(14,4): every formula quantizes 4dp HALF_UP as its LAST step.
        assert values[key].as_tuple().exponent == -4, f"{year} {key}"


def test_materialize_person_multiplies_the_unquantized_paycheck():
    """The precision rule (spec §1.2): the chain multiplies the UNQUANTIZED quotient.

    2023 is the pin — 9 x (145000/24) is 54375 exactly, while 9 x the 4dp paycheck the
    sheet cached is 54375.0003. `derive_suggestions` multiplied the stored cell and missed
    the stored year by three ten-thousandths; this chain reproduces it.
    """
    person = materialize_person({"annual_salary": Decimal("145000"), "pay_periods": Decimal("9")})
    assert person["gross_paycheck"] == Decimal("6041.6667")
    assert person["latest_w2_income"] == Decimal("54375.0000")
    assert Decimal("9") * person["gross_paycheck"] == Decimal("54375.0003")  # the old chain
    # pay_periods is the year-to-date count of checks received, NOT the annual cadence:
    # the divisor is the sheet's hardcoded 24 in every year.
    assert materialize_person({"annual_salary": Decimal("188930"), "pay_periods": Decimal("20")})[
        "latest_w2_income"
    ] == Decimal("157441.6667")


def test_materialize_replaces_whatever_came_in_under_a_derived_key():
    """A total handed in is DISCARDED, not trusted — the whole point of Part 1."""
    person = materialize_person(
        {
            "other_w2_income": Decimal("999999"),
            "w2_bonuses": Decimal("30"),
            "w2_other": Decimal("20"),
        }
    )
    assert person["other_w2_income"] == Decimal("50.0000")
    household = materialize_household(2025, {"ltcg_total": Decimal("999999")})
    assert household["ltcg_total"] == Decimal("0.0000")


def test_materialize_defaults_missing_components_to_zero():
    """An empty sheet cell IS a zero, so every total is always computable — and always
    lands at the column's own scale."""
    values = materialize_household(2027, materialize_person({}))
    for key in DERIVED_KEYS:
        assert values[key] == ZERO, key
        assert values[key].as_tuple().exponent == -4, key


def test_materialize_household_order():
    """`stcg_total` nets against the REBUILT long-term line, not a stale stored one."""
    values = materialize_household(
        2025,
        {
            "ltcg_total": Decimal("0"),  # stale: the netting would find nothing to net
            "ltcg_brokerage": Decimal("-670"),
            "stcg_standard": Decimal("1000"),
        },
    )
    assert values["ltcg_total"] == Decimal("-670.0000")
    assert values["stcg_total"] == Decimal("330.0000")


def test_materialize_household_itemized_reads_magi_from_the_rebuilt_totals():
    """The SALT phase-down is judged on MAGI, and MAGI reads the totals above it — so the
    cap only bites once `ltcg_total` has been rebuilt (spec §1.2's dependency order)."""
    lots = {
        "itemized_salt": Decimal("24141.06"),
        "ltcg_total": Decimal("0"),  # stale again
        "ltcg_brokerage": Decimal("600000"),
    }
    values = materialize_household(2025, lots)
    # MAGI 600000 -> 40000 - 30% x 100000 = 10000, exactly the floor.
    assert values["itemized_deduction"] == Decimal("10000.0000")
    # Without the gains the same SALT is under the full cap and passes through whole —
    # which is the answer a stale `ltcg_total: 0` would have produced above.
    flat = materialize_household(2025, {"itemized_salt": Decimal("24141.06")})
    assert flat["itemized_deduction"] == Decimal("24141.0600")


def test_materialize_salt_cap_2024_vs_2025():
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
    assert materialize_household(2024, items)["itemized_deduction"] == Decimal("10016")
    assert (
        materialize_household(2024, items)["itemized_deduction"]
        == YEAR_INPUTS[2024]["itemized_deduction"]
    )
    # Uncapped under 40000: the full 17488.59 + 16.
    assert materialize_household(2025, items)["itemized_deduction"] == Decimal("17504.59")
    assert materialize_household(2023, items)["itemized_deduction"] == Decimal("10016")


@pytest.mark.parametrize(
    ("standard", "espp", "ltcg", "expected"),
    [
        ("754", "0", "-670", "84"),  # loss nets, net still positive
        ("670", "0", "-670", "0"),  # loss nets EXACTLY to 0: the netted 0, not the 670
        ("8040.08", "0", "536.38", "8040.08"),  # LTCG gain never touches the STCG line
        ("951.93", "0", "0", "951.93"),  # no LTCG line
        ("100", "0", "-500", "0"),  # loss swamps the gain: STCG floors at 0
        ("-100", "0", "0", "0"),  # a standalone STCG loss floors at 0 too
        ("600", "154", "-670", "84"),  # the ESPP component joins `s`
    ],
)
def test_materialize_stcg_netting_branches(standard, espp, ltcg, expected):
    """The long-term leg arrives as its COMPONENT now — `ltcg_total` is rebuilt, so the
    netting rule can only ever read a figure it computed itself."""
    inputs = {
        "stcg_standard": Decimal(standard),
        "stcg_espp_component": Decimal(espp),
        "ltcg_brokerage": Decimal(ltcg),
    }
    assert materialize_household(2025, inputs)["stcg_total"] == Decimal(expected)


def test_materialize_household_leaves_the_per_person_four_alone():
    """Person before household: the household pass must not touch a per-person total, or a
    two-earner return's summed wages would be rebuilt from summed components."""
    summed = {
        "latest_w2_income": Decimal("161441.6667"),
        "other_w2_income": Decimal("50.0000"),
        "gross_paycheck": Decimal("8872.0833"),
        "other_pretax_deductions": Decimal("300.0000"),
        "annual_salary": Decimal("212930"),
        "pay_periods": Decimal("24"),
    }
    values = materialize_household(2025, summed)
    for key in PER_PERSON_DERIVED_KEYS:
        assert values[key] == summed[key], key


def test_per_person_before_household_sum():
    """A per-person product cannot be rebuilt from household sums, which is why every
    column is materialized before the per-person keys are summed (spec §1.2)."""
    primary = {"pay_periods": Decimal("20"), "annual_salary": Decimal("188930")}
    partner = {"pay_periods": Decimal("4"), "annual_salary": Decimal("24000")}
    per_person = (
        materialize_person(primary)["latest_w2_income"]
        + materialize_person(partner)["latest_w2_income"]
    )
    assert per_person == Decimal("161441.6667")
    # Materializing the SUMMED components instead: 24 x 212930/24, a different return.
    summed_first = materialize_person(
        {"pay_periods": Decimal("24"), "annual_salary": Decimal("212930")}
    )
    assert summed_first["latest_w2_income"] == Decimal("212930.0000")
    assert summed_first["latest_w2_income"] != per_person


# --------------------------------------------------------------------------------------
# derive_suggestions()
# --------------------------------------------------------------------------------------


def test_derive_suggestions_is_the_capital_loss_line_alone():
    """What remains advisory once the nine totals are computed: a prior-year carryforward
    is a real number no formula knows, so the chip stays and the key stays typeable."""
    assert SUGGESTION_KEYS == ("capital_loss_deductions",)
    assert set(derive_suggestions(2025, YEAR_INPUTS[2025])) == {"capital_loss_deductions"}


def test_suggestion_capital_loss_negative():
    """The netting rule is unchanged; the SUGGESTION is clamped to the statutory 3000 per
    return (2026-08-26 spec §5.3). The engine still never reads this key, so no breakdown
    moved. The loss arrives as its COMPONENT — the total it feeds is computed."""
    inputs = {"ltcg_brokerage": Decimal("-5000"), "stcg_standard": Decimal("1000")}
    assert derive_suggestions(2025, inputs)["capital_loss_deductions"] == Decimal("-3000")
    # The un-nettable remainder is still -4000 — the STCG line proves the netting ran.
    assert materialize_household(2025, inputs)["stcg_total"] == Decimal("0")


def test_suggestion_reads_the_rebuilt_long_term_line():
    """A stale `ltcg_total` handed in cannot move the suggestion: `derive_suggestions`
    materializes the household dict itself before reading it."""
    stale = {"ltcg_total": Decimal("0"), "ltcg_brokerage": Decimal("-5000")}
    assert derive_suggestions(2025, stale)["capital_loss_deductions"] == Decimal("-3000")


def test_suggestions_default_missing_references_to_zero():
    """Empty sheet cells are zeros, so the one suggestion is always offered."""
    suggested = derive_suggestions(2027, {})
    assert len(suggested) == 1
    assert all(value == Decimal("0") for value in suggested.values())


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
# The engine rebuilds what it is handed (2026-09-11 spec §1.3)
# --------------------------------------------------------------------------------------


def test_engine_overwrites_a_stale_household_total():
    """Approach 1 (spec decision 3): the engine ignores any total a caller hands it and
    rebuilds it from the components. A fabricated long-term line changes nothing."""
    stale = dict(YEAR_INPUTS[2024]) | {"ltcg_total": Decimal("999999")}
    breakdown = compute_breakdown(2024, stale, YEAR_BRACKETS[2024])
    assert breakdown.warnings == []
    assert actuals(breakdown) == actuals(breakdown_for(2024))


def test_engine_rebuilds_a_stale_per_person_total_on_the_single_path():
    """`earners=None` synthesizes its one bundle THROUGH `materialize_person`, so a lone
    caller cannot bypass the rebuild either — the wages come back from pay_periods and
    annual_salary even with both W-2 totals zeroed."""
    zeroed = dict(YEAR_INPUTS[2024]) | {
        "latest_w2_income": Decimal("0"),
        "other_w2_income": Decimal("0"),
    }
    breakdown = compute_breakdown(2024, zeroed, YEAR_BRACKETS[2024])
    assert breakdown.warnings == []
    assert actuals(breakdown) == actuals(breakdown_for(2024))
    assert breakdown.medicare.w2_income == Decimal("235724.46")


def test_missing_warning_names_a_derived_key_only_when_every_component_is_absent():
    """A total with at least one entered component is not missing, it is COMPUTED — and a
    total with none of them is still named by its own key, at today's granularity."""
    components = (
        "w2_stock_rsus_sold",
        "w2_bonuses",
        "w2_salary_checkpoint",
        "w2_espp_sale_component",
        "w2_employer_hsa",
        "w2_other",
    )
    bare = {key: value for key, value in YEAR_INPUTS[2024].items() if key not in components}
    muted = compute_breakdown(2024, bare, YEAR_BRACKETS[2024]).warnings[0]
    assert muted.startswith("missing inputs defaulted to 0: ")
    assert "other_w2_income" in muted.removeprefix("missing inputs defaulted to 0: ").split(", ")

    # One component back — a zero one at that, since absent is not zero — and the total is
    # no longer missing. The stored `other_w2_income` is in BOTH dicts and names nothing:
    # what the engine asks about is the components.
    one = bare | {"w2_bonuses": YEAR_INPUTS[2024]["w2_bonuses"]}
    assert compute_breakdown(2024, one, YEAR_BRACKETS[2024]).warnings == []


def test_deduction_warning_reads_components():
    """The pair rule restated over components (spec §1.3): one stored itemized COMPONENT
    has answered the deduction question, even though nothing stores the total."""
    itemizing = compute_breakdown(2024, {"itemized_salt": Decimal("5000")}, YEAR_BRACKETS[2024])
    assert not any(w.startswith("No standard or itemized") for w in itemizing.warnings)
    assert itemizing.federal.taxable_income == Decimal("0")  # AGI 0 less a 5000 deduction

    neither = compute_breakdown(2024, {}, YEAR_BRACKETS[2024])
    assert neither.warnings[0] == (
        "No standard or itemized deduction entered for 2024 — federal tax is overstated"
    )


# --------------------------------------------------------------------------------------
# Warnings
# --------------------------------------------------------------------------------------


def test_engine_keys_are_defined_tax_keys():
    defined = [key for key, *_ in TAX_INPUT_DEFINITIONS]
    assert set(ENGINE_INPUT_KEYS) <= set(defined)
    assert list(ENGINE_INPUT_KEYS) == [key for key in defined if key in set(ENGINE_INPUT_KEYS)]


def test_suggestion_keys_are_defined_tax_keys():
    assert set(SUGGESTION_KEYS) <= {key for key, *_ in TAX_INPUT_DEFINITIONS}


def test_input_units_cover_defined_keys_and_default_to_money():
    """The unit registry is an EXCEPTION list (2026-09-09 spec §2): every key it names is
    a real definition, everything else is money, and a key added later is money until it
    says otherwise."""
    defined = {key for key, *_ in TAX_INPUT_DEFINITIONS}
    assert set(TAX_INPUT_UNITS) <= defined
    assert set(TAX_INPUT_UNITS.values()) <= set(INPUT_UNITS)
    assert unit_for("pay_periods") == "count"
    assert unit_for("unq_div_state_exempt_pct") == "percent"
    assert unit_for("annual_salary") == "money"
    assert unit_for("a_key_no_definition_has") == "money"
    assert {key for key in defined if unit_for(key) != "money"} == set(TAX_INPUT_UNITS)


def test_both_deductions_absent_gets_its_own_sentence():
    """4e (2026-09-09 spec): with neither deduction stored the engine taxes AGI in full —
    the largest single way a freshly created year can be wrong — so it says so on its own
    line instead of naming `standard_deduction` among twenty other keys in the muted list.

    Both, not either: a year that stores one of the pair has answered the question, and
    max(standard, itemized) reads the other as the zero it is.
    """
    # Wages arrive as a COMPONENT since 2026-09-11 — `other_w2_income` is computed, so a
    # year that typed the total and nothing else would now read as a year with no W-2.
    sparse = compute_breakdown(2024, {"w2_bonuses": Decimal("100000")}, YEAR_BRACKETS[2024])
    assert sparse.warnings[0] == (
        "No standard or itemized deduction entered for 2024 — federal tax is overstated"
    )
    # Said once: the two keys leave the muted list when the sentence above fires. Split
    # rather than searched — "standard_deduction" is a substring of the state row's key.
    muted = sparse.warnings[1]
    assert muted.startswith("missing inputs defaulted to 0: ")
    muted_keys = muted.removeprefix("missing inputs defaulted to 0: ").split(", ")
    assert "standard_deduction" not in muted_keys
    assert "itemized_deduction" not in muted_keys
    assert "state_standard_deduction" in muted_keys  # the rest of the list is untouched
    # ...and the figures really are the overstated ones the sentence describes.
    assert sparse.federal.taxable_income == Decimal("100000")

    # One of the pair is enough to retire it, and the OTHER then reads as the zero it is.
    answered = compute_breakdown(
        2024,
        {"w2_bonuses": Decimal("100000"), "standard_deduction": Decimal("14600")},
        YEAR_BRACKETS[2024],
    )
    assert not any(w.startswith("No standard or itemized deduction") for w in answered.warnings)
    assert "itemized_deduction" in answered.warnings[0].split(", ")
    assert answered.federal.taxable_income == Decimal("85400")


def test_missing_inputs_warning():
    inputs = dict(YEAR_INPUTS[2024])
    # The interest LINE is computed, so "missing" is a question about its components:
    # dropping the total alone would change nothing at all (the test below its neighbour).
    del inputs["interest_total"]
    del inputs["interest_standard"]
    del inputs["interest_us_treasuries"]
    del inputs["qualified_dividends"]
    breakdown = compute_breakdown(2024, inputs, YEAR_BRACKETS[2024])
    assert breakdown.warnings == [
        "missing inputs defaulted to 0: interest_total, interest_us_treasuries, qualified_dividends"
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
    assert cents(breakdown.state.tax) == Decimal("15901.12") + Decimal("149") - Decimal("1000000")
    assert NEGATIVE_STATE_TAX_WARNING in breakdown.warnings
    assert breakdown.state.tax < 0


def test_niit_advisory_flags_folded_rates():
    """The advisory's ONE job since 2026-08-31 (spec C2): a stored 18.8/23.8 rate is the
    sheet's folded NIIT next to an engine that now charges the surcharge separately —
    i.e. a double-charge. Exact matches only (the migration/importer rewrite the same two
    values), any bracket count, normalized rendering at Numeric(7,4) scale."""
    folded = _table(("0", "0.188", "0.238"), _CG_THRESHOLDS[2024])
    stored_scale = _table(("0.0000", "0.1880", "0.2380"), _CG_THRESHOLDS[2024])
    flagged = (
        "stored capital-gains rate(s) 0.188/0.238 appear to fold the NIIT surcharge in — "
        "NIIT is computed as its own line; store the base rates 0.15/0.2"
    )
    assert niit_advisory(folded) == flagged
    assert niit_advisory(stored_scale) == flagged  # scale never changes a word
    assert niit_advisory(YEAR_BRACKETS[2024]["capital_gains"]) is None  # base rates
    assert niit_advisory([]) is None
    # One folded rate alone still flags; a near-miss is the user's own number.
    assert niit_advisory(_table(("0", "0.188"), ("0", "47026"))) == (
        "stored capital-gains rate(s) 0.188 appear to fold the NIIT surcharge in — "
        "NIIT is computed as its own line; store the base rates 0.15/0.2"
    )
    assert niit_advisory(_table(("0", "0.1881", "0.239"), _CG_THRESHOLDS[2024])) is None


def test_niit_advisory_reaches_the_breakdown_warnings():
    folded = dict(YEAR_BRACKETS[2024]) | {
        "capital_gains": _table(("0", "0.188", "0.238"), _CG_THRESHOLDS[2024])
    }
    breakdown = compute_breakdown(2024, YEAR_INPUTS[2024], folded)
    assert breakdown.warnings == [
        "stored capital-gains rate(s) 0.188/0.238 appear to fold the NIIT surcharge in — "
        "NIIT is computed as its own line; store the base rates 0.15/0.2"
    ]
    # The engine still walks the STORED rates verbatim — the advisory never edits them —
    # so a folded table really does double-charge: 179.13 x 0.188 on the CG line PLUS
    # 75.59264 on the NIIT line. That state is what migration f7d3b2a91c40 ends.
    assert breakdown.capital_gains.tax == Decimal("179.13") * Decimal("0.188")
    assert breakdown.niit.tax == Decimal("75.59264")
