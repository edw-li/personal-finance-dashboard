import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.lifecycle.__main__ import _amain, build_parser, main, render_report, verify_verdict
from app.models import Account
from app.schemas.lifecycle import RestoreReport, RestoreSchema, RestoreTableDiff
from app.services.snapshot import build_snapshot_zip


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


# ── the exit codes, end to end ───────────────────────────────────────────────────────


class _NoDispose:
    """Stands in for app.database.engine: _amain disposes it in a finally, and disposing the
    session-scoped test engine would yank the pool out from under the rest of the suite."""

    async def dispose(self) -> None:
        return None


@pytest.fixture
def cli_session(engine, monkeypatch):
    """The CLI opens its OWN session from app.database.SessionLocal — which points at
    DATABASE_URL, i.e. a REAL database. Point it at the test engine instead so no test here
    can reach one."""
    monkeypatch.setattr(
        "app.lifecycle.__main__.SessionLocal", async_sessionmaker(engine, expire_on_commit=False)
    )
    monkeypatch.setattr("app.lifecycle.__main__.engine", _NoDispose())


async def release_locks(db) -> None:
    """TWO sessions, one database: the CLI opens its own, and its TRUNCATE wants ACCESS
    EXCLUSIVE. This session must not still be sitting in the read transaction that
    build_snapshot_zip opened, or the two block each other until the suite times out."""
    await db.commit()


def test_main_returns_2_for_a_path_that_is_not_a_file(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["prog", "verify", str(tmp_path / "nope.zip")])
    assert main() == 2  # no database is opened at all
    assert "is not a file" in capsys.readouterr().err


async def test_amain_returns_2_when_the_file_is_not_a_snapshot(cli_session, tmp_path, capsys):
    bad = tmp_path / "bad.zip"
    bad.write_bytes(b"not a zip")
    assert await _amain("verify", bad, False) == 2
    assert "error: Not a snapshot ZIP from this app" in capsys.readouterr().err


async def test_amain_returns_1_when_a_table_differs(db, seeded_user, tmp_path, cli_session, capsys):
    account = Account(name="A", slug="a", group="cash", sort_order=1)
    db.add(account)
    await db.commit()
    snap = await build_snapshot_zip(db)
    book = tmp_path / "book.zip"
    book.write_bytes(snap.payload)
    account.sort_order = 5
    await db.commit()

    assert await _amain("verify", book, False) == 1
    captured = capsys.readouterr()
    assert "FAIL: 1 table(s) differ: accounts" in captured.out
    assert captured.err == ""  # a differing table is a verdict, not an error


async def test_amain_returns_1_and_says_nothing_changed_when_the_apply_explodes(
    db, seeded_user, tmp_path, cli_session, capsys, monkeypatch
):
    db.add(Account(name="Keep", slug="keep", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)
    book = tmp_path / "book.zip"
    book.write_bytes(snap.payload)
    await release_locks(db)

    def explode():
        raise RuntimeError("disk on fire")

    monkeypatch.setattr("app.lifecycle.restore._exported_in_fk_order", explode)
    assert await _amain("restore", book, False) == 1
    err = capsys.readouterr().err
    assert "restore failed and nothing was changed" in err and "disk on fire" in err


async def test_amain_never_claims_a_restore_failed_when_nothing_was_written(
    db, tmp_path, cli_session, capsys, monkeypatch
):
    snap = await build_snapshot_zip(db)
    book = tmp_path / "book.zip"
    book.write_bytes(snap.payload)
    await release_locks(db)

    def explode(*args, **kwargs):
        raise RuntimeError("connection reset")

    monkeypatch.setattr("app.lifecycle.__main__.plan_restore", explode)
    assert await _amain("verify", book, False) == 1
    assert "error: verify failed" in capsys.readouterr().err
    assert await _amain("restore", book, True) == 1
    assert "error: restore failed (" in capsys.readouterr().err  # a dry run changed nothing
