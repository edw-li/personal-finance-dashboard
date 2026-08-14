"""Pure sheet parsers: worksheet -> normalized dataclasses + issues. No DB imports here."""

ROW_CAP = 2000  # unsized Google-Sheets export: never trust ws.max_row (see plan notes)
BLANK_STREAK_STOP = 5

# The Taxes sheet's input labels in exact row order per section. The parser walks this
# sequence and hard-errors on any mismatch — it is the layout-drift detector. Keys must
# exist in app.tax_keys (asserted by tests).
SHEET_TAX_INPUT_SEQUENCE: list[tuple[str, list[tuple[str, str]]]] = [
    (
        "ORDINARY INCOME",
        [
            ("Annual Salary", "annual_salary"),
            ("Gross Paycheck", "gross_paycheck"),
            ("Pay Periods", "pay_periods"),
            ("Latest W2 Income", "latest_w2_income"),
            ("Other W2 Income", "other_w2_income"),
            ("(Stock/RSUs Sold)", "w2_stock_rsus_sold"),
            ("(Bonuses)", "w2_bonuses"),
            ("(Salary Checkpoint)", "w2_salary_checkpoint"),
            ("(ESPP Sale Component)", "w2_espp_sale_component"),
            ("(Employer HSA Contribution)", "w2_employer_hsa"),
            ("(Other, specify)", "w2_other"),
            ("Short Term Capital Gain/Loss", "stcg_total"),
            ("(Standard Gain/Loss)", "stcg_standard"),
            ("(ESPP Sale Component)", "stcg_espp_component"),
            ("Unqualified Dividends", "unqualified_dividends"),
            ("(US Treasuries ETF)", "unq_div_us_treasuries_etf"),
            ("(State Exempt Percentage)", "unq_div_state_exempt_pct"),
            ("(Other Dividends)", "unq_div_other"),
            ("Interest", "interest_total"),
            ("(Standard Interest)", "interest_standard"),
            ("(US Treasuries)", "interest_us_treasuries"),
            ("Other Income, eg. 1099 MISC", "other_income_1099"),
        ],
    ),
    (
        "DEDUCTIONS",
        [
            ("Traditional 401k Contributions", "trad_401k_contributions"),
            ("HSA Contributions", "hsa_contributions"),
            ("HSA Contributions (Employer)", "hsa_contributions_employer"),
            ("Capital Loss Deductions", "capital_loss_deductions"),
            ("Other Pre-tax Deductions", "other_pretax_deductions"),
            ("(Dental)", "pretax_dental"),
            ("(Vision)", "pretax_vision"),
            ("Standard Deduction", "standard_deduction"),
            ("Itemized Deduction", "itemized_deduction"),
            ("(SALT Amount)", "itemized_salt"),
            ("(Donations/Tithes)", "itemized_donations"),
            ("(Vehicle Registration Fees)", "itemized_vehicle_reg"),
            ("(Sec 199A Div - [20%])", "itemized_sec199a_div"),
            ("(Other Items)", "itemized_other"),
        ],
    ),
    (
        "CAPITAL GAINS",
        [
            ("Long Term Capital Gain/Loss", "ltcg_total"),
            ("(Brokerage Gain/Loss)", "ltcg_brokerage"),
            ("(ESPP Sale Component)", "ltcg_espp_component"),
            ("Qualified Dividends", "qualified_dividends"),
            ("Other Capital Gains", "other_capital_gains"),
        ],
    ),
]
