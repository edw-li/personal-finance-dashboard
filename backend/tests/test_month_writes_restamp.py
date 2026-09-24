"""K4 (2026-09-23 spec): a provisional snapshot — recorded before its month — is restamped on any
balances save that does not send recorded_on: final on or after its 1st, still provisional (with
the new date) before it. Always logged, so Undo restores it; legacy months, final snapshots and a
NULL date never move."""

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select

from app.models import (
    Account,
    AccountBalance,
    ChangeLog,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    SpendingCategory,
)
from app.services import clock
from app.services.month_review import adopt_existing_history

OCT = date(2026, 10, 1)
SEP_22 = date(2026, 9, 22)
NW = "/api/v1/net-worth"
MR = "/api/v1/month-review"


def on(monkeypatch, day: date) -> None:
    monkeypatch.setattr(clock, "product_today", lambda: day)


async def seed(db, *, month=OCT, recorded_on=SEP_22, balance="100.00") -> int:
    account = Account(name="Cash", slug="cash", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    snapshot = NetWorthSnapshot(month=month, recorded_on=recorded_on)
    db.add(snapshot)
    await db.flush()
    db.add(AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal(balance)))
    await db.commit()
    return account.id


async def stored(db, month=OCT) -> date | None:
    return (
        await db.execute(
            select(NetWorthSnapshot.recorded_on).where(NetWorthSnapshot.month == month)
        )
    ).scalar_one()


async def undo(auth_client, batch_id: str) -> None:
    response = await auth_client.post(f"/api/v1/activity/batches/{batch_id}/undo")
    assert response.status_code == 200, response.text


async def snapshot_updates(db) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(ChangeLog)
            .where(ChangeLog.table_name == "net_worth_snapshots", ChangeLog.op == "update")
        )
    ).scalar_one()


def balances(account_id: int, value: str) -> dict:
    return {"balances": [{"account_id": account_id, "balance": value}]}


async def test_an_unchanged_save_on_or_after_the_1st_finalizes_and_undo_restores(
    auth_client, db, monkeypatch
):
    account_id = await seed(db)
    on(monkeypatch, date(2026, 10, 1))
    response = await auth_client.put(f"{NW}/months/{OCT}", json=balances(account_id, "100.00"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["updated"], body["unchanged"]) == (0, 1)
    assert await stored(db) == date(2026, 10, 1)
    month = (await auth_client.get(f"{NW}/months/{OCT}")).json()
    assert (month["provisional"], month["as_of"]) == (False, "2026-10-01")
    # The restamp is logged even on the standalone PUT, which otherwise logs no metadata.
    assert await snapshot_updates(db) == 1
    label = (await db.execute(select(ChangeLog.label).limit(1))).scalar_one()
    assert label == "Saved Oct 2026 balances — 0 updated, recorded Oct 1"
    await undo(auth_client, body["batch_id"])
    assert await stored(db) == SEP_22


async def test_a_changed_save_on_or_after_the_1st_finalizes_with_the_balance_updates(
    auth_client, db, monkeypatch
):
    account_id = await seed(db)
    on(monkeypatch, date(2026, 10, 3))
    body = (await auth_client.put(f"{NW}/months/{OCT}", json=balances(account_id, "150.00"))).json()
    assert (body["updated"], await stored(db)) == (1, date(2026, 10, 3))
    await undo(auth_client, body["batch_id"])
    assert await stored(db) == SEP_22


async def test_a_save_before_the_1st_restamps_but_stays_provisional(auth_client, db, monkeypatch):
    account_id = await seed(db)
    on(monkeypatch, date(2026, 9, 25))
    body = (await auth_client.put(f"{NW}/months/{OCT}", json=balances(account_id, "120.00"))).json()
    assert await stored(db) == date(2026, 9, 25)
    month = (await auth_client.get(f"{NW}/months/{OCT}")).json()
    assert (month["provisional"], month["as_of"]) == (True, "2026-09-25")
    await undo(auth_client, body["batch_id"])
    assert await stored(db) == SEP_22


async def test_an_explicit_recorded_on_still_wins(auth_client, db, monkeypatch):
    account_id = await seed(db)
    on(monkeypatch, date(2026, 10, 3))
    await auth_client.put(
        f"{NW}/months/{OCT}",
        json={"recorded_on": "2026-09-30", **balances(account_id, "100.00")},
    )
    assert await stored(db) == date(2026, 9, 30)


async def test_a_final_snapshot_s_date_never_moves(auth_client, db, monkeypatch):
    march = date(2026, 3, 1)
    account_id = await seed(db, month=march, recorded_on=march)
    on(monkeypatch, date(2026, 10, 3))
    await auth_client.put(f"{NW}/months/{march}", json=balances(account_id, "999.00"))
    assert await stored(db, march) == march


async def test_a_null_date_is_not_overwritten(auth_client, db, monkeypatch):
    account_id = await seed(db, recorded_on=None)
    on(monkeypatch, date(2026, 10, 3))
    await auth_client.put(f"{NW}/months/{OCT}", json=balances(account_id, "150.00"))
    assert await stored(db) is None


async def test_the_month_review_put_restamps_too(auth_client, db, monkeypatch):
    account_id = await seed(db)
    on(monkeypatch, date(2026, 10, 1))
    current = (await auth_client.get(f"{MR}/months/{OCT}")).json()
    saved = await auth_client.put(
        f"{MR}/months/{OCT}",
        json={
            "expected_revision": current["input_revision"],
            "balances": balances(account_id, "100.00"),
        },
    )
    assert saved.status_code == 200, saved.text
    assert await stored(db) == date(2026, 10, 1)
    await undo(auth_client, saved.json()["batch_id"])
    assert await stored(db) == SEP_22


async def test_a_legacy_month_recorded_early_is_never_restamped(auth_client, db, monkeypatch):
    """restamp=False: re-saving it would move its digest off legacy_revision and drop it from
    the averages. Both PUTs pass the flag from the month's state."""
    july = date(2026, 7, 1)
    account_id = await seed(db, month=july, recorded_on=date(2026, 6, 28))
    category = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(category)
    await db.flush()
    db.add_all(
        [
            MonthlySpending(month=july, category_id=category.id, amount=Decimal("2000.00")),
            MonthlyCashflow(month=july, net_pay=Decimal("6000.00")),
        ]
    )
    await db.commit()
    await adopt_existing_history(db, date(2026, 9, 12))
    await db.commit()
    on(monkeypatch, date(2026, 10, 3))
    before = (await auth_client.get(f"{MR}/months/{july}")).json()
    assert before["state"] == "unreviewed_history"
    standalone = await auth_client.put(f"{NW}/months/{july}", json=balances(account_id, "100.00"))
    assert standalone.status_code == 200, standalone.text
    saved = await auth_client.put(
        f"{MR}/months/{july}",
        json={
            "expected_revision": before["input_revision"],
            "balances": balances(account_id, "100.00"),
        },
    )
    assert saved.status_code == 200, saved.text
    assert await stored(db, july) == date(2026, 6, 28)
    assert (await auth_client.get(f"{MR}/months/{july}")).json()["state"] == "unreviewed_history"


async def test_a_spending_only_put_creates_no_snapshot(auth_client, db, monkeypatch):
    on(monkeypatch, date(2026, 10, 3))
    category = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(category)
    await db.commit()
    current = (await auth_client.get(f"{MR}/months/2026-09-01")).json()
    saved = await auth_client.put(
        f"{MR}/months/2026-09-01",
        json={
            "expected_revision": current["input_revision"],
            "spending": {"amounts": [{"category_id": category.id, "amount": "10.00"}]},
        },
    )
    assert saved.status_code == 200, saved.text
    assert (await db.execute(select(func.count()).select_from(NetWorthSnapshot))).scalar_one() == 0
    tables = set((await db.execute(select(ChangeLog.table_name))).scalars())
    assert "net_worth_snapshots" not in tables


async def test_a_batch_closed_legacy_month_recorded_early_stays_closed(
    auth_client, db, monkeypatch
):
    """Review minor 1: a legacy month recorded early can be batch-closed (no blocker before the
    adoption month). Closed, it is no longer `unreviewed_history` — but it must still never be
    restamped (the new date would move its certified digest: `needs_review`) nor blocked."""
    july = date(2026, 7, 1)
    account_id = await seed(db, month=july, recorded_on=date(2026, 6, 28))
    category = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(category)
    await db.flush()
    db.add_all(
        [
            MonthlySpending(month=july, category_id=category.id, amount=Decimal("2000.00")),
            MonthlyCashflow(month=july, net_pay=Decimal("6000.00")),
        ]
    )
    await db.commit()
    await adopt_existing_history(db, date(2026, 9, 12))
    await db.commit()
    on(monkeypatch, date(2026, 10, 3))
    legacy = (await auth_client.get(f"{MR}/months/{july}")).json()
    assert (legacy["state"], legacy["blockers"]) == ("unreviewed_history", [])
    closed = await auth_client.post(
        f"{MR}/batch-close",
        json={
            "months": [{"month": str(july), "expected_revision": legacy["input_revision"]}],
            "reviewed": {"balances": True, "spending": True, "take_home": True},
        },
    )
    assert closed.status_code == 200, closed.text
    after_close = (await auth_client.get(f"{MR}/months/{july}")).json()
    assert (after_close["state"], after_close["blockers"]) == ("closed", [])
    saved = await auth_client.put(
        f"{MR}/months/{july}",
        json={
            "expected_revision": after_close["input_revision"],
            "balances": balances(account_id, "100.00"),
            "reviewed": {"balances": True, "spending": True, "take_home": True},
        },
    )
    assert saved.status_code == 200, saved.text
    standalone = await auth_client.put(f"{NW}/months/{july}", json=balances(account_id, "100.00"))
    assert standalone.status_code == 200, standalone.text
    assert await stored(db, july) == date(2026, 6, 28)
    assert (await auth_client.get(f"{MR}/months/{july}")).json()["state"] == "closed"


async def test_a_same_day_resave_restamps_nothing_and_says_nothing(auth_client, db, monkeypatch):
    """Review minor 3: re-saving early balances on the day they were recorded changes no date, so
    no restamp is logged and the label claims none."""
    account_id = await seed(db)  # Oct 1 balances, recorded Sep 22
    on(monkeypatch, SEP_22)
    response = await auth_client.put(f"{NW}/months/{OCT}", json=balances(account_id, "150.00"))
    assert response.status_code == 200, response.text
    labels = set((await db.execute(select(ChangeLog.label))).scalars())
    assert labels == {"Saved Oct 2026 balances — 1 updated"}
    assert await snapshot_updates(db) == 0
    assert await stored(db) == SEP_22
