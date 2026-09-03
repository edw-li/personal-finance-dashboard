import io
import json
import zipfile
from datetime import datetime

from sqlalchemy import select

from app.models import User, UserPreference
from app.security import hash_password

PREFS = "/api/v1/prefs"


async def test_prefs_require_auth(client):
    assert (await client.get(PREFS)).status_code == 401
    assert (await client.patch(PREFS, json={"theme": "dark"})).status_code == 401
    assert (await client.delete(f"{PREFS}/theme")).status_code == 401


async def test_prefs_start_empty_and_patch_partially(auth_client):
    assert (await auth_client.get(PREFS)).json() == {"prefs": {}}
    resp = await auth_client.patch(
        PREFS, json={"theme": "light", "scope": {"owner": "joint", "range": "ytd"}}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()["prefs"]
    assert set(body) == {"theme", "scope"}
    assert body["theme"]["value"] == "light"
    assert body["scope"]["value"] == {"owner": "joint", "range": "ytd"}
    first_stamp = datetime.fromisoformat(body["theme"]["updated_at"])
    # A later partial PATCH touches only its key — and only that key's updated_at moves.
    again = (await auth_client.patch(PREFS, json={"density": "compact"})).json()["prefs"]
    assert set(again) == {"theme", "scope", "density"}
    assert datetime.fromisoformat(again["theme"]["updated_at"]) == first_stamp
    bumped = (await auth_client.patch(PREFS, json={"theme": "system"})).json()["prefs"]
    assert bumped["theme"]["value"] == "system"
    assert datetime.fromisoformat(bumped["theme"]["updated_at"]) >= first_stamp
    assert (await auth_client.get(PREFS)).json()["prefs"] == bumped


async def test_patch_validates_every_key_before_writing_any(auth_client):
    resp = await auth_client.patch(PREFS, json={"theme": "light", "currency_style": "compact"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Unknown preference `currency_style`"
    bad = await auth_client.patch(PREFS, json={"theme": "light", "landing_page": "/nope"})
    assert bad.status_code == 422
    assert bad.json()["detail"].startswith("landing_page: must be one of /, /update")
    assert (await auth_client.get(PREFS)).json() == {"prefs": {}}  # nothing was written
    empty = await auth_client.patch(PREFS, json={})
    assert empty.status_code == 422 and empty.json()["detail"] == "Send at least one preference"


async def test_delete_resets_a_key_and_ignores_an_unset_one(auth_client, db, seeded_user):
    await auth_client.patch(PREFS, json={"landing_page": "/net-worth", "theme": "light"})
    assert (await auth_client.delete(f"{PREFS}/landing_page")).status_code == 204
    assert set((await auth_client.get(PREFS)).json()["prefs"]) == {"theme"}
    assert (await auth_client.delete(f"{PREFS}/landing_page")).status_code == 204  # idempotent
    unknown = await auth_client.delete(f"{PREFS}/currency_style")
    assert unknown.status_code == 422
    assert unknown.json()["detail"] == "Unknown preference `currency_style`"
    rows = (await db.execute(select(UserPreference))).scalars().all()
    assert [(r.user_id, r.key) for r in rows] == [(seeded_user.id, "theme")]


async def test_rows_are_per_user(auth_client, db, seeded_user):
    other = User(email="other@example.com", password_hash=hash_password("correct-horse"))
    db.add(other)
    await db.flush()
    db.add(UserPreference(user_id=other.id, key="theme", value="system"))
    await db.commit()
    await auth_client.patch(PREFS, json={"theme": "light"})
    assert (await auth_client.get(PREFS)).json()["prefs"]["theme"]["value"] == "light"
    rows = (
        (await db.execute(select(UserPreference).order_by(UserPreference.user_id))).scalars().all()
    )
    assert [(r.user_id, r.value) for r in rows] == [(seeded_user.id, "light"), (other.id, "system")]


async def test_unregistered_rows_are_not_served(auth_client, db, seeded_user):
    db.add(UserPreference(user_id=seeded_user.id, key="retired_key", value=1))
    db.add(UserPreference(user_id=seeded_user.id, key="theme", value="dark"))
    await db.commit()
    assert set((await auth_client.get(PREFS)).json()["prefs"]) == {"theme"}


async def test_preferences_ride_the_export(auth_client, seeded_user):
    # Read the id BEFORE the export: /export/snapshot ROLLS BACK the shared test session
    # when it is done, which expires every ORM object in it, and refreshing an expired
    # attribute from sync test code is SQLAlchemy's MissingGreenlet trap (the same fix as
    # the restore trail's "actor id read before the export's rollback").
    user_id = seeded_user.id
    await auth_client.patch(PREFS, json={"theme": "light"})
    resp = await auth_client.get("/api/v1/export/snapshot")
    archive = zipfile.ZipFile(io.BytesIO(resp.content))
    nested = json.loads(archive.read("finance-export.json"))
    rows = nested["tables"]["user_preferences"]
    assert len(rows) == 1 and rows[0]["key"] == "theme" and rows[0]["value"] == "light"
    assert rows[0]["user_id"] == user_id
