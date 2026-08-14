from sqlalchemy import func, select

from app.models import Security
from tests.workbook_builder import build_workbook


def _upload(data: bytes):
    return {"file": ("workbook.xlsx", data, "application/octet-stream")}


async def test_import_requires_auth(client):
    resp = await client.post("/api/v1/import/xlsx", files=_upload(b"whatever"))
    assert resp.status_code == 401


async def test_import_dry_run_is_the_default(auth_client, db):
    resp = await auth_client.post("/api/v1/import/xlsx", files=_upload(build_workbook()))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dry_run"] is True and body["applied"] is False
    assert body["sheets"]["net_worth"]["entities"]["accounts"]["creates"] == 3
    count = (await db.execute(select(func.count()).select_from(Security))).scalar_one()
    assert count == 0  # dry run wrote nothing


async def test_import_apply_writes_and_reports(auth_client, db):
    resp = await auth_client.post(
        "/api/v1/import/xlsx?dry_run=false", files=_upload(build_workbook())
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied"] is True
    count = (await db.execute(select(func.count()).select_from(Security))).scalar_one()
    assert count == 4


async def test_import_rejects_non_xlsx(auth_client):
    resp = await auth_client.post("/api/v1/import/xlsx", files=_upload(b"not a zip"))
    assert resp.status_code == 400


async def test_import_rejects_oversize_upload(auth_client):
    blob = b"x" * (15 * 1024 * 1024 + 1)
    resp = await auth_client.post("/api/v1/import/xlsx", files=_upload(blob))
    assert resp.status_code == 413
