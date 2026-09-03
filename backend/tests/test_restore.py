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
    parse_tables,
    plan_restore,
)
from app.models import (
    Account,
    ChangeLog,
    LifecycleRun,
    UserPreference,
)
from app.schemas.lifecycle import RestoreTableDiff
from app.services.snapshot import EXPORTED_TABLES, build_snapshot_zip, restore_points_dir

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


# ── parse_tables / diff_tables ───────────────────────────────────────────────────────


async def test_parse_tables_422s_on_an_unknown_column_and_warns_on_an_absent_one(db, seeded_user):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)

    def add_colour(tables):
        tables["accounts"][0]["colour"] = "teal"

    def drop_person_id(tables):
        del tables["accounts"][0]["person_id"]

    with pytest.raises(SnapshotError) as excinfo:
        parse_tables(
            load_snapshot(rezip(snap.payload, tables_patch=add_colour)), user_id=seeded_user.id
        )
    assert excinfo.value.status == 422
    assert excinfo.value.detail == "Snapshot column accounts.colour is unknown to this server"

    parsed = parse_tables(
        load_snapshot(rezip(snap.payload, tables_patch=drop_person_id)), user_id=seeded_user.id
    )
    assert parsed.warnings == [
        "accounts.person_id is absent from the snapshot — the column default applies"
    ]
    assert parsed.absent["accounts"] == ["person_id"]
    assert parsed.rows["accounts"][0]["person_id"] is None  # for the identity hash
    assert parsed.rows["accounts"][0]["sort_order"] == 1


async def test_parse_tables_422s_on_a_value_that_does_not_parse(db, seeded_user):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)

    def bad_sort(tables):
        tables["accounts"][0]["sort_order"] = "many"

    with pytest.raises(SnapshotError) as excinfo:
        parse_tables(
            load_snapshot(rezip(snap.payload, tables_patch=bad_sort)), user_id=seeded_user.id
        )
    assert excinfo.value.status == 422
    assert "accounts.sort_order" in excinfo.value.detail


async def test_parse_tables_rewrites_preferences_to_the_caller_and_notes_a_foreign_environment(
    db, seeded_user
):
    db.add(UserPreference(user_id=seeded_user.id, key="theme", value="light"))
    await db.commit()
    snap = await build_snapshot_zip(db)

    def foreign_user(tables):
        tables["user_preferences"][0]["user_id"] = 999
        tables["user_preferences"].append({**tables["user_preferences"][0], "user_id": 42})

    loaded = load_snapshot(
        rezip(snap.payload, manifest_patch={"environment": "prod"}, tables_patch=foreign_user)
    )
    parsed = parse_tables(loaded, user_id=seeded_user.id)
    # One row per key, owned by the caller — duplicates from another account collapse.
    assert [(r["user_id"], r["key"]) for r in parsed.rows["user_preferences"]] == [
        (seeded_user.id, "theme")
    ]
    assert parsed.warnings == [
        "Snapshot was exported from a 'prod' environment; this server is 'dev'"
    ]
    no_user = parse_tables(loaded, user_id=None)
    assert no_user.rows["user_preferences"] == []
    assert "user_preferences skipped — no user to attach them to" in no_user.warnings


async def test_diff_tables_hashes_identity_through_the_csv_writer(db, seeded_user):
    account = Account(name="Café Fund", slug="cafe-fund", group="cash", sort_order=2)
    db.add(account)
    await db.commit()
    snap = await build_snapshot_zip(db)
    parsed = parse_tables(load_snapshot(snap.payload), user_id=seeded_user.id)
    report = await plan_restore(
        db, load_snapshot(snap.payload), user_id=seeded_user.id, server_head=None
    )
    assert report.dry_run is True and report.applied is False
    assert report.exported_at == snap.exported_at
    assert report.tables["accounts"] == RestoreTableDiff(current=1, incoming=1, identical=True)
    assert all(diff.identical for diff in report.tables.values())
    assert report.restore_point is None and report.batch_id is None and report.run_id is None
    # Change the live row: same counts, no longer identical.
    account.sort_order = 3
    await db.commit()
    changed = await plan_restore(
        db, load_snapshot(snap.payload), user_id=seeded_user.id, server_head=None
    )
    assert changed.tables["accounts"] == RestoreTableDiff(current=1, incoming=1, identical=False)
    assert parsed.rows["accounts"][0]["sort_order"] == 2
    # A dry run writes nothing: no restore point, no run, no change-log row.
    assert not restore_points_dir().exists()
    assert await count(db, LifecycleRun) == 0 and await count(db, ChangeLog) == 0
