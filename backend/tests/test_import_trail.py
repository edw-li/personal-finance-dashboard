from sqlalchemy import select

from app.importer.service import run_import
from app.models import ChangeLog, LifecycleRun
from app.services.snapshot import restore_points_dir
from tests.workbook_builder import build_workbook


async def test_apply_writes_a_restore_point_a_summary_row_and_a_run(db):
    report = await run_import(build_workbook(), db, dry_run=False, actor="me@example.com")
    assert report.applied is True
    assert len(list(restore_points_dir().iterdir())) == 1
    runs = (await db.execute(select(LifecycleRun).order_by(LifecycleRun.id))).scalars().all()
    assert [(r.kind, r.dry_run, r.ok, r.actor) for r in runs] == [
        ("restore_point", False, True, "me@example.com"),
        ("import_xlsx", False, True, "me@example.com"),
    ]
    assert runs[1].report["applied"] is True and "sheets" in runs[1].report
    row = (await db.execute(select(ChangeLog))).scalar_one()
    assert (row.op, row.source, row.table_name, row.actor) == (
        "batch",
        "import",
        "*",
        "me@example.com",
    )
    assert row.batch_id == runs[1].batch_id
    assert row.label.startswith("Imported workbook — ") and row.label.endswith(" across 9 sheets")
    assert row.after["sheets"]["net_worth"]["accounts"]["creates"] == 3


async def test_dry_run_records_a_run_and_no_restore_point(db):
    report = await run_import(build_workbook(), db, dry_run=True)
    assert report.applied is False
    assert not restore_points_dir().exists()
    run = (await db.execute(select(LifecycleRun))).scalar_one()
    assert (run.kind, run.dry_run, run.ok, run.actor, run.batch_id) == (
        "import_xlsx",
        True,
        True,
        None,
        None,
    )
    assert run.report["dry_run"] is True
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


async def test_a_workbook_with_errors_records_a_failed_run_and_no_restore_point(db):
    from tests.workbook_builder import default_taxes_rows

    rows = default_taxes_rows()
    rows[3][1] = "Pay Cadence"  # label drift -> the Taxes PARSER aborts with an error
    report = await run_import(build_workbook(taxes=rows), db, dry_run=False)
    assert report.has_errors and report.applied is False
    # A parse refusal never reaches the appliers, so there is nothing to keep first.
    assert not restore_points_dir().exists()
    run = (await db.execute(select(LifecycleRun))).scalar_one()
    assert (run.kind, run.ok, run.batch_id) == ("import_xlsx", False, None)
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


async def test_an_apply_phase_error_keeps_the_restore_point_and_logs_no_summary(db):
    """The other refusal shape: parse-clean, so the current database IS kept first, and the
    failed run is still stored — but the rolled-back apply leaves no summary row."""
    from tests.workbook_builder import default_net_worth_rows

    rows = default_net_worth_rows()
    rows[1][4] = "Checking!"  # slugs to 'checking', colliding with column 3's account
    report = await run_import(build_workbook(net_worth=rows), db, dry_run=False)
    assert report.has_errors and report.applied is False
    assert len(list(restore_points_dir().iterdir())) == 1
    runs = (await db.execute(select(LifecycleRun).order_by(LifecycleRun.id))).scalars().all()
    assert [(r.kind, r.ok) for r in runs] == [("restore_point", True), ("import_xlsx", False)]
    assert runs[1].batch_id is None
    assert (await db.execute(select(ChangeLog))).scalars().all() == []


async def test_the_route_passes_the_actor(auth_client, db):
    resp = await auth_client.post(
        "/api/v1/import/xlsx?dry_run=false",
        files={"file": ("workbook.xlsx", build_workbook(), "application/octet-stream")},
    )
    assert resp.status_code == 200, resp.text
    runs = (await db.execute(select(LifecycleRun.actor))).scalars().all()
    assert set(runs) == {"me@example.com"}
