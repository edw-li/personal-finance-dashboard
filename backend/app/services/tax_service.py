"""The sheet's tax engine: progressive bracket walk + capital-gains stacking (spec §9).

Pure module — no DB, no HTTP, no FastAPI. Everything is full-precision Decimal; rounding
is the schema layer's job (money 2dp, effective rates 6dp via `money.quantize_pct`), so
the engine never quantizes an intermediate the sheet did not quantize.

The canonical model is the clean shape the workbook's own "Total Income" row uses in every
year (2024's whole column follows it), plus one deliberate correction the sheet made in NO
year: state AGI carries `cg_amount`, because California taxes capital gains and all
dividends as ordinary income and the sheet's state chain silently dropped them (2026-08-25
spec §1 — for a CG year the app's state tax is >= the sheet's, on purpose, in every year
unconditionally). The other three year-columns also carry hand-edit drift (a stray
literal, capital gains folded into AGI, a stale hardcoded deduction);
`backend/tests/test_tax_service.py` pins the canonical outputs AND reproduces each
drifted/divergent sheet value to the cent, so no difference is accidental. Precedent:
Plan 3's savings-rate line and Plan 4's Unrealized column shipped the principled formula
over the sheet's the same way.

Stored input values are authoritative for the breakdown; `derive_suggestions` is advisory
only (the UI offers a chip, nothing is ever auto-applied server-side).

Outputs are full-precision and UNBOUNDED: a product of two API-bounded inputs (treasuries ×
exempt-pct, each up to 10^10) reaches ~10^20, and an effective rate over a near-zero base
~10^24. So the schema layer must quantize money with a plain `Decimal.quantize` — never
money.py's bounded `quantize_money` — and range-guard rates before `quantize_pct`; with
either guard skipped, a GET raises on data the API itself accepted.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from app.tax_keys import JURISDICTIONS, MARRIED_JOINT, MARRIED_SEPARATE, SINGLE

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
# Statutory and non-indexed (audit §5), so constants rather than data: MFJ is 250000 and
# MFS 125000, neither of which is "2x single". An unknown status reads single's figure —
# this is a pure read over stored data and must never raise on it.
NIIT_AGI_THRESHOLDS: dict[str, Decimal] = {
    SINGLE: NIIT_AGI_THRESHOLD,
    MARRIED_JOINT: Decimal("250000"),
    MARRIED_SEPARATE: Decimal("125000"),
}
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


def _federal_agi(value: Callable[[str], Decimal]) -> Decimal:
    """Federal AGI, the sheet's clean model (rows 96-99).

    ONE definition with two consumers: `compute_breakdown`'s income chain and the SALT
    phase-down's MAGI in `derive_suggestions`. Term order is the canonical formula's, so
    the goldens pin it to the cent. capital_loss_deductions is deliberately absent — the
    sheet models it as a line but no output formula ever reads it.
    """
    return (
        value("latest_w2_income")
        + value("other_w2_income")
        + value("stcg_total")
        + value("unqualified_dividends")
        + value("interest_total")
        + value("other_income_1099")
    ) - (
        value("trad_401k_contributions")
        + value("hsa_contributions")
        + value("hsa_contributions_employer")
        + value("other_pretax_deductions")
    )


@dataclass(frozen=True)
class EarnerWages:
    """One person's W-2 wage bundle for the per-earner payroll walks (spec §5.3).

    THREE fields, not one, because the sheet's FICA bases differ per family: Social
    Security and Medicare run on wages net of HSA *and* the other pre-tax deductions,
    while CA SDI subtracts dental/vision alone (the CA quirk in the FICA note below). A
    single `w2_wages` scalar could not reproduce both, so each earner carries the two
    pre-tax legs and the engine derives the bases here — one definition, two consumers,
    exactly as the aggregate path did.
    """

    w2_wages: Decimal
    pretax_hsa: Decimal = ZERO
    other_pretax: Decimal = ZERO

    @property
    def fica_wages(self) -> Decimal:
        """The Medicare / Social Security base for this person."""
        return self.w2_wages - (self.pretax_hsa + self.other_pretax)

    @property
    def sdi_wages(self) -> Decimal:
        """The CA SDI base: dental/vision out, HSA deliberately left IN."""
        return self.w2_wages - self.other_pretax


def earner_from_inputs(values: Mapping[str, Decimal]) -> EarnerWages:
    """One person's bundle from THEIR OWN input rows — the exact composition
    `compute_breakdown` synthesizes when `earners` is None, so the API can build a
    two-earner list without a second definition of "what a W-2 is"."""

    def value(key: str) -> Decimal:
        found = values.get(key)
        return ZERO if found is None else found

    return EarnerWages(
        w2_wages=value("latest_w2_income") + value("other_w2_income"),
        pretax_hsa=value("hsa_contributions") + value("hsa_contributions_employer"),
        other_pretax=value("other_pretax_deductions"),
    )


@dataclass
class JurisdictionResult:
    """One tax family's line; the fields that family does not have stay None.

    Income taxes carry agi/taxable_income, wage taxes carry w2_income/taxable_wages, and
    capital gains carry taxable_income (the ordinary income the gains stack on top of)
    plus gains_amount.
    """

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
    """Effective rate at full precision; None when the base is 0 (the sheet's #DIV/0!).

    A negative base still divides — the sign semantics are the sheet's — but `0 / -base` is
    Decimal("-0"), which would serialize as "-0.000000"; adding ZERO collapses it to +0.
    """
    if base == 0:
        return None
    return (tax / base) + ZERO


def niit_advisory(
    fed_agi: Decimal, cg_brackets: list[Bracket], filing_status: str = SINGLE
) -> str | None:
    """Flag stored CG rates that contradict the sheet's AGI-driven NIIT rule.

    Returns None when the table is too short to carry both rates (nothing to compare) or
    when the stored pair already matches. Never edits the brackets: the engine walks what
    is stored, verbatim. The threshold is the filing status's (200k / 250k / 125k) — an
    unknown status reads single's, because a GET must never fail on stored data.
    """
    if len(cg_brackets) < 3:
        return None
    threshold = NIIT_AGI_THRESHOLDS.get(filing_status, NIIT_AGI_THRESHOLD)
    ordered = sorted(cg_brackets, key=lambda bracket: bracket[1])
    stored = (ordered[1][0], ordered[2][0])
    above = fed_agi > threshold
    expected = NIIT_RATES if above else BASE_CG_RATES
    if stored == expected:
        return None
    # Stored rates arrive at the column's Numeric(7,4) scale, so normalize before rendering:
    # 0.1500 and a hand-typed 0.15 are the same rate and must produce the same message. The
    # EXPECTED pair is normalized identically — otherwise the constants' own scale leaks
    # into the text and the message reads "0.15/0.2 ... implies 0.15/0.20".
    return NIIT_WARNING.format(
        stored=stored[0].normalize(),
        stored_top=stored[1].normalize(),
        side="above" if above else "at or below",
        threshold=threshold,
        expected=expected[0].normalize(),
        expected_top=expected[1].normalize(),
    )


def compute_breakdown(
    year: int,
    inputs: dict[str, Decimal],
    brackets: dict[str, list[Bracket]],
    *,
    filing_status: str = SINGLE,
    earners: list[EarnerWages] | None = None,
) -> TaxBreakdown:
    """The canonical model, per the Plan 5 Workbook reference.

    Missing input keys default to 0 (an empty sheet cell IS a zero) and are reported once,
    in form order. A jurisdiction that is missing — or explicitly stored as an empty
    bracket list — yields 0 tax plus a warning. Effective rates are full-precision ratios,
    None when the denominator is 0; the schema layer quantizes.

    `filing_status` selects nothing here but the NIIT advisory's threshold: every OTHER
    status-dependent number lives in the bracket TABLES the caller selected, which is why
    a wrong-status table is refused upstream rather than compensated for down here.

    `earners` is the per-person wage split the payroll walks need (2026-08-26 spec §5.3).
    With None the engine synthesizes the single bundle from `inputs` exactly as it always
    did, so the whole default path — and the golden suite — is byte-identical. An EMPTY
    list is not "one earner with nothing": it means no wage data at all, and reads like a
    year with no W-2.
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
    fed_agi = _federal_agi(values.__getitem__)
    fed_deduction = max(values["standard_deduction"], values["itemized_deduction"])
    fed_ti = fed_agi - fed_deduction
    fed_tax = walk(tables["federal"], fed_ti)

    # Capital gains (rows 118-120): a long-term LOSS nets against gains only while the net
    # stays positive; otherwise the sheet drops it (its deduction line never reaches AGI).
    # Netted here, above the state section, because state AGI consumes cg_amount too; the
    # federal CG stack itself is applied after FICA, where the sheet computes it.
    ltcg = values["ltcg_total"]
    netted = ltcg + values["qualified_dividends"] + values["other_capital_gains"]
    if ltcg > 0:
        cg_amount = netted
    elif ltcg < 0 and netted > 0:
        cg_amount = netted
    else:
        cg_amount = values["qualified_dividends"] + values["other_capital_gains"]

    # State (rows 100-103): CA exempts the treasury slice of unqualified dividends and
    # does NOT recognise the HSA deduction, so both are added back — and, deliberately
    # unlike the sheet (whose state chain dropped them in EVERY year), state AGI carries
    # cg_amount: California taxes capital gains and all dividends as ordinary income
    # (2026-08-25 spec §1). One definition of taxable gains, two consumers — this term and
    # the federal stack below.
    state_agi = (
        fed_agi
        - values["unq_div_us_treasuries_etf"] * values["unq_div_state_exempt_pct"]
        + values["hsa_contributions"]
        + values["hsa_contributions_employer"]
        + cg_amount
    )
    state_ti = state_agi - values["state_standard_deduction"]
    state_tax = walk(tables["state"], state_ti) - values["state_exemption_credits"]
    if state_tax < 0:
        warnings.append(NEGATIVE_STATE_TAX_WARNING)

    # FICA (rows 104-115): the wage bases deliberately keep trad-401k in — it is pre-tax
    # for income tax only. SDI subtracts dental/vision alone, not HSA (the CA quirk).
    # One earner or many, the REPORTED aggregates are identical sums; what changes is
    # where the per-person caps bite (2026-08-26 spec §5.3).
    bundles = [earner_from_inputs(values)] if earners is None else list(earners)
    w2_income = sum((earner.w2_wages for earner in bundles), ZERO)
    # Medicare is a COMBINED-wage walk on purpose, and its shape is unchanged: the 1.45%
    # base is linear, and the 0.9% additional tier is legally assessed on COMBINED wages
    # above the status threshold (Form 8959). Correctness therefore comes from the
    # status-selected medicare table (MFJ's tier at 250k, MFS's at 125k), never from
    # splitting the wages — a per-person split would UNDER-charge a two-earner couple.
    medicare_wages = sum((earner.fica_wages for earner in bundles), ZERO)
    medicare_tax = walk(tables["medicare"], medicare_wages)

    # The SS wage base is modelled as a terminal 0-rate bracket; r109's min() makes the cap
    # explicit so taxable_wages reads as the capped figure the sheet displays. It is
    # tax-neutral by construction (income inside a 0-rate bracket contributes nothing), and
    # it is only a cap when that top rate really is 0 — a table without the terminal row,
    # or with a genuinely progressive top tier, reports (and taxes) uncapped wages. The cap
    # is PER PERSON: two earners get two wage bases, which is the single worst wrong-money
    # consequence of the old shared figure (audit §3.2).
    ss_table = tables["social_security"]
    ss_cap: Decimal | None = None
    if len(ss_table) > 1:
        top_rate, top_threshold = max(ss_table, key=lambda bracket: bracket[1])
        if top_rate == 0:
            ss_cap = top_threshold
    ss_bases = [
        earner.fica_wages if ss_cap is None else min(earner.fica_wages, ss_cap)
        for earner in bundles
    ]
    ss_wages = sum(ss_bases, ZERO)
    ss_tax = sum((walk(ss_table, base) for base in ss_bases), ZERO)

    # SDI likewise walks per earner (the sheet-derived data carries a pseudo-cap row, and a
    # cap is a per-person parameter), while the REPORTED taxable_wages stays the uncapped
    # aggregate the sheet displays — pinned by the 2024 golden's 235424.46.
    sdi_table = tables["disability"]
    sdi_wages = sum((earner.sdi_wages for earner in bundles), ZERO)
    sdi_tax = sum((walk(sdi_table, earner.sdi_wages) for earner in bundles), ZERO)

    # The federal CG stack (row 120): cg_amount was netted above the state section, which
    # shares it; the gains stack on top of federal taxable income.
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

    advisory = niit_advisory(fed_agi, tables["capital_gains"], filing_status)
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
