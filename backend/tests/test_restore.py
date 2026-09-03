import io
import json
import zipfile
from collections.abc import Callable
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text

from app.lifecycle.restore import (
    RESTORE_PRESERVED_SETTINGS,
    SnapshotError,
    apply_restore,
    check_schema,
    load_snapshot,
    parse_tables,
    plan_restore,
)
from app.models import (
    Account,
    AppSetting,
    CategoryBudget,
    ChangeLog,
    CreditCard,
    CustomEvent,
    LifecycleRun,
    Person,
    SpendingCategory,
    UserPreference,
)
from app.schemas.lifecycle import RestoreReport, RestoreTableDiff
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


async def test_load_snapshot_refuses_a_member_over_the_uncompressed_cap(db, monkeypatch):
    # The 15 MB upload ceiling counts COMPRESSED bytes; the cap here bounds what a crafted
    # archive can ask us to hold in memory. Shrink it rather than build a 64 MB bomb.
    snap = await build_snapshot_zip(db)
    monkeypatch.setattr("app.lifecycle.restore.MAX_MEMBER_BYTES", 64)
    with pytest.raises(SnapshotError) as excinfo:
        load_snapshot(snap.payload)
    assert excinfo.value.status == 413
    assert "is too large" in excinfo.value.detail


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


# ── apply_restore ────────────────────────────────────────────────────────────────────


async def seed_a_book(db, seeded_user) -> None:
    """A workbook import plus the UI-only rows the workbook never carries (spec §13)."""
    from app.importer.service import run_import
    from tests.workbook_builder import build_workbook

    report = await run_import(build_workbook(), db, dry_run=False)
    assert report.applied and not report.has_errors
    category = (
        (await db.execute(select(SpendingCategory).order_by(SpendingCategory.id))).scalars().first()
    )
    db.add(
        CategoryBudget(
            category_id=category.id, effective_month=date(2024, 1, 1), amount=Decimal("500.00")
        )
    )
    db.add(CustomEvent(event_date=date(2026, 12, 25), label="Bonus lands", detail=None))
    # `people` is the SECOND-TO-LAST exported table but the parent of accounts.person_id and
    # credit_cards.person_id: owning a row from each pins the FK-ordered insert (spec §7
    # step 4). Insert in the export's own order instead and both statements fail.
    person = Person(name="Alex", is_primary=True)
    db.add(person)
    await db.flush()
    db.add(
        CreditCard(
            name="Sapphire",
            slug="sapphire",
            rewards_currency="points",
            annual_fee=Decimal("95.00"),
            point_value_cents=Decimal("1.5000"),
            person_id=person.id,
        )
    )
    db.add(UserPreference(user_id=seeded_user.id, key="theme", value="light"))
    owned = (await db.execute(select(Account).order_by(Account.id))).scalars().first()
    owned.person_id = person.id
    await db.commit()


async def wipe_exported_tables(db) -> None:
    names = ", ".join(f'"{name}"' for name in TABLE_NAMES)
    await db.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
    await db.commit()


async def restore_now(db, payload: bytes, user_id: int) -> RestoreReport:
    return await apply_restore(
        db,
        load_snapshot(payload),
        user_id=user_id,
        actor="me@example.com",
        server_head=None,
        source_name="finance-export.zip",
        size_bytes=len(payload),
    )


async def test_apply_restore_round_trips_every_table_byte_for_byte(db, seeded_user):
    await seed_a_book(db, seeded_user)
    before = await build_snapshot_zip(db)
    assert before.counts["accounts"] == 3 and before.counts["credit_cards"] == 1
    assert before.counts["people"] == 1  # the FK the insert order has to respect
    await wipe_exported_tables(db)
    assert await count(db, Account) == 0

    report = await restore_now(db, before.payload, seeded_user.id)
    assert report.applied is True and report.dry_run is False
    assert report.tables["accounts"] == RestoreTableDiff(current=0, incoming=3, identical=False)
    assert report.restore_point is not None
    assert (restore_points_dir() / report.restore_point).is_file()
    assert report.batch_id is not None and report.run_id is not None

    after = await build_snapshot_zip(db)
    a = zipfile.ZipFile(io.BytesIO(before.payload))
    b = zipfile.ZipFile(io.BytesIO(after.payload))
    assert (
        json.loads(a.read("finance-export.json"))["tables"]
        == json.loads(b.read("finance-export.json"))["tables"]
    )
    for name in a.namelist():
        if name.startswith("csv/"):
            assert a.read(name) == b.read(name), name

    # The trail: the restore's summary change-log row is the LAST row (the trail is not part of
    # the snapshot, so rows the seed's own logged writes left behind survive a restore by
    # design), one restore run holding the report, plus the restore point's own run
    # (committed before the transaction).
    rows = (await db.execute(select(ChangeLog).order_by(ChangeLog.id))).scalars().all()
    assert [(r.op, r.source, r.table_name) for r in rows][-1] == ("batch", "restore", "*")
    assert sum(1 for r in rows if r.source == "restore") == 1
    assert rows[-1].after == {
        "tables": {name: diff.incoming for name, diff in report.tables.items()}
    }
    assert rows[-1].batch_id == report.batch_id
    # Runs likewise: the seed's own import run (if any) precedes the restore point and the restore.
    runs = (await db.execute(select(LifecycleRun).order_by(LifecycleRun.id))).scalars().all()
    assert [r.kind for r in runs][-2:] == ["restore_point", "restore"]
    assert runs[-1].id == report.run_id and runs[-1].batch_id == report.batch_id
    assert runs[-1].report["restore_point"] == report.restore_point
    assert runs[-1].filename == "finance-export.zip" and runs[-1].size_bytes == len(before.payload)


async def test_apply_restore_preserves_this_servers_operational_settings(db, seeded_user):
    db.add(AppSetting(key="backup_status", value={"snapshot": True}))
    db.add(AppSetting(key="swr_pct", value={"value": "0.04"}))
    await db.commit()
    snap = await build_snapshot_zip(db)  # carries backup_status = {"snapshot": True}
    for key, value in (
        ("backup_status", {"server": True}),
        ("nvidia_api_key", {"value": "nvapi-x"}),
        ("swr_pct", {"value": "0.99"}),
    ):
        setting = await db.get(AppSetting, key)
        if setting is None:
            db.add(AppSetting(key=key, value=value))
        else:
            setting.value = value
    await db.commit()

    report = await restore_now(db, snap.payload, seeded_user.id)
    assert report.preserved_settings == ["backup_status", "nvidia_api_key"]
    stored = {s.key: s.value for s in (await db.execute(select(AppSetting))).scalars()}
    assert stored["backup_status"] == {"server": True}  # this server's marker, not the snapshot's
    assert stored["nvidia_api_key"] == {"value": "nvapi-x"}  # the key survives a restore
    assert stored["swr_pct"] == {"value": "0.04"}  # ordinary settings come from the snapshot
    for key in RESTORE_PRESERVED_SETTINGS:
        assert key in {
            "nvidia_api_key",
            "backup_status",
            "backup_runs",
            "refresh_runs",
            "last_refresh",
        }
    # A preserved row is never written from the file, so it is not part of the identity
    # either: the drill's `verify` passes right after this restore even though this
    # server's backup_status differs from the one the snapshot carries.
    plan = await plan_restore(
        db, load_snapshot(snap.payload), user_id=seeded_user.id, server_head=None
    )
    assert plan.tables["app_settings"] == RestoreTableDiff(current=1, incoming=1, identical=True)
    assert all(diff.identical for diff in plan.tables.values())


async def test_a_snapshot_carrying_preserved_settings_reports_only_the_rows_it_writes(
    db, seeded_user
):
    db.add(AppSetting(key="backup_status", value={"snapshot": True}))
    db.add(AppSetting(key="refresh_runs", value=[{"at": "2026-09-01T00:00:00+00:00"}]))
    db.add(AppSetting(key="swr_pct", value={"value": "0.04"}))
    await db.commit()
    snap = await build_snapshot_zip(db)
    assert len(load_snapshot(snap.payload).tables["app_settings"]) == 3  # the file has all three
    await wipe_exported_tables(db)

    report = await restore_now(db, snap.payload, seeded_user.id)
    # Counted as written, not as carried: two preserved rows stay out of the report and out
    # of the database (this server has none to put back after the truncate).
    assert report.tables["app_settings"] == RestoreTableDiff(current=0, incoming=1, identical=False)
    assert report.preserved_settings == []
    assert [s.key for s in (await db.execute(select(AppSetting))).scalars()] == ["swr_pct"]
    # And the same file now verifies clean — the diff a restore cannot settle is gone.
    plan = await plan_restore(
        db, load_snapshot(snap.payload), user_id=seeded_user.id, server_head=None
    )
    assert plan.tables["app_settings"] == RestoreTableDiff(current=1, incoming=1, identical=True)
    assert [name for name, diff in plan.tables.items() if not diff.identical] == []


async def test_apply_restore_rewrites_preferences_fixes_the_self_reference_and_resumes_sequences(
    db, seeded_user
):
    parent = Account(name="401k", slug="401k", group="pre_tax", sort_order=1)
    db.add(parent)
    await db.flush()
    # The child has the LOWER sort but the HIGHER id: the export writes it after its parent,
    # but a snapshot from a book where the child was created first would not — the apply
    # must not depend on file order for the self-reference.
    child = Account(
        name="401k Bucket",
        slug="401k-bucket",
        group="pre_tax",
        sort_order=0,
        is_component=True,
        parent_account_id=parent.id,
    )
    db.add(child)
    db.add(UserPreference(user_id=seeded_user.id, key="density", value="compact"))
    await db.commit()
    snap = await build_snapshot_zip(db)

    def swap_order_and_user(tables):
        tables["accounts"].reverse()  # child first
        tables["user_preferences"][0]["user_id"] = 999

    await wipe_exported_tables(db)
    report = await restore_now(
        db, rezip(snap.payload, tables_patch=swap_order_and_user), seeded_user.id
    )
    assert report.applied is True
    accounts = {a.slug: a for a in (await db.execute(select(Account))).scalars()}
    assert accounts["401k-bucket"].parent_account_id == accounts["401k"].id
    pref = (await db.execute(select(UserPreference))).scalar_one()
    assert (pref.user_id, pref.key, pref.value) == (seeded_user.id, "density", "compact")
    # Sequences resume past the restored ids: the next account is max(id)+1, not a collision.
    fresh = Account(name="New", slug="new", group="cash", sort_order=9)
    db.add(fresh)
    await db.commit()
    assert fresh.id == max(accounts["401k"].id, accounts["401k-bucket"].id) + 1


async def test_apply_restore_keeps_three_restore_points(db, seeded_user):
    # Read before the export: build_snapshot_zip opens its REPEATABLE READ transaction with a
    # rollback, which expires every loaded instance (a lazy refresh here would be detached).
    actor = seeded_user.id
    snap = await build_snapshot_zip(db)
    for _ in range(4):
        await restore_now(db, snap.payload, actor)
    assert len(list(restore_points_dir().iterdir())) == 3
    kinds = [
        r.kind for r in (await db.execute(select(LifecycleRun).order_by(LifecycleRun.id))).scalars()
    ]
    assert kinds == ["restore_point", "restore"] * 4


async def test_apply_restore_rolls_back_and_keeps_the_restore_point_on_failure(
    db, seeded_user, monkeypatch
):
    db.add(Account(name="Keep", slug="keep", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)

    def explode():
        raise RuntimeError("disk on fire")

    monkeypatch.setattr("app.lifecycle.restore._exported_in_fk_order", explode)
    with pytest.raises(RuntimeError, match="disk on fire"):
        await restore_now(db, snap.payload, seeded_user.id)
    await db.rollback()  # what the router does
    assert await count(db, Account) == 1  # the TRUNCATE rolled back with everything else
    assert await count(db, ChangeLog) == 0
    runs = (await db.execute(select(LifecycleRun))).scalars().all()
    assert [r.kind for r in runs] == ["restore_point"]  # committed on its own, still listed
    assert len(list(restore_points_dir().iterdir())) == 1
