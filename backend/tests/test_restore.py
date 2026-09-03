import io
import json
import zipfile
from collections.abc import Callable

import pytest
from sqlalchemy import func, select

from app.lifecycle.restore import (
    SnapshotError,
    check_schema,
    load_snapshot,
)
from app.services.snapshot import EXPORTED_TABLES, build_snapshot_zip

TABLE_NAMES = [name for _, name in EXPORTED_TABLES]


def rezip(
    payload: bytes,
    *,
    manifest_patch: dict | None = None,
    tables_patch: Callable[[dict], None] | None = None,
) -> bytes:
    """A copy of an export ZIP with its manifest and/or JSON tables edited in place."""
    src = zipfile.ZipFile(io.BytesIO(payload))
    manifest = json.loads(src.read("manifest.json"))
    export = json.loads(src.read("finance-export.json"))
    if manifest_patch:
        manifest.update(manifest_patch)
    if tables_patch:
        tables_patch(export["tables"])
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for name in src.namelist():
            if name == "manifest.json":
                dst.writestr(name, json.dumps(manifest))
            elif name == "finance-export.json":
                dst.writestr(name, json.dumps(export))
            else:
                dst.writestr(name, src.read(name))
    return out.getvalue()


def foreign_zip(**members: str) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for name, body in members.items():
            dst.writestr(name, body)
    return out.getvalue()


async def count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


# ── load_snapshot / check_schema ─────────────────────────────────────────────────────


def test_load_snapshot_refuses_non_zips_and_foreign_zips():
    for data in (
        b"not a zip",
        foreign_zip(**{"readme.txt": "hi"}),
        foreign_zip(**{"manifest.json": "{}", "finance-export.json": "{}"}),  # not this app
        foreign_zip(**{"manifest.json": "{not json", "finance-export.json": "{}"}),
    ):
        with pytest.raises(SnapshotError) as excinfo:
            load_snapshot(data)
        assert excinfo.value.status == 400
        assert excinfo.value.detail == "Not a snapshot ZIP from this app"


async def test_load_snapshot_reads_the_manifest_and_the_tables(db):
    snap = await build_snapshot_zip(db)
    loaded = load_snapshot(snap.payload)
    assert loaded.alembic_head is None  # create_all test schema
    assert loaded.exported_at == snap.exported_at
    assert loaded.environment == "dev"
    assert set(loaded.tables) == set(TABLE_NAMES)


async def test_load_snapshot_422s_naming_the_extra_or_missing_table(db):
    snap = await build_snapshot_zip(db)

    def drop_people(tables):
        del tables["people"]

    def add_crypto(tables):
        tables["crypto"] = []

    with pytest.raises(SnapshotError) as missing:
        load_snapshot(rezip(snap.payload, tables_patch=drop_people))
    assert missing.value.status == 422
    assert "missing table(s) people" in missing.value.detail
    with pytest.raises(SnapshotError) as extra:
        load_snapshot(rezip(snap.payload, tables_patch=add_crypto))
    assert extra.value.status == 422
    assert "extra table(s) crypto" in extra.value.detail


async def test_check_schema_409s_with_the_spec_sentence_and_treats_two_nones_as_equal(db):
    snap = await build_snapshot_zip(db)
    loaded = load_snapshot(snap.payload)
    ok = check_schema(loaded, None)
    assert (ok.snapshot_head, ok.server_head, ok.compatible) == (None, None, True)
    foreign = load_snapshot(rezip(snap.payload, manifest_patch={"alembic_head": "b8e4d17c2a90"}))
    with pytest.raises(SnapshotError) as excinfo:
        check_schema(foreign, "c3a7e19d5b42")
    assert excinfo.value.status == 409
    assert excinfo.value.detail == (
        "This snapshot was exported at schema `b8e4d17c2a90`; this server runs `c3a7e19d5b42`. "
        "Restore it on a server at `b8e4d17c2a90`, or use the nightly database dump."
    )
    with pytest.raises(SnapshotError) as none_vs_head:
        check_schema(loaded, "c3a7e19d5b42")
    assert "exported at schema `none`" in none_vs_head.value.detail
