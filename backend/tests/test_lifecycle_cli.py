from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.lifecycle.__main__ import build_parser, render_report, verify_verdict
from app.schemas.lifecycle import RestoreReport, RestoreSchema, RestoreTableDiff


def make_report(identical: bool) -> RestoreReport:
    return RestoreReport(
        dry_run=True,
        applied=False,
        exported_at=datetime(2026, 9, 2, 23, 30, tzinfo=UTC),
        schema=RestoreSchema(snapshot_head=None, server_head=None, compatible=True),
        tables={
            "accounts": RestoreTableDiff(current=3, incoming=3, identical=True),
            "account_balances": RestoreTableDiff(current=90, incoming=87, identical=identical),
        },
        preserved_settings=["backup_status"],
        warnings=["accounts.person_id is absent from the snapshot — the column default applies"],
        errors=[],
        restore_point="pre-restore-20260904-091500-123456.zip" if not identical else None,
        batch_id=None,
        run_id=None,
    )


def test_parser_has_the_two_commands_and_the_dry_run_flag():
    args = build_parser().parse_args(["restore", "book.zip", "--dry-run"])
    assert (args.command, args.zip, args.dry_run) == ("restore", Path("book.zip"), True)
    args = build_parser().parse_args(["restore", "book.zip"])
    assert args.dry_run is False
    args = build_parser().parse_args(["verify", "book.zip"])
    assert args.command == "verify"
    with pytest.raises(SystemExit):
        build_parser().parse_args(["book.zip"])  # a command is required


def test_render_report_prints_counts_flags_warnings_and_the_restore_point():
    text = render_report(make_report(identical=False))
    assert text.splitlines() == [
        "dry_run=True applied=False schema=ok",
        "  = accounts: 3 -> 3",
        "  ~ account_balances: 90 -> 87",
        "  WARN: accounts.person_id is absent from the snapshot — the column default applies",
        "restore point: pre-restore-20260904-091500-123456.zip",
    ]


def test_verify_verdict_names_the_tables_that_differ():
    assert verify_verdict(make_report(identical=True)) == ("PASS: 2 tables identical", 0)
    assert verify_verdict(make_report(identical=False)) == (
        "FAIL: 1 table(s) differ: account_balances",
        1,
    )
