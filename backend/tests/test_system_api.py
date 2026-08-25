from datetime import UTC, datetime

from sqlalchemy import text

from app.config import settings
from app.models import AppSetting
from app.services.price_service import LAST_REFRESH_KEY

STATUS = "/api/v1/system/status"
PRICES_STATUS = "/api/v1/prices/refresh-status"

# A stored refresh outcome in record_refresh_run's exact envelope-and-payload shape.
LAST_RUN = {
    "at": "2026-08-24T20:11:00+00:00",
    "trigger": "scheduled",
    "updated": 36,
    "failed": {},
    "skipped_manual": 1,
    "history_appended": True,
    "dividends_ingested": 0,
    "dividends_removed": 0,
    "dividends_skipped_overlap": 0,
}


async def test_system_status_requires_auth(client):
    assert (await client.get(STATUS)).status_code == 401


async def test_system_status_shape_on_a_bare_database(auth_client):
    resp = await auth_client.get(STATUS)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # prices: the refresh-status shape verbatim plus the scheduler flag — False here
    # because conftest pins scheduler_enabled off and ASGITransport never runs the
    # lifespan, so no handle ever exists in tests.
    assert body["prices"] == {"last": None, "next_run_at": None, "scheduler_running": False}
    assert isinstance(body["database"]["size_bytes"], int)
    assert body["database"]["size_bytes"] > 0
    # The test schema is create_all-built — no alembic_version table — and the GET reads
    # that as None rather than 500ing (the missing-table posture; GETs never reject).
    assert body["database"]["alembic_head"] is None
    assert body["backup"] is None
    # The dev box's settings (config default). The prod passthrough is pinned below with
    # a monkeypatch, so this is the literal value, not a tautological echo.
    assert body["environment"] == "dev"


async def test_system_prices_matches_the_old_endpoint_which_stands(auth_client, db):
    db.add(AppSetting(key=LAST_REFRESH_KEY, value={"value": LAST_RUN}))
    await db.commit()
    old = (await auth_client.get(PRICES_STATUS)).json()
    new = (await auth_client.get(STATUS)).json()["prices"]
    # One composition, two doors: strip the one addition and the payloads are identical —
    # any drift between them is a bug in the Task 2 extraction, not a formatting choice.
    assert new.pop("scheduler_running") is False
    assert new == old
    assert old["last"]["updated"] == 36  # the stored record actually flowed through both


async def test_system_status_reads_the_alembic_head_when_the_table_exists(auth_client, db):
    # Prod databases are alembic-built; the test schema is not, so stage the table by
    # hand — and DROP it before leaving, because conftest's TRUNCATE walks
    # Base.metadata.sorted_tables and would never clean a stray table out of the
    # session-scoped schema (it would leak into every later test).
    await db.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
    await db.execute(text("INSERT INTO alembic_version VALUES ('e7c5a9f4b2d8')"))
    await db.commit()
    try:
        body = (await auth_client.get(STATUS)).json()
        assert body["database"]["alembic_head"] == "e7c5a9f4b2d8"
        # A present-but-empty table must read as None too (the schemas docstring's claim).
        await db.execute(text("DELETE FROM alembic_version"))
        await db.commit()
        body = (await auth_client.get(STATUS)).json()
        assert body["database"]["alembic_head"] is None
    finally:
        # A failing GET above would leave the SHARED session in an aborted transaction;
        # without this rollback the DROP itself raises and the stray table outlives
        # drop_all/TRUNCATE forever (neither walks non-metadata tables).
        await db.rollback()
        await db.execute(text("DROP TABLE alembic_version"))
        await db.commit()


async def test_system_backup_marker_roundtrip(auth_client, db):
    # The exact FLAT shape backup_db.sh upserts (spec §3) — no {"value": ...} envelope.
    db.add(
        AppSetting(
            key="backup_status",
            value={
                "last_success_at": "2026-08-25T09:10:11Z",
                "object_key": "backups/finance_2026-08-25.sql.gz",
                "size": "1.2M",
            },
        )
    )
    await db.commit()
    backup = (await auth_client.get(STATUS)).json()["backup"]
    assert backup["object_key"] == "backups/finance_2026-08-25.sql.gz"
    assert backup["size"] == "1.2M"
    # Compared as instants, not strings: pydantic may re-spell the zone ('Z' vs '+00:00').
    assert datetime.fromisoformat(backup["last_success_at"]) == datetime(
        2026, 8, 25, 9, 10, 11, tzinfo=UTC
    )


async def test_system_backup_malformed_rows_read_as_none(auth_client, db):
    # Wrong keys, the accidental {"value": ...} envelope, and a non-dict: each is "no
    # backup recorded", never a 500 — the marker is written by a shell script and the
    # GET must survive whatever it managed to store.
    for value in (
        {"uploaded": "yesterday"},
        {"value": {"last_success_at": "2026-08-25T09:10:11Z", "object_key": "k", "size": "1M"}},
        ["not", "a", "dict"],
    ):
        setting = await db.get(AppSetting, "backup_status")
        if setting is None:
            db.add(AppSetting(key="backup_status", value=value))
        else:
            setting.value = value
        await db.commit()
        resp = await auth_client.get(STATUS)
        assert resp.status_code == 200, resp.text
        assert resp.json()["backup"] is None


async def test_system_environment_passes_through_prod(auth_client, monkeypatch):
    # settings is the module-level singleton and the endpoint reads it per-request, so a
    # patched attribute is what the response reports (conftest mutates the same object).
    monkeypatch.setattr(settings, "environment", "prod")
    assert (await auth_client.get(STATUS)).json()["environment"] == "prod"


async def test_system_scheduler_flag_reads_the_live_handle(auth_client, monkeypatch):
    monkeypatch.setattr("app.api.system.is_scheduler_running", lambda: True)
    assert (await auth_client.get(STATUS)).json()["prices"]["scheduler_running"] is True
