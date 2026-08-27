"""Household API (2026-08-26 spec §5.1): the people registry every owner column points at.

Every test seeds its own primary member: migration f3a91c7e2b45 seeds one on deployed
databases, but this test database is built by Base.metadata.create_all, which never runs
migrations."""

from app.models import AppSetting, Person

HOUSEHOLD = "/api/v1/household"


async def _seed_primary(db) -> Person:
    person = Person(name="Me", is_primary=True)
    db.add(person)
    await db.commit()
    return person


async def test_household_requires_auth(client):
    assert (await client.get(HOUSEHOLD)).status_code == 401


async def test_get_returns_the_people_and_a_null_marriage_date(auth_client, db):
    person = await _seed_primary(db)
    resp = await auth_client.get(HOUSEHOLD)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "people": [{"id": person.id, "name": "Me", "is_primary": True}],
        "marriage_date": None,
    }


async def test_get_on_an_empty_registry_still_answers(auth_client):
    # A GET never rejects the state it finds: an unseeded database is an empty household,
    # not a 500.
    assert (await auth_client.get(HOUSEHOLD)).json() == {"people": [], "marriage_date": None}


async def test_post_person_creates_a_non_primary_member(auth_client, db):
    await _seed_primary(db)
    resp = await auth_client.post(f"{HOUSEHOLD}/people", json={"name": "  Partner  "})
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "Partner"  # stored stripped
    # NEVER primary: the seeded row owns that flag for the life of the database, and a
    # second TRUE would surface ux_people_single_primary as an opaque IntegrityError 500.
    assert created["is_primary"] is False

    people = (await auth_client.get(HOUSEHOLD)).json()["people"]
    # Primary first, then by id — the owner selects downstream want "Me" at the top.
    assert [p["name"] for p in people] == ["Me", "Partner"]


async def test_post_person_409s_on_a_duplicate_name(auth_client, db):
    await _seed_primary(db)
    first = await auth_client.post(f"{HOUSEHOLD}/people", json={"name": "Partner"})
    assert first.status_code == 201
    dup = await auth_client.post(f"{HOUSEHOLD}/people", json={"name": "Partner"})
    assert dup.status_code == 409


async def test_post_person_422s_on_a_blank_name(auth_client):
    # Pydantic catches "" at min_length; the router catches whitespace-only, which would
    # otherwise store a display name nothing can render.
    assert (await auth_client.post(f"{HOUSEHOLD}/people", json={"name": ""})).status_code == 422
    assert (await auth_client.post(f"{HOUSEHOLD}/people", json={"name": "   "})).status_code == 422


async def test_patch_person_renames_and_leaves_is_primary_alone(auth_client, db):
    person = await _seed_primary(db)
    resp = await auth_client.patch(
        f"{HOUSEHOLD}/people/{person.id}", json={"name": "Ed", "is_primary": False}
    )
    assert resp.status_code == 200, resp.text
    # is_primary is not on the schema at all, so a body carrying it is IGNORED rather than
    # refused — the invariant is the database's job, not a request's.
    assert resp.json() == {"id": person.id, "name": "Ed", "is_primary": True}


async def test_patch_person_404_409_and_blank(auth_client, db):
    person = await _seed_primary(db)
    assert (
        await auth_client.patch(f"{HOUSEHOLD}/people/999", json={"name": "X"})
    ).status_code == 404
    partner = (await auth_client.post(f"{HOUSEHOLD}/people", json={"name": "Partner"})).json()
    clash = await auth_client.patch(f"{HOUSEHOLD}/people/{partner['id']}", json={"name": "Me"})
    assert clash.status_code == 409
    blank = await auth_client.patch(f"{HOUSEHOLD}/people/{person.id}", json={"name": "  "})
    assert blank.status_code == 422


async def test_there_is_no_person_delete_route(auth_client, db):
    person = await _seed_primary(db)
    # Not 204, not 409 — the route does not exist (spec §5.1). Rows here are referenced by
    # accounts, and "remove a household member" is not something this app models.
    assert (await auth_client.delete(f"{HOUSEHOLD}/people/{person.id}")).status_code == 405


async def test_marriage_date_round_trips_through_its_own_key(auth_client, db):
    resp = await auth_client.put(f"{HOUSEHOLD}/marriage-date", json={"marriage_date": "2026-09-19"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"marriage_date": "2026-09-19"}
    assert (await auth_client.get(HOUSEHOLD)).json()["marriage_date"] == "2026-09-19"
    # The readers' envelope, under a key of its OWN — not a fourth field on the legacy
    # three-field settings PUT, where a new key silently drops unless the schema, the
    # router loop and SettingsPage's boxesFor all learn about it together (audit §2.2).
    assert (await db.get(AppSetting, "marriage_date")).value == {"value": "2026-09-19"}


async def test_marriage_date_is_untouched_by_the_settings_put(auth_client):
    await auth_client.put(f"{HOUSEHOLD}/marriage-date", json={"marriage_date": "2026-09-19"})
    saved = await auth_client.put(
        "/api/v1/settings",
        json={
            "swr_pct": "0.045",
            "espp_ticker": "nvda",
            "price_refresh_cron": "10 13 * * mon-fri",
        },
    )
    assert saved.status_code == 200, saved.text
    # The whole point of the separate key: a full-form settings save must not be able to
    # clear household config it has never heard of.
    assert (await auth_client.get(HOUSEHOLD)).json()["marriage_date"] == "2026-09-19"


async def test_marriage_date_explicit_null_clears_it(auth_client):
    await auth_client.put(f"{HOUSEHOLD}/marriage-date", json={"marriage_date": "2026-09-19"})
    resp = await auth_client.put(f"{HOUSEHOLD}/marriage-date", json={"marriage_date": None})
    assert resp.status_code == 200
    assert resp.json() == {"marriage_date": None}
    assert (await auth_client.get(HOUSEHOLD)).json()["marriage_date"] is None


async def test_marriage_date_rejects_an_absurd_year(auth_client):
    bad = await auth_client.put(f"{HOUSEHOLD}/marriage-date", json={"marriage_date": "1026-09-19"})
    assert bad.status_code == 422
    # Nothing was written: validation runs before the get-then-set.
    assert (await auth_client.get(HOUSEHOLD)).json()["marriage_date"] is None


async def test_marriage_date_reader_treats_a_malformed_blob_as_absent(auth_client, db):
    db.add(AppSetting(key="marriage_date", value={"value": "not-a-date"}))
    await db.commit()
    # A GET never rejects stored data (house rule): malformed == absent, never a 500.
    assert (await auth_client.get(HOUSEHOLD)).json()["marriage_date"] is None
