"""Lane M (2026-09-23 spec §M1, §M4): the monthly update's part saves, pinned with the wizard's
EXACT bodies — a request id always, `reviewed` always, a leg only for the part the action is
about — against the real routes and K3's evidence. A spending save never writes or copies a
snapshot; a take-home save never completes a partly entered month's spending, not even with the
spending box ticked; the Confirm (a PUT with no leg) does, and its Undo takes it back; a balances
save of early balances on or after their 1st makes them final; and a month's $0 consent belongs to
its spending part — a balances save, a balances Confirm or a take-home change keeps it, a changed
amount clears it. A server change that breaks what the wizard sends fails here."""

from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.models import (
    Account,
    AccountBalance,
    ChangeLog,
    MonthlySpending,
    NetWorthSnapshot,
    SpendingCategory,
)
from app.models.month_review import MonthReview, MonthReviewAdoption
from app.services import clock
from app.services.coverage import load_coverage

PT = ZoneInfo("America/Los_Angeles")
AUG, SEP, OCT = date(2026, 8, 1), date(2026, 9, 1), date(2026, 10, 1)
MR = "/api/v1/month-review/months"
UNTICKED = {"balances": False, "spending": False, "take_home": False}


def on(monkeypatch, day: date) -> None:
    monkeypatch.setattr(clock, "product_today", lambda: day)


def wizard(revision: str, *, balances=None, spending=None, reviewed=UNTICKED, close=False) -> dict:
    """MonthlyUpdatePage's body (src/pages/MonthlyUpdatePage.tsx `save`): a leg only for the part
    the action is about, never `recorded_on`."""
    body = {
        "expected_revision": revision,
        "request_id": str(uuid4()),
        "reviewed": reviewed,
        "close": close,
    }
    if balances is not None:
        body["balances"] = balances
    if spending is not None:
        body["spending"] = spending
    return body


def rent_and_take_home(rent_id: int) -> dict:
    """The wizard's spending leg for September: the stored rent row, re-listed as it stands, and a
    take-home typed from the paystub."""
    return {"amounts": [{"category_id": rent_id, "amount": "2072.23"}], "net_pay": "6000.00"}


async def revision(auth_client, month: date) -> str:
    response = await auth_client.get(f"{MR}/{month}")
    assert response.status_code == 200, response.text
    return response.json()["input_revision"]


async def september_with_rent_saved_sep_7(db) -> SpendingCategory:
    """The real copy's September (§V4): Sep 1 balances, adopted Sep 12, rent saved in the UI on
    Sep 7 — partly entered from Oct 1."""
    db.add(MonthReviewAdoption(id=1, adopted_on=date(2026, 9, 12)))
    account = Account(name="Cash", slug="cash", group="cash", sort_order=1)
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add_all([account, rent])
    await db.flush()
    snapshot = NetWorthSnapshot(month=SEP, recorded_on=SEP)
    db.add(snapshot)
    await db.flush()
    db.add(
        AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("100.00"))
    )
    db.add(MonthlySpending(month=SEP, category_id=rent.id, amount=Decimal("2072.23")))
    db.add(
        ChangeLog(
            batch_id=uuid4(),
            source="ui",
            actor="me@example.com",
            label="Saved Sep 2026 month",
            table_name="monthly_spending",
            pk={"id": 1},
            op="insert",
            before=None,
            after={"id": 1},
            month=SEP,
            at=datetime(2026, 9, 7, 12, tzinfo=PT),
        )
    )
    await db.commit()
    return rent


async def september_spending(db) -> str:
    return (await load_coverage(db)).status.spending_state(SEP)


async def undo(auth_client, batch_id: str) -> None:
    response = await auth_client.post(f"/api/v1/activity/batches/{batch_id}/undo")
    assert response.status_code == 200, response.text


async def test_a_spending_part_save_for_a_month_without_balances_writes_no_snapshot(
    auth_client, db, monkeypatch
):
    on(monkeypatch, date(2026, 10, 3))
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=1)
    db.add(rent)
    await db.commit()
    saved = await auth_client.put(
        f"{MR}/{SEP}",
        json=wizard(
            await revision(auth_client, SEP),
            spending=rent_and_take_home(rent.id),
        ),
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["balances"] is None
    assert (await db.execute(select(func.count()).select_from(NetWorthSnapshot))).scalar_one() == 0
    tables = set(
        (
            await db.execute(
                select(ChangeLog.table_name).where(ChangeLog.batch_id == saved.json()["batch_id"])
            )
        ).scalars()
    )
    assert tables == {"monthly_spending", "monthly_cashflow", "month_reviews"}


async def test_a_take_home_part_save_leaves_the_month_partial(auth_client, db, monkeypatch):
    rent = await september_with_rent_saved_sep_7(db)
    on(monkeypatch, date(2026, 10, 3))
    # The wizard's spending body re-lists the stored rent row (unchanged) beside the take-home.
    saved = await auth_client.put(
        f"{MR}/{SEP}",
        json=wizard(
            await revision(auth_client, SEP),
            spending=rent_and_take_home(rent.id),
        ),
    )
    assert saved.status_code == 200, saved.text
    tables = set(
        (
            await db.execute(
                select(ChangeLog.table_name).where(ChangeLog.batch_id == saved.json()["batch_id"])
            )
        ).scalars()
    )
    assert "net_worth_snapshots" not in tables
    assert await september_spending(db) == "partial"


async def test_a_take_home_save_carrying_the_spending_tick_leaves_the_month_partial(
    auth_client, db, monkeypatch
):
    """K's review tightened clause (d): a save that carries the ticked box beside a leg is not a
    confirmation — only the no-leg Confirm is."""
    rent = await september_with_rent_saved_sep_7(db)
    on(monkeypatch, date(2026, 10, 3))
    saved = await auth_client.put(
        f"{MR}/{SEP}",
        json=wizard(
            await revision(auth_client, SEP),
            spending=rent_and_take_home(rent.id),
            reviewed={"balances": False, "spending": True, "take_home": True},
        ),
    )
    assert saved.status_code == 200, saved.text
    assert await september_spending(db) == "partial"


async def test_the_confirm_body_completes_the_month_and_its_undo_takes_it_back(
    auth_client, db, monkeypatch
):
    await september_with_rent_saved_sep_7(db)
    on(monkeypatch, date(2026, 10, 3))
    confirmed = await auth_client.put(
        f"{MR}/{SEP}",
        json=wizard(
            await revision(auth_client, SEP),
            reviewed={"balances": False, "spending": True, "take_home": False},
        ),
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["balances"] is None
    assert confirmed.json()["spending"] is None
    # The request id changes the review row, so even an otherwise unchanged Confirm is logged.
    assert confirmed.json()["batch_id"] is not None
    assert await september_spending(db) == "entered"
    await undo(auth_client, confirmed.json()["batch_id"])
    assert await september_spending(db) == "partial"


async def test_a_confirm_sent_during_the_month_does_not_count_the_same_one_after_it_does(
    auth_client, db, monkeypatch
):
    """Clause (d) counts a confirmation made once the month has ended. The wizard's Confirm body
    sent on Sep 30 leaves September partial on Oct 3; the identical body sent on Oct 3 — the tick
    already stored, only the request id new — completes it."""
    await september_with_rent_saved_sep_7(db)
    confirm = {"balances": False, "spending": True, "take_home": False}
    on(monkeypatch, date(2026, 9, 30))
    early = await auth_client.put(
        f"{MR}/{SEP}", json=wizard(await revision(auth_client, SEP), reviewed=confirm)
    )
    assert early.status_code == 200, early.text
    on(monkeypatch, date(2026, 10, 3))
    assert await september_spending(db) == "partial"
    confirmed = await auth_client.put(
        f"{MR}/{SEP}", json=wizard(await revision(auth_client, SEP), reviewed=confirm)
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["batch_id"] is not None
    assert await september_spending(db) == "entered"


async def test_a_no_leg_review_save_with_the_spending_tick_completes_it(
    auth_client, db, monkeypatch
):
    """The Review step's "Save progress" with nothing changed and the box ticked sends the same
    no-leg PUT as the Confirm."""
    await september_with_rent_saved_sep_7(db)
    on(monkeypatch, date(2026, 10, 3))
    saved = await auth_client.put(
        f"{MR}/{SEP}",
        json=wizard(
            await revision(auth_client, SEP),
            reviewed={"balances": True, "spending": True, "take_home": False},
        ),
    )
    assert saved.status_code == 200, saved.text
    assert await september_spending(db) == "entered"


async def test_a_balances_part_save_of_early_balances_on_their_1st_makes_them_final(
    auth_client, db, monkeypatch
):
    account = Account(name="Cash", slug="cash", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    snapshot = NetWorthSnapshot(month=OCT, recorded_on=date(2026, 9, 22))
    db.add(snapshot)
    await db.flush()
    db.add(
        AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("100.00"))
    )
    await db.commit()
    on(monkeypatch, OCT)
    # "Confirm Oct 1 balances": the unchanged balances, notes cleared as the wizard sends them.
    confirmed = await auth_client.put(
        f"{MR}/{OCT}",
        json=wizard(
            await revision(auth_client, OCT),
            balances={"notes": None, "balances": [{"account_id": account.id, "balance": "100.00"}]},
        ),
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["spending"] is None
    month = (await auth_client.get(f"/api/v1/net-worth/months/{OCT}")).json()
    assert (month["recorded_on"], month["as_of"], month["provisional"]) == (
        "2026-10-01",
        "2026-10-01",
        False,
    )
    await undo(auth_client, confirmed.json()["batch_id"])
    month = (await auth_client.get(f"/api/v1/net-worth/months/{OCT}")).json()
    assert (month["recorded_on"], month["provisional"]) == ("2026-09-22", True)


# --- The $0 consent belongs to the spending part (2026-09-23 spec §M1: saving one part never
# touches the other). A month that really spent nothing is saved with the "Confirm remaining
# categories as $0" box ticked; the box is not re-sent on later saves (it resets on every load), so
# a balances save, a balances Confirm or a take-home change must leave the consent standing. A save
# that changes a spending amount without re-sending it clears it.

ZERO_LINE = "Confirm that the all-zero spending entries are intentional."


async def august_saved_as_zero(auth_client, db, monkeypatch, *, recorded_on: date = AUG):
    """August on Sep 5: Aug 1 balances, and the wizard's spending save with the $0 box ticked —
    the one category at $0.00 — beside a take-home."""
    account = Account(name="Cash", slug="cash", group="cash", sort_order=1)
    food = SpendingCategory(name="Food", slug="food", sort_order=1)
    db.add_all([account, food])
    await db.flush()
    snapshot = NetWorthSnapshot(month=AUG, recorded_on=recorded_on)
    db.add(snapshot)
    await db.flush()
    db.add(
        AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("100.00"))
    )
    await db.commit()
    on(monkeypatch, date(2026, 9, 5))
    saved = await auth_client.put(
        f"{MR}/{AUG}",
        json=wizard(
            await revision(auth_client, AUG),
            spending={
                "amounts": [{"category_id": food.id, "amount": "0.00"}],
                "net_pay": "5000.00",
                "confirm_zero": True,
            },
        ),
    )
    assert saved.status_code == 200, saved.text
    assert await zero_confirmed(auth_client, db)
    return account, food


async def zero_confirmed(auth_client, db) -> bool:
    """August's $0 consent as every reader sees it: the stored flag, the review's blockers and
    K3's spending state (a lapsed consent reads the month's spending as missing)."""
    review = await db.get(MonthReview, AUG, populate_existing=True)
    blockers = (await auth_client.get(f"{MR}/{AUG}")).json()["blockers"]
    state = (await load_coverage(db)).status.spending_state(AUG)
    held = bool(review and review.zero_spending_confirmed)
    assert held == (ZERO_LINE not in blockers) == (state == "entered"), (held, blockers, state)
    return held


async def test_a_balances_save_keeps_the_months_zero_spending_consent(auth_client, db, monkeypatch):
    account, _ = await august_saved_as_zero(auth_client, db, monkeypatch)
    saved = await auth_client.put(
        f"{MR}/{AUG}",
        json=wizard(
            await revision(auth_client, AUG),
            balances={"notes": None, "balances": [{"account_id": account.id, "balance": "150.00"}]},
        ),
    )
    assert saved.status_code == 200, saved.text
    assert await zero_confirmed(auth_client, db)


async def test_confirming_early_balances_keeps_the_zero_spending_consent(
    auth_client, db, monkeypatch
):
    """The Confirm sends the balances unchanged; the server restamps the date (K4), which moves
    the month's digest — and must not move the consent."""
    account, _ = await august_saved_as_zero(
        auth_client, db, monkeypatch, recorded_on=date(2026, 7, 25)
    )
    confirmed = await auth_client.put(
        f"{MR}/{AUG}",
        json=wizard(
            await revision(auth_client, AUG),
            balances={"notes": None, "balances": [{"account_id": account.id, "balance": "100.00"}]},
        ),
    )
    assert confirmed.status_code == 200, confirmed.text
    month = (await auth_client.get(f"/api/v1/net-worth/months/{AUG}")).json()
    assert month["recorded_on"] == "2026-09-05"
    assert await zero_confirmed(auth_client, db)


async def test_a_take_home_change_keeps_the_zero_spending_consent(auth_client, db, monkeypatch):
    """The wizard's spending leg re-lists the stored $0.00 row unchanged beside the new take-home,
    and does not re-send the box."""
    _, food = await august_saved_as_zero(auth_client, db, monkeypatch)
    saved = await auth_client.put(
        f"{MR}/{AUG}",
        json=wizard(
            await revision(auth_client, AUG),
            spending={
                "amounts": [{"category_id": food.id, "amount": "0.00"}],
                "net_pay": "5100.00",
            },
        ),
    )
    assert saved.status_code == 200, saved.text
    assert await zero_confirmed(auth_client, db)


async def test_changing_a_spending_amount_clears_the_zero_spending_consent(
    auth_client, db, monkeypatch
):
    _, food = await august_saved_as_zero(auth_client, db, monkeypatch)
    for amount in ("12.00", "0.00"):
        saved = await auth_client.put(
            f"{MR}/{AUG}",
            json=wizard(
                await revision(auth_client, AUG),
                spending={
                    "amounts": [{"category_id": food.id, "amount": amount}],
                    "net_pay": "5000.00",
                },
            ),
        )
        assert saved.status_code == 200, saved.text
    # Back at $0.00 without the box: the zeros are no longer confirmed.
    assert not await zero_confirmed(auth_client, db)


# --- The wizard reads K4's blocker by its phrase (src/pages/MonthlyUpdatePage.tsx
# `serverEarlyBlocker`): it shows the sentence beside "Save and close", and offers "Confirm {Oct 1}
# balances", only when the server lists it. A reworded sentence would silently take the Confirm
# away — so the phrase is pinned here, beside the exemption the wizard relies on.

EARLY_PHRASE = " balances were recorded early, on "


async def test_an_early_month_lists_the_blocker_phrase_the_wizard_reads_history_does_not(
    auth_client, db, monkeypatch
):
    db.add(MonthReviewAdoption(id=1, adopted_on=date(2026, 9, 12)))
    account = Account(name="Cash", slug="cash", group="cash", sort_order=1)
    db.add(account)
    await db.flush()
    # Oct 1 recorded Sep 22 (after adoption, blocked); Aug 1 recorded Jul 25 (history, exempt).
    for month, recorded_on in ((OCT, date(2026, 9, 22)), (AUG, date(2026, 7, 25))):
        snapshot = NetWorthSnapshot(month=month, recorded_on=recorded_on)
        db.add(snapshot)
        await db.flush()
        db.add(
            AccountBalance(
                snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("100.00")
            )
        )
    await db.commit()
    on(monkeypatch, date(2026, 10, 3))
    october = (await auth_client.get(f"{MR}/{OCT}")).json()["blockers"]
    assert any(EARLY_PHRASE in line for line in october), october
    august = (await auth_client.get(f"{MR}/{AUG}")).json()["blockers"]
    assert not any(EARLY_PHRASE in line for line in august), august
