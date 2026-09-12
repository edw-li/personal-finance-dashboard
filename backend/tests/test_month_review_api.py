"""Money/review atomicity, adoption, stale corrections and evidence parity."""

import asyncio
from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import (
    Account,
    AccountBalance,
    ChangeLog,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    SpendingCategory,
)
from app.models.month_review import MonthReview
from app.services import clock
from app.services.changelog import undo_batch
from app.services.month_review import adopt_existing_history, load_review_book, lock_review_inputs

D = Decimal
TODAY = date(2026, 9, 12)
CURRENT = date(2026, 9, 1)
PAST = date(2026, 8, 1)
BASE = "/api/v1/month-review"
CONFIRMED = {"balances": True, "spending": True, "take_home": True}


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "product_today", lambda: TODAY)


async def seed(db, months=(PAST,), *, spend="100.00", pay="1000.00"):
    account = Account(name="Investments", slug="investments", group="taxable")
    category = SpendingCategory(name="Living", slug="living", kind="living")
    db.add_all([account, category])
    await db.flush()
    for month in months:
        snapshot = NetWorthSnapshot(month=month, recorded_on=month)
        db.add(snapshot)
        await db.flush()
        db.add(AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=D("5000")))
        if spend is not None:
            db.add(MonthlySpending(month=month, category_id=category.id, amount=D(spend)))
        if pay is not None:
            db.add(MonthlyCashflow(month=month, net_pay=D(pay)))
    await db.commit()
    return account.id, category.id


async def get_state(client, month=PAST):
    response = await client.get(f"{BASE}/months/{month}")
    assert response.status_code == 200, response.text
    return response.json()


async def close(client, month=PAST, **extra):
    before = await get_state(client, month)
    response = await client.put(
        f"{BASE}/months/{month}",
        json={
            "expected_revision": before["input_revision"],
            "close": True,
            "reviewed": CONFIRMED,
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_read_contract_requires_auth_and_does_not_adopt_on_read(client, auth_client, db):
    # auth_client shares client; clear its header for the explicit unauthenticated read.
    token = client.headers.pop("Authorization")
    assert (await client.get(BASE)).status_code == 401
    client.headers["Authorization"] = token
    await seed(db)
    first = await get_state(auth_client)
    assert first["state"] == "ready_to_review"
    assert not first["eligible_spending"]
    assert (await db.execute(select(func.count()).select_from(MonthReview))).scalar_one() == 0


async def test_historical_adoption_preserves_values_and_never_closes_current(auth_client, db):
    await seed(db, (PAST, CURRENT, date(2026, 10, 1)))
    before = list((await db.execute(select(MonthlySpending.amount))).scalars())
    await adopt_existing_history(db, TODAY)
    await db.commit()
    response = (await auth_client.get(BASE)).json()
    months = {item["month"]: item for item in response["months"]}
    assert response["default_month"] == str(PAST)
    assert months[str(PAST)]["state"] == "unreviewed_history"
    assert months[str(PAST)]["closed_at"] is None
    assert months[str(PAST)]["legacy_eligible"]
    assert not months[str(CURRENT)]["eligible_spending"]
    assert not months["2026-10-01"]["can_close"]
    assert list((await db.execute(select(MonthlySpending.amount))).scalars()) == before


async def test_atomic_save_rolls_back_balances_when_spending_rejects(auth_client, db):
    account_id, _ = await seed(db, ())
    before = await get_state(auth_client, CURRENT)
    response = await auth_client.put(
        f"{BASE}/months/{CURRENT}",
        json={
            "expected_revision": before["input_revision"],
            "balances": {"balances": [{"account_id": account_id, "balance": "100.005"}]},
            "spending": {"amounts": [{"category_id": 999999, "amount": "50"}]},
        },
    )
    assert response.status_code == 422, response.text
    assert (await db.execute(select(func.count()).select_from(NetWorthSnapshot))).scalar_one() == 0
    assert (await db.execute(select(func.count()).select_from(AccountBalance))).scalar_one() == 0
    assert (await db.execute(select(func.count()).select_from(ChangeLog))).scalar_one() == 0
    assert (await get_state(auth_client, CURRENT))["input_revision"] == before["input_revision"]


async def test_atomic_lock_order_allows_an_in_flight_snapshot_writer_to_finish(db, engine):
    """Exercise independent real transactions, never concurrent requests on fixture db."""
    account_id, _ = await seed(db, ())
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    atomic_pid = asyncio.get_running_loop().create_future()

    async def atomic_editor():
        async with sessions() as editor:
            atomic_pid.set_result(await editor.scalar(text("SELECT pg_backend_pid()")))
            await lock_review_inputs(editor)
            await editor.rollback()

    async with sessions() as writer:
        snapshot_id = await writer.scalar(
            insert(NetWorthSnapshot).values(month=PAST).returning(NetWorthSnapshot.id)
        )
        pending = asyncio.create_task(atomic_editor())
        try:
            pid = await atomic_pid
            for _ in range(100):
                waiting = await db.scalar(
                    text(
                        "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = :pid "
                        "AND relation = 'net_worth_snapshots'::regclass AND NOT granted)"
                    ),
                    {"pid": pid},
                )
                if waiting:
                    break
                await asyncio.sleep(0.01)
            assert waiting, "The atomic editor must wait for the original snapshot writer"
            # With child-first locks, each transaction now waits for the other and PostgreSQL
            # aborts one. Parent-first locks let the original writer finish normally.
            await asyncio.wait_for(
                writer.execute(
                    insert(AccountBalance).values(
                        snapshot_id=snapshot_id, account_id=account_id, balance=D("500")
                    )
                ),
                3,
            )
            await writer.commit()
            await asyncio.wait_for(pending, 3)
        finally:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)


async def test_failed_close_keeps_previous_saved_values(auth_client, db):
    account_id, category_id = await seed(db, pay=None)
    before = await get_state(auth_client)
    response = await auth_client.put(
        f"{BASE}/months/{PAST}",
        json={
            "expected_revision": before["input_revision"],
            "close": True,
            "reviewed": CONFIRMED,
            "balances": {"balances": [{"account_id": account_id, "balance": "6000"}]},
            "spending": {"amounts": [{"category_id": category_id, "amount": "120"}]},
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "month_not_ready"
    assert (await db.execute(select(AccountBalance.balance))).scalar_one() == D("5000")
    assert (await db.execute(select(MonthlySpending.amount))).scalar_one() == D("100")


async def test_activity_undo_waits_before_reversing_a_partial_atomic_save(auth_client, db, engine):
    """Undo must not take a child lock while a month save is locking its parents."""
    account_id, _ = await seed(db, ())
    saved = await auth_client.put(
        f"/api/v1/net-worth/months/{PAST}",
        json={"balances": [{"account_id": account_id, "balance": "5000"}]},
    )
    assert saved.status_code == 200, saved.text
    batch_id = UUID(saved.json()["batch_id"])
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    undo_pid = asyncio.get_running_loop().create_future()

    async def activity_undo():
        async with sessions() as undo_session:
            undo_pid.set_result(await undo_session.scalar(text("SELECT pg_backend_pid()")))
            return await undo_batch(undo_session, batch_id, actor="concurrent-test")

    async with sessions() as editor:
        # Pause a real transaction partway through the atomic editor's lock sequence.
        await editor.execute(
            text("LOCK TABLE accounts, net_worth_snapshots IN SHARE ROW EXCLUSIVE MODE")
        )
        pending = asyncio.create_task(activity_undo())
        try:
            pid = await undo_pid
            for _ in range(100):
                waiting = await db.scalar(
                    text(
                        "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = :pid "
                        "AND relation IN ('accounts'::regclass, 'net_worth_snapshots'::regclass) "
                        "AND NOT granted)"
                    ),
                    {"pid": pid},
                )
                if waiting:
                    break
                await asyncio.sleep(0.01)
            assert waiting, "Activity undo must wait for the in-flight atomic editor"
            # An uncoordinated reverse replay already holds account_balances here, causing
            # a deadlock. Matching the parent-first lock sequence lets both finish.
            await asyncio.wait_for(lock_review_inputs(editor), 3)
            await editor.rollback()
            assert await asyncio.wait_for(pending, 3)
        finally:
            await editor.rollback()
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
    assert (await db.execute(select(func.count()).select_from(NetWorthSnapshot))).scalar_one() == 0
    assert (await db.execute(select(func.count()).select_from(AccountBalance))).scalar_one() == 0


async def test_save_and_close_is_one_idempotent_batch_and_undo_restores_all_feeds(auth_client, db):
    account_id, category_id = await seed(db)
    original = await get_state(auth_client)
    request = {
        "expected_revision": original["input_revision"],
        "request_id": str(uuid4()),
        "close": True,
        "reviewed": CONFIRMED,
        "balances": {
            "notes": "Reviewed together",
            "balances": [{"account_id": account_id, "balance": "6500"}],
        },
        "spending": {"amounts": [{"category_id": category_id, "amount": "300"}], "net_pay": "1200"},
    }
    response = await auth_client.put(f"{BASE}/months/{PAST}", json=request)
    assert response.status_code == 200, response.text
    first = response.json()
    assert first["review"]["state"] == "closed"
    assert first["batch_id"]
    batches = (await db.execute(select(func.count(func.distinct(ChangeLog.batch_id))))).scalar_one()
    replay = await auth_client.put(f"{BASE}/months/{PAST}", json=request)
    assert replay.status_code == 200, replay.text
    assert replay.json() == first
    assert (
        await db.execute(select(func.count(func.distinct(ChangeLog.batch_id))))
    ).scalar_one() == batches
    from uuid import UUID

    await undo_batch(db, UUID(first["batch_id"]), actor="me@example.com")
    restored = await get_state(auth_client)
    assert restored["input_revision"] == original["input_revision"]
    assert restored["state"] == "ready_to_review"
    assert (await db.execute(select(NetWorthSnapshot.notes))).scalar_one() is None


async def test_other_editor_revision_conflicts_and_zero_clear_stays_distinct(auth_client, db):
    _, category_id = await seed(db)
    stale = await get_state(auth_client)
    await auth_client.put(
        f"/api/v1/spending/months/{PAST}",
        json={
            "amounts": [{"category_id": category_id, "amount": "150"}],
        },
    )
    conflict = await auth_client.put(
        f"{BASE}/months/{PAST}",
        json={
            "expected_revision": stale["input_revision"],
            "spending": {"amounts": [{"category_id": category_id, "amount": "999"}]},
        },
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "month_revision_conflict"
    state = await get_state(auth_client)
    cleared = await auth_client.put(
        f"{BASE}/months/{PAST}",
        json={
            "expected_revision": state["input_revision"],
            "spending": {"net_pay": None},
        },
    )
    assert cleared.status_code == 200, cleared.text
    assert not cleared.json()["review"]["coverage"]["take_home"]
    assert cleared.json()["spending"]["net_pay_cleared"]


async def test_confirmed_zero_can_close_but_ambiguous_zero_cannot(auth_client, db):
    _, category_id = await seed(db, spend="0", pay="0")
    await adopt_existing_history(db, TODAY)
    await db.commit()
    unreviewed = await get_state(auth_client)
    assert not unreviewed["can_close"]
    assert not unreviewed["eligible_spending"]
    result = await close(
        auth_client,
        spending={
            "confirm_zero": True,
            "amounts": [{"category_id": category_id, "amount": "0"}],
        },
    )
    assert result["review"]["eligible_savings"]
    metrics = (
        await auth_client.get("/api/v1/metrics/spending", params={"month": str(PAST)})
    ).json()
    values = {row["id"]: row["value"] for row in metrics["metrics"]}
    assert values["living_spending"] == "0.00"
    assert values["cash_saved"] == "0.00"
    assert values["cash_savings_rate"] is None
    coverage = (await auth_client.get("/api/v1/coverage")).json()
    assert str(PAST) not in coverage["spending_empty"]


async def test_correction_and_classification_change_invalidate_legacy_and_closed_review(
    auth_client, db
):
    _, category_id = await seed(db)
    await adopt_existing_history(db, TODAY)
    await db.commit()
    await db.execute(update(MonthlySpending).values(amount=D("200")))  # import/Core writer
    await db.commit()
    corrected = await get_state(auth_client)
    assert corrected["state"] == "needs_review"
    assert not corrected["legacy_eligible"]
    await close(auth_client)
    await db.execute(
        update(SpendingCategory).where(SpendingCategory.id == category_id).values(kind="tax")
    )
    await db.commit()
    assert (await get_state(auth_client))["state"] == "needs_review"


async def test_payroll_fingerprint_is_effective_dated_and_not_quote_dependent(auth_client, db):
    await seed(db)
    person = Person(name="Test", is_primary=True)
    db.add(person)
    await db.flush()
    old = PaycheckProfile(
        person_id=person.id, effective_date=date(2026, 1, 1), annual_salary=D("120000")
    )
    future = PaycheckProfile(
        person_id=person.id, effective_date=date(2026, 9, 1), annual_salary=D("150000")
    )
    db.add_all([old, future])
    await db.commit()
    old_id, future_id = old.id, future.id
    result = await close(auth_client)
    await db.execute(
        update(PaycheckProfile)
        .where(PaycheckProfile.id == future_id)
        .values(annual_salary=D("200000"))
    )
    await db.commit()
    assert (await get_state(auth_client))["input_revision"] == result["review"]["input_revision"]
    await db.execute(
        update(PaycheckProfile).where(PaycheckProfile.id == old_id).values(trad_401k_pct=D("0.1"))
    )
    await db.commit()
    assert (await get_state(auth_client))["state"] == "needs_review"


async def test_batch_close_is_atomic_and_default_prefers_closed_month(auth_client, db):
    july = date(2026, 7, 1)
    await seed(db, (july, PAST))
    await adopt_existing_history(db, TODAY)
    await db.commit()
    book = await load_review_book(db)
    before = [(month, state.input_revision) for month, state in book.months.items()]
    bad = await auth_client.post(
        f"{BASE}/batch-close",
        json={
            "reviewed": CONFIRMED,
            "months": [
                {"month": str(month), "expected_revision": digest if month == july else "0" * 64}
                for month, digest in before
            ],
        },
    )
    assert bad.status_code == 409
    assert not any(row.closed_at for row in (await db.execute(select(MonthReview))).scalars())
    good = await auth_client.post(
        f"{BASE}/batch-close",
        json={
            "reviewed": CONFIRMED,
            "months": [{"month": str(july), "expected_revision": before[0][1]}],
        },
    )
    assert good.status_code == 200, good.text
    assert (await auth_client.get(BASE)).json()["default_month"] == str(july)


async def test_fixed_calendar_windows_evidence_matrix_and_projection_agree(auth_client, db):
    months = [date(2025, 7, 1), date(2025, 8, 1), date(2026, 6, 1), date(2026, 7, 1), PAST, CURRENT]
    _, category_id = await seed(db, months)
    amounts = [9999, 50, 100, 200, 300, 1000]
    for month, amount in zip(months, amounts, strict=True):
        await db.execute(
            update(MonthlySpending).where(MonthlySpending.month == month).values(amount=D(amount))
        )
    await db.commit()
    await adopt_existing_history(db, TODAY)
    await db.commit()
    evidence = (
        await auth_client.get("/api/v1/metrics/spending", params={"month": str(PAST)})
    ).json()
    assert evidence["comparison"]["value"] == "116.67"  # Aug25+Jun26+Jul26; Aug26 excluded
    assert evidence["comparison"]["window"]["from"] == "2025-08-01"
    assert len(evidence["comparison"]["window"]["included"]) == 3
    assert len(evidence["comparison"]["window"]["excluded"]) == 9
    assert evidence["rolling"]["value"] == "200.00"  # Jun, Jul, Aug; older gaps not filled
    matrix = (await auth_client.get("/api/v1/spending/matrix", params={"start": str(PAST)})).json()
    assert matrix["comparison_average"][0] == evidence["comparison"]["value"]
    category = next(item for item in matrix["series"] if item["category_id"] == category_id)
    assert category["comparison_average"][0] == evidence["comparison"]["value"]
    assert category["comparison_count"][0] == 3
    assert matrix["default_month"] == str(PAST)
    from app.services.assistant_context import build_context

    context = await build_context(db, route="/spending", search={"month": str(PAST)}, view={})
    mover = next(item for item in context["spending"]["movers"] if item["category"] == "Living")
    assert mover["comparison_average"] == category["comparison_average"][0]
    assert mover["comparison_count"] == 3
    assert mover["delta_12mo_avg"] == "183.33"
    projection = await auth_client.get("/api/v1/projection", params={"years": 1, "volatility": 0})
    assert projection.status_code == 200, projection.text
    assert projection.json()["annual_spend"] == "2400.00"
    assert projection.json()["monthly_contribution"] == "800.00"
    assert projection.json()["derived_window"] == {
        "from": "2025-09-01",
        "to": str(PAST),
        "months": 3,
    }


async def test_spending_components_and_period_rate_use_matched_money_totals(auth_client, db):
    july = date(2026, 7, 1)
    await seed(db, (july, PAST), spend="100", pay="1000")
    tax = SpendingCategory(name="Tax", slug="tax", kind="tax")
    transfer = SpendingCategory(name="Transfer", slug="transfer", kind="transfer")
    db.add_all([tax, transfer])
    await db.flush()
    db.add_all(
        [
            MonthlySpending(month=PAST, category_id=tax.id, amount=D("50")),
            MonthlySpending(month=PAST, category_id=transfer.id, amount=D("400")),
        ]
    )
    await db.execute(
        update(MonthlyCashflow).where(MonthlyCashflow.month == july).values(net_pay=D("2000"))
    )
    await db.commit()
    await adopt_existing_history(db, TODAY)
    await db.commit()
    response = (
        await auth_client.get("/api/v1/metrics/spending", params={"month": str(PAST)})
    ).json()
    metrics = {row["id"]: row for row in response["metrics"]}
    assert metrics["living_spending"]["value"] == "100.00"
    assert metrics["cash_outflow"]["value"] == "150.00"
    assert metrics["all_category_entries"]["value"] == "550.00"
    assert metrics["cash_saved"]["value"] == "850.00"
    assert metrics["rolling_cash_savings_rate"]["value"] == "0.916667"  # (1900+850)/3000
    assert all(metric["scope"] == "household" for metric in metrics.values())


async def test_idempotency_keeps_omitted_pay_distinct_from_an_explicit_clear(auth_client, db):
    _, category_id = await seed(db)
    original = await get_state(auth_client)
    request = {
        "expected_revision": original["input_revision"],
        "request_id": str(uuid4()),
        "spending": {"amounts": [{"category_id": category_id, "amount": "120"}]},
    }
    first = await auth_client.put(f"{BASE}/months/{PAST}", json=request)
    assert first.status_code == 200, first.text
    changed = {**request, "spending": {**request["spending"], "net_pay": None}}
    replay = await auth_client.put(f"{BASE}/months/{PAST}", json=changed)
    assert replay.status_code == 409
    assert "different changes" in replay.json()["detail"]
    assert (await db.execute(select(MonthlyCashflow.net_pay))).scalar_one() == D("1000")
