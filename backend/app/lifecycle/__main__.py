"""CLI: python -m app.lifecycle restore <zip> [--dry-run]  |  python -m app.lifecycle verify <zip>

Exit codes mirror app.importer: 0 = done (verify: PASS), 1 = the restore failed and was
rolled back, or verify found a differing table, 2 = the file is unreadable or incompatible
(not a snapshot, wrong tables, wrong schema head). Runs against DATABASE_URL from the
environment/.env like app.seed — the restore drill (scripts/restore_drill.sh) points that at
a scratch database. Preferences attach to the lowest user id (seed.py's convention).
"""

import argparse
import asyncio
import sys
from pathlib import Path

from sqlalchemy import select

from app.database import SessionLocal, engine
from app.lifecycle.restore import SnapshotError, apply_restore, load_snapshot, plan_restore
from app.models import User
from app.schemas.lifecycle import RestoreReport
from app.services.snapshot import alembic_head


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.lifecycle",
        description="Restore the app's own snapshot ZIP, or verify the live database against one.",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    restore = sub.add_parser("restore", help="replace every exported table from the ZIP")
    restore.add_argument("zip", type=Path, help="a finance-export-*.zip")
    restore.add_argument("--dry-run", action="store_true", help="report the diff without writing")
    verify = sub.add_parser("verify", help="compare the live database to the ZIP, table by table")
    verify.add_argument("zip", type=Path, help="a finance-export-*.zip")
    return parser


def render_report(report: RestoreReport) -> str:
    lines = [
        f"dry_run={report.dry_run} applied={report.applied} "
        f"schema={'ok' if report.schema_.compatible else 'MISMATCH'}"
    ]
    for name, diff in report.tables.items():
        flag = "=" if diff.identical else "~"
        lines.append(f"  {flag} {name}: {diff.current} -> {diff.incoming}")
    for warning in report.warnings:
        lines.append(f"  WARN: {warning}")
    if report.restore_point is not None:
        lines.append(f"restore point: {report.restore_point}")
    return "\n".join(lines)


def verify_verdict(report: RestoreReport) -> tuple[str, int]:
    differing = [name for name, diff in report.tables.items() if not diff.identical]
    if differing:
        return f"FAIL: {len(differing)} table(s) differ: {', '.join(differing)}", 1
    return f"PASS: {len(report.tables)} tables identical", 0


async def _amain(command: str, zip_path: Path, dry_run: bool) -> int:
    # One-shot CLI: blocking read before any awaits is fine (nothing else on the loop yet).
    data = zip_path.read_bytes()  # noqa: ASYNC240
    try:
        async with SessionLocal() as db:
            user = (await db.execute(select(User).order_by(User.id))).scalars().first()
            user_id = None if user is None else user.id
            actor = "cli" if user is None else f"cli:{user.email}"
            head = await alembic_head(db)
            try:
                snapshot = load_snapshot(data)
                if command == "verify" or dry_run:
                    report = await plan_restore(db, snapshot, user_id=user_id, server_head=head)
                else:
                    report = await apply_restore(
                        db,
                        snapshot,
                        user_id=user_id,
                        actor=actor,
                        server_head=head,
                        source_name=zip_path.name,
                        size_bytes=len(data),
                    )
            except SnapshotError as exc:
                print(f"error: {exc.detail}", file=sys.stderr)
                return 2
            except Exception as exc:  # a CLI reports, it does not traceback
                await db.rollback()
                # `verify` and `restore --dry-run` never wrote: saying a restore failed
                # would send the drill's reader hunting for damage that cannot exist.
                failed = (
                    "restore failed and nothing was changed"
                    if command == "restore" and not dry_run
                    else f"{command} failed"
                )
                print(f"error: {failed} ({exc!r})", file=sys.stderr)
                return 1
    finally:
        await engine.dispose()
    print(render_report(report))
    if command == "verify":
        verdict, code = verify_verdict(report)
        print(verdict)
        return code
    return 0


def main() -> int:
    args = build_parser().parse_args()
    if not args.zip.is_file():
        print(f"error: {args.zip} is not a file", file=sys.stderr)
        return 2
    return asyncio.run(_amain(args.command, args.zip, getattr(args, "dry_run", False)))


if __name__ == "__main__":
    raise SystemExit(main())
