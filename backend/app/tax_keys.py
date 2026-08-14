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
    ("pay_periods", "Pay Periods", ORDINARY_INCOME, 30, False),
    ("latest_w2_income", "Latest W2 Income", ORDINARY_INCOME, 40, True),
    ("other_w2_income", "Other W2 Income", ORDINARY_INCOME, 50, True),
    ("w2_stock_rsus_sold", "W2: Stock/RSUs Sold", ORDINARY_INCOME, 60, False),
    ("w2_bonuses", "W2: Bonuses", ORDINARY_INCOME, 70, False),
    ("w2_salary_checkpoint", "W2: Salary Checkpoint", ORDINARY_INCOME, 80, False),
    ("w2_espp_sale_component", "W2: ESPP Sale Component", ORDINARY_INCOME, 90, False),
    ("w2_employer_hsa", "W2: Employer HSA Contribution", ORDINARY_INCOME, 100, False),
    ("w2_other", "W2: Other", ORDINARY_INCOME, 110, False),
    ("stcg_total", "Short Term Capital Gain/Loss", ORDINARY_INCOME, 120, True),
    ("stcg_standard", "STCG: Standard Gain/Loss", ORDINARY_INCOME, 130, False),
    ("stcg_espp_component", "STCG: ESPP Sale Component", ORDINARY_INCOME, 140, False),
    ("unqualified_dividends", "Unqualified Dividends", ORDINARY_INCOME, 150, True),
    ("unq_div_us_treasuries_etf", "Unq Div: US Treasuries ETF", ORDINARY_INCOME, 160, False),
    ("unq_div_state_exempt_pct", "Unq Div: State Exempt Percentage", ORDINARY_INCOME, 170, False),
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
    ("itemized_sec199a_div", "Itemized: Sec 199A Div (20%)", DEDUCTIONS, 130, False),
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

JURISDICTIONS = (
    "federal",
    "state",
    "medicare",
    "social_security",
    "disability",
    "capital_gains",
)
