"""Export vertical (2026-08-31 tier-1 spec §B1): the ZIP's exact shape, the per-type
serialization spellings, and the pin that makes a NEW table fail the suite until it is
consciously listed in EXPORTED_TABLES or named in EXCLUDED_TABLES."""

import io
import json
import re
import zipfile
from datetime import date
from decimal import Decimal

from app.database import Base
from app.models import Account, AccountBalance, AppSetting, NetWorthSnapshot
from app.services.snapshot import (
    EXCLUDED_TABLES,
    EXPORTED_TABLES,
    REDACTED_ROWS,
    build_snapshot_zip,
)

EXPORT = "/api/v1/export/snapshot"


def test_export_list_pins_every_metadata_table():
    exported_names = [table for _, table in EXPORTED_TABLES]
    assert len(exported_names) == len(set(exported_names)), "duplicate table in EXPORTED_TABLES"
    for model, table_name in EXPORTED_TABLES:
        assert model.__tablename__ == table_name, f"{model.__name__} is not {table_name!r}"
    assert set(exported_names) & EXCLUDED_TABLES == set()
    # THE PIN: every Base.metadata table is either exported or a NAMED exclusion. A new
    # model lands here red until someone decides which — that decision is the feature.
    # (alembic_version is not a metadata table; the manifest carries the head instead.)
    assert set(exported_names) | EXCLUDED_TABLES == set(Base.metadata.tables)
    # THE REDACTION PIN: a typo'd table name would silently redact NOTHING while the
    # manifest still advertised the redaction, and a table without the `key` column the
    # filter reads would AttributeError mid-request. Both are structural, so pin both.
    models_by_table = {table: model for model, table in EXPORTED_TABLES}
    for table_name in REDACTED_ROWS:
        assert table_name in models_by_table, f"{table_name!r} is redacted but never exported"
        assert "key" in models_by_table[table_name].__table__.columns, (
            f"{table_name!r} has no `key` column — the row filter reads row.key"
        )


async def test_export_requires_auth(client):
    assert (await client.get(EXPORT)).status_code == 401


async def test_export_zip_carries_manifest_every_csv_and_the_json(auth_client):
    resp = await auth_client.get(EXPORT)
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/zip"
    assert re.fullmatch(
        r'attachment; filename="finance-export-\d{8}-\d{4}\.zip"',
        resp.headers["content-disposition"],
    ), resp.headers["content-disposition"]
    archive = zipfile.ZipFile(io.BytesIO(resp.content))
    names = set(archive.namelist())
    assert "manifest.json" in names
    assert "finance-export.json" in names
    for _, table_name in EXPORTED_TABLES:
        assert f"csv/{table_name}.csv" in names
    assert len(names) == len(EXPORTED_TABLES) + 2  # nothing extra rides along
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["environment"] == "dev"
    assert manifest["alembic_head"] is None  # create_all-built test schema (system.py's rule)
    # Row counts cover every listed table — all zero on a database holding only the user.
    assert manifest["tables"] == {table: 0 for _, table in EXPORTED_TABLES}
    nested = json.loads(archive.read("finance-export.json"))
    assert nested["tables"] == {table: [] for _, table in EXPORTED_TABLES}
    assert nested["exported_at"] == manifest["exported_at"]
    assert nested["alembic_head"] is None


async def test_export_rows_round_trip_with_pinned_formats(auth_client, db):
    snapshot = NetWorthSnapshot(month=date(2026, 5, 1), recorded_on=date(2026, 5, 3), notes=None)
    account = Account(name="Café Fund", slug="cafe-fund", group="cash", sort_order=2)
    db.add_all([snapshot, account])
    await db.flush()
    db.add(
        AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("1234.50"))
    )
    db.add(AppSetting(key="swr_pct", value={"value": "0.04"}))
    await db.commit()

    resp = await auth_client.get(EXPORT)
    assert resp.status_code == 200, resp.text
    archive = zipfile.ZipFile(io.BytesIO(resp.content))

    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["tables"]["accounts"] == 1
    assert manifest["tables"]["account_balances"] == 1
    assert manifest["tables"]["app_settings"] == 1

    # CSV: header is the MODEL-DEFINITION column order; NULL is the EMPTY cell; booleans
    # are lowercase true/false; non-ASCII text survives the utf-8 round trip byte-exact.
    accounts_csv = archive.read("csv/accounts.csv").decode("utf-8").splitlines()
    assert accounts_csv[0] == (
        "id,name,slug,group,sort_order,is_active,is_component,parent_account_id,person_id"
    )
    assert accounts_csv[1] == f"{account.id},Café Fund,cafe-fund,cash,2,true,false,,"

    balances_csv = archive.read("csv/account_balances.csv").decode("utf-8").splitlines()
    assert balances_csv[0] == "id,snapshot_id,account_id,balance"
    assert balances_csv[1].endswith(",1234.50")  # Decimal as a plain string, never exponents

    snapshots_csv = archive.read("csv/net_worth_snapshots.csv").decode("utf-8").splitlines()
    assert snapshots_csv[1].split(",")[1] == "2026-05-01"  # dates ISO

    # JSONB: compact JSON inside the CSV cell (csv doubles the quotes), native in the JSON.
    settings_csv = archive.read("csv/app_settings.csv").decode("utf-8").splitlines()
    assert settings_csv[1] == 'swr_pct,"{""value"":""0.04""}"'

    nested = json.loads(archive.read("finance-export.json"))
    assert nested["tables"]["accounts"] == [
        {
            "id": account.id,
            "name": "Café Fund",
            "slug": "cafe-fund",
            "group": "cash",
            "sort_order": 2,
            "is_active": True,
            "is_component": False,
            "parent_account_id": None,
            "person_id": None,
        }
    ]
    assert nested["tables"]["account_balances"][0]["balance"] == "1234.50"
    assert nested["tables"]["net_worth_snapshots"][0]["month"] == "2026-05-01"
    assert nested["tables"]["app_settings"] == [{"key": "swr_pct", "value": {"value": "0.04"}}]


async def test_export_redacts_the_nvidia_api_key_row(auth_client, db):
    """The assistant key (spec 2026-09-01 §3) must not ride into every backup ZIP — while
    its app_settings siblings still export: the redaction is per-ROW, not per-table."""
    db.add(AppSetting(key="nvidia_api_key", value={"value": "nvapi-SECRET"}))
    db.add(AppSetting(key="assistant_default_model", value={"value": "kimi-k3"}))
    await db.commit()

    resp = await auth_client.get(EXPORT)
    assert resp.status_code == 200, resp.text
    raw = resp.content
    # Cheap outer net only: the members are DEFLATE-compressed, so this catches a
    # regression that stored them uncompressed and nothing else. The decompressed-member
    # assertions below are the real proof.
    assert b"nvapi-SECRET" not in raw
    archive = zipfile.ZipFile(io.BytesIO(raw))

    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["redactions"] == ["app_settings.nvidia_api_key"]
    assert manifest["tables"]["app_settings"] == 1  # the count is the EXPORTED rows

    # CSV and JSON alike — both serializations read the one filtered `rows` list, so the
    # secret is absent from the decompressed members too, not merely from the ZIP bytes.
    csv_text = archive.read("csv/app_settings.csv").decode("utf-8")
    assert "assistant_default_model" in csv_text  # its sibling row still exports
    assert "nvidia_api_key" not in csv_text
    assert "nvapi-SECRET" not in csv_text

    nested = json.loads(archive.read("finance-export.json"))
    assert nested["tables"]["app_settings"] == [
        {"key": "assistant_default_model", "value": {"value": "kimi-k3"}}
    ]


def test_export_pins_the_lifecycle_decisions():
    # The three operational tables are NAMED exclusions with a reason (spec §6): a restore
    # must be recorded in them, not replaced by them. Preferences are user data and export.
    assert EXCLUDED_TABLES == frozenset({"users", "change_log", "lifecycle_runs"})
    assert "user_preferences" in {table for _, table in EXPORTED_TABLES}


async def test_service_and_endpoint_build_the_same_archive(auth_client, db):
    # The extraction (spec §12 Phase 0) must be byte-identical below the timestamp: every
    # CSV member equal, the manifest equal once exported_at is set aside, same member list.
    account = Account(name="Café Fund", slug="cafe-fund", group="cash", sort_order=2)
    db.add(account)
    db.add(AppSetting(key="swr_pct", value={"value": "0.04"}))
    await db.commit()
    built = await build_snapshot_zip(db)
    resp = await auth_client.get(EXPORT)
    assert resp.status_code == 200, resp.text
    ours = zipfile.ZipFile(io.BytesIO(built.payload))
    theirs = zipfile.ZipFile(io.BytesIO(resp.content))
    assert ours.namelist() == theirs.namelist()
    for name in ours.namelist():
        if name.startswith("csv/"):
            assert ours.read(name) == theirs.read(name), name
    manifest_a = json.loads(ours.read("manifest.json"))
    manifest_b = json.loads(theirs.read("manifest.json"))
    manifest_a.pop("exported_at")
    manifest_b.pop("exported_at")
    assert manifest_a == manifest_b
    assert built.counts["accounts"] == 1 and built.counts["app_settings"] == 1
    assert re.fullmatch(r"finance-export-\d{8}-\d{4}\.zip", built.filename)
