"""CLI entry point: python -m app.importer path/to/workbook.xlsx [--dry-run]

Exit codes: 0 = success (report printed), 1 = report contains errors (nothing applied),
2 = unreadable file. Runs against DATABASE_URL from the environment/.env like app.seed.
"""

import argparse
import asyncio
import sys
from pathlib import Path

from app.database import SessionLocal, engine
from app.importer.service import InvalidWorkbookError, run_import


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.importer",
        description="Import the source spreadsheet (dry-run by default is OFF; pass --dry-run "
        "to preview the diff without writing).",
    )
    parser.add_argument("workbook", type=Path, help="path to the .xlsx workbook")
    parser.add_argument("--dry-run", action="store_true", help="report the diff without writing")
    return parser


async def _amain(workbook: Path, dry_run: bool) -> int:
    # One-shot CLI: blocking read before any awaits is fine (nothing else on the loop yet).
    data = workbook.read_bytes()  # noqa: ASYNC240
    try:
        async with SessionLocal() as db:
            report = await run_import(data, db, dry_run=dry_run)
    except InvalidWorkbookError as exc:
        print(f"error: not a valid .xlsx workbook ({exc})", file=sys.stderr)
        return 2
    finally:
        await engine.dispose()
    print(report.render_text())
    if report.has_errors:
        print("\nerrors present — nothing was applied", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    args = build_parser().parse_args()
    if not args.workbook.is_file():
        print(f"error: {args.workbook} is not a file", file=sys.stderr)
        return 2
    return asyncio.run(_amain(args.workbook, args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
