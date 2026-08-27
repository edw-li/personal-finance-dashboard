"""Household API (2026-08-26 spec §5.1): the people registry every owner column points at.

Every test seeds its own primary member: migration f3a91c7e2b45 seeds one on deployed
databases, but this test database is built by Base.metadata.create_all, which never runs
migrations."""

from app.models import Person

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
