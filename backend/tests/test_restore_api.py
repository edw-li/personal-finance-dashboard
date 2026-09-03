from datetime import datetime

from sqlalchemy import func, select

from app.models import Account, LifecycleRun
from app.services.snapshot import build_snapshot_zip, snapshots_dir
from tests.test_restore import rezip

UPLOAD = "/api/v1/import/snapshot"
STORED = "/api/v1/import/snapshot/stored"


def upload(payload: bytes, name: str = "finance-export.zip"):
    return {"file": (name, payload, "application/zip")}


async def count_accounts(db) -> int:
    return (await db.execute(select(func.count()).select_from(Account))).scalar_one()


async def test_restore_requires_auth(client):
    assert (await client.post(UPLOAD, files=upload(b"x"))).status_code == 401
    assert (await client.post(f"{STORED}/finance-export-20260904-233000.zip")).status_code == 401


async def test_dry_run_is_the_default_and_writes_nothing(auth_client, db):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)
    account = (await db.execute(select(Account))).scalar_one()
    account.sort_order = 5
    await db.commit()

    resp = await auth_client.post(UPLOAD, files=upload(snap.payload))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dry_run"] is True and body["applied"] is False
    assert body["schema"] == {"snapshot_head": None, "server_head": None, "compatible": True}
    assert body["tables"]["accounts"] == {"current": 1, "incoming": 1, "identical": False}
    assert body["restore_point"] is None and body["batch_id"] is None and body["run_id"] is None
    # Pydantic spells a UTC instant with 'Z'; compare instants, not strings.
    assert datetime.fromisoformat(body["exported_at"]) == snap.exported_at
    assert (await db.execute(select(Account))).scalar_one().sort_order == 5
    assert (await db.execute(select(func.count()).select_from(LifecycleRun))).scalar_one() == 0


async def test_apply_restores_and_records(auth_client, db):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)
    account = (await db.execute(select(Account))).scalar_one()
    account.sort_order = 5
    await db.commit()

    resp = await auth_client.post(f"{UPLOAD}?dry_run=false", files=upload(snap.payload, "sep2.zip"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied"] is True and body["restore_point"].startswith("pre-restore-")
    assert (await db.execute(select(Account))).scalar_one().sort_order == 1
    runs = (await db.execute(select(LifecycleRun).order_by(LifecycleRun.id))).scalars().all()
    assert [r.kind for r in runs] == ["restore_point", "restore"]
    assert runs[1].filename == "sep2.zip" and runs[1].actor == "me@example.com"
    assert runs[1].report["applied"] is True
    # The session survives: the same token still works after every exported table moved.
    assert (await auth_client.get("/api/v1/auth/me")).status_code == 200


async def test_the_gates_answer_400_422_409(auth_client, db):
    snap = await build_snapshot_zip(db)
    bad = await auth_client.post(UPLOAD, files=upload(b"not a zip"))
    assert bad.status_code == 400 and bad.json()["detail"] == "Not a snapshot ZIP from this app"

    def drop_people(tables):
        del tables["people"]

    missing = await auth_client.post(
        UPLOAD, files=upload(rezip(snap.payload, tables_patch=drop_people))
    )
    assert missing.status_code == 422 and "missing table(s) people" in missing.json()["detail"]
    foreign = await auth_client.post(
        UPLOAD, files=upload(rezip(snap.payload, manifest_patch={"alembic_head": "b8e4d17c2a90"}))
    )
    assert foreign.status_code == 409
    assert foreign.json()["detail"].startswith(
        "This snapshot was exported at schema `b8e4d17c2a90`; this server runs `none`."
    )
    too_big = await auth_client.post(UPLOAD, files=upload(b"x" * (15 * 1024 * 1024 + 1)))
    assert too_big.status_code == 413


async def test_stored_snapshot_restores_by_name_and_refuses_foreign_names(auth_client, db):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)
    directory = snapshots_dir()
    directory.mkdir(parents=True)
    (directory / "finance-export-20260904-233000.zip").write_bytes(snap.payload)
    (directory / "notes.txt").write_bytes(b"x")
    await db.execute(Account.__table__.delete())
    await db.commit()

    resp = await auth_client.post(f"{STORED}/finance-export-20260904-233000.zip?dry_run=false")
    assert resp.status_code == 200, resp.text
    assert resp.json()["applied"] is True
    assert await count_accounts(db) == 1
    for name in (
        "notes.txt",
        "..%2Ffinance-export-20260904-233000.zip",
        "finance-export-20260904-999999.zip",
    ):
        missing = await auth_client.post(f"{STORED}/{name}")
        assert missing.status_code == 404, name
        assert missing.json()["detail"].startswith("No stored snapshot named")


async def test_a_failure_after_the_restore_point_answers_500_and_changes_nothing(
    auth_client, db, monkeypatch
):
    db.add(Account(name="Keep", slug="keep", group="cash", sort_order=1))
    await db.commit()
    snap = await build_snapshot_zip(db)

    def explode():
        raise RuntimeError("disk on fire")

    monkeypatch.setattr("app.lifecycle.restore._exported_in_fk_order", explode)
    resp = await auth_client.post(f"{UPLOAD}?dry_run=false", files=upload(snap.payload))
    assert resp.status_code == 500
    assert resp.json()["detail"] == "Restore failed and nothing was changed"
    await db.rollback()
    assert await count_accounts(db) == 1
    runs = (await db.execute(select(LifecycleRun))).scalars().all()
    assert [r.kind for r in runs] == ["restore_point"]
