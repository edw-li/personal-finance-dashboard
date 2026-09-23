"""Restore points you can actually use (2026-09-23 spec §B3, data-entry audit F10): listed,
downloadable and restorable like stored snapshots, behind the same guards — both name
grammars anchored, the join kept inside its directory, symlinks never followed."""

import io
import json
import zipfile
from datetime import UTC, datetime

import pytest

from app.services.snapshot import restore_point_stamp, restore_points_dir, snapshots_dir
from app.services.snapshot_store import list_restore_points, stored_file

POINT = "pre-restore-20260904-091500-123456.zip"
SNAP = "finance-export-20260904-233000.zip"


def zipped(head: str | None) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("manifest.json", json.dumps({"alembic_head": head}))
        archive.writestr("finance-export.json", "{}")
    return out.getvalue()


def test_restore_point_stamp_reads_the_utc_instant_to_the_microsecond():
    assert restore_point_stamp(POINT) == datetime(2026, 9, 4, 9, 15, 0, 123456, tzinfo=UTC)
    for foreign in (
        SNAP,
        "pre-restore-20260904-091500.zip",
        "pre-restore-20261399-091500-000000.zip",
        f"{POINT}.part",
    ):
        assert restore_point_stamp(foreign) is None, foreign


def test_list_restore_points_is_newest_first_with_kind_and_restorable_by_head():
    directory = restore_points_dir()
    directory.mkdir(parents=True)
    (directory / "pre-restore-20260903-080000-000001.zip").write_bytes(zipped("b8e4d17c2a90"))
    (directory / POINT).write_bytes(zipped("c3a7e19d5b42"))
    (directory / "pre-restore-20260905-070000-000000.zip").write_bytes(b"not a zip")
    for foreign in ("notes.txt", f"{POINT}.part", SNAP, "pre-restore-2026.zip"):
        (directory / foreign).write_bytes(b"x")
    entries = list_restore_points("c3a7e19d5b42")
    assert [e.name for e in entries] == [
        "pre-restore-20260905-070000-000000.zip",
        POINT,
        "pre-restore-20260903-080000-000001.zip",
    ]
    assert [e.restorable for e in entries] == [False, True, False]
    assert {e.kind for e in entries} == {"restore_point"}
    assert entries[1].at == datetime(2026, 9, 4, 9, 15, 0, 123456, tzinfo=UTC)
    assert entries[1].size_bytes > 0
    assert entries[0].alembic_head is None  # unreadable: listed, never restorable


def test_list_restore_points_without_a_directory_is_empty():
    assert list_restore_points("c3a7e19d5b42") == []


def test_stored_file_resolves_either_grammar_and_nothing_else():
    snapshots_dir().mkdir(parents=True)
    restore_points_dir().mkdir(parents=True)
    (snapshots_dir() / SNAP).write_bytes(b"s")
    (restore_points_dir() / POINT).write_bytes(b"p")
    (restore_points_dir() / "notes.txt").write_bytes(b"x")
    assert stored_file(SNAP) == snapshots_dir() / SNAP
    assert stored_file(POINT) == restore_points_dir() / POINT
    for name in (
        "notes.txt",
        f"../snapshots/{SNAP}",
        f"..\\restore-points\\{POINT}",
        f"/{SNAP}",
        f"{SNAP}/../{POINT}",
        "finance-export-20260905-233000.zip",  # the grammar, but no such file
        "pre-restore-20260905-091500-123456.zip",
        "",
    ):
        assert stored_file(name) is None, name


def test_stored_file_never_follows_a_symlink(tmp_path):
    """is_file() FOLLOWS a link, so a link named like a restore point would hand out whatever
    it points at — off the data volume entirely. Prod is Linux; Windows needs Developer Mode
    to create one, hence the skip rather than a silent pass."""
    restore_points_dir().mkdir(parents=True)
    real = tmp_path / "elsewhere.zip"
    real.write_bytes(zipped(None))
    try:
        (restore_points_dir() / POINT).symlink_to(real)
    except OSError as exc:  # pragma: no cover - privilege-dependent
        pytest.skip(f"cannot create symlinks here: {exc}")
    assert stored_file(POINT) is None
    assert list_restore_points(None) == []
