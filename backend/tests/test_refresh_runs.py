"""refresh_runs (2026-08-31 spec §B3): record_refresh_run keeps a last-10 trail alongside
the last_refresh blob — newest first, trimmed at write, self-healing over garbage."""

from datetime import UTC, datetime

from app.models import AppSetting
from app.services.price_service import (
    REFRESH_RUNS_KEY,
    RefreshResult,
    record_refresh_run,
)


async def test_record_refresh_run_appends_newest_first_and_trims_at_ten(db):
    for i in range(12):
        await record_refresh_run(
            db,
            RefreshResult(updated=["VOO"] * i, failed={"ZI": "delisted"} if i % 2 else {}),
            trigger="scheduled" if i % 2 else "manual",
            history_appended=False,
            at=datetime(2026, 8, 1, 12, 0, i, tzinfo=UTC),
        )
        await db.commit()
    setting = await db.get(AppSetting, REFRESH_RUNS_KEY)
    runs = setting.value["value"]  # the Python writers' envelope, like last_refresh
    assert len(runs) == 10
    # Newest first: the 12th write (i=11) leads; the two oldest fell off the end.
    assert runs[0] == {
        "at": "2026-08-01T12:00:11+00:00",
        "trigger": "scheduled",
        "updated": 11,
        "failed_count": 1,
    }
    assert runs[9]["at"] == "2026-08-01T12:00:02+00:00"


async def test_record_refresh_run_starts_fresh_over_a_garbage_runs_row(db):
    db.add(AppSetting(key=REFRESH_RUNS_KEY, value={"value": "not-a-list"}))
    await db.commit()
    await record_refresh_run(
        db,
        RefreshResult(updated=["VOO"]),
        trigger="manual",
        history_appended=False,
        at=datetime(2026, 8, 2, 9, 0, 0, tzinfo=UTC),
    )
    await db.commit()
    setting = await db.get(AppSetting, REFRESH_RUNS_KEY)
    assert setting.value == {
        "value": [
            {
                "at": "2026-08-02T09:00:00+00:00",
                "trigger": "manual",
                "updated": 1,
                "failed_count": 0,
            }
        ]
    }


async def test_record_refresh_run_skips_non_dict_items_when_appending(db):
    db.add(AppSetting(key=REFRESH_RUNS_KEY, value={"value": ["garbage", 42]}))
    await db.commit()
    await record_refresh_run(
        db,
        RefreshResult(),
        trigger="manual",
        history_appended=False,
        at=datetime(2026, 8, 3, 9, 0, 0, tzinfo=UTC),
    )
    await db.commit()
    setting = await db.get(AppSetting, REFRESH_RUNS_KEY)
    assert setting.value["value"] == [
        {"at": "2026-08-03T09:00:00+00:00", "trigger": "manual", "updated": 0, "failed_count": 0}
    ]
