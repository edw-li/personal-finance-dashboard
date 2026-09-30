"""Individual take-home keeps its aggregate, review, history and restore in agreement."""

from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest

from app.importer.apply import apply_spending
from app.importer.cells import CellIssues
from app.importer.parsers import ParsedSpending, ParsedSpendingMonth
from app.importer.report import SheetReport
from app.lifecycle.restore import SnapshotError, load_snapshot, parse_tables
from app.models import MonthlyCashflow, Person
from app.services import clock
from app.services.changelog import undo_batch
from app.services.review_input import month_input
from app.services.review_input_v1 import month_input as frozen_month_input
from app.services.review_input_v1 import revision
from app.services.snapshot import build_snapshot_zip
from tests.test_month_review_api import CONFIRMED, get_state, seed
from tests.test_restore import restore_now

MONTH = date(2026, 8, 1)
URL = f"/api/v1/spending/months/{MONTH}"


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "product_today", lambda: date(2026, 9, 29))


@pytest.fixture
async def people(db):
    members = [Person(name="Edward", is_primary=True), Person(name="Grace", is_primary=False)]
    db.add_all(members)
    await db.commit()
    return [person.id for person in members]


async def test_derives_total_after_rounding_each_member_and_restores_after_delete(
    auth_client, db, people
):
    amounts = {str(person): "100.105" for person in people}
    saved = await auth_client.put(URL, json={"net_pay_by_person": amounts})
    assert saved.status_code == 200, saved.text
    stored = (await auth_client.get(URL)).json()
    assert stored["net_pay"] == "200.22"
    assert stored["net_pay_by_person"] == {str(person): "100.11" for person in people}
    matrix = (await auth_client.get("/api/v1/spending/matrix")).json()
    assert matrix["net_pay"] == ["200.22"]

    deleted = await auth_client.delete(URL)
    assert deleted.status_code == 204, deleted.text
    assert (await auth_client.get(URL)).json()["net_pay_by_person"] is None
    await undo_batch(db, UUID(deleted.headers["X-Change-Batch"]), actor="test")
    assert (await auth_client.get(URL)).json() == stored


@pytest.mark.parametrize(
    "amounts, aggregate",
    [
        ({"1": "100", "2": "200"}, "301"),
        ({"1": "100", "2": "200"}, None),
        ({"1": "-1", "2": "200"}, "199"),
        ({"999999": "1"}, "1"),
        ({}, "0"),
        ({"1": "9999999999.99", "2": ".01"}, "10000000000"),
        ({"1": "NaN"}, "0"),
    ],
)
async def test_invalid_breakdowns_cannot_change_saved_money(
    auth_client, db, people, amounts, aggregate
):
    db.add(MonthlyCashflow(month=MONTH, net_pay=Decimal("250")))
    await db.commit()
    response = await auth_client.put(URL, json={"net_pay": aggregate, "net_pay_by_person": amounts})
    assert response.status_code == 422, response.text
    stored = (await auth_client.get(URL)).json()
    assert stored["net_pay"] == "250.00"
    assert stored["net_pay_by_person"] is None


async def test_legacy_updates_preserve_matching_breakdowns_and_clear_incompatible_ones(
    auth_client, people
):
    amounts = {str(people[0]): "100.00", str(people[1]): "200.00"}
    assert (await auth_client.put(URL, json={"net_pay_by_person": amounts})).status_code == 200
    assert (await auth_client.put(URL, json={"net_pay": "300"})).status_code == 200
    assert (await auth_client.get(URL)).json()["net_pay_by_person"] == amounts
    assert (await auth_client.put(URL, json={"net_pay": "350"})).status_code == 200
    assert (await auth_client.get(URL)).json()["net_pay_by_person"] is None
    assert (
        await auth_client.put(URL, json={"net_pay": None, "net_pay_by_person": None})
    ).status_code == 200
    assert (await auth_client.get(URL)).json()["net_pay"] is None


async def test_zero_income_is_recorded(auth_client, people):
    amounts = {str(person): "0" for person in people}
    saved = await auth_client.put(URL, json={"net_pay_by_person": amounts})
    assert saved.status_code == 200, saved.text
    response = await auth_client.get(URL)
    assert response.json()["net_pay"] == "0.00"
    assert response.json()["net_pay_by_person"] == {str(person): "0.00" for person in people}


async def test_atomic_review_and_undo_cover_same_total_reallocations(auth_client, db, people):
    await seed(db)
    original = await get_state(auth_client)
    breakdown = {str(people[0]): "400.00", str(people[1]): "600.00"}
    saved = await auth_client.put(
        f"/api/v1/month-review/months/{MONTH}",
        json={
            "expected_revision": original["input_revision"],
            "close": True,
            "reviewed": CONFIRMED,
            "spending": {"net_pay_by_person": breakdown},
        },
    )
    assert saved.status_code == 200, saved.text
    closed = saved.json()["review"]
    assert closed["state"] == "closed"
    assert closed["input_revision"] != original["input_revision"]
    changed = await auth_client.put(
        URL, json={"net_pay_by_person": {str(people[0]): "500", str(people[1]): "500"}}
    )
    assert changed.status_code == 200, changed.text
    stale = await get_state(auth_client)
    assert stale["state"] == "needs_review"
    assert stale["input_revision"] != closed["input_revision"]
    await undo_batch(db, UUID(changed.json()["batch_id"]), actor="test")
    assert (await get_state(auth_client))["input_revision"] == closed["input_revision"]
    assert (await auth_client.get(URL)).json()["net_pay_by_person"] == breakdown


def test_new_nullable_column_preserves_frozen_legacy_review_fingerprints():
    pay = {"month": MONTH, "net_pay": Decimal("1000"), "net_pay_by_person": None}
    args = (MONTH, [], [], [], [pay], [], [], [])
    assert revision(month_input(*args)) == revision(frozen_month_input(*args))


async def test_export_and_restore_round_trip_member_amounts(auth_client, db, people, seeded_user):
    amounts = {str(people[0]): "100.00", str(people[1]): "200.00"}
    assert (await auth_client.put(URL, json={"net_pay_by_person": amounts})).status_code == 200
    snapshot = await build_snapshot_zip(db)
    assert (await auth_client.put(URL, json={"net_pay": "350"})).status_code == 200
    await restore_now(db, snapshot.payload, seeded_user.id)
    stored = (await auth_client.get(URL)).json()
    assert stored["net_pay"] == "300.00"
    assert stored["net_pay_by_person"] == amounts


@pytest.mark.parametrize("bad", [{"99999": "300"}, {"1": "299"}, {"1": "-1", "2": "301"}, [], {}])
async def test_restore_rejects_invalid_member_metadata(auth_client, db, people, seeded_user, bad):
    assert (await auth_client.put(URL, json={"net_pay": "300"})).status_code == 200
    snapshot = load_snapshot((await build_snapshot_zip(db)).payload)
    snapshot.tables["monthly_cashflow"][0]["net_pay_by_person"] = bad
    with pytest.raises(SnapshotError, match="take-home") as refused:
        parse_tables(snapshot, user_id=seeded_user.id)
    assert refused.value.status == 422


async def test_spreadsheet_import_keeps_matching_breakdown_but_clears_it_when_total_changes(
    db, people
):
    amounts = {str(people[0]): "100.00", str(people[1]): "200.00"}
    db.add(MonthlyCashflow(month=MONTH, net_pay=Decimal("300"), net_pay_by_person=amounts))
    await db.commit()
    for total, expected in [("300", amounts), ("350", None)]:
        parsed = ParsedSpending(
            categories=[],
            months=[ParsedSpendingMonth(month=MONTH, amounts={}, net_pay=Decimal(total))],
            issues=CellIssues(),
        )
        await apply_spending(db, parsed, SheetReport())
        await db.commit()
        cashflow = await db.get(MonthlyCashflow, MONTH)
        assert cashflow.net_pay == Decimal(total)
        assert cashflow.net_pay_by_person == expected
