"""Importer orchestrator: workbook bytes -> parse all sheets -> apply or abort.

Same code path for dry-run and apply (spec section 5): the appliers always run; dry-run
rolls the session back instead of committing. Any parse error anywhere blocks the apply
entirely — the report still carries every sheet's errors and warnings.
"""

import io
import zipfile

import openpyxl
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy.ext.asyncio import AsyncSession

from app.importer import apply as appliers
from app.importer import parsers
from app.importer.report import ImportReport

PARSER_TABLE = (
    ("reference_data", "ReferenceData", parsers.parse_reference_data),
    ("positions", "Positions", parsers.parse_positions),
    ("portfolio", "Portfolio", parsers.parse_portfolio),
    ("net_worth", "Net Worth", parsers.parse_net_worth),
    ("spending", "Spending", parsers.parse_spending),
    ("taxes", "Taxes", parsers.parse_taxes),
    ("espp", "ESPP", parsers.parse_espp),
    ("paycheck", "Paycheck Modeler", parsers.parse_paycheck),
    ("focal_history", "Focal History", parsers.parse_focal_history),
)


class InvalidWorkbookError(ValueError):
    """The upload/file is not a readable .xlsx workbook."""


def _load_workbook(data: bytes):
    try:
        return openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except (zipfile.BadZipFile, InvalidFileException, KeyError, OSError) as exc:
        raise InvalidWorkbookError(str(exc)) from exc


async def run_import(data: bytes, db: AsyncSession, *, dry_run: bool) -> ImportReport:
    report = ImportReport.new(dry_run=dry_run)
    workbook = _load_workbook(data)
    parsed: dict[str, object] = {}
    try:
        for key, sheet_name, parser in PARSER_TABLE:
            sheet_report = report.sheets[key]
            if sheet_name not in workbook.sheetnames:
                sheet_report.errors.append(f"sheet {sheet_name!r} not found in workbook")
                continue
            try:
                result = parser(workbook[sheet_name])
            except Exception as exc:
                # A structurally hollow sheet (e.g. zero rows) must be a row-context-free
                # sheet error, not a CLI traceback / HTTP 500 (Task 8 review finding).
                sheet_report.errors.append(f"{sheet_name}: parser crashed: {exc!r}")
                continue
            sheet_report.warnings.extend(result.issues.warnings)
            sheet_report.errors.extend(result.issues.errors)
            parsed[key] = result
    finally:
        workbook.close()
    if report.has_errors:
        return report  # strict: errors anywhere block the whole apply (spec section 5)

    try:
        by_name = await appliers.apply_reference_data(
            db, parsed["reference_data"], report.sheets["reference_data"]
        )
        await appliers.apply_positions(db, parsed["positions"], by_name, report.sheets["positions"])
        await appliers.apply_portfolio_history(db, parsed["portfolio"], report.sheets["portfolio"])
        await appliers.apply_net_worth(db, parsed["net_worth"], report.sheets["net_worth"])
        await appliers.apply_spending(db, parsed["spending"], report.sheets["spending"])
        await appliers.apply_taxes(db, parsed["taxes"], report.sheets["taxes"])
        await appliers.apply_espp(db, parsed["espp"], report.sheets["espp"])
        await appliers.apply_focal_history(
            db, parsed["focal_history"], report.sheets["focal_history"]
        )
        await appliers.apply_paycheck(
            db, parsed["paycheck"], parsed["focal_history"], report.sheets["paycheck"]
        )
        if report.has_errors or dry_run:  # apply_taxes can error on missing definitions
            await db.rollback()
        else:
            await db.commit()
            report.applied = True
    except Exception:
        await db.rollback()
        raise
    return report
