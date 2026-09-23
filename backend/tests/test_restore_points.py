"""Restore points you can actually use (2026-09-23 spec §B3, data-entry audit F10): listed,
downloadable and restorable like stored snapshots, behind the same guards — both name
grammars anchored, the join kept inside its directory, symlinks never followed."""

import contextlib
import io
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models import Account
from app.services import snapshot_store
from app.services.snapshot import (
    RESTORE_POINT_NAME_RE,
    restore_point_stamp,
    restore_points_dir,
    snapshots_dir,
    trim_directory,
    write_restore_point,
)
from app.services.snapshot_store import list_restore_points, open_stored_file
from tests.workbook_builder import build_workbook

POINT = "pre-restore-20260904-091500-123456.zip"
SNAP = "finance-export-20260904-233000.zip"
RESTORE_POINTS = "/api/v1/system/restore-points"
DOWNLOAD = "/api/v1/system/snapshots/{}/download"
STORED = "/api/v1/import/snapshot/stored"


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


def read_stored(name: str) -> bytes | None:
    """What the gate hands back for `name`: the file's bytes, or None when it refuses."""
    stored = open_stored_file(name)
    if stored is None:
        return None
    with stored.handle:
        return stored.handle.read()


def test_open_stored_file_resolves_either_grammar_and_nothing_else():
    snapshots_dir().mkdir(parents=True)
    restore_points_dir().mkdir(parents=True)
    (snapshots_dir() / SNAP).write_bytes(b"s")
    (restore_points_dir() / POINT).write_bytes(b"point")
    (restore_points_dir() / "notes.txt").write_bytes(b"x")
    assert read_stored(SNAP) == b"s"
    assert read_stored(POINT) == b"point"
    stored = open_stored_file(POINT)
    with stored.handle:
        assert (stored.name, stored.size) == (POINT, 5)
    # A DIRECTORY named like a point is not a file to hand out.
    (restore_points_dir() / "pre-restore-20260906-091500-123456.zip").mkdir()
    assert open_stored_file("pre-restore-20260906-091500-123456.zip") is None
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
        assert open_stored_file(name) is None, name


def test_open_stored_file_never_follows_a_symlink(tmp_path):
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
    assert open_stored_file(POINT) is None
    assert list_restore_points(None) == []


def test_without_o_nofollow_the_opener_refuses_what_is_symlink_reports(monkeypatch):
    """Windows has no O_NOFOLLOW (and this box cannot create symlinks, so the test above
    skips here): the fallback asks is_symlink before the open. Pin that branch everywhere."""
    restore_points_dir().mkdir(parents=True)
    (restore_points_dir() / POINT).write_bytes(zipped(None))
    monkeypatch.setattr(snapshot_store, "_NOFOLLOW", 0)
    monkeypatch.setattr(Path, "is_symlink", lambda self: self.name == POINT)
    assert open_stored_file(POINT) is None
    assert list_restore_points(None) == []


def test_an_opened_stored_file_reads_whole_even_when_rotation_unlinks_it():
    """The handle is what gets read and streamed, so a point rotated out between the open and
    the last byte still arrives whole (2026-09-23 lane B1 review, M2)."""
    restore_points_dir().mkdir(parents=True)
    (restore_points_dir() / POINT).write_bytes(b"payload" * 1000)
    stored = open_stored_file(POINT)
    try:
        (restore_points_dir() / POINT).unlink()
    except PermissionError:  # pragma: no cover - Windows cannot unlink an open file
        stored.handle.close()
        pytest.skip("this platform cannot unlink an open file")
    with stored.handle:
        assert stored.handle.read() == b"payload" * 1000


def test_a_listing_skips_a_name_that_is_gone_by_the_time_it_is_read(monkeypatch):
    """Rotation can delete a point after the directory read returned its name; the listing
    leaves it out instead of answering 500 (2026-09-23 lane B1 review, M2). The ghost comes
    from the directory read itself, so the test holds whichever call first finds it gone."""
    restore_points_dir().mkdir(parents=True)
    (restore_points_dir() / POINT).write_bytes(zipped(None))
    ghost = restore_points_dir() / "pre-restore-20260903-080000-000001.zip"
    real_iterdir = Path.iterdir

    def iterdir_with_a_ghost(self):
        yield from real_iterdir(self)
        if self == restore_points_dir():
            yield ghost

    monkeypatch.setattr(Path, "iterdir", iterdir_with_a_ghost)
    assert [entry.name for entry in list_restore_points(None)] == [POINT]


async def test_a_point_rotated_out_after_the_gate_still_downloads_whole(auth_client, monkeypatch):
    """The download streams from the handle the gate opened, so rotation deleting the file
    between the gate and the send cannot turn the 200 into a 500 — the old path-based
    FileResponse re-opened by name at send time (2026-09-23 lane B1 review, M2). Windows
    cannot unlink an open file at all: the same guarantee, from the other side."""
    restore_points_dir().mkdir(parents=True)
    payload = zipped(None)
    (restore_points_dir() / POINT).write_bytes(payload)
    real_gate = snapshot_store.open_stored_file

    def gate_then_rotate(name):
        stored = real_gate(name)
        with contextlib.suppress(PermissionError):
            (restore_points_dir() / name).unlink()
        return stored

    monkeypatch.setattr("app.api.system.open_stored_file", gate_then_rotate)
    resp = await auth_client.get(f"/api/v1/system/snapshots/{POINT}/download")
    assert resp.status_code == 200
    assert resp.content == payload


async def test_restore_point_routes_require_auth(client):
    assert (await client.get(RESTORE_POINTS)).status_code == 401
    assert (await client.get(DOWNLOAD.format(POINT))).status_code == 401


async def test_restore_points_lists_what_a_restore_wrote(auth_client, db):
    assert (await auth_client.get(RESTORE_POINTS)).json() == []
    point = await write_restore_point(db, actor="me@example.com")
    listed = (await auth_client.get(RESTORE_POINTS)).json()
    # A create_all database has no alembic head, and neither does its restore point.
    assert [(e["name"], e["kind"], e["restorable"]) for e in listed] == [
        (point.name, "restore_point", True)
    ]
    # The snapshot list stays the snapshot list, and says so.
    created = (await auth_client.post("/api/v1/system/snapshots")).json()
    assert created["kind"] == "snapshot"
    snapshots = (await auth_client.get("/api/v1/system/snapshots")).json()
    assert [(e["name"], e["kind"]) for e in snapshots] == [(created["name"], "snapshot")]


async def test_download_serves_either_kind_byte_for_byte(auth_client, db):
    point = await write_restore_point(db, actor=None)
    snap = (await auth_client.post("/api/v1/system/snapshots")).json()["name"]
    for name, directory in ((point.name, restore_points_dir()), (snap, snapshots_dir())):
        resp = await auth_client.get(DOWNLOAD.format(name))
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/zip"
        assert name in resp.headers["content-disposition"]
        assert resp.content == (directory / name).read_bytes()
        assert resp.headers["content-length"] == str(len(resp.content))
        # A whole-database ZIP must not sit in a browser cache (review M3).
        assert resp.headers["cache-control"] == "no-store"


async def test_the_live_export_is_never_cached_either(auth_client):
    resp = await auth_client.get("/api/v1/export/snapshot")
    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "no-store"


async def test_download_refuses_foreign_and_traversal_names(auth_client, db):
    await write_restore_point(db, actor=None)
    (restore_points_dir() / "notes.txt").write_bytes(b"x")
    for name in (
        "notes.txt",
        "..%2Fsnapshots%2Ffinance-export-20260904-233000.zip",
        "..%2F..%2Fetc%2Fpasswd",
        "%2Fetc%2Fpasswd",
        "finance-export-20260904-999999.zip",
        "pre-restore-20260904-091500-999999.zip",
    ):
        resp = await auth_client.get(DOWNLOAD.format(name))
        assert resp.status_code == 404, name
        assert resp.json()["detail"].startswith("No stored snapshot named"), name


async def sort_order(db) -> int:
    db.expire_all()
    return (await db.execute(select(Account.sort_order))).scalar_one()


async def set_sort_order(db, value: int) -> None:
    await db.execute(Account.__table__.update().values(sort_order=value))
    await db.commit()


async def test_a_restore_point_restores_by_name(auth_client, db):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    point = await write_restore_point(db, actor=None)
    await set_sort_order(db, 9)
    dry = await auth_client.post(f"{STORED}/{point.name}")
    assert dry.status_code == 200, dry.text
    assert dry.json()["dry_run"] is True
    assert dry.json()["tables"]["accounts"]["identical"] is False
    assert await sort_order(db) == 9  # a dry run writes nothing
    applied = await auth_client.post(f"{STORED}/{point.name}?dry_run=false")
    assert applied.status_code == 200, applied.text
    assert applied.json()["applied"] is True
    assert await sort_order(db) == 1


async def test_restoring_the_oldest_of_three_restore_points_still_works(auth_client, db):
    """The apply writes a NEW point first, which rotates the oldest of three out of the
    directory — the very file being restored. Its bytes are read before the restore starts,
    so the undo a bad day needs most still works (spec §B3)."""
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    names = []
    for order in (1, 2, 3):
        await set_sort_order(db, order)
        names.append((await write_restore_point(db, actor=None)).name)
    await set_sort_order(db, 4)
    resp = await auth_client.post(f"{STORED}/{names[0]}?dry_run=false")
    assert resp.status_code == 200, resp.text
    assert await sort_order(db) == 1
    kept = sorted(path.name for path in restore_points_dir().iterdir())
    assert names[0] not in kept and len(kept) == 3
    assert kept[:2] == names[1:] and kept[2] == resp.json()["restore_point"]


async def test_a_failed_restore_from_the_oldest_point_keeps_that_point(
    auth_client, db, monkeypatch
):
    """The apply writes its own point FIRST, and that write used to rotate the oldest of three
    out of the directory at once — so a restore FROM the oldest point that then failed deleted
    the very file a retry needed: "Restore failed and nothing was changed", then a 404
    (2026-09-23 lane B1 review, Important 1). The source is protected until the apply commits."""
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    names = []
    for order in (1, 2, 3):
        await set_sort_order(db, order)
        names.append((await write_restore_point(db, actor=None)).name)
    await set_sort_order(db, 4)

    def explode():
        raise RuntimeError("disk on fire")

    with monkeypatch.context() as patch:
        patch.setattr("app.lifecycle.restore._exported_in_fk_order", explode)
        failed = await auth_client.post(f"{STORED}/{names[0]}?dry_run=false")
    assert failed.status_code == 500
    assert failed.json()["detail"] == "Restore failed and nothing was changed"
    assert await sort_order(db) == 4
    # The source is still on the volume, beside the point the failed apply wrote.
    assert (restore_points_dir() / names[0]).is_file()
    assert len(list(restore_points_dir().iterdir())) == 4
    retry = await auth_client.post(f"{STORED}/{names[0]}")
    assert retry.status_code == 200, retry.text
    assert retry.json()["dry_run"] is True
    applied = await auth_client.post(f"{STORED}/{names[0]}?dry_run=false")
    assert applied.status_code == 200, applied.text
    assert await sort_order(db) == 1
    # Committed: "newest three kept" holds again, and the source has done its job.
    kept = sorted(p.name for p in restore_points_dir().iterdir())
    assert len(kept) == 3 and names[0] not in kept
    assert applied.json()["restore_point"] in kept


def test_trim_directory_never_deletes_a_protected_name():
    directory = restore_points_dir()
    directory.mkdir(parents=True)
    names = [f"pre-restore-2026090{day}-080000-000000.zip" for day in range(1, 6)]
    for name in names:
        (directory / name).write_bytes(b"x")
    removed = trim_directory(directory, RESTORE_POINT_NAME_RE, 3, protect=frozenset({names[0]}))
    # The protected oldest still counts toward the order, but is never the one removed.
    assert removed == [names[1]]
    assert sorted(p.name for p in directory.iterdir()) == [names[0], *names[2:]]
    assert trim_directory(directory, RESTORE_POINT_NAME_RE, 3) == [names[0]]


async def test_restore_from_stored_refuses_foreign_names_in_one_sentence(auth_client, db):
    await write_restore_point(db, actor=None)
    for name in (
        "notes.txt",
        "..%2F" + POINT,
        "..%2Frestore-points%2F" + POINT,
        "pre-restore-20260904-091500-999999.zip",
    ):
        missing = await auth_client.post(f"{STORED}/{name}")
        assert missing.status_code == 404, name
        assert missing.json()["detail"].startswith("No stored snapshot named"), name


async def test_an_applied_import_names_the_restore_point_it_saved(auth_client, db):
    files = {"file": ("workbook.xlsx", build_workbook(), "application/octet-stream")}
    dry = (await auth_client.post("/api/v1/import/xlsx", files=files)).json()
    assert dry["restore_point"] is None
    applied = (await auth_client.post("/api/v1/import/xlsx?dry_run=false", files=files)).json()
    assert applied["applied"] is True
    assert (restore_points_dir() / applied["restore_point"]).is_file()


def test_the_name_grammars_are_ascii_only():
    """`\d` matches every Unicode digit; a fullwidth "２０２６…" name must be as foreign as any
    other (2026-09-23 lane B1 review, M1)."""
    from app.services.snapshot import SNAPSHOT_NAME_RE

    wide = "２０２６０９０４"
    point = f"pre-restore-{wide}-091500-123456.zip"
    snap = f"finance-export-{wide}-233000.zip"
    assert RESTORE_POINT_NAME_RE.fullmatch(point) is None
    assert SNAPSHOT_NAME_RE.fullmatch(snap) is None
    restore_points_dir().mkdir(parents=True)
    snapshots_dir().mkdir(parents=True)
    (restore_points_dir() / point).write_bytes(zipped(None))
    (snapshots_dir() / snap).write_bytes(zipped(None))
    assert open_stored_file(point) is None and open_stored_file(snap) is None
    assert list_restore_points(None) == []
