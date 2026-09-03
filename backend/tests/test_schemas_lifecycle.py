from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.lifecycle import (
    ActivityBatchOut,
    ActivityOut,
    ActivityRunDetailOut,
    ActivityRunOut,
    HealthCheckOut,
    HealthFixOut,
    HealthOut,
    PrefEntryOut,
    PrefsOut,
    RestoreReport,
    RestoreSchema,
    RestoreTableDiff,
    SnapshotEntryOut,
)
from app.schemas.net_worth import MonthUpsertResult
from app.schemas.spending import SpendingUpsertResult
from app.schemas.system import BackupRunOut, BackupStatusOut

NOW = datetime(2026, 9, 4, 3, 0, tzinfo=UTC)


def test_restore_report_serializes_schema_under_its_wire_name():
    report = RestoreReport(
        dry_run=True,
        applied=False,
        exported_at=NOW,
        schema=RestoreSchema(
            snapshot_head="c3a7e19d5b42", server_head="c3a7e19d5b42", compatible=True
        ),
        tables={"accounts": RestoreTableDiff(current=3, incoming=3, identical=True)},
        preserved_settings=["backup_status"],
        warnings=[],
        errors=[],
        restore_point=None,
        batch_id=None,
        run_id=None,
    )
    body = report.model_dump(mode="json")
    # `schema` shadows a BaseModel attribute, so the field is schema_ with an alias — the
    # WIRE says schema (spec §7), by_alias on both dump and FastAPI's response path.
    assert body["schema"] == {
        "snapshot_head": "c3a7e19d5b42",
        "server_head": "c3a7e19d5b42",
        "compatible": True,
    }
    assert "schema_" not in body
    assert RestoreReport.model_validate(body).schema_.compatible is True


def test_activity_entries_are_discriminated_by_type():
    batch = ActivityBatchOut(
        batch_id=uuid4(),
        at=NOW,
        source="ui",
        actor="me@example.com",
        label="Saved Sep 2026 balances — 19 updated",
        month=None,
        rows=19,
        undoable=True,
        undone_by=None,
    )
    run = ActivityRunOut(
        run_id=1,
        at=NOW,
        kind="snapshot",
        ok=True,
        dry_run=False,
        filename="finance-export-20260904-233000.zip",
        size_bytes=1024,
        has_report=True,
    )
    page = ActivityOut(entries=[batch, run], next_before=None)
    body = page.model_dump(mode="json")
    assert [e["type"] for e in body["entries"]] == ["batch", "run"]
    parsed = ActivityOut.model_validate(body)
    assert isinstance(parsed.entries[0], ActivityBatchOut)
    assert isinstance(parsed.entries[1], ActivityRunOut)
    detail = ActivityRunDetailOut(run=run, report={"dry_run": False})
    assert detail.model_dump(mode="json")["report"] == {"dry_run": False}


def test_snapshot_entry_prefs_and_health_shapes():
    entry = SnapshotEntryOut(
        name="finance-export-20260904-233000.zip",
        at=NOW,
        size_bytes=2048,
        alembic_head="c3a7e19d5b42",
        restorable=True,
    )
    assert entry.model_dump(mode="json")["restorable"] is True
    prefs = PrefsOut(prefs={"theme": PrefEntryOut(value="dark", updated_at=NOW)})
    assert prefs.model_dump(mode="json")["prefs"]["theme"]["value"] == "dark"
    check = HealthCheckOut(
        id="zero_filled_spending",
        severity="error",
        title="Zero-filled spending month",
        detail="19 rows of $0.00 with no take-home",
        count=1,
        months=["2026-09-01"],
        fix=HealthFixOut(kind="action", action="delete_spending_month", label="Delete the month"),
    )
    health = HealthOut(checked_at=NOW, checks=[check])
    body = health.model_dump(mode="json")
    assert body["checks"][0]["months"] == ["2026-09-01"]
    assert body["checks"][0]["fix"]["to"] is None
    with pytest.raises(ValidationError):
        HealthCheckOut(id="x", severity="loud", title="t", detail="d")


def test_backup_status_parses_old_and_new_markers():
    old = BackupStatusOut.model_validate(
        {
            "last_success_at": "2026-08-25T09:10:11Z",
            "object_key": "backups/f.sql.gz",
            "size": "1.2M",
        }
    )
    assert old.verified is None and old.size_bytes is None and old.encrypted is None
    new = BackupStatusOut.model_validate(
        {
            "last_success_at": "2026-09-04T03:00:12Z",
            "object_key": "backups/finance_2026-09-04.sql.gz.gpg",
            "size": "108K",
            "size_bytes": 110592,
            "encrypted": True,
            "retention_days": 30,
            "verified": True,
            "verified_at": "2026-09-04T03:00:40Z",
            "row_counts": {
                "net_worth_snapshots": 33,
                "monthly_spending": 621,
                "position_transactions": 210,
            },
        }
    )
    assert new.verified is True and new.row_counts["monthly_spending"] == 621
    failed = BackupStatusOut.model_validate(
        {
            "last_success_at": "2026-09-04T03:00:12Z",
            "object_key": "k",
            "size": "108K",
            "verified": False,
            "verify_error": "row count mismatch: monthly_spending 621 != 600",
        }
    )
    assert failed.verified is False and failed.verify_error.startswith("row count")
    run = BackupRunOut.model_validate(
        {"at": "2026-09-04T03:00:12Z", "ok": True, "object": "k", "verified": True}
    )
    assert run.verified is True
    assert BackupRunOut.model_validate({"at": "2026-09-04T03:00:12Z", "ok": True}).verified is None


def test_upsert_results_carry_an_optional_batch_id():
    month = MonthUpsertResult(
        month="2026-09-01", snapshot_created=False, created=0, updated=1, unchanged=3
    )
    assert month.batch_id is None
    spend = SpendingUpsertResult(
        month="2026-09-01", created=0, updated=0, unchanged=3, net_pay_set=False
    )
    assert spend.model_dump(mode="json")["batch_id"] is None
    assert (
        MonthUpsertResult(
            month="2026-09-01",
            snapshot_created=False,
            created=0,
            updated=1,
            unchanged=3,
            batch_id=uuid4(),
        ).batch_id
        is not None
    )
