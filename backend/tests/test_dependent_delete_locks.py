"""The five deletes that image what hangs off their row lock that row FIRST (2026-09-25 polish
L3c): read FOR UPDATE (changelog.lock_parent) before any dependent is read, so a child another
tab writes in between waits for the delete instead of being removed — or unlinked — by the FK's
ON DELETE without an image. Each route's statement order is proven from the SQL it sends; the
race itself once, on the lock's own mode.

An account and a spending category are month-review inputs, so their deletes take the review
tables' locks BEFORE the row lock — the month save's own locks, in undo_batch's order — and a
save racing the delete of its own row waits for it (or it for the save) instead of deadlocking;
both orderings are raced through the real routes."""

import asyncio
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from types import ModuleType

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api import credit_cards as credit_cards_api
from app.api import month_review as month_review_api
from app.api import net_worth as net_worth_api
from app.api import spending as spending_api
from app.models import Account, CardCredit, CreditCard, RewardCategory, Security, SpendingCategory
from app.schemas.month_review import MonthSaveIn, MonthSaveOut
from app.services import clock
from app.services.changelog import ChangeBatch, lock_parent
from app.services.month_review import REVIEW_INPUT_TABLES
from tests.exact_undo import logged, shape
from tests.ordering_helpers import (
    RACE_SECONDS,
    backend_pid,
    first_position,
    recorded_sql,
    until_blocked,
)

CARD = {
    "name": "Venture X",
    "slug": "venture-x",
    "annual_fee": Decimal("395.00"),
    "rewards_currency": "miles",
    "point_value_cents": Decimal("1.0000"),
}

# model, its fields, its DELETE path, and a fragment of every read of what hangs off it: the
# counts that refuse the delete, and the rows it images — those read FOR UPDATE too
DELETES = [
    pytest.param(
        CreditCard,
        CARD,
        "/api/v1/credit-cards/{id}",
        (),
        (
            "FROM reward_categories",
            "FROM card_credits",
            "FROM reward_rates",
            "FROM credit_limit_events",
        ),
        id="credit card",
    ),
    pytest.param(
        RewardCategory,
        {"name": "Groceries", "slug": "groceries"},
        "/api/v1/credit-cards/categories/{id}",
        (),
        ("FROM reward_rates",),
        id="reward category",
    ),
    pytest.param(
        Security,
        {"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "holding_type": "etf"},
        "/api/v1/portfolio/securities/{id}",
        ("FROM position_transactions", "FROM dividend_payments"),
        ("FROM security_dividend_events", "FROM price_history", "FROM latest_prices"),
        id="security",
    ),
    pytest.param(
        SpendingCategory,
        {"name": "Dining", "slug": "dining", "sort_order": 0},
        "/api/v1/spending/categories/{id}",
        ("FROM monthly_spending",),
        ("FROM reward_categories", "FROM category_budgets"),
        id="spending category",
    ),
    pytest.param(
        Account,
        {"name": "Checking", "slug": "checking", "group": "cash", "sort_order": 0},
        "/api/v1/net-worth/accounts/{id}",
        ("FROM account_balances",),
        ("WHERE accounts.parent_account_id", "FROM credit_cards"),
        id="account",
    ),
]


@pytest.mark.parametrize(("model", "fields", "path", "counted", "imaged"), DELETES)
async def test_a_delete_locks_its_row_before_it_reads_what_hangs_off_it(
    auth_client, db, model, fields, path, counted, imaged
):
    row = model(**fields)
    db.add(row)
    await db.commit()
    table = model.__tablename__
    with recorded_sql(db) as statements:
        resp = await auth_client.delete(path.format(id=row.id))
    assert resp.status_code == 204, resp.text
    lock = first_position(statements, "FOR UPDATE")
    assert f"FROM {table} \nWHERE {table}.id = " in statements[lock][0]
    for fragment in counted:
        assert first_position(statements, fragment) > lock, fragment
    for fragment in imaged:  # what the delete images is locked as it is read
        position = first_position(statements, fragment)
        assert position > lock and "FOR UPDATE" in statements[position][0], fragment
    if table in REVIEW_INPUT_TABLES:  # the month save's locks first, then the row
        assert first_position(statements, "LOCK TABLE") < lock
    else:
        assert not any("LOCK TABLE" in sql for sql, _ in statements)


async def test_a_child_another_tab_writes_waits_for_the_locked_row(db, engine):
    """The lock's mode is the fix: a child's foreign key takes FOR KEY SHARE on its parent, and
    FOR UPDATE blocks that — so while a delete holds its card, another tab's new credit on it
    waits (here out to a short lock_timeout, having written nothing) instead of slipping in
    under the cascade; once the delete's transaction is over, it goes through."""
    card = CreditCard(**CARD)
    db.add(card)
    await db.commit()
    card_id = card.id
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as deleting:
        assert await lock_parent(deleting, CreditCard, card_id) is not None
        async with sessions() as other_tab:
            await other_tab.execute(text("SET LOCAL lock_timeout = '200ms'"))
            other_tab.add(CardCredit(card_id=card_id, label="Travel", annual_value=Decimal("300")))
            with pytest.raises(DBAPIError, match="lock timeout"):
                await other_tab.flush()
    async with sessions() as other_tab:  # the delete's transaction is over: the row is free
        other_tab.add(CardCredit(card_id=card_id, label="Travel", annual_value=Decimal("300")))
        await other_tab.commit()


async def delete_card_while(engine, card_id: int, other_tab_write) -> Response:
    """Delete the card while another tab's write (`other_tab_write`, run first and left
    uncommitted) holds a row that hangs off it; that tab commits once the delete waits for it."""
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as other_tab, sessions() as deleting:
        await other_tab.execute(other_tab_write)
        pid = await backend_pid(deleting)
        batch = ChangeBatch(deleting, actor="tab 1")
        task = asyncio.create_task(
            credit_cards_api.delete_credit_card(card_id, db=deleting, batch=batch)
        )
        try:
            await until_blocked(engine, pid, task)
        finally:
            await other_tab.commit()
            [resp] = await asyncio.gather(task, return_exceptions=True)
    assert not isinstance(resp, BaseException) and resp.status_code == 204, resp
    return resp


async def test_a_category_re_pinned_away_during_a_card_delete_keeps_its_new_pin(db, engine):
    """Another tab re-pins a category from the card being deleted to another card, not yet
    committed. A plain read of the pins still saw it on this card, and the delete's unpin then
    waited for that tab and wrote NULL over the new pin. Read FOR UPDATE, the delete waits for
    the tab and Postgres re-checks the pin on the row as committed: the category is no longer
    this card's, and the delete leaves it — and its image — alone."""
    leaving = CreditCard(**CARD)
    staying = CreditCard(**{**CARD, "name": "SavorOne", "slug": "savorone"})
    db.add_all([leaving, staying])
    await db.flush()
    travel = RewardCategory(name="Travel", slug="travel", pinned_card_id=leaving.id)
    db.add(travel)
    await db.commit()
    leaving_id, staying_id, travel_id = leaving.id, staying.id, travel.id
    re_pin = (
        update(RewardCategory)
        .where(RewardCategory.id == travel_id)
        .values(pinned_card_id=staying_id)
    )
    resp = await delete_card_while(engine, leaving_id, re_pin)
    pin = select(RewardCategory.pinned_card_id).where(RewardCategory.id == travel_id)
    assert (await db.execute(pin)).scalar_one() == staying_id
    assert shape(await logged(db, resp.headers["x-change-batch"])) == [("delete", "credit_cards")]


async def test_a_credit_edited_during_a_card_delete_is_imaged_as_edited(db, engine):
    """Another tab edits a credit on the card being deleted, not yet committed. A plain read
    imaged the credit as it was, then the delete waited for the edit and removed the row — so an
    Undo would have brought the old value back over the edit. Read FOR UPDATE, the delete waits
    for the edit and images the credit as it now stands."""
    card = CreditCard(**CARD)
    db.add(card)
    await db.flush()
    credit = CardCredit(card_id=card.id, label="Travel", annual_value=Decimal("300.00"))
    db.add(credit)
    await db.commit()
    card_id, credit_id = card.id, credit.id
    edit = update(CardCredit).where(CardCredit.id == credit_id).values(annual_value=Decimal("350"))
    resp = await delete_card_while(engine, card_id, edit)
    rows = await logged(db, resp.headers["x-change-batch"])
    [imaged] = [row for row in rows if row.table_name == "card_credits"]
    assert imaged.before["annual_value"] == "350.00"


# ── a month save racing the delete of its own row ────────────────────────────────────

MONTH = date(2026, 9, 1)


@dataclass(frozen=True)
class ReviewInput:
    """A month-review input whose delete races a month save that writes a row under it."""

    module: ModuleType  # the router: its delete, and the lock_parent it looks up
    delete: str
    make: type
    fields: dict
    save: str  # the MonthSaveIn part that writes one row under it
    refusal: str  # the delete's 409 once that row exists


REVIEW_INPUTS = [
    pytest.param(
        ReviewInput(
            net_worth_api,
            "delete_account",
            Account,
            {"name": "Checking", "slug": "checking", "group": "cash", "sort_order": 0},
            "balances",
            "account has 1 balance rows — deactivate it instead",
        ),
        id="account",
    ),
    pytest.param(
        ReviewInput(
            spending_api,
            "delete_category",
            SpendingCategory,
            {"name": "Dining", "slug": "dining", "sort_order": 0},
            "spending",
            "category has 1 monthly rows — deactivate it instead",
        ),
        id="spending category",
    ),
]


def save_body(case: ReviewInput, revision: str, row_id: int) -> MonthSaveIn:
    part = (
        {"balances": [{"account_id": row_id, "balance": "5000"}]}
        if case.save == "balances"
        else {"amounts": [{"category_id": row_id, "amount": "50"}]}
    )
    return MonthSaveIn.model_validate({"expected_revision": revision, case.save: part})


def pause_after(monkeypatch, module: ModuleType, name: str) -> tuple[asyncio.Event, asyncio.Event]:
    """Patch `module.name` to run and then stand still, holding whatever it locked: `reached` is
    set once it has run, and it returns only after the test sets `go`."""
    real = getattr(module, name)
    reached, go = asyncio.Event(), asyncio.Event()

    async def paused(*args, **kwargs):
        result = await real(*args, **kwargs)
        reached.set()
        await go.wait()
        return result

    monkeypatch.setattr(module, name, paused)
    return reached, go


async def until_reached(reached: asyncio.Event, task: asyncio.Task) -> None:
    """Return once `task` stands at its pause; fail with its own error if it ended first."""
    waiter = asyncio.create_task(reached.wait())
    done, _ = await asyncio.wait(
        {waiter, task}, timeout=RACE_SECONDS, return_when=asyncio.FIRST_COMPLETED
    )
    if waiter not in done:
        waiter.cancel()
        if task.done():
            task.result()
        raise AssertionError("the request never reached its pause")


async def seeded(auth_client, db, monkeypatch, case: ReviewInput) -> tuple[int, str]:
    """The row, and the month's revision a save of it must name."""
    monkeypatch.setattr(clock, "product_today", lambda: date(2026, 9, 12))
    row = case.make(**case.fields)
    db.add(row)
    await db.commit()
    state = await auth_client.get(f"/api/v1/month-review/months/{MONTH}")
    assert state.status_code == 200, state.text
    return row.id, state.json()["input_revision"]


async def delete_in(session, case: ReviewInput, row_id: int):
    route = getattr(case.module, case.delete)
    return await route(row_id, db=session, batch=ChangeBatch(session, actor="tab 1"))


async def save_in(session, body: MonthSaveIn):
    return await month_review_api.save_month(
        MONTH, body, db=session, batch=ChangeBatch(session, actor="tab 2")
    )


@pytest.mark.parametrize("case", REVIEW_INPUTS)
async def test_a_month_save_waits_for_the_delete_of_its_row_and_is_refused(
    auth_client, db, engine, monkeypatch, case
):
    """The delete gets as far as its row lock, then stands still; the save starts. Row lock
    first, the save took its table locks, wrote under the row and waited on it — then the
    delete's own write waited on the save's table locks, and Postgres aborted the save, the
    app's most important write, as a 500. Review locks first, the save waits at its own
    locks, and after the delete it refuses in words."""
    row_id, revision = await seeded(auth_client, db, monkeypatch, case)
    reached, go = pause_after(monkeypatch, case.module, "lock_parent")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as deleting, sessions() as saving:
        save_pid = await backend_pid(saving)
        tasks = [asyncio.create_task(delete_in(deleting, case, row_id))]
        try:
            await until_reached(reached, tasks[0])
            tasks.append(asyncio.create_task(save_in(saving, save_body(case, revision, row_id))))
            await until_blocked(engine, save_pid, tasks[1])
        finally:
            go.set()
            results = await asyncio.gather(*tasks, return_exceptions=True)
    deleted, saved = results
    assert not isinstance(deleted, BaseException) and deleted.status_code == 204, deleted
    assert isinstance(saved, HTTPException) and saved.status_code in (409, 422), saved


@pytest.mark.parametrize("case", REVIEW_INPUTS)
async def test_a_delete_waits_for_the_month_save_of_its_row_and_is_refused(
    auth_client, db, engine, monkeypatch, case
):
    """The save holds its table locks and stands still; the delete starts. Row lock first, the
    delete locked the row and then waited on the save's table locks at its own write, the save's
    write waited on the row, and Postgres aborted one of them. Review locks first, the delete
    waits at them, and once the save's row exists it refuses with its own sentence."""
    row_id, revision = await seeded(auth_client, db, monkeypatch, case)
    reached, go = pause_after(monkeypatch, month_review_api, "lock_review_inputs")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as deleting, sessions() as saving:
        delete_pid = await backend_pid(deleting)
        tasks = [asyncio.create_task(save_in(saving, save_body(case, revision, row_id)))]
        try:
            await until_reached(reached, tasks[0])
            tasks.append(asyncio.create_task(delete_in(deleting, case, row_id)))
            await until_blocked(engine, delete_pid, tasks[1])
        finally:
            go.set()
            results = await asyncio.gather(*tasks, return_exceptions=True)
    saved, deleted = results
    assert isinstance(saved, MonthSaveOut), saved
    assert isinstance(deleted, HTTPException), deleted
    assert (deleted.status_code, deleted.detail) == (409, case.refusal)
