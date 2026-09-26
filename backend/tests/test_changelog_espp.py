"""The ESPP router's writes are change-logged (2026-09-25 polish spec §6.1, lane L3b): lots,
purchase periods and offerings — every create, edit and delete one batch with an Activity
label and the X-Change-Batch header — and the Activity card undoes a delete exactly: a sold
lot comes back sold, a Reset period comes back stored, an offering comes back with its id."""

from app.models import EsppLot, EsppOffering, EsppPeriod
from app.services.changelog import REPLAY_REFUSAL
from tests.changelog_asserts import label_of, logged, ops, table_rows, undo

LOTS = "/api/v1/espp/lots"
PERIODS = "/api/v1/espp/periods"
OFFERINGS = "/api/v1/espp/offerings"

LOT = {
    "purchase_date": "2024-02-29",
    "qualifying_date": "2025-09-01",
    "shares": "260",
    "subscription_price": "48.509",
    "purchase_fmv": "79.112",
}
PERIOD = {
    "label": "Mar–Aug 2026",
    "period_start": "2026-03-01",
    "period_end": "2026-08-31",
    "semi_annual_base": "81000",
    "additional_payments": "0",
    "contribution_pct": "0.14",
}
OFFERING = {"offering_start": "2025-09-01", "subscription_price": "170.79", "notes": "reset"}


async def test_lot_create_edit_delete_each_log_one_labelled_batch(auth_client, db):
    created = await auth_client.post(LOTS, json=LOT)
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "espp_lots")]
    assert label_of(rows) == "Added the lot purchased Feb 29, 2024"
    assert rows[0].after["purchase_price"] == "41.23265"  # 0.85 x 48.509, the lot family's 5 dp
    lot_id = created.json()["id"]

    edited = await auth_client.patch(f"{LOTS}/{lot_id}", json={"shares": "250"})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "espp_lots")]
    assert label_of(rows) == "Edited the lot purchased Feb 29, 2024"
    assert (rows[0].before["shares"], rows[0].after["shares"]) == ("260.0000", "250.0000")

    deleted = await auth_client.delete(f"{LOTS}/{lot_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "espp_lots")]
    assert label_of(rows) == "Deleted the lot purchased Feb 29, 2024"


async def test_undo_restores_a_deleted_sold_lot_exactly(auth_client, db):
    sold = {**LOT, "sold_date": "2025-10-01", "sold_price": "180.5", "notes": "sold for the house"}
    lot_id = (await auth_client.post(LOTS, json=sold)).json()["id"]
    before = await table_rows(db, EsppLot)
    deleted = await auth_client.delete(f"{LOTS}/{lot_id}")
    assert await table_rows(db, EsppLot) == {"espp_lots": []}
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == "Undid: Deleted the lot purchased Feb 29, 2024"
    after = await table_rows(db, EsppLot)
    assert after == before
    [row] = after["espp_lots"]
    assert (row["id"], row["sold_date"].isoformat(), str(row["sold_price"])) == (
        lot_id,
        "2025-10-01",
        "180.50000",
    )


async def test_undoing_a_lot_delete_after_its_date_was_reused_refuses(auth_client, db):
    """Accepted (spec §6.1): purchase_date is the lot's natural key, so the replayed row cannot
    sit beside a new lot entered for the same purchase — the replay refusal."""
    lot_id = (await auth_client.post(LOTS, json=LOT)).json()["id"]
    deleted = await auth_client.delete(f"{LOTS}/{lot_id}")
    again = await auth_client.post(LOTS, json=LOT)
    assert again.status_code == 201, again.text
    again_id = again.json()["id"]
    refused = await undo(auth_client, deleted)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    assert [row["id"] for row in (await table_rows(db, EsppLot))["espp_lots"]] == [again_id]


async def test_period_save_edit_reset_each_log_one_labelled_batch(auth_client, db):
    created = await auth_client.post(PERIODS, json=PERIOD)
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "espp_periods")]
    # Saving a derived modeler row is what materializes it — hence "Saved", not "Added".
    assert label_of(rows) == "Saved the Mar–Aug 2026 purchase period"
    period_id = created.json()["id"]

    edited = await auth_client.patch(f"{PERIODS}/{period_id}", json={"contribution_pct": "0.15"})
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "espp_periods")]
    assert label_of(rows) == "Edited the Mar–Aug 2026 purchase period"
    assert (rows[0].before["contribution_pct"], rows[0].after["contribution_pct"]) == (
        "0.140000000",
        "0.150000000",
    )

    deleted = await auth_client.delete(f"{PERIODS}/{period_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "espp_periods")]
    # The modeler's only door to this DELETE is "Reset … to its derived values".
    assert label_of(rows) == "Reset the Mar–Aug 2026 purchase period"


async def test_undo_restores_a_reset_period_exactly(auth_client, db):
    period_id = (await auth_client.post(PERIODS, json=PERIOD)).json()["id"]
    before = await table_rows(db, EsppPeriod)
    deleted = await auth_client.delete(f"{PERIODS}/{period_id}")
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert await table_rows(db, EsppPeriod) == before


async def test_offering_create_edit_delete_each_log_one_labelled_batch(auth_client, db):
    created = await auth_client.post(OFFERINGS, json=OFFERING)
    assert created.status_code == 201, created.text
    rows = await logged(db, created)
    assert ops(rows) == [("insert", "espp_offerings")]
    assert label_of(rows) == "Added the offering starting Sep 1, 2025"
    offering_id = created.json()["id"]

    edited = await auth_client.patch(
        f"{OFFERINGS}/{offering_id}", json={"subscription_price": "171.5"}
    )
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited)
    assert ops(rows) == [("update", "espp_offerings")]
    assert label_of(rows) == "Edited the offering starting Sep 1, 2025"
    assert (rows[0].before["subscription_price"], rows[0].after["subscription_price"]) == (
        "170.79000",
        "171.50000",
    )

    deleted = await auth_client.delete(f"{OFFERINGS}/{offering_id}")
    assert deleted.status_code == 204
    rows = await logged(db, deleted)
    assert ops(rows) == [("delete", "espp_offerings")]
    assert label_of(rows) == "Deleted the offering starting Sep 1, 2025"


async def test_undo_restores_a_deleted_offering_exactly(auth_client, db):
    offering_id = (await auth_client.post(OFFERINGS, json=OFFERING)).json()["id"]
    before = await table_rows(db, EsppOffering)
    deleted = await auth_client.delete(f"{OFFERINGS}/{offering_id}")
    resp = await undo(auth_client, deleted)
    assert resp.status_code == 200, resp.text
    assert await table_rows(db, EsppOffering) == before
