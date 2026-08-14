from app.importer.parsers import SHEET_TAX_INPUT_SEQUENCE
from app.tax_keys import TAX_INPUT_DEFINITIONS
from tests.workbook_builder import build_workbook, load_readonly


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
    wb.close()


def test_sheet_tax_sequence_matches_tax_keys():
    sequence_keys = [key for _, entries in SHEET_TAX_INPUT_SEQUENCE for _, key in entries]
    definition_keys = [key for key, *_ in TAX_INPUT_DEFINITIONS]
    # The sheet block covers exactly the 41 original definitions (the 2 state keys from
    # Task 2 are parsed out of the STATE bracket section instead).
    assert sequence_keys == [k for k in definition_keys if not k.startswith("state_")]
    assert len(sequence_keys) == 41
