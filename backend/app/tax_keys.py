"""Tax input definitions: (key, label, section, sort_order, is_derived).

is_derived marks line items the sheet computes from others (gray cells); the UI
offers a computed suggestion but the stored value remains editable.
"""

ORDINARY_INCOME = "ordinary_income"
DEDUCTIONS = "deductions"
CAPITAL_GAINS = "capital_gains"

SECTIONS = (ORDINARY_INCOME, DEDUCTIONS, CAPITAL_GAINS)

TAX_INPUT_DEFINITIONS: list[tuple[str, str, str, int, bool]] = [
    ("annual_salary", "Annual Salary", ORDINARY_INCOME, 10, False),
    ("gross_paycheck", "Gross Paycheck", ORDINARY_INCOME, 20, True),
    ("pay_periods", "Pay periods (checks received so far this year)", ORDINARY_INCOME, 30, False),
    ("latest_w2_income", "Latest W2 Income", ORDINARY_INCOME, 40, True),
    ("other_w2_income", "Other W2 Income", ORDINARY_INCOME, 50, True),
    ("w2_stock_rsus_sold", "W2: Stock/RSUs Sold", ORDINARY_INCOME, 60, False),
    ("w2_bonuses", "W2: Bonuses", ORDINARY_INCOME, 70, False),
    ("w2_salary_checkpoint", "W2: Salary Checkpoint", ORDINARY_INCOME, 80, False),
    ("w2_espp_sale_component", "W2: ESPP Sale Component", ORDINARY_INCOME, 90, False),
    ("w2_employer_hsa", "W2: Employer HSA Contribution", ORDINARY_INCOME, 100, False),
    ("w2_other", "W2: Other", ORDINARY_INCOME, 110, False),
    # Tracker-only (2026-08-26 spec §5.6): the withholding card's partner side reads these
    # two, the engine never does. Stored inputs outside ENGINE_INPUT_KEYS — real values
    # the user enters, zero effect on any liability. (capital_loss_deductions used to be
    # the precedent here; it joined the engine's keys on 2026-08-31, spec C3.)
    ("w2_fed_withholding", "W2: Federal Withholding", ORDINARY_INCOME, 112, False),
    ("w2_state_withholding", "W2: State Withholding", ORDINARY_INCOME, 114, False),
    # The third tracker-only key (2026-09-09 audit item 4c): what was ACTUALLY withheld on
    # the year's bonuses, which replaces the withholding card's 22% / 6.6% / marginal-FICA
    # model when it is entered. Like its two neighbours, the engine never reads it.
    (
        "w2_bonus_withholding",
        "W-2: bonus withholding (actual, optional)",
        ORDINARY_INCOME,
        116,
        False,
    ),
    ("stcg_total", "Short Term Capital Gain/Loss", ORDINARY_INCOME, 120, True),
    ("stcg_standard", "STCG: Standard Gain/Loss", ORDINARY_INCOME, 130, False),
    ("stcg_espp_component", "STCG: ESPP Sale Component", ORDINARY_INCOME, 140, False),
    ("unqualified_dividends", "Unqualified Dividends", ORDINARY_INCOME, 150, True),
    ("unq_div_us_treasuries_etf", "Unq Div: US Treasuries ETF", ORDINARY_INCOME, 160, False),
    (
        "unq_div_state_exempt_pct",
        "Treasury-fund dividends — state-exempt share (%)",
        ORDINARY_INCOME,
        170,
        False,
    ),
    ("unq_div_other", "Unq Div: Other Dividends", ORDINARY_INCOME, 180, False),
    ("interest_total", "Interest", ORDINARY_INCOME, 190, True),
    ("interest_standard", "Interest: Standard", ORDINARY_INCOME, 200, False),
    ("interest_us_treasuries", "Interest: US Treasuries", ORDINARY_INCOME, 210, False),
    ("other_income_1099", "Other Income (e.g. 1099 MISC)", ORDINARY_INCOME, 220, False),
    ("trad_401k_contributions", "Traditional 401k Contributions", DEDUCTIONS, 10, False),
    ("hsa_contributions", "HSA Contributions", DEDUCTIONS, 20, False),
    ("hsa_contributions_employer", "HSA Contributions (Employer)", DEDUCTIONS, 30, False),
    ("capital_loss_deductions", "Capital Loss Deductions", DEDUCTIONS, 40, False),
    ("other_pretax_deductions", "Other Pre-tax Deductions", DEDUCTIONS, 50, True),
    ("pretax_dental", "Pre-tax: Dental", DEDUCTIONS, 60, False),
    ("pretax_vision", "Pre-tax: Vision", DEDUCTIONS, 70, False),
    ("standard_deduction", "Standard Deduction", DEDUCTIONS, 80, False),
    ("itemized_deduction", "Itemized Deduction", DEDUCTIONS, 90, True),
    ("itemized_salt", "Itemized: SALT Amount", DEDUCTIONS, 100, False),
    ("itemized_donations", "Itemized: Donations/Tithes", DEDUCTIONS, 110, False),
    ("itemized_vehicle_reg", "Itemized: Vehicle Registration Fees", DEDUCTIONS, 120, False),
    (
        "itemized_sec199a_div",
        "Sec 199A QBI deduction (20% of qualified REIT/PTP dividends)",
        DEDUCTIONS,
        130,
        False,
    ),
    ("itemized_other", "Itemized: Other Items", DEDUCTIONS, 140, False),
    # CA state-engine data rows from the sheet's STATE INCOME TAX INFO block — per-year
    # values the Plan 5 engine needs; they are inputs, not brackets.
    ("state_standard_deduction", "State Standard Deduction", DEDUCTIONS, 150, False),
    ("state_exemption_credits", "State Exemption Credits", DEDUCTIONS, 160, False),
    ("ltcg_total", "Long Term Capital Gain/Loss", CAPITAL_GAINS, 10, True),
    ("ltcg_brokerage", "LTCG: Brokerage Gain/Loss", CAPITAL_GAINS, 20, False),
    ("ltcg_espp_component", "LTCG: ESPP Sale Component", CAPITAL_GAINS, 30, False),
    ("qualified_dividends", "Qualified Dividends", CAPITAL_GAINS, 40, False),
    ("other_capital_gains", "Other Capital Gains", CAPITAL_GAINS, 50, False),
]

# The UNIT each key is entered in (2026-09-09 spec §2). Money is the default and the
# exceptions are listed, so a key added later is money until it says otherwise — which is
# right for a tax sheet. Deliberately CODE, not a `tax_input_definitions` column: the unit
# is a property of the key rather than of one database, so a stored column would only mean
# a migration to tell an old database that `pay_periods` counts checks. The API stamps
# every `TaxInputsOut` item with `unit_for(key)` and the form picks its box from it.
MONEY = "money"
COUNT = "count"
PERCENT = "percent"
INPUT_UNITS = (MONEY, COUNT, PERCENT)

TAX_INPUT_UNITS: dict[str, str] = {
    "pay_periods": COUNT,
    # Stored as the FRACTION the engine multiplies by (0.9753); the form shows 97.53%.
    "unq_div_state_exempt_pct": PERCENT,
}


def unit_for(key: str) -> str:
    """This key's entry unit — `money` unless TAX_INPUT_UNITS says otherwise."""
    return TAX_INPUT_UNITS.get(key, MONEY)


_LABELS: dict[str, str] = {key: label for key, label, *_ in TAX_INPUT_DEFINITIONS}


def label_for(key: str, stored: str) -> str:
    """The label to SHOW for a key: this file's, when this file knows the key.

    `seed_tax_definitions` is insert-only by contract (test_seed.py pins it), so a row
    written before a relabel keeps the old text forever — and a relabel is a code change,
    like the unit above. Serving the label from here rather than from the row means a
    rename ships with the code that motivated it, on every database, with no migration and
    no boot-time rewrite of a table nothing else touches. `stored` is the fallback for a
    key this file does not define, which only an importer could create.
    """
    return _LABELS.get(key, stored)


# The ranges the PUT enforces per unit. A count of checks received so far this year is a
# whole number, and 53 is the most a weekly payroll can pay in one calendar year; a percent
# key stores a fraction, so 0..1 (the engine multiplies it directly).
MIN_INPUT_COUNT = 0
MAX_INPUT_COUNT = 53


JURISDICTIONS = (
    "federal",
    "state",
    "medicare",
    "social_security",
    "disability",
    "capital_gains",
)

# The two that are levied PER WORKER (2026-09-11 spec §2.1): Social Security's wage base is
# per employee and California's SDI — or an employer's Voluntary Plan in its place — is per
# worker and per employer, so one household can need two different tables for the same year.
# Medicare, federal, state and capital gains are per RETURN and never carry a person.
#
# ONE tuple, because this is one fact with two readers: `tax_brackets.person_id` may only be
# set for these, and the clone helper's `verbatim_ok` flags name exactly these for exactly
# the same reason (a per-worker parameter does not move with filing status).
PER_WORKER_JURISDICTIONS: tuple[str, ...] = ("social_security", "disability")

# Filing status (2026-08-26 spec §4). Python-validated like `accounts.group`, and stored
# as a plain String(20) so a future status (head_of_household) is a one-line change plus
# data, never a migration. `single` is the default everywhere: every stored year predates
# the marriage, and the engine's single path must stay byte-identical.
SINGLE = "single"
MARRIED_JOINT = "married_joint"
MARRIED_SEPARATE = "married_separate"
FILING_STATUSES = (SINGLE, MARRIED_JOINT, MARRIED_SEPARATE)

# The input keys that belong to a PERSON rather than the household (audit §3.2's list of
# 17, plus the two tracker keys above). Every OTHER key is household-level and stores
# exactly one row per year with person_id NULL — after the person migration, NULL means
# household, strictly. Only six of these reach the engine's walks; the rest feed the
# suggestion formulas and the withholding card.
PER_PERSON_KEYS: tuple[str, ...] = (
    "annual_salary",
    "gross_paycheck",
    "pay_periods",
    "latest_w2_income",
    "other_w2_income",
    "w2_stock_rsus_sold",
    "w2_bonuses",
    "w2_salary_checkpoint",
    "w2_espp_sale_component",
    "w2_employer_hsa",
    "w2_other",
    "w2_fed_withholding",
    "w2_state_withholding",
    "w2_bonus_withholding",
    "trad_401k_contributions",
    "hsa_contributions",
    "hsa_contributions_employer",
    "other_pretax_deductions",
    "pretax_dental",
    "pretax_vision",
)

# The nine totals the sheet's grey cells computed and this app now computes itself
# (2026-09-11 spec §1.1): never stored, never accepted on a write, rebuilt by the engine
# from the components below. ONE list, read off the definition tuples' `is_derived` flag
# rather than typed again beside them, so a tenth total is added in exactly one place.
DERIVED_KEYS: tuple[str, ...] = tuple(
    key for key, _label, _section, _order, derived in TAX_INPUT_DEFINITIONS if derived
)

# The four that belong to a PERSON and the five that belong to the return. The split is
# load-bearing, not cosmetic: a per-person product cannot be rebuilt from household sums
# (Σ pᵢ·sᵢ/24 ≠ (Σpᵢ)(Σsᵢ)/24), so the per-person four are materialized per column and only
# then summed, while the five below are rebuilt once over the summed dict.
PER_PERSON_DERIVED_KEYS: tuple[str, ...] = tuple(k for k in DERIVED_KEYS if k in PER_PERSON_KEYS)
# In DEPENDENCY order, which is why this one is spelled out rather than filtered from
# DERIVED_KEYS: stcg_total nets against the REBUILT ltcg_total, and itemized_deduction
# sizes its SALT cap on a MAGI that reads every total above it. `materialize_household`
# ITERATES this tuple over a table of formulas, so the order below is the order the engine
# runs — not a comment about it that a reordered function could silently contradict.
HOUSEHOLD_DERIVED_KEYS: tuple[str, ...] = (
    "ltcg_total",
    "unqualified_dividends",
    "interest_total",
    "stcg_total",
    "itemized_deduction",
)

# What each formula READS, expanded transitively so no entry is itself derived: the
# question every consumer actually asks is "has the user entered anything this total could
# be built from", and a derived component would make that question recursive. The keys MAGI
# reads to size the SALT cap are deliberately NOT components of itemized_deduction — they
# move the cap, they are not terms of the sum. Consumers: the two 422 sentences, the
# importer's skip, the form's paste note and the engine's "all components absent" rule.
DERIVED_COMPONENTS: dict[str, tuple[str, ...]] = {
    "gross_paycheck": ("annual_salary",),
    "latest_w2_income": ("pay_periods", "annual_salary"),
    "other_w2_income": (
        "w2_stock_rsus_sold",
        "w2_bonuses",
        "w2_salary_checkpoint",
        "w2_espp_sale_component",
        "w2_employer_hsa",
        "w2_other",
    ),
    "stcg_total": (
        "stcg_standard",
        "stcg_espp_component",
        # The long-term legs the netting rule nets against: ltcg_total is derived, so its
        # own components stand in its place here.
        "ltcg_brokerage",
        "ltcg_espp_component",
    ),
    "unqualified_dividends": ("unq_div_us_treasuries_etf", "unq_div_other"),
    "interest_total": ("interest_standard", "interest_us_treasuries"),
    "other_pretax_deductions": ("pretax_dental", "pretax_vision"),
    "itemized_deduction": (
        "itemized_salt",
        "itemized_donations",
        "itemized_vehicle_reg",
        "itemized_other",
    ),
    "ltcg_total": ("ltcg_brokerage", "ltcg_espp_component"),
}

# The human formula shown beside a computed cell, in place of the chip it replaced.
# Presentation owned by the code that owns the formula — the `label_for` / `unit_for`
# precedent — so a formula change ships its caption with it, on every database.
FORMULA_CAPTIONS: dict[str, str] = {
    "gross_paycheck": "Annual Salary ÷ 24",
    "latest_w2_income": "Pay periods × Gross Paycheck",
    "other_w2_income": (
        "RSUs sold + Bonuses + Salary checkpoint + ESPP sale component + Employer HSA + Other"
    ),
    "stcg_total": "Standard + ESPP short-term, netted against a long-term loss",
    "unqualified_dividends": "US Treasuries ETF + Other dividends",
    "interest_total": "Standard + US Treasuries",
    "other_pretax_deductions": "Dental + Vision",
    "itemized_deduction": "SALT (capped) + Donations + Vehicle registration + Other",
    "ltcg_total": "Brokerage + ESPP long-term",
}


_DERIVED_KEY_SET = frozenset(DERIVED_KEYS)


def is_derived_key(key: str) -> bool:
    """Is this total computed? The API stamps `is_derived` from HERE, not from the
    `tax_input_definitions` column — the seed is insert-only, so the column is a record of
    what an old database was told, while this file is what the engine does today."""
    return key in _DERIVED_KEY_SET


def component_labels(key: str) -> str:
    """This total's components, by LABEL, in form order — the text the two refusal
    sentences interpolate ("edit those instead" / "override those instead" — singular when
    the total has exactly one component).

    Labels rather than keys because the sentence is read by the person looking at the form,
    where every one of these is a row they can see."""
    return ", ".join(label_for(component, component) for component in DERIVED_COMPONENTS[key])
