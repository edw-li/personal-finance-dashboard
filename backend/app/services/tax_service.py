"""The sheet's tax engine: progressive bracket walk + capital-gains stacking (spec §9).

Pure module — no DB, no HTTP, no FastAPI. Everything is full-precision Decimal; rounding
is the schema layer's job (money 2dp, effective rates 6dp via `money.quantize_pct`), so
the engine never quantizes an intermediate the sheet did not quantize.

The canonical model is the clean shape the workbook's own "Total Income" row uses in every
year, which is also 2024's whole column. The other three year-columns carry hand-edit
drift (a stray literal, capital gains folded into AGI, a stale hardcoded deduction);
`backend/tests/test_tax_service.py` pins the canonical outputs AND reproduces each drifted
sheet value to the cent, so no divergence is accidental. Precedent: Plan 3's savings-rate
line and Plan 4's Unrealized column shipped the principled formula the same way.

Stored input values are authoritative for the breakdown; `derive_suggestions` is advisory
only (the UI offers a chip, nothing is ever auto-applied server-side).
"""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from app.tax_keys import JURISDICTIONS

ZERO = Decimal("0")

# (rate, threshold), where the threshold is the bracket's inclusive FLOOR.
Bracket = tuple[Decimal, Decimal]

JURISDICTION_WARN_MISSING = "no {j} brackets for {year}: {j} tax computed as 0"
MISSING_INPUTS_WARNING = "missing inputs defaulted to 0: {keys}"
NEGATIVE_STATE_TAX_WARNING = "state tax negative after exemption credits"
NIIT_WARNING = (
    "capital-gains rates {stored}/{stored_top} contradict the sheet's NIIT rule for this "
    "AGI ({side} {threshold} implies {expected}/{expected_top})"
)

# The sheet models CG bracket rates 2/3 as IF(agi > 200000, 18.8%, 15%) / IF(..., 23.8%,
# 20%) — the NIIT surcharge folded into the rate. The DB imported the cached values, so a
# year whose AGI later crosses the threshold silently keeps the wrong pair; we advise
# rather than override, because the stored brackets are the user's to edit.
NIIT_AGI_THRESHOLD = Decimal("200000")
NIIT_RATES = (Decimal("0.188"), Decimal("0.238"))
BASE_CG_RATES = (Decimal("0.15"), Decimal("0.20"))

# Suggestions land in tax_inputs, Numeric(14,4).
SUGGESTION_QUANTUM = Decimal("0.0001")
# The sheet divides annual salary by a hardcoded 24 — `pay_periods` is the year-to-date
# count of checks received, not the annual cadence.
PAYCHECKS_PER_YEAR = Decimal("24")
SALT_CAP_FIRST_RAISED_YEAR = 2025
SALT_CAP_BEFORE = Decimal("10000")
SALT_CAP_FROM = Decimal("40000")

# Every input key `compute_breakdown` reads, in tax_keys definition order (== the order
# the inputs form renders), so the missing-key warning reads like the form.
ENGINE_INPUT_KEYS: tuple[str, ...] = (
    "latest_w2_income",
    "other_w2_income",
    "stcg_total",
    "stcg_standard",
    "unqualified_dividends",
    "unq_div_us_treasuries_etf",
    "unq_div_state_exempt_pct",
    "interest_total",
    "other_income_1099",
    "trad_401k_contributions",
    "hsa_contributions",
    "hsa_contributions_employer",
    "other_pretax_deductions",
    "standard_deduction",
    "itemized_deduction",
    "state_standard_deduction",
    "state_exemption_credits",
    "ltcg_total",
    "ltcg_brokerage",
    "qualified_dividends",
    "other_capital_gains",
)

SUGGESTION_KEYS: tuple[str, ...] = (
    "gross_paycheck",
    "latest_w2_income",
    "other_w2_income",
    "stcg_total",
    "unqualified_dividends",
    "interest_total",
    "capital_loss_deductions",
    "other_pretax_deductions",
    "itemized_deduction",
    "ltcg_total",
)


def walk(brackets: list[Bracket], income: Decimal) -> Decimal:
    """Progressive bracket walk (the sheet's `calculateTaxes`).

    `brackets` is [(rate, threshold), ...]; thresholds are inclusive floors and are sorted
    defensively here (the API validates ascending order with thresholds[0] == 0). A
    threshold belongs to the bracket BELOW it, so 2024 federal tax on exactly 11600 is
    1160. Non-positive income is 0 — the sheet never taxes a loss. Full precision.
    """
    if income <= 0:
        return ZERO
    ordered = sorted(brackets, key=lambda bracket: bracket[1])
    total = ZERO
    for index, (rate, floor) in enumerate(ordered):
        if income <= floor:
            break
        ceiling = ordered[index + 1][1] if index + 1 < len(ordered) else income
        total += (min(income, ceiling) - floor) * rate
    return total


def stack(brackets: list[Bracket], base: Decimal, amount: Decimal) -> Decimal:
    """Capital-gains stacking (the sheet's `calculateCGTaxes`).

    The gains occupy the interval [max(base, 0), max(base, 0) + amount] of the CG bracket
    space, so ordinary taxable income decides which CG rates they meet. Non-positive
    amount is 0; a negative base clamps to 0 rather than sliding the gains below the
    first bracket. Full precision.
    """
    if amount <= 0:
        return ZERO
    ordered = sorted(brackets, key=lambda bracket: bracket[1])
    low = max(base, ZERO)
    high = low + amount
    total = ZERO
    for index, (rate, floor) in enumerate(ordered):
        ceiling = ordered[index + 1][1] if index + 1 < len(ordered) else high
        segment_low = max(low, floor)
        segment_high = min(high, ceiling)
        if segment_high > segment_low:
            total += (segment_high - segment_low) * rate
    return total


@dataclass
class JurisdictionResult:
    """One tax family's line. Fields a family does not have stay None: income taxes carry
    agi/taxable_income, wage taxes carry w2_income/taxable_wages, and capital gains carry
    taxable_income (the ordinary income the gains stack on top of) + gains_amount."""

    tax: Decimal
    effective_rate: Decimal | None = None
    agi: Decimal | None = None
    taxable_income: Decimal | None = None
    w2_income: Decimal | None = None
    taxable_wages: Decimal | None = None
    gains_amount: Decimal | None = None


@dataclass
class TaxTotals:
    gross_income: Decimal
    total_income: Decimal
    total_tax: Decimal
    take_home: Decimal
    effective_rate: Decimal | None = None


@dataclass
class TaxBreakdown:
    year: int
    federal: JurisdictionResult
    state: JurisdictionResult
    medicare: JurisdictionResult
    social_security: JurisdictionResult
    disability: JurisdictionResult
    capital_gains: JurisdictionResult
    totals: TaxTotals
    warnings: list[str] = field(default_factory=list)


def _rate(tax: Decimal, base: Decimal) -> Decimal | None:
    """Effective rate at full precision; None when the base is 0 (the sheet's #DIV/0!)."""
    if base == 0:
        return None
    return tax / base


def niit_advisory(fed_agi: Decimal, cg_brackets: list[Bracket]) -> str | None:
    """Flag stored CG rates that contradict the sheet's AGI-driven NIIT rule.

    Returns None when the table is too short to carry both rates (nothing to compare) or
    when the stored pair already matches. Never edits the brackets: the engine walks what
    is stored, verbatim.
    """
    if len(cg_brackets) < 3:
        return None
    ordered = sorted(cg_brackets, key=lambda bracket: bracket[1])
    stored = (ordered[1][0], ordered[2][0])
    above = fed_agi > NIIT_AGI_THRESHOLD
    expected = NIIT_RATES if above else BASE_CG_RATES
    if stored == expected:
        return None
    return NIIT_WARNING.format(
        stored=stored[0],
        stored_top=stored[1],
        side="above" if above else "at or below",
        threshold=NIIT_AGI_THRESHOLD,
        expected=expected[0],
        expected_top=expected[1],
    )


def compute_breakdown(
    year: int,
    inputs: dict[str, Decimal],
    brackets: dict[str, list[Bracket]],
) -> TaxBreakdown:
    """The canonical model, per the Plan 5 Workbook reference.

    Missing input keys default to 0 (an empty sheet cell IS a zero) and are reported once,
    in form order. A jurisdiction that is missing — or explicitly stored as an empty
    bracket list — yields 0 tax plus a warning. Effective rates are full-precision ratios,
    None when the denominator is 0; the schema layer quantizes.
    """
    values: dict[str, Decimal] = {}
    missing_inputs: list[str] = []
    for key in ENGINE_INPUT_KEYS:
        found = inputs.get(key)
        if found is None:
            missing_inputs.append(key)
            values[key] = ZERO
        else:
            values[key] = found

    warnings: list[str] = []
    if missing_inputs:
        warnings.append(MISSING_INPUTS_WARNING.format(keys=", ".join(missing_inputs)))

    tables: dict[str, list[Bracket]] = {}
    for name in JURISDICTIONS:
        table = brackets.get(name) or []
        if not table:
            warnings.append(JURISDICTION_WARN_MISSING.format(j=name, year=year))
        tables[name] = list(table)

    # Federal (sheet rows 96-99). capital_loss_deductions (r27) is modelled as a line but
    # no output formula ever reads it — ported faithfully, so it does NOT reach AGI.
    fed_agi = (
        values["latest_w2_income"]
        + values["other_w2_income"]
        + values["stcg_total"]
        + values["unqualified_dividends"]
        + values["interest_total"]
        + values["other_income_1099"]
    ) - (
        values["trad_401k_contributions"]
        + values["hsa_contributions"]
        + values["hsa_contributions_employer"]
        + values["other_pretax_deductions"]
    )
    fed_deduction = max(values["standard_deduction"], values["itemized_deduction"])
    fed_ti = fed_agi - fed_deduction
    fed_tax = walk(tables["federal"], fed_ti)

    # State (rows 100-103): CA exempts the treasury slice of unqualified dividends and
    # does NOT recognise the HSA deduction, so both are added back.
    state_agi = (
        fed_agi
        - values["unq_div_us_treasuries_etf"] * values["unq_div_state_exempt_pct"]
        + values["hsa_contributions"]
        + values["hsa_contributions_employer"]
    )
    state_ti = state_agi - values["state_standard_deduction"]
    state_tax = walk(tables["state"], state_ti) - values["state_exemption_credits"]
    if state_tax < 0:
        warnings.append(NEGATIVE_STATE_TAX_WARNING)

    # FICA (rows 104-115): the wage bases deliberately keep trad-401k in — it is pre-tax
    # for income tax only. SDI subtracts dental/vision alone, not HSA (the CA quirk).
    w2_income = values["latest_w2_income"] + values["other_w2_income"]
    medicare_wages = w2_income - (
        values["hsa_contributions"]
        + values["hsa_contributions_employer"]
        + values["other_pretax_deductions"]
    )
    medicare_tax = walk(tables["medicare"], medicare_wages)

    # The SS wage base is modelled as a terminal 0-rate bracket; r109's min() makes the cap
    # explicit so taxable_wages reads as the capped figure the sheet displays. It is
    # tax-neutral by construction (income inside a 0-rate bracket contributes nothing), and
    # it is only a cap when that top rate really is 0 — a table without the terminal row,
    # or with a genuinely progressive top tier, reports (and taxes) uncapped wages.
    ss_table = tables["social_security"]
    ss_wages = medicare_wages
    if len(ss_table) > 1:
        top_rate, top_threshold = max(ss_table, key=lambda bracket: bracket[1])
        if top_rate == 0:
            ss_wages = min(medicare_wages, top_threshold)
    ss_tax = walk(ss_table, ss_wages)

    sdi_wages = w2_income - values["other_pretax_deductions"]
    sdi_tax = walk(tables["disability"], sdi_wages)

    # Capital gains (rows 118-120): a long-term LOSS nets against gains only while the net
    # stays positive; otherwise the sheet drops it (its deduction line never reaches AGI).
    ltcg = values["ltcg_total"]
    netted = ltcg + values["qualified_dividends"] + values["other_capital_gains"]
    if ltcg > 0:
        cg_amount = netted
    elif ltcg < 0 and netted > 0:
        cg_amount = netted
    else:
        cg_amount = values["qualified_dividends"] + values["other_capital_gains"]
    cg_tax = stack(tables["capital_gains"], fed_ti, cg_amount)

    # Totals (rows 121-125). Gross income sums the *_standard / *_brokerage COMPONENTS,
    # not the netted totals, so a netted-away loss still shows up in the top line; total
    # income repeats the clean AGI formula.
    gross_income = (
        values["latest_w2_income"]
        + values["other_w2_income"]
        + values["stcg_standard"]
        + values["unqualified_dividends"]
        + values["interest_total"]
        + values["other_income_1099"]
        + values["ltcg_brokerage"]
        + values["qualified_dividends"]
        + values["other_capital_gains"]
    )
    total_tax = fed_tax + state_tax + medicare_tax + ss_tax + sdi_tax + cg_tax

    advisory = niit_advisory(fed_agi, tables["capital_gains"])
    if advisory is not None:
        warnings.append(advisory)

    return TaxBreakdown(
        year=year,
        federal=JurisdictionResult(
            tax=fed_tax,
            effective_rate=_rate(fed_tax, fed_agi),
            agi=fed_agi,
            taxable_income=fed_ti,
        ),
        state=JurisdictionResult(
            tax=state_tax,
            effective_rate=_rate(state_tax, state_agi),
            agi=state_agi,
            taxable_income=state_ti,
        ),
        medicare=JurisdictionResult(
            tax=medicare_tax,
            effective_rate=_rate(medicare_tax, w2_income),
            w2_income=w2_income,
            taxable_wages=medicare_wages,
        ),
        social_security=JurisdictionResult(
            tax=ss_tax,
            effective_rate=_rate(ss_tax, w2_income),
            w2_income=w2_income,
            taxable_wages=ss_wages,
        ),
        disability=JurisdictionResult(
            tax=sdi_tax,
            effective_rate=_rate(sdi_tax, w2_income),
            w2_income=w2_income,
            taxable_wages=sdi_wages,
        ),
        capital_gains=JurisdictionResult(
            tax=cg_tax,
            effective_rate=_rate(cg_tax, cg_amount),
            taxable_income=fed_ti,
            gains_amount=cg_amount,
        ),
        totals=TaxTotals(
            gross_income=gross_income,
            total_income=fed_agi,
            total_tax=total_tax,
            take_home=gross_income - total_tax,
            effective_rate=_rate(total_tax, gross_income),
        ),
        warnings=warnings,
    )


def derive_suggestions(year: int, inputs: dict[str, Decimal]) -> dict[str, Decimal]:
    """Advisory values for the sheet's gray (formula) input cells, quantized 4dp HALF_UP.

    Computed from the STORED values of the referenced keys — sheet-faithful, because the
    gray formulas reference cells rather than recursing. Missing references default to 0
    (an empty cell is a zero), so all ten suggestions are always offered; the caller
    decides whether to surface a chip. Never applied automatically.
    """

    def value(key: str) -> Decimal:
        found = inputs.get(key)
        return ZERO if found is None else found

    # `s` is the short-term line the sheet nets the long-term loss against.
    short_term = value("stcg_standard") + value("stcg_espp_component")
    ltcg = value("ltcg_total")
    netted = short_term + ltcg
    if short_term >= 0 and ltcg < 0 and netted >= 0:
        stcg_total = netted
    elif short_term >= 0 and netted >= 0:
        stcg_total = short_term
    else:
        stcg_total = ZERO

    # The SALT cap is hardcoded per column in the sheet: 10000 through 2024, 40000 after.
    cap = SALT_CAP_FROM if year >= SALT_CAP_FIRST_RAISED_YEAR else SALT_CAP_BEFORE
    salt = value("itemized_salt")
    itemized = (salt if salt < cap else cap) + (
        value("itemized_donations")
        + value("itemized_vehicle_reg")
        + value("itemized_sec199a_div")
        + value("itemized_other")
    )

    suggestions = {
        "gross_paycheck": value("annual_salary") / PAYCHECKS_PER_YEAR,
        "latest_w2_income": value("pay_periods") * value("gross_paycheck"),
        "other_w2_income": (
            value("w2_stock_rsus_sold")
            + value("w2_bonuses")
            + value("w2_salary_checkpoint")
            + value("w2_espp_sale_component")
            + value("w2_employer_hsa")
            + value("w2_other")
        ),
        "stcg_total": stcg_total,
        "unqualified_dividends": value("unq_div_us_treasuries_etf") + value("unq_div_other"),
        "interest_total": value("interest_standard") + value("interest_us_treasuries"),
        # r27 carries the un-nettable remainder of the loss, so it is negative or zero.
        "capital_loss_deductions": netted if netted < 0 else ZERO,
        "other_pretax_deductions": value("pretax_dental") + value("pretax_vision"),
        "itemized_deduction": itemized,
        "ltcg_total": value("ltcg_brokerage") + value("ltcg_espp_component"),
    }
    return {
        key: suggestions[key].quantize(SUGGESTION_QUANTUM, rounding=ROUND_HALF_UP)
        for key in SUGGESTION_KEYS
    }
