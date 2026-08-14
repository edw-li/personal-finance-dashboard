import datetime
from decimal import Decimal

from app.importer.cells import (
    Q2,
    Q4,
    Q6,
    Q9,
    CellIssues,
    cell_ref,
    first_of_month,
    is_placeholder_balance,
    slugify,
    synthetic_ticker,
    to_date_lenient,
    to_date_strict,
    to_decimal,
)
from app.importer.report import ImportReport, SheetReport


def dec(value, quantum=Q2, max_int_digits=12, issues=None):
    issues = issues if issues is not None else CellIssues()
    return to_decimal(value, quantum, max_int_digits, ctx="T!r1c1", issues=issues)


def test_to_decimal_rounds_half_up_not_bankers():
    # PG rounds half-away-from-zero; Python's default quantize is banker's (2.665 -> 2.66).
    assert dec(2.665) == Decimal("2.67")
    assert dec(-2.665) == Decimal("-2.67")


def test_to_decimal_uses_short_float_repr():
    assert dec(0.1) == Decimal("0.10")
    assert dec(8301.342763) == Decimal("8301.34")


def test_to_decimal_shares_and_pct_quanta():
    assert dec(381.259077932274, Q6, 10) == Decimal("381.259078")
    assert dec(0.334009166758825, Q9, 1) == Decimal("0.334009167")


def test_to_decimal_parses_numeric_strings():
    assert dec("45.54", Q4, 6) == Decimal("45.5400")


def test_to_decimal_error_cells_and_blanks_are_none_without_error():
    issues = CellIssues()
    assert dec("#N/A", issues=issues) is None
    assert dec("#REF!", issues=issues) is None
    assert dec("N/A", issues=issues) is None
    assert dec("  ", issues=issues) is None
    assert dec(None, issues=issues) is None
    assert issues.errors == []


def test_to_decimal_non_numeric_is_error_with_context():
    issues = CellIssues()
    assert dec("Average", issues=issues) is None
    assert dec(True, issues=issues) is None
    assert dec(datetime.datetime(2024, 1, 1), issues=issues) is None
    assert len(issues.errors) == 3
    assert all("T!r1c1" in e for e in issues.errors)


def test_to_decimal_enforces_numeric_bounds():
    issues = CellIssues()
    assert dec(Decimal("1e13"), Q2, 12, issues=issues) is None
    assert issues.errors and "NUMERIC" in issues.errors[0]


def test_placeholder_balance_detection_on_raw_values():
    assert is_placeholder_balance(0.001)
    assert is_placeholder_balance(-0.001)
    assert not is_placeholder_balance(0.0)
    assert not is_placeholder_balance(0.01)
    assert not is_placeholder_balance("0.001x")
    assert not is_placeholder_balance(None)


def test_to_date_strict_and_lenient():
    issues = CellIssues()
    assert to_date_strict(
        datetime.datetime(2024, 3, 1), ctx="T!r1c1", issues=issues
    ) == datetime.date(2024, 3, 1)
    assert to_date_strict(None, ctx="T!r1c1", issues=issues) is None
    assert issues.errors == []
    assert to_date_strict("2024-03-01", ctx="T!r1c1", issues=issues) is None
    assert len(issues.errors) == 1
    # ReferenceData junk: datetime.time(0, 0) ex-div cells coerce silently
    assert to_date_lenient(datetime.time(0, 0)) is None
    assert to_date_lenient("N/A") is None
    assert to_date_lenient(datetime.datetime(2023, 9, 30)) == datetime.date(2023, 9, 30)


def test_first_of_month_normalizes_with_warning():
    issues = CellIssues()
    assert first_of_month(datetime.date(2024, 3, 15), ctx="T!r1c1", issues=issues) == datetime.date(
        2024, 3, 1
    )
    assert len(issues.warnings) == 1
    assert first_of_month(datetime.date(2024, 3, 1), ctx="T!r1c1", issues=issues) == datetime.date(
        2024, 3, 1
    )
    assert len(issues.warnings) == 1  # no new warning when already first-of-month


def test_slugify():
    assert slugify("Wells Fargo Checking") == "wells-fargo-checking"
    assert slugify("Traditional 401(k)") == "traditional-401-k"
    assert slugify("Auto & Transport") == "auto-transport"
    assert slugify("Vehicle(s)") == "vehicle-s"
    assert slugify("Fidelity® 500 Index Fund") == "fidelity-500-index-fund"


def test_synthetic_ticker_short_unique():
    taken = {"NVDA"}
    first = synthetic_ticker("Fundrise Innovation Fund", taken)
    assert first == "X-FUNDRISE"
    assert len(first) <= 20
    taken.add(first)
    assert synthetic_ticker("Fundrise Innovation Something", taken) == "X-FUNDRISE-2"


def test_cell_ref_format():
    assert cell_ref("Net Worth", 5, 3) == "Net Worth!r5c3"


def test_sheet_report_counts_and_sample_cap():
    report = SheetReport()
    report.counts("accounts").creates += 1
    report.counts("accounts").skips += 2
    for i in range(60):
        report.add_sample(f"sample {i}")
    assert report.entities["accounts"].creates == 1
    assert len(report.samples) == 50
    assert report.samples_truncated == 10


def test_import_report_error_detection():
    report = ImportReport.new(dry_run=True)
    assert not report.has_errors
    report.sheets["taxes"].errors.append("boom")
    assert report.has_errors
    assert set(report.sheets) == {
        "reference_data",
        "positions",
        "portfolio",
        "net_worth",
        "spending",
        "taxes",
        "espp",
        "paycheck",
        "focal_history",
    }
