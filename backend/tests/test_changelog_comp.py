"""The comp router's writes are change-logged (2026-09-25 polish spec §6.1, lane L3b): every
focal-event and RSU-grant create, edit and delete is one batch with an Activity label and the
X-Change-Batch header, and the Activity card undoes a delete exactly — same id, same row."""

from app.models import CompEvent, RsuGrant
from app.services.changelog import REPLAY_REFUSAL
from tests.changelog_asserts import label_of, logged, ops, table_rows, undo

EVENTS = "/api/v1/comp/events"
GRANTS = "/api/v1/comp/rsu-grants"

EVENT = {
    "focal_year": 2025,
    "current_base": "162000",
    "new_base": "175000",
    "unvested_rsus": "1822",
    "unvested_price": "183.2508",
    "refresh_rsus": "610.0524",
    "grant_price": "129.5651",
    "notes": "mid-cycle focal",
}
GRANT = {
    "kind": "refresh",
    "label": "2025 focal",
    "focal_year": 2025,
    "shares": 480,
    "grant_price": "129.5651",
    "first_vest_date": "2025-06-18",
    "cliff_pct": "0.0625",
    "notes": "refresh grant",
}


async def test_comp_event_create_edit_delete_each_log_one_labelled_batch(auth_client, db):
    created = await auth_client.post(EVENTS, json=EVENT)
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "comp_events")]
    assert label_of(rows) == "Added the 2025 comp event"
    assert rows[0].after["current_base"] == "162000.00"
    event_id = created.json()["id"]

    edited = await auth_client.patch(f"{EVENTS}/{event_id}", json={"new_base": "180000"})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "comp_events")]
    assert label_of(rows) == "Edited the 2025 comp event"
    assert (rows[0].before["new_base"], rows[0].after["new_base"]) == ("175000.00", "180000.00")

    deleted = await auth_client.delete(f"{EVENTS}/{event_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "comp_events")]
    assert label_of(rows) == "Deleted the 2025 comp event"
    assert rows[0].before["focal_year"] == 2025 and rows[0].after is None


async def test_an_unchanged_comp_event_edit_logs_nothing_and_names_no_batch(auth_client):
    event_id = (await auth_client.post(EVENTS, json=EVENT)).json()["id"]
    same = await auth_client.patch(f"{EVENTS}/{event_id}", json={"new_base": "175000.00"})
    assert same.status_code == 200, same.text
    assert "x-change-batch" not in same.headers  # the client offers no Undo for a no-op


async def test_undo_restores_a_deleted_comp_event_exactly(auth_client, db):
    event_id = (await auth_client.post(EVENTS, json=EVENT)).json()["id"]
    before = await table_rows(db, CompEvent)
    deleted = await auth_client.delete(f"{EVENTS}/{event_id}")
    assert await table_rows(db, CompEvent) == {"comp_events": []}
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == "Undid: Deleted the 2025 comp event"
    assert await table_rows(db, CompEvent) == before


async def test_rsu_grant_create_edit_delete_each_log_one_labelled_batch(auth_client, db):
    created = await auth_client.post(GRANTS, json=GRANT)
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "rsu_grants")]
    assert label_of(rows) == "Added RSU grant 2025 focal"
    grant_id = created.json()["id"]

    edited = await auth_client.patch(f"{GRANTS}/{grant_id}", json={"shares": 500})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "rsu_grants")]
    assert label_of(rows) == "Edited RSU grant 2025 focal"
    assert (rows[0].before["shares"], rows[0].after["shares"]) == (480, 500)

    deleted = await auth_client.delete(f"{GRANTS}/{grant_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "rsu_grants")]
    assert label_of(rows) == "Deleted RSU grant 2025 focal"


async def test_undo_restores_a_deleted_rsu_grant_exactly(auth_client, db):
    grant_id = (await auth_client.post(GRANTS, json=GRANT)).json()["id"]
    before = await table_rows(db, RsuGrant)
    deleted = await auth_client.delete(f"{GRANTS}/{grant_id}")
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert await table_rows(db, RsuGrant) == before


async def test_undoing_a_grant_delete_after_its_label_was_reused_refuses(auth_client, db):
    """Accepted (spec §6.1): the label is the grant's unique name, so the replayed row cannot
    sit beside the new grant that took it — the replay refusal, never a 500 and never an
    overwrite of the newer grant."""
    grant_id = (await auth_client.post(GRANTS, json=GRANT)).json()["id"]
    deleted = await auth_client.delete(f"{GRANTS}/{grant_id}")
    again = await auth_client.post(GRANTS, json=GRANT)
    assert again.status_code == 201, again.text
    again_id = again.json()["id"]
    refused = await undo(auth_client, deleted)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    assert [row["id"] for row in (await table_rows(db, RsuGrant))["rsu_grants"]] == [again_id]
