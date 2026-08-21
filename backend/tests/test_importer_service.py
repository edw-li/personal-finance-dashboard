from datetime import date
from decimal import Decimal

from sqlalchemy import func, select

from app.importer.__main__ import build_parser
from app.importer.report import SHEET_KEYS
from app.importer.service import run_import
from app.models import Account, PortfolioValueHistory, PositionTransaction, Security, TaxInput
from tests.workbook_builder import build_workbook, default_taxes_rows


async def _count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def test_dry_run_reports_without_writing(db):
    report = await run_import(build_workbook(), db, dry_run=True)
    assert report.dry_run is True and report.applied is False
    assert not report.has_errors
    assert report.sheets["net_worth"].entities["accounts"].creates == 3
    assert report.sheets["taxes"].entities["tax_inputs"].creates == 86
    assert report.sheets["portfolio"].entities["portfolio_value_history"].creates == 3
    assert await _count(db, Account) == 0
    assert await _count(db, Security) == 0
    assert await _count(db, TaxInput) == 0


async def test_dry_run_reports_deletes_without_deleting(db):
    # Deletes are the one verb dry-run most needs to be provably safe on (the history
    # override contract is the importer's only sweep besides the positions sync): a live
    # row inside the sheet's range is REPORTED as a delete and survives the run.
    db.add(
        PortfolioValueHistory(
            snapshot_date=date(2023, 11, 1),  # mid-week stray inside the sheet's range
            market_value=Decimal("60000.00"),
            cost_basis=Decimal("55000.00"),
            sp500_value=Decimal("53100.00"),
        )
    )
    await db.commit()

    report = await run_import(build_workbook(), db, dry_run=True)
    assert report.dry_run is True and report.applied is False
    assert report.sheets["portfolio"].entities["portfolio_value_history"].deletes == 1
    assert await _count(db, PortfolioValueHistory) == 1  # the seeded row alone, untouched


async def test_apply_then_reapply_is_all_skips(db):
    first = await run_import(build_workbook(), db, dry_run=False)
    assert first.applied is True and not first.has_errors
    assert await _count(db, Account) == 3
    assert await _count(db, Security) == 4  # 3 ReferenceData + Mystery Fund auto-create
    assert await _count(db, PositionTransaction) == 3

    second = await run_import(build_workbook(), db, dry_run=False)
    assert second.applied is True
    for key in SHEET_KEYS:
        for entity, counts in second.sheets[key].entities.items():
            assert counts.creates == 0, (key, entity)
            assert counts.updates == 0, (key, entity)
            assert counts.deletes == 0, (key, entity)
    # And a dry-run after apply shows a clean no-op diff (spec: import twice -> no diff)
    third = await run_import(build_workbook(), db, dry_run=True)
    assert third.sheets["net_worth"].entities["account_balances"].skips == 6


async def test_parse_errors_block_apply_entirely(db):
    rows = default_taxes_rows()
    rows[3][1] = "Pay Cadence"  # label drift -> Taxes parser aborts with error
    report = await run_import(build_workbook(taxes=rows), db, dry_run=False)
    assert report.has_errors and report.applied is False
    # Strict contract: NOTHING is written, not even clean sheets
    assert await _count(db, Account) == 0
    assert await _count(db, Security) == 0


async def test_missing_sheet_is_error(db):
    report = await run_import(build_workbook(portfolio=None), db, dry_run=True)
    assert any("Portfolio" in e for e in report.sheets["portfolio"].errors)
    assert report.has_errors


async def test_parser_crash_is_captured_as_sheet_error(db):
    # A present-but-empty sheet makes parse_taxes hit rows[0] on an empty list
    report = await run_import(build_workbook(taxes=[]), db, dry_run=True)
    assert any("parser crashed" in e for e in report.sheets["taxes"].errors)
    assert report.has_errors and report.applied is False


def test_cli_parser_flags():
    args = build_parser().parse_args(["book.xlsx", "--dry-run"])
    assert args.workbook.name == "book.xlsx" and args.dry_run is True
    args = build_parser().parse_args(["book.xlsx"])
    assert args.dry_run is False


async def test_apply_phase_error_rolls_back_everything(db):
    # Parse-clean workbook whose APPLY phase errors (duplicate account slug detected in
    # apply_net_worth): the orchestrator must roll back the entire run, not half-land it.
    from tests.workbook_builder import default_net_worth_rows

    rows = default_net_worth_rows()
    rows[1][4] = "Checking!"  # slugs to 'checking', colliding with column 3's account
    report = await run_import(build_workbook(net_worth=rows), db, dry_run=False)
    assert report.has_errors and report.applied is False
    assert await _count(db, Account) == 0
    assert await _count(db, Security) == 0
    assert await _count(db, TaxInput) == 0
