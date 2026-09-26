"""The paycheck router's profile writes are change-logged (2026-09-25 polish spec §6.1, lane
L3b): each create, edit and delete is one batch with an Activity label naming whose profile it
is and the X-Change-Batch header, and the Activity card undoes a delete exactly. The transient
`in_force` flag the responses carry is unmapped, so no image ever holds it."""

import pytest

from app.models import PaycheckProfile, Person
from tests.exact_undo import images, label_of, logged, shape, undo
from tests.ordering_helpers import first_position, recorded_sql

PROFILES = "/api/v1/paycheck/profiles"

PROFILE = {
    "effective_date": "2026-08-17",
    "annual_salary": "188930",
    "trad_401k_pct": "0.13",
    "after_tax_401k_pct": "0.03",
    "espp_pct": "0.11",
    "withholding_pct": "0.334009167",
    "dental_vision_per_check": "12.50",
    "hsa_per_check": "100",
    "fed_withholding_pct": "0.22",
    "state_withholding_pct": "0.08",
    "notes": "Aug raise",
}


@pytest.fixture
async def me(db) -> Person:
    """The primary person: `create_all` seeds no roster, and a profile must have an owner."""
    person = Person(name="Edward", is_primary=True)
    db.add(person)
    await db.commit()
    return person


async def test_profile_create_edit_delete_each_log_one_labelled_batch(auth_client, db, me):
    created = await auth_client.post(PROFILES, json=PROFILE)
    assert created.status_code == 201, created.text
    assert created.json()["in_force"] is True  # the transient flag still answers
    rows = await logged(db, created)
    assert shape(rows) == [("insert", "paycheck_profiles")]
    assert label_of(rows) == "Added Edward's paycheck profile effective Aug 17, 2026"
    assert rows[0].after["withholding_pct"] == "0.334009167"
    assert "in_force" not in rows[0].after  # unmapped: never imaged
    profile_id = created.json()["id"]

    edited = await auth_client.patch(f"{PROFILES}/{profile_id}", json={"annual_salary": "195000"})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert shape(rows) == [("update", "paycheck_profiles")]
    assert label_of(rows) == "Edited Edward's paycheck profile effective Aug 17, 2026"
    assert (rows[0].before["annual_salary"], rows[0].after["annual_salary"]) == (
        "188930.00",
        "195000.00",
    )
    assert "in_force" not in rows[0].before and "in_force" not in rows[0].after

    deleted = await auth_client.delete(f"{PROFILES}/{profile_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert shape(rows) == [("delete", "paycheck_profiles")]
    assert label_of(rows) == "Deleted Edward's paycheck profile effective Aug 17, 2026"


async def test_the_label_names_whose_profile_when_two_share_a_date(auth_client, db, me):
    """The effective date is unique per PERSON, so a label without the owner could name two
    rows at once."""
    partner = Person(name="Grace")
    db.add(partner)
    await db.commit()
    partner_id = partner.id
    mine = await auth_client.post(PROFILES, json=PROFILE)
    theirs = await auth_client.post(PROFILES, json={**PROFILE, "person_id": partner_id})
    assert theirs.status_code == 201, theirs.text
    labels = [label_of(await logged(db, response)) for response in (mine, theirs)]
    assert labels == [
        "Added Edward's paycheck profile effective Aug 17, 2026",
        "Added Grace's paycheck profile effective Aug 17, 2026",
    ]


async def test_undo_restores_a_deleted_profile_exactly(auth_client, db, me):
    profile_id = (await auth_client.post(PROFILES, json=PROFILE)).json()["id"]
    before = await images(db, PaycheckProfile)
    deleted = await auth_client.delete(f"{PROFILES}/{profile_id}")
    assert await images(db, PaycheckProfile) == []
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == (
        "Undid: Deleted Edward's paycheck profile effective Aug 17, 2026"
    )
    assert await images(db, PaycheckProfile) == before
    listed = (await auth_client.get(PROFILES)).json()
    assert [(profile["id"], profile["in_force"]) for profile in listed] == [(profile_id, True)]


async def test_the_undo_of_a_profile_takes_the_review_input_locks_first(auth_client, db, me):
    """paycheck_profiles is a month-review input (services.month_review.REVIEW_INPUT_TABLES), so
    its Undo takes the review tables' SHARE ROW EXCLUSIVE locks — the month save's own — before
    it reads whether the batch may still be undone, and before it writes."""
    profile_id = (await auth_client.post(PROFILES, json=PROFILE)).json()["id"]
    deleted = await auth_client.delete(f"{PROFILES}/{profile_id}")
    with recorded_sql(db) as statements:
        resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    lock = first_position(statements, "LOCK TABLE")
    assert "paycheck_profiles" in statements[lock][0]
    assert statements[lock][0].endswith("IN SHARE ROW EXCLUSIVE MODE")
    assert lock < first_position(statements, "FROM lifecycle_runs")  # the eligibility reads
    assert lock < first_position(statements, "INSERT INTO paycheck_profiles")
