import datetime
from decimal import Decimal

import pytest

from app.importer.parsers import SHEET_TAX_INPUT_SEQUENCE
from app.tax_keys import TAX_INPUT_DEFINITIONS
from tests.workbook_builder import (
    build_workbook,
    default_espp_rows,
    default_net_worth_rows,
    default_paycheck_rows,
    default_portfolio_rows,
    default_positions_rows,
    default_reference_data_rows,
    default_spending_rows,
    default_taxes_rows,
    load_readonly,
)


def test_builder_produces_loadable_workbook_with_all_sheets():
    wb = load_readonly(build_workbook())
    assert set(wb.sheetnames) == {
        "Paycheck Modeler",
        "ESPP",
        "Focal History",
        "Positions",
        "Spending",
        "Taxes",
        "Net Worth",
        "Portfolio",
        "ReferenceData",
    }
    ws = wb["Net Worth"]
    rows = list(ws.iter_rows(min_row=1, max_row=1, max_col=3, values_only=True))
    assert rows[0][0] == "Month"
    # The real workbook is an unsized Google-Sheets export; the fixture must present the
    # same hazard (ws.max_row is None) so parsers relying on it fail here, not on real data.
    assert ws.max_row is None
    with pytest.raises(ValueError):
        ws.calculate_dimension()
    wb.close()


def test_sheet_tax_sequence_matches_tax_keys():
    sequence_keys = [key for _, entries in SHEET_TAX_INPUT_SEQUENCE for _, key in entries]
    definition_keys = [key for key, *_ in TAX_INPUT_DEFINITIONS]
    # The sheet block covers exactly the 41 original definitions (the 2 state keys from
    # Task 2 are parsed out of the STATE bracket section instead).
    assert sequence_keys == [k for k in definition_keys if not k.startswith("state_")]
    assert len(sequence_keys) == 41


def test_build_workbook_rejects_unknown_override():
    with pytest.raises(TypeError, match="unknown sheet override"):
        build_workbook(referencedata=None)  # typo'd key must not silently no-op


def _sheet(name, **overrides):
    wb = load_readonly(build_workbook(**overrides))
    return wb[name]


def test_parse_reference_data_maps_fields_and_junk():
    from app.importer.parsers import parse_reference_data

    parsed = parse_reference_data(_sheet("ReferenceData"))
    assert parsed.issues.errors == []
    by_ticker = {s.ticker: s for s in parsed.securities}
    assert set(by_ticker) == {"ACME", "DIVC", "MUT1"}
    acme = by_ticker["ACME"]
    assert acme.name == "Acme ETF"
    assert acme.industry == "ETF"
    assert acme.holding_type == "etf"
    assert acme.annual_dividend == Decimal("2.5000")  # string cell '2.5'
    assert acme.ex_div_date == datetime.date(2024, 1, 31)
    assert acme.last_price == Decimal("100.5000")
    divc = by_ticker["DIVC"]
    assert divc.holding_type == "stock"
    assert divc.ex_div_date is None  # time(0,0) junk -> None silently
    assert divc.last_price is None  # '#N/A' -> skipped with warning
    assert any("last price" in w.lower() for w in parsed.issues.warnings)
    assert by_ticker["MUT1"].holding_type == "mutual_fund"


def test_parse_reference_data_duplicate_ticker_or_name_is_error():
    from app.importer.parsers import parse_reference_data

    rows = [
        ["Symbol", "Name", "Sector", None, None, None, None, None, None],
        ["AAA", "Same Name", "ETF", None, 1.0, None, None, None, None],
        ["AAA", "Other Name", "ETF", None, 1.0, None, None, None, None],
        ["BBB", "Same Name", "ETF", None, 1.0, None, None, None, None],
    ]
    parsed = parse_reference_data(_sheet("ReferenceData", reference_data=rows))
    assert len(parsed.issues.errors) == 2  # duplicate ticker AAA, duplicate name


def test_parse_positions_skips_zero_share_rows_and_keeps_order():
    from app.importer.parsers import parse_positions

    parsed = parse_positions(_sheet("Positions"))
    assert parsed.issues.errors == []
    assert [t.name for t in parsed.transactions] == ["Acme ETF", "Acme ETF", "Mystery Fund"]
    first, sell, mystery = parsed.transactions
    assert first.account == "RH Taxable"
    assert first.type == "buy"
    assert first.txn_date is None  # the sheet has no date column (spec risk)
    assert first.shares == Decimal("10.123457")  # 12dp -> 6dp HALF_UP
    assert first.price == Decimal("100.1235")  # 6dp -> 4dp HALF_UP
    assert first.fees is None
    assert first.sort_index == 20  # sheet row 2 * 10
    assert sell.type == "sell"
    assert sell.fees == Decimal("1.50")
    assert sell.sort_index == 40  # row 4 (the zero-share row 3 was skipped, index keeps row order)
    assert mystery.sort_index == 50
    assert any("zero-share" in w.lower() for w in parsed.issues.warnings)


def test_parse_positions_split_and_bad_type():
    from app.importer.parsers import parse_positions

    rows = default_positions_rows()[:2]
    rows.append(["RH Taxable", "Split", "Acme ETF", None, None, None, 4.0, 0, 0, 0, 0, 0])
    rows.append(["RH Taxable", "Split", "Acme ETF", None, None, None, None, 0, 0, 0, 0, 0])
    rows.append(["RH Taxable", "Gift", "Acme ETF", 1.0, 1.0, None, None, 0, 0, 0, 0, 0])
    parsed = parse_positions(_sheet("Positions", positions=rows))
    split = parsed.transactions[-1]
    assert split.type == "split"
    assert split.split_factor == Decimal("4.0000")
    assert split.shares == Decimal("0") and split.price == Decimal(
        "0"
    )  # dummy per Plan 1 convention
    assert len(parsed.issues.errors) == 2  # split without factor; unknown type 'Gift'


def test_parse_positions_warns_on_negative_and_unreadable_fees():
    from app.importer.parsers import parse_positions

    rows = default_positions_rows()[:2]
    rows.append(["RH Taxable", "Buy", "Acme ETF", -5.0, 10.0, None, None, 0, 0, 0, 0, 0])
    rows.append(["RH Taxable", "Buy", "Acme ETF", 1.0, 10.0, "#REF!", None, 0, 0, 0, 0, 0])
    parsed = parse_positions(_sheet("Positions", positions=rows))
    assert parsed.issues.errors == []
    assert len(parsed.transactions) == 3  # both flagged rows still import
    assert any("negative shares/price" in w for w in parsed.issues.warnings)
    assert any("without fees" in w for w in parsed.issues.warnings)


def test_parse_net_worth_accounts_groups_and_balances():
    from app.importer.parsers import parse_net_worth

    parsed = parse_net_worth(_sheet("Net Worth"))
    assert parsed.issues.errors == []
    assert [(a.name, a.group, a.sort_order) for a in parsed.accounts] == [
        ("Checking", "cash", 3),
        ("IRA", "pre_tax", 5),
        ("Credit Card", "liability", 7),
    ]
    assert len(parsed.snapshots) == 2  # r5 future-template row skipped
    first, second = parsed.snapshots
    assert first.month == datetime.date(2024, 1, 1)
    assert first.recorded_on == datetime.date(2024, 1, 5)
    assert first.balances["Checking"] == Decimal("100.50")
    assert first.balances["IRA"] == Decimal("0.00")  # 0.001 sentinel normalized
    assert first.balances["Credit Card"] == Decimal("-25.00")  # liabilities stored negative
    assert second.balances["Credit Card"] == Decimal("-30.00")
    assert any("0.001" in w for w in parsed.issues.warnings)  # aggregate sentinel warning
    assert any("liabilit" in w.lower() for w in parsed.issues.warnings)


def test_parse_net_worth_unknown_band_falls_back_to_other():
    from app.importer.parsers import parse_net_worth

    rows = default_net_worth_rows()
    rows[0][6] = "MYSTERY GROUP"
    parsed = parse_net_worth(_sheet("Net Worth", net_worth=rows))
    assert parsed.accounts[2].group == "other"
    assert any("MYSTERY GROUP" in w for w in parsed.issues.warnings)


def test_parse_net_worth_duplicate_month_is_error():
    from app.importer.parsers import parse_net_worth

    rows = default_net_worth_rows()
    rows.append(rows[3][:])  # repeat 2024-02 row
    parsed = parse_net_worth(_sheet("Net Worth", net_worth=rows))
    assert any("duplicate month" in e.lower() for e in parsed.issues.errors)


def test_parse_spending_months_rollups_and_total_check():
    from app.importer.parsers import parse_spending

    parsed = parse_spending(_sheet("Spending"))
    assert parsed.issues.errors == []
    assert [(c.name, c.sort_order) for c in parsed.categories] == [("Food", 2), ("Rent", 3)]
    assert len(parsed.months) == 2  # Average, 2024.0 rollup and empty template all skipped
    january, february = parsed.months
    assert january.month == datetime.date(2024, 1, 1)
    assert january.amounts == {"Food": Decimal("100.00"), "Rent": Decimal("900.00")}
    assert january.net_pay == Decimal("3000.00")
    # r4 TOTAL says 951 but Food+Rent = 950 -> cross-check warning names the month
    assert any("2024-02" in w and "TOTAL" in w for w in parsed.issues.warnings)
    assert february.net_pay == Decimal("3000.00")


def test_parse_spending_missing_total_column_is_error():
    from app.importer.parsers import parse_spending

    rows = default_spending_rows()
    rows[0][3] = "NOT-TOTAL"
    parsed = parse_spending(_sheet("Spending", spending=rows))
    assert any("TOTAL" in e for e in parsed.issues.errors)


def test_parse_spending_string_month_is_error_not_silent_skip():
    from app.importer.parsers import parse_spending

    rows = default_spending_rows()
    rows[2][0] = "2024-01-01"  # CSV-pasted month as text must not vanish silently
    parsed = parse_spending(_sheet("Spending", spending=rows))
    assert any("expected a month date" in e for e in parsed.issues.errors)
    assert len(parsed.months) == 1  # only February survives
    # the 'Average' row is still skipped silently
    assert not any("Average" in e for e in parsed.issues.errors)


def test_parse_net_worth_warns_when_terminal_band_missing():
    from app.importer.parsers import parse_net_worth

    rows = default_net_worth_rows()
    rows[0][8] = None  # remove the 'NET WORTH' band header
    parsed = parse_net_worth(_sheet("Net Worth", net_worth=rows))
    assert any("terminal band not found" in w for w in parsed.issues.warnings)


def test_parse_taxes_inputs_brackets_and_active_years():
    from app.importer.parsers import parse_taxes

    parsed = parse_taxes(_sheet("Taxes"))
    assert parsed.issues.errors == []
    years = {i.year for i in parsed.inputs}
    assert years == {2023, 2024}  # the empty 2025 column is skipped silently
    by_key = {(i.year, i.key): i.value for i in parsed.inputs}
    assert by_key[(2023, "annual_salary")] == Decimal("100.0000")
    assert by_key[(2023, "unq_div_state_exempt_pct")] == Decimal("0.9645")  # 4dp survives
    assert by_key[(2024, "unq_div_state_exempt_pct")] == Decimal("0.9753")
    # State special rows land as inputs; the federal Standard/Itemized row is derived -> absent
    assert by_key[(2023, "state_standard_deduction")] == Decimal("5363.0000")
    assert by_key[(2023, "state_exemption_credits")] == Decimal("144.0000")
    assert len({i.key for i in parsed.inputs}) == 43
    brackets = [(b.year, b.jurisdiction, b.bracket_index) for b in parsed.brackets]
    assert (2023, "federal", 1) in brackets and (2023, "federal", 2) in brackets
    assert (2024, "capital_gains", 1) in brackets
    federal_1 = next(
        b
        for b in parsed.brackets
        if (b.year, b.jurisdiction, b.bracket_index) == (2023, "federal", 1)
    )
    assert federal_1.rate == Decimal("0.1000")
    assert federal_1.threshold == Decimal("0.00")
    per_year = sum(1 for b in parsed.brackets if b.year == 2023)
    assert per_year == 7  # fixture: fed 2 + state 1 + medicare 1 + ss 1 + sdi 1 + cg 1


def test_parse_taxes_label_drift_is_fatal_error():
    from app.importer.parsers import parse_taxes

    rows = default_taxes_rows()
    rows[3][1] = "Pay Cadence"  # was 'Pay Periods'
    parsed = parse_taxes(_sheet("Taxes", taxes=rows))
    assert any("Pay Periods" in e and "Pay Cadence" in e for e in parsed.issues.errors)
    assert parsed.inputs == [] and parsed.brackets == []  # aborted: layout no longer trusted


def test_parse_taxes_warns_on_rate_above_one():
    from app.importer.parsers import parse_taxes

    rows = default_taxes_rows()
    for row in rows:
        if row[0] == "MEDICARE TAX INFO":
            row[2] = 1.45  # a percent entered as 1.45 instead of 0.0145
    parsed = parse_taxes(_sheet("Taxes", taxes=rows))
    assert any("looks like a percentage" in w for w in parsed.issues.warnings)


def test_parse_taxes_missing_bracket_section_is_error():
    from app.importer.parsers import parse_taxes

    rows = [
        row if row[0] != "MEDICARE TAX INFO" else ["MEDICARE INFO", *row[1:]]
        for row in default_taxes_rows()
    ]
    parsed = parse_taxes(_sheet("Taxes", taxes=rows))
    joined = " ".join(parsed.issues.errors)
    # the renamed header ends the walk: medicare AND everything after it goes missing
    assert "never found" in joined
    assert "medicare" in joined and "capital_gains" in joined


def test_parse_taxes_duplicate_bracket_row_is_error():
    from app.importer.parsers import parse_taxes

    rows = default_taxes_rows()
    for index, row in enumerate(rows):
        if row[0] == "MEDICARE TAX INFO":
            rows.insert(index + 1, [None, "Bracket 1 Rate", 0.9, 0.9, None])
            break
    parsed = parse_taxes(_sheet("Taxes", taxes=rows))
    assert any("duplicate 'Bracket 1 Rate'" in e for e in parsed.issues.errors)
    # first occurrence wins: the original 0.0145 rate is preserved for 2023
    medicare = [b for b in parsed.brackets if b.jurisdiction == "medicare" and b.year == 2023]
    assert medicare and medicare[0].rate == Decimal("0.0145")


def test_parse_taxes_negative_rate_warns_and_no_year_columns_errors():
    from app.importer.parsers import parse_taxes

    rows = default_taxes_rows()
    for row in rows:
        if row[0] == "CAPITAL GAINS TAX INFO":
            row[2] = -0.05
    parsed = parse_taxes(_sheet("Taxes", taxes=rows))
    assert any("is negative" in w for w in parsed.issues.warnings)

    rows = default_taxes_rows()
    rows[0] = ["Fill in White cells", None, "2023", "2024", None]  # text years
    parsed = parse_taxes(_sheet("Taxes", taxes=rows))
    assert any("no year columns" in e for e in parsed.issues.errors)
    assert parsed.inputs == [] and parsed.brackets == []


def test_parse_espp_lots_periods_and_ignored_calculator():
    from app.importer.parsers import parse_espp

    parsed = parse_espp(_sheet("ESPP"))
    assert parsed.issues.errors == []
    assert [(lot.purchase_date, lot.shares) for lot in parsed.lots] == [
        (datetime.date(2024, 2, 29), Decimal("100.0000")),
        (datetime.date(2024, 8, 30), Decimal("90.0000")),
    ]
    lot = parsed.lots[0]
    assert lot.qualifying_date == datetime.date(2025, 9, 1)
    assert lot.subscription_price == Decimal("40.00000")
    assert lot.purchase_fmv == Decimal("50.00000")
    assert lot.purchase_price == Decimal("34.00000")
    assert lot.sold_date is None and lot.sold_price is None
    feb, aug = parsed.periods
    assert feb.label == "February 2025 Purchase"
    assert feb.period_start == datetime.date(2024, 9, 1)
    assert feb.period_end == datetime.date(2025, 2, 27)
    assert feb.semi_annual_base == Decimal("50000.00")
    assert feb.additional_payments == Decimal("0.00")
    assert feb.contribution_pct == Decimal("0.100000000")
    assert aug.label == "August 2025 Purchase"
    assert aug.period_start == datetime.date(2025, 3, 1)
    assert aug.period_end == datetime.date(2025, 8, 29)
    assert aug.additional_payments == Decimal("100.00")
    assert any("derived" in w.lower() for w in parsed.issues.warnings)
    assert any("taxation calculator" in w.lower() for w in parsed.issues.warnings)


def test_parse_espp_missing_template_dates_skips_periods():
    from app.importer.parsers import parse_espp

    rows = default_espp_rows()
    for row in rows:
        if len(row) > 8 and isinstance(row[8], datetime.datetime) and row[8].year >= 2025:
            row[8] = None  # remove the future template dates
    parsed = parse_espp(_sheet("ESPP", espp=rows))
    assert parsed.periods == []
    assert any("period" in w.lower() for w in parsed.issues.warnings)
    assert len(parsed.lots) == 2  # lots unaffected


def test_parse_paycheck_fields_and_quantization():
    from app.importer.parsers import parse_paycheck

    parsed = parse_paycheck(_sheet("Paycheck Modeler"))
    assert parsed.issues.errors == []
    profile = parsed.profile
    assert profile is not None
    assert profile.annual_salary == Decimal("120000.00")
    assert profile.trad_401k_pct == Decimal("0.100000000")
    assert profile.roth_401k_pct == Decimal("0.000000000")
    assert profile.after_tax_401k_pct == Decimal("0.020000000")
    assert profile.withholding_pct == Decimal("0.250000000")  # 15dp cell -> 9dp HALF_UP
    assert profile.espp_pct == Decimal("0.050000000")
    assert profile.dental_vision_per_check == Decimal("10.00")
    assert profile.hsa_per_check == Decimal("50.00")
    assert not any("Gross Paycheck" in w for w in parsed.issues.warnings)  # 120000/24 == 5000


def test_parse_paycheck_gross_mismatch_warns_and_missing_salary_skips():
    from app.importer.parsers import parse_paycheck

    rows = default_paycheck_rows()
    rows[3][2] = 4321.0  # Gross Paycheck != salary/24
    parsed = parse_paycheck(_sheet("Paycheck Modeler", paycheck=rows))
    assert any("Gross Paycheck" in w for w in parsed.issues.warnings)

    rows = default_paycheck_rows()
    rows[2][1] = "Yearly Salary"  # label drift: Annual Salary not found
    parsed = parse_paycheck(_sheet("Paycheck Modeler", paycheck=rows))
    assert parsed.profile is None
    assert any("Annual Salary" in w for w in parsed.issues.warnings)


def test_parse_focal_full_partial_and_template_rows():
    from app.importer.parsers import parse_focal_history

    parsed = parse_focal_history(_sheet("Focal History"))
    assert parsed.issues.errors == []
    assert [(e.focal_year, e.current_base, e.new_base) for e in parsed.events] == [
        (2024, Decimal("110000.00"), Decimal("120000.00")),
        (2025, Decimal("120000.00"), None),  # partial row imported as-is
    ]
    full = parsed.events[0]
    assert full.unvested_rsus == Decimal("500.0000")
    assert full.unvested_price == Decimal("89.6600")
    assert full.refresh_rsus == Decimal("100.0000")
    assert full.grant_price == Decimal("90.0000")


def test_parse_portfolio_warns_on_nonzero_dividends_only():
    from app.importer.parsers import parse_portfolio

    parsed = parse_portfolio(_sheet("Portfolio"))
    assert parsed.issues.errors == []
    dividend_warnings = [w for w in parsed.issues.warnings if "dividend" in w.lower()]
    assert len(dividend_warnings) == 1
    assert "DIVC" in dividend_warnings[0] and "12.5" in dividend_warnings[0]


def test_parse_espp_and_paycheck_warn_on_percentage_scale():
    from app.importer.parsers import parse_espp, parse_paycheck

    rows = default_espp_rows()
    for row in rows:
        if len(row) > 2 and row[1] == "ESPP Contribution Percentage":
            row[2] = 5.0  # meant 5%, typed as 5
    parsed = parse_espp(_sheet("ESPP", espp=rows))
    assert any("looks like a percentage" in w for w in parsed.issues.warnings)

    rows = default_paycheck_rows()
    for row in rows:
        if len(row) > 5 and row[4] == "ESPP %":
            row[5] = 5.0
    parsed = parse_paycheck(_sheet("Paycheck Modeler", paycheck=rows))
    assert any("looks like a percentage" in w for w in parsed.issues.warnings)
    assert parsed.profile is not None  # warn, not error: profile still imports


def test_parse_espp_period_derivation_skips_already_purchased_dates():
    import datetime as dt

    from app.importer.parsers import parse_espp

    rows = default_espp_rows()
    # A lot for 2025-02-27 exists at the bottom while its template row stays unfilled:
    # derivation must skip to the NEXT unpurchased February (2026-02-27).
    rows.append(
        [None] * 8 + [dt.datetime(2025, 2, 27), dt.datetime(2026, 2, 27), 80.0, 41.0, 60.0, 35.0]
    )
    parsed = parse_espp(_sheet("ESPP", espp=rows))
    assert len(parsed.lots) == 3
    feb = next(p for p in parsed.periods if p.label.startswith("February"))
    assert feb.label == "February 2026 Purchase"


def test_parse_portfolio_warns_on_negative_dividends_too():
    from app.importer.parsers import parse_portfolio

    rows = default_portfolio_rows()
    rows[3][15] = -12.5
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert any("-12.5" in w for w in parsed.issues.warnings)


def test_parsers_reject_overlong_text_fields():
    from app.importer.parsers import (
        parse_net_worth,
        parse_positions,
        parse_reference_data,
        parse_spending,
    )

    long_name = "X" * 130
    rows = default_positions_rows()
    rows.append([long_name[:100], "Buy", "Acme ETF", 1.0, 1.0, None, None, 0, 0, 0, 0, 0])
    assert any(
        "too long" in e for e in parse_positions(_sheet("Positions", positions=rows)).issues.errors
    )

    rows = default_reference_data_rows()
    rows[1][2] = "S" * 90
    parsed = parse_reference_data(_sheet("ReferenceData", reference_data=rows))
    assert any("Sector too long" in e for e in parsed.issues.errors)

    rows = default_net_worth_rows()
    rows[1][2] = long_name
    parsed = parse_net_worth(_sheet("Net Worth", net_worth=rows))
    assert any("account name too long" in e for e in parsed.issues.errors)

    rows = default_spending_rows()
    rows[0][1] = "C" * 90
    parsed = parse_spending(_sheet("Spending", spending=rows))
    assert any("category name too long" in e for e in parsed.issues.errors)


def test_parse_portfolio_extracts_value_history():
    from datetime import date
    from decimal import Decimal

    from app.importer.parsers import parse_portfolio

    parsed = parse_portfolio(_sheet("Portfolio"))
    assert parsed.issues.errors == []
    assert [p.snapshot_date for p in parsed.history] == [
        date(2023, 10, 23),
        date(2023, 10, 30),
        date(2023, 11, 6),
    ]
    # Q2 half-up quantization of the sheet's float noise
    assert parsed.history[1].market_value == Decimal("53413.36")
    assert parsed.history[1].sp500_value == Decimal("53001.35")
    assert parsed.history[1].cost_basis == Decimal("55212.09")
    assert parsed.history[2].market_value == Decimal("63577.56")
    # No "no value-history rows" warning when the region is populated
    assert not any("value-history" in w for w in parsed.issues.warnings)


def test_parse_portfolio_history_errors_on_values_without_date():
    from app.importer.parsers import parse_portfolio

    rows = default_portfolio_rows()
    rows[4][27] = None  # r5 col AB: date gone, values remain
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert any("r5c28" in e and "no date" in e for e in parsed.issues.errors)


def test_parse_portfolio_history_errors_on_missing_or_junk_value():
    from app.importer.parsers import parse_portfolio

    rows = default_portfolio_rows()
    rows[3][32] = None  # r4 col AG (cost basis) blank
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert any("r4c33" in e for e in parsed.issues.errors)

    rows = default_portfolio_rows()
    rows[3][28] = "#N/A"  # r4 col AC (market value): silent-None error string
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert any("r4c29" in e for e in parsed.issues.errors)

    rows = default_portfolio_rows()
    rows[3][28] = "abc"  # non-numeric: to_decimal's own error, not doubled
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert len([e for e in parsed.issues.errors if "r4c29" in e]) == 1


def test_parse_portfolio_history_errors_on_non_increasing_dates():
    from app.importer.parsers import parse_portfolio

    rows = default_portfolio_rows()
    rows[4][27] = datetime.datetime(2023, 10, 30)  # r5 duplicates r4's date
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert any("r5c28" in e and "not after" in e for e in parsed.issues.errors)

    rows = default_portfolio_rows()
    rows[4][27] = datetime.datetime(2023, 10, 1)  # r5 goes backwards
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert any("r5c28" in e and "not after" in e for e in parsed.issues.errors)


def test_parse_portfolio_history_empty_region_warns_not_errors():
    from app.importer.parsers import parse_portfolio

    rows = [row[:27] for row in default_portfolio_rows()]  # strip the AB..AH region
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert parsed.issues.errors == []
    assert parsed.history == []
    assert any("no value-history rows" in w for w in parsed.issues.warnings)


def test_parse_portfolio_history_continues_across_short_blank_gaps():
    from datetime import date

    from app.importer.parsers import parse_portfolio

    rows = default_portfolio_rows()
    # Two all-blank rows (below BLANK_STREAK_STOP=5) between r5 and a final point on r8:
    # the scan must bridge the gap, not stop at it. [None] is the builder's proven
    # spacer-row idiom (default_espp_rows uses it).
    rows.append([None])
    rows.append([None])
    rows.append(
        [None] * 27
        + [datetime.datetime(2023, 11, 13), 64758.48, 0.0186, 56136.79, 0.0106, 62999.09, 0.0096]
    )
    parsed = parse_portfolio(_sheet("Portfolio", portfolio=rows))
    assert parsed.issues.errors == []
    assert [p.snapshot_date for p in parsed.history][-1] == date(2023, 11, 13)
    assert len(parsed.history) == 4
