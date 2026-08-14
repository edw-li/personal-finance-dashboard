import datetime
from decimal import Decimal

import pytest

from app.importer.parsers import SHEET_TAX_INPUT_SEQUENCE
from app.tax_keys import TAX_INPUT_DEFINITIONS
from tests.workbook_builder import build_workbook, default_positions_rows, load_readonly


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
