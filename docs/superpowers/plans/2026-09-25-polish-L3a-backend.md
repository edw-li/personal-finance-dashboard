# Polish L3a "Backend A" — exact undo for portfolio and calendar, spending/net-worth completions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every user-intent write in `backend/app/api/portfolio.py` and `backend/app/api/calendar.py` records its rows
in one change batch and answers `X-Change-Batch`; the two cascade deletes in `spending.py` / `net_worth.py` image what
hangs off the row they remove; five already-logged routes stop throwing their batch id away — so the Activity card's
Undo restores exactly what a write changed (spec `docs/superpowers/specs/2026-09-25-polish-alignment-feedback-undo-design.md`
§6.1 and §1 D1; contract C1 in `2026-09-25-polish-00-overview.md`).

**Architecture:** the existing `services/changelog.py` machinery, unchanged. Each route takes
`batch: ChangeBatch = Depends(change_batch)`, images rows around its writes (`record_insert` after a flush,
`record_update` with a `row_image` taken before the mutation, `record_delete` before `db.delete`), sets a human label,
commits through `batch.commit()` and answers the header through `batch_header(...)`. Deletes image their dependents
children-first and parent-last through explicit ORM statements, then FLUSH before deleting the parent (see decision 2).
No schema change, no migration, no service change.

**Tech Stack:** FastAPI 0.141, SQLAlchemy 2.0.52 (async) + asyncpg 0.31, Postgres 16, pytest (+ xdist), ruff 0.16.

---

## Conventions for every task

Run everything from the lane worktree's backend, with the main checkout's venv and the lane's own test database
(Postgres is on `127.0.0.1:5433`; the database is created on first use):

```bash
cd /c/Users/edyli/personal-finance-dashboard/.worktrees/polish-undo-a/backend
export FINANCE_TEST_DB=finance_test_l3a
PY=C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe
```

- Tests: `$PY -m pytest <paths> -q`. Full suite at the end only: `$PY -m pytest -n 4 -q`.
- Lint: `$PY -m ruff check app tests`; format the files a task touched with `$PY -m ruff format <files>` (every file
  this lane edits is ruff-format clean today — keep it so).
- One commit per task, conventional prefix, a body saying what and why. Never push, never merge.
- The shared test session (`tests/conftest.py`): the `client` drives routes through the test's own `db` session. An
  Undo refusal rolls that session back and expires every instance — read ids into plain ints before any refusal and
  `await db.rollback()` after one before reusing `db`. `undo_batch` ends with `db.expunge_all()`.

## Decisions (made while reading the code; the "why" the reviewer will ask for)

1. **Labels** (Activity-card voice; dates via `app.services.day_labels.long_day` → "Sep 2, 2026", locale-proof):

   | Route | Label |
   |---|---|
   | `portfolio.update_portfolio_account` | `Changed the owner of {label}` |
   | `create_security` / `update_security` / `delete_security` | `Added security {ticker}` / `Edited security {ticker}` / `Deleted security {ticker}` |
   | `create_transaction` / `update_transaction` / `delete_transaction` | `Added {txn}` / `Edited {txn}` / `Deleted {txn}` where `{txn}` = `NVDA buy of Sep 2, 2026`, or `VOO buy (undated)` for a dateless (imported) row |
   | `reorder_transactions` | `Moved {txn}` when one row's move explains the new order (`moved_ids`, as the categories reorder names one), else `Reordered {n} transactions` |
   | `create_dividend` / `update_dividend` / `delete_dividend` | `Added NVDA dividend of Aug 31, 2026` / `Edited …` / `Deleted …` |
   | `update_classification`, `save_allocation_targets` | unchanged (logged since 2026-09-13) |
   | `calendar.create_custom_event` / `update_custom_event` / `delete_custom_event` | `Added calendar event {title}` / `Edited calendar event {title}` / `Deleted calendar event {title}` |
   | `put_override` | from what changed: `Marked {event} done`, `Reopened {event}`, `Hid {event}`, `Unhid {event}`, `Set your figure for {event}`, `Cleared your figure for {event}`, `Edited the note on {event}`; two changes at once → `Edited {event}` |
   | `delete_override` | `Cleared your edits on {event}` |
   | `create_feed_token` | `Created calendar feed link {label}` |

   `{event}` is the calendar's own label plus the key's day: `Tax deadline — Q3 estimated payment of Sep 15, 2026`.
2. **Flush children before deleting the parent.** Probed on this box: with no `relationship()` between the mappers, the
   unit of work orders DELETEs by class name, so `securities` goes BEFORE `security_dividend_events`; the FK cascade then
   takes the events and the ORM's own DELETE matches 0 rows (`SAWarning: … expected to delete 1 row(s); 0 were
   matched`). Every cascade delete here therefore does `await db.flush()` after the children and before
   `db.delete(parent)`.
3. **Naming an overridden event composes the calendar for that one day.** The route only has the key
   (`source:entity_ref:date`); the label lives in the generators (and in the fold, for paydays and vests). `_event_name`
   runs the router's own `_compose_for` over the key's day — BEFORE the write, read-only — and takes the matching
   event's label. The overdue monthly reminder sits on today while its key keeps the nominal day, so a `ritual` key's
   window runs on to today (capped by `MAX_SPAN_DAYS`). A key no event carries, or a date no calendar has
   (`2026-02-30` passes `KEY_RE`), is named by the key: `Hid calendar event rsu:vest:2099-01-01`. Chosen over a second
   copy of every generator's label strings (drift) and over a client-sent label (C2 fixes the client's arguments).
4. **A feed link's image leaves out `token_hash`.** Undo of the create deletes by primary key, so it still works
   exactly; but an Undo of THAT Undo would re-insert the row from its image — reviving a link the user took back, maybe
   after revoking it (revoke is unlogged, so nothing refuses on overlap). Without the hash the re-insert violates NOT
   NULL and the Activity route answers `REPLAY_REFUSAL`: no chain of Undos can put a credential back, which is the
   reason `revoke_feed_token` is exempt in the first place.
5. **`_resolve_account`** wraps `services.portfolio_accounts.resolve_portfolio_account` in the router: it looks the
   label up first and records an insert only when the service had to mint the row, ahead of the transaction/dividend
   that uses it. The service stays untouched (the importer shares it).
6. **Budget rows keep their month** (`month=effective_month`) in `delete_category`, like `put_category_budget` and
   `delete_category_budget` already record them.
7. **Test layout** — new files only, so lane L3b (same pin file, different routers) cannot collide beyond the pin dict:
   `tests/exact_undo.py` (helpers), `tests/test_changelog_portfolio.py`, `tests/test_changelog_calendar.py`,
   `tests/test_changelog_completions.py`. Existing tests edited only where the behaviour they pin changed
   (`test_reorder_transactions_api.py`: the reorder is logged now; `test_reorder_serialization.py`: the direct call's
   signature) plus the pin test.
8. **Out of scope, reported instead of edited** (services are off-limits unless strictly needed): the comments in
   `services/ordering.py` ("an Activity-card Undo (the two logged lists)") and `services/changelog.py` ("An Undo that
   rewrites accounts or spending categories …") now undersell — the ledger's reorder is logged too. The code already
   serializes it (`ORDERED_LISTS` includes `PositionTransaction`); Task 4 proves it.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `backend/app/api/portfolio.py` | modify | log all 11 unlogged writes; `_resolve_account`, `_txn_name`; `delete_security` images its derived rows; the reorder docstring rewritten |
| `backend/app/api/calendar.py` | modify | log six writes; `_event_name`, `_override_label`; feed-link image without the hash |
| `backend/app/api/spending.py` | modify | header on create/update category + budget PUT; `delete_category` images reward links and budgets |
| `backend/app/api/net_worth.py` | modify | header on create/update account; `delete_account` images component links and card links |
| `backend/tests/exact_undo.py` | create | `logged`, `shape`, `images`, `undo` — the exact-undo test vocabulary |
| `backend/tests/test_changelog_portfolio.py` | create | portfolio batches, labels, headers, exact undo, refusals, ledger-lock serialization |
| `backend/tests/test_changelog_calendar.py` | create | calendar batches, labels, headers, exact undo, the exempt pair |
| `backend/tests/test_changelog_completions.py` | create | the five headers; category and account cascade undo |
| `backend/tests/test_changelog_pin.py` | modify | `portfolio.py` and `calendar.py` join LOGGED; two calendar EXEMPT entries |
| `backend/tests/test_reorder_transactions_api.py` | modify | docstring + the "unlogged" assertion becomes the logged rows |
| `backend/tests/test_reorder_serialization.py` | modify | `reorder_transactions` direct calls pass `Response()` and a `ChangeBatch` |

---

### Task 1: Securities — create, edit and delete are logged; a delete images its price rows

**Files:**
- Create: `backend/tests/exact_undo.py`
- Create: `backend/tests/test_changelog_portfolio.py`
- Modify: `backend/app/api/portfolio.py` (imports; `create_security`, `update_security`, `delete_security`)

- [ ] **Step 1: Write the shared helpers**

`backend/tests/exact_undo.py`:

```python
"""Shared by the exact-undo tests (2026-09-25 polish spec §6.1): what one batch logged, every
row of a table as its change-log image, and the Undo round trip. "Exact" means the rows an
Undo puts back are the rows the delete took — the same images, ids included — so the tests
compare whole images, never a handful of fields."""

from sqlalchemy import select

from app.models import ChangeLog
from app.services.changelog import row_image

ACTIVITY = "/api/v1/activity"


async def logged(db, batch_id: str) -> list[ChangeLog]:
    """The batch's change-log rows in the order the route recorded them."""
    return list(
        (
            await db.execute(
                select(ChangeLog).where(ChangeLog.batch_id == batch_id).order_by(ChangeLog.id)
            )
        )
        .scalars()
        .all()
    )


def shape(rows: list[ChangeLog]) -> list[tuple[str, str]]:
    """(op, table) per row — the sequence an Undo replays in reverse."""
    return [(row.op, row.table_name) for row in rows]


async def images(db, model) -> list[dict]:
    """Every row of `model` as its change-log image, in primary-key order. Read with
    populate_existing, so an instance the shared session still holds answers with what the
    DATABASE holds: an Undo's Core statements bypass the identity map."""
    keys = list(model.__table__.primary_key.columns)
    result = await db.execute(
        select(model).order_by(*keys).execution_options(populate_existing=True)
    )
    return [row_image(row) for row in result.scalars().all()]


async def undo(auth_client, batch_id: str):
    return await auth_client.post(f"{ACTIVITY}/batches/{batch_id}/undo")
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_changelog_portfolio.py` (later tasks append to it):

```python
"""Exact undo for the portfolio router (2026-09-25 polish spec §6.1, D1): every user-intent
write records its rows in one change batch and answers X-Change-Batch, and a delete images
what hangs off the row it removes, so the Activity card's Undo puts back the same rows — ids,
ledger positions and price history included."""

from datetime import UTC, date, datetime
from decimal import Decimal

from app.models import LatestPrice, PriceHistory, Security, SecurityDividendEvent
from app.services.changelog import DEPENDENT_REFUSAL, REPLAY_REFUSAL
from tests.exact_undo import images, logged, shape, undo

PORTFOLIO = "/api/v1/portfolio"
SECURITIES = f"{PORTFOLIO}/securities"
VOO = {"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "holding_type": "etf"}


async def priced_security(db) -> Security:
    """VOO with everything a price refresh leaves behind: two historical ex-dividend markers,
    three daily closes and a latest quote."""
    security = Security(
        ticker="VOO",
        name="Vanguard S&P 500 ETF",
        holding_type="etf",
        annual_dividend=Decimal("6.6500"),
        ex_div_date=date(2026, 6, 27),
    )
    db.add(security)
    await db.flush()
    db.add_all(
        [
            SecurityDividendEvent(
                security_id=security.id, ex_date=date(2025, 3, 27), per_share=Decimal("1.812300")
            ),
            SecurityDividendEvent(
                security_id=security.id, ex_date=date(2025, 6, 30), per_share=Decimal("1.744900")
            ),
            *[
                PriceHistory(
                    security_id=security.id,
                    price_date=date(2026, 9, day),
                    close=Decimal(f"{540 + day}.1200"),
                )
                for day in (21, 22, 23)
            ],
            LatestPrice(
                security_id=security.id,
                price=Decimal("563.4100"),
                quoted_at=datetime(2026, 9, 24, 20, 0, tzinfo=UTC),
                source="yfinance",
            ),
        ]
    )
    await db.commit()
    return security


# ── securities ───────────────────────────────────────────────────────────────────────


async def test_security_create_edit_and_delete_are_logged_with_their_batch(auth_client, db):
    created = await auth_client.post(SECURITIES, json={**VOO, "ticker": " voo "})
    assert created.status_code == 201, created.text
    security_id = created.json()["id"]
    [row] = await logged(db, created.headers["x-change-batch"])
    assert (row.op, row.table_name, row.label) == ("insert", "securities", "Added security VOO")
    assert row.after["ticker"] == "VOO"

    path = f"{SECURITIES}/{security_id}"
    edited = await auth_client.patch(path, json={"name": "Vanguard 500"})
    assert edited.status_code == 200, edited.text
    [row] = await logged(db, edited.headers["x-change-batch"])
    assert (row.op, row.label) == ("update", "Edited security VOO")
    assert (row.before["name"], row.after["name"]) == ("Vanguard S&P 500 ETF", "Vanguard 500")
    # Nothing changed, nothing logged — and no header, so the client offers no Undo.
    unchanged = await auth_client.patch(path, json={"name": "Vanguard 500"})
    assert unchanged.status_code == 200 and "x-change-batch" not in unchanged.headers

    deleted = await auth_client.delete(path)
    assert deleted.status_code == 204
    [row] = await logged(db, deleted.headers["x-change-batch"])
    assert (row.op, row.table_name, row.label) == ("delete", "securities", "Deleted security VOO")


async def test_deleting_a_security_takes_its_price_rows_and_undo_puts_back_every_one(
    auth_client, db
):
    security = await priced_security(db)
    security_id = security.id
    tables = (Security, SecurityDividendEvent, PriceHistory, LatestPrice)
    before = {model: await images(db, model) for model in tables}
    deleted = await auth_client.delete(f"{SECURITIES}/{security_id}")
    assert deleted.status_code == 204, deleted.text
    batch_id = deleted.headers["x-change-batch"]
    rows = await logged(db, batch_id)
    # Children first, the security LAST: the Undo replays in reverse, so the security is back
    # before the rows that point at it.
    assert shape(rows) == [
        ("delete", "security_dividend_events"),
        ("delete", "security_dividend_events"),
        ("delete", "price_history"),
        ("delete", "price_history"),
        ("delete", "price_history"),
        ("delete", "latest_prices"),
        ("delete", "securities"),
    ]
    assert {row.label for row in rows} == {"Deleted security VOO"}
    for model in tables:
        assert await images(db, model) == []
    restored = await undo(auth_client, batch_id)
    assert restored.status_code == 200, restored.text
    assert (restored.json()["label"], restored.json()["rows"]) == (
        "Undid: Deleted security VOO",
        7,
    )
    for model in tables:
        assert await images(db, model) == before[model]  # the same rows, ids included


async def test_undoing_a_security_delete_after_the_ticker_came_back_refuses(auth_client, db):
    security = await priced_security(db)
    deleted = await auth_client.delete(f"{SECURITIES}/{security.id}")
    assert deleted.status_code == 204
    again = await auth_client.post(SECURITIES, json=VOO)
    assert again.status_code == 201, again.text
    again_id = again.json()["id"]
    refused = await undo(auth_client, deleted.headers["x-change-batch"])
    # No later batch names the old rows, so it is the replay itself that fails: the old
    # security's ticker is taken again (an accepted behaviour, spec §6.1).
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == REPLAY_REFUSAL
    await db.rollback()  # the refusal rolled the shared session back
    listed = (await auth_client.get(SECURITIES)).json()
    assert [(row["id"], row["ticker"]) for row in listed] == [(again_id, "VOO")]
    assert await images(db, PriceHistory) == []


async def test_undoing_a_security_create_after_a_refresh_priced_it_refuses(auth_client, db):
    created = await auth_client.post(SECURITIES, json=VOO)
    assert created.status_code == 201, created.text
    # The price refresh writes unlogged, as the machine it is.
    db.add(
        PriceHistory(
            security_id=created.json()["id"], price_date=date(2026, 9, 24), close=Decimal("563.41")
        )
    )
    await db.commit()
    refused = await undo(auth_client, created.headers["x-change-batch"])
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == DEPENDENT_REFUSAL
```

- [ ] **Step 3: Run them to see them fail**

Run: `$PY -m pytest tests/test_changelog_portfolio.py -q`
Expected: 4 failed — `KeyError: 'x-change-batch'` (no route answers the header yet).

- [ ] **Step 4: Implement**

In `backend/app/api/portfolio.py`, extend the imports:

```python
from app.models import (
    DividendPayment,
    LatestPrice,
    Person,
    PortfolioAccount,
    PortfolioValueHistory,
    PositionTransaction,
    PriceHistory,
    Security,
    SecurityDividendEvent,
)
```

```python
from app.services.changelog import (
    CHANGE_BATCH_HEADER,
    ChangeBatch,
    batch_header,
    change_batch,
    row_image,
)
from app.services.day_labels import long_day
```

Replace `create_security`:

```python
@router.post("/securities", response_model=SecurityOut, status_code=201)
async def create_security(
    body: SecurityCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Security:
    """Logged (2026-09-25 polish spec §6.1). Accepted: once a refresh has written prices for
    the new security, undoing the create refuses (DEPENDENT_REFUSAL) — the price rows depend
    on it."""
    ticker = _normalize_ticker(body.ticker)
    name = _validated_name(body.name)
    annual = body.annual_dividend
    if annual is not None:
        annual = _validated_annual_dividend(annual)
    ex_div_date = body.ex_div_date
    if ex_div_date is not None:
        ex_div_date = require_reasonable_date(ex_div_date, "ex_div_date")
    existing = (
        (await db.execute(select(Security).where(Security.ticker == ticker))).scalars().first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"security {ticker!r} already exists")
    security = Security(
        ticker=ticker,
        name=name,
        industry=body.industry,
        holding_type=body.holding_type,
        is_manual_priced=body.is_manual_priced,
        annual_dividend=annual,
        ex_div_date=ex_div_date,
    )
    db.add(security)
    await db.flush()
    batch.record_insert(security)
    batch.label = f"Added security {security.ticker}"
    response.headers.update(batch_header(await batch.commit()))
    return security
```

Replace `update_security`:

```python
@router.patch("/securities/{security_id}", response_model=SecurityOut)
async def update_security(
    security_id: int,
    body: SecurityUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Security:
    """Accepted (spec §6.1): the change log keeps whole-row images, so undoing an edit also
    writes back the refresh-owned columns (annual dividend, ex-dates) as they stood at the
    edit — the next refresh restores them. The refresh is unlogged, so the overlap refusal
    cannot see it (update_classification has always had this property)."""
    security = await _get_security(db, security_id)
    # Validate EVERY field before touching the ORM object: a 422 raised halfway through a
    # multi-field PATCH would otherwise leave half the row mutated for the next autoflush.
    validated: dict[str, object] = {}
    for field_name, value in body.model_dump(exclude_unset=True).items():
        if value is None and field_name in NON_NULLABLE_SECURITY_FIELDS:
            continue  # explicit null on a NOT NULL column = no-op request
        if value is not None:
            if field_name == "name":
                value = _validated_name(value)
            elif field_name == "annual_dividend":
                value = _validated_annual_dividend(value)
            elif field_name == "ex_div_date":
                value = require_reasonable_date(value, "ex_div_date")
        validated[field_name] = value
    before = row_image(security)
    for field_name, value in validated.items():
        setattr(security, field_name, value)
    batch.record_update(security, before)
    batch.label = f"Edited security {security.ticker}"
    response.headers.update(batch_header(await batch.commit()))
    return security
```

Replace `delete_security`:

```python
@router.delete("/securities/{security_id}", status_code=204)
async def delete_security(
    security_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """Refused while transactions or dividends reference the security (deactivate instead).
    Otherwise its derived rows go first — the historical ex-dividend markers, the daily closes
    (~780 for the employer ticker) and the latest quote — each imaged and deleted through the
    ORM rather than left to ON DELETE CASCADE, then the security LAST, so an Undo (which
    replays in reverse) restores the security and then every row that hung off it, ids
    included. Accepted (spec §6.1): once the ticker is created again, that Undo refuses
    (REPLAY_REFUSAL) — the ticker is taken."""
    security = await _get_security(db, security_id)
    txn_count = (
        await db.execute(
            select(func.count())
            .select_from(PositionTransaction)
            .where(PositionTransaction.security_id == security_id)
        )
    ).scalar_one()
    dividend_count = (
        await db.execute(
            select(func.count())
            .select_from(DividendPayment)
            .where(DividendPayment.security_id == security_id)
        )
    ).scalar_one()
    if txn_count or dividend_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"security has {txn_count} transactions and {dividend_count} dividends"
                " — deactivate it instead"
            ),
        )
    events = (
        (
            await db.execute(
                select(SecurityDividendEvent)
                .where(SecurityDividendEvent.security_id == security_id)
                .order_by(SecurityDividendEvent.id)
            )
        )
        .scalars()
        .all()
    )
    history = (
        (
            await db.execute(
                select(PriceHistory)
                .where(PriceHistory.security_id == security_id)
                .order_by(PriceHistory.id)
            )
        )
        .scalars()
        .all()
    )
    latest = await db.get(LatestPrice, security_id)
    for row in [*events, *history, *([] if latest is None else [latest])]:
        batch.record_delete(row)
        await db.delete(row)
    # Out before the security's own DELETE: no relationship() orders these mappers, and the
    # unit of work would otherwise delete the security first and let the cascade take the
    # markers from under their own DELETEs.
    await db.flush()
    batch.record_delete(security)
    await db.delete(security)
    batch.label = f"Deleted security {security.ticker}"
    batch_id = await batch.commit()
    return Response(status_code=204, headers=batch_header(batch_id))
```

Every child row is loaded (`.all()`) before the first `db.delete`, so no query's autoflush runs mid-way through the
deletes.

- [ ] **Step 5: Run the tests to see them pass**

Run: `$PY -m pytest tests/test_changelog_portfolio.py tests/test_portfolio_api.py -q`
Expected: all passed (the existing `test_delete_security_guarded_when_referenced` still sees its price rows go).

- [ ] **Step 6: Format, lint, commit**

```bash
$PY -m ruff format app/api/portfolio.py tests/exact_undo.py tests/test_changelog_portfolio.py
$PY -m ruff check app tests
git add app/api/portfolio.py tests/exact_undo.py tests/test_changelog_portfolio.py
git commit -m "feat(portfolio): securities are change-logged; a delete images its price rows so Undo restores them" -m "create/update/delete_security record through a ChangeBatch and answer X-Change-Batch. The delete images and deletes its security_dividend_events, price_history and latest_prices rows explicitly (children first, flushed before the parent: no relationship orders the mappers, so the unit of work would delete the security first), so the Activity Undo brings back every row with its id. Polish spec 6.1 / D1."
```

---

### Task 2: Transactions — create, edit and delete are logged, and the label a write mints is imaged

**Files:**
- Modify: `backend/app/api/portfolio.py` (`_resolve_account`, `_txn_name`; `create_transaction`, `update_transaction`,
  `delete_transaction`)
- Modify: `backend/tests/test_changelog_portfolio.py`

- [ ] **Step 1: Write the failing tests**

Add to the imports of `backend/tests/test_changelog_portfolio.py`:

```python
from sqlalchemy import select

from app.models import PortfolioAccount, PositionTransaction
from tests.portfolio_factories import acct
```

(merged into the existing `from app.models import …` line, which becomes
`from app.models import LatestPrice, PortfolioAccount, PositionTransaction, PriceHistory, Security, SecurityDividendEvent`).

Add below `priced_security`:

```python
TRANSACTIONS = f"{PORTFOLIO}/transactions"


async def stock(db, ticker: str = "NVDA", name: str = "NVIDIA") -> int:
    security = Security(ticker=ticker, name=name, holding_type="stock")
    db.add(security)
    await db.commit()
    return security.id


async def ledger(db) -> list[int]:
    """Three NVDA rows at 10, 20, 30: a dated UI buy, an undated imported buy, a dated sell."""
    security_id = await stock(db)
    rows = [
        PositionTransaction(
            security_id=security_id,
            portfolio_account=acct("RH Taxable"),
            type="buy",
            txn_date=date(2026, 9, 2),
            shares=Decimal("10.000000"),
            price=Decimal("120.5000"),
            fees=Decimal("1.00"),
            sort_index=10,
            source="ui",
        ),
        PositionTransaction(
            security_id=security_id,
            portfolio_account=acct("RH Taxable"),
            type="buy",
            shares=Decimal("5.000000"),
            price=Decimal("90.0000"),
            sort_index=20,
            source="import",
            import_key=20,
        ),
        PositionTransaction(
            security_id=security_id,
            portfolio_account=acct("RH Taxable"),
            type="sell",
            txn_date=date(2026, 9, 10),
            shares=Decimal("2.000000"),
            price=Decimal("130.0000"),
            sort_index=30,
            source="ui",
            notes="trim",
        ),
    ]
    db.add_all(rows)
    await db.commit()
    return [row.id for row in rows]


async def replay(db) -> list[tuple[int, int]]:
    rows = await db.execute(
        select(PositionTransaction.id, PositionTransaction.sort_index).order_by(
            PositionTransaction.sort_index, PositionTransaction.id
        )
    )
    return [(row.id, row.sort_index) for row in rows]


def buy(security_id: int, account: str, **fields) -> dict:
    return {
        "security_id": security_id,
        "account": account,
        "type": "buy",
        "shares": "10",
        "price": "120.5",
        **fields,
    }
```

Append the tests:

```python
# ── transactions ─────────────────────────────────────────────────────────────────────


async def test_a_transaction_on_a_new_label_logs_the_label_before_the_row(auth_client, db):
    security_id = await stock(db)
    first = await auth_client.post(
        TRANSACTIONS, json=buy(security_id, "RH Joint Taxable", txn_date="2026-09-02")
    )
    assert first.status_code == 201, first.text
    first_batch = first.headers["x-change-batch"]
    rows = await logged(db, first_batch)
    assert shape(rows) == [("insert", "portfolio_accounts"), ("insert", "position_transactions")]
    assert {row.label for row in rows} == {"Added NVDA buy of Sep 2, 2026"}
    assert rows[0].after["label"] == "RH Joint Taxable"
    assert rows[1].after["portfolio_account_id"] == rows[0].after["id"]
    # A label that already exists mints nothing: only the row is logged.
    second = await auth_client.post(TRANSACTIONS, json=buy(security_id, "RH Joint Taxable"))
    assert second.status_code == 201, second.text
    second_batch = second.headers["x-change-batch"]
    [row] = await logged(db, second_batch)
    assert (row.table_name, row.label) == ("position_transactions", "Added NVDA buy (undated)")
    # While the second row files under the label, undoing the first cannot take the label away.
    refused = await undo(auth_client, first_batch)
    assert refused.status_code == 409 and refused.json()["detail"] == DEPENDENT_REFUSAL
    await db.rollback()
    assert (await undo(auth_client, second_batch)).status_code == 200
    assert (await undo(auth_client, first_batch)).status_code == 200
    assert await images(db, PositionTransaction) == []
    assert await images(db, PortfolioAccount) == []  # the label the first write minted went too


async def test_moving_a_transaction_to_a_new_label_images_its_new_account_id(auth_client, db):
    security_id = await stock(db)
    created = await auth_client.post(
        TRANSACTIONS, json=buy(security_id, "RH Taxable", txn_date="2026-09-02")
    )
    assert created.status_code == 201, created.text
    txn_id = created.json()["id"]
    [label_row, _] = await logged(db, created.headers["x-change-batch"])
    path = f"{TRANSACTIONS}/{txn_id}"
    edited = await auth_client.patch(path, json={"account": "Fidelity Taxable", "price": "121"})
    assert edited.status_code == 200, edited.text
    edit_batch = edited.headers["x-change-batch"]
    rows = await logged(db, edit_batch)
    assert shape(rows) == [("insert", "portfolio_accounts"), ("update", "position_transactions")]
    assert {row.label for row in rows} == {"Edited NVDA buy of Sep 2, 2026"}
    # The relationship moves the FK only at a flush — the image was taken after one.
    assert rows[1].before["portfolio_account_id"] == label_row.after["id"]
    assert rows[1].after["portfolio_account_id"] == rows[0].after["id"]
    assert (rows[1].before["price"], rows[1].after["price"]) == ("120.5000", "121.0000")
    unchanged = await auth_client.patch(path, json={"price": "121"})
    assert unchanged.status_code == 200 and "x-change-batch" not in unchanged.headers
    assert (await undo(auth_client, edit_batch)).status_code == 200
    listed = (await auth_client.get(TRANSACTIONS)).json()
    assert [(row["id"], row["account"], row["price"]) for row in listed] == [
        (txn_id, "RH Taxable", "120.5000")
    ]
    labels = (await auth_client.get(f"{PORTFOLIO}/accounts")).json()
    assert [row["label"] for row in labels] == ["RH Taxable"]  # the edit's new label went too


async def test_deleting_a_transaction_and_undoing_it_restores_the_same_row(auth_client, db):
    first, middle, last = await ledger(db)
    before = await images(db, PositionTransaction)
    deleted = await auth_client.delete(f"{TRANSACTIONS}/{middle}")
    assert deleted.status_code == 204
    batch_id = deleted.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.table_name, row.label) == (
        "delete",
        "position_transactions",
        "Deleted NVDA buy (undated)",
    )
    assert await replay(db) == [(first, 10), (last, 30)]
    assert (await undo(auth_client, batch_id)).status_code == 200
    # Same id, same sort_index: back in its place in the replay order, not at the ledger's end.
    assert await images(db, PositionTransaction) == before
    listed = (await auth_client.get(TRANSACTIONS)).json()
    assert [row["id"] for row in listed] == [first, middle, last]
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest tests/test_changelog_portfolio.py -q -k "transaction"`
Expected: 3 failed — `KeyError: 'x-change-batch'`.

- [ ] **Step 3: Implement**

In `backend/app/api/portfolio.py`, add after `_owner_filter`:

```python
async def _resolve_account(db: AsyncSession, batch: ChangeBatch, label: str) -> PortfolioAccount:
    """resolve_portfolio_account, with the label row it mints — when it mints one — recorded in
    `batch` ahead of the row that needs it. An Undo then removes a label the write brought into
    being (refusing while another row still files under it), never one that was already there."""
    cleaned = label.strip()
    existing = (
        (await db.execute(select(PortfolioAccount).where(PortfolioAccount.label == cleaned)))
        .scalars()
        .first()
    )
    if existing is not None:
        return existing
    account = await resolve_portfolio_account(db, cleaned)  # flushes: the image has its id
    batch.record_insert(account)
    return account


def _txn_name(ticker: str, txn: PositionTransaction) -> str:
    """How an Activity label names a ledger row: "NVDA buy of Sep 2, 2026", or "VOO buy
    (undated)" for the imported rows that carry no date."""
    if txn.txn_date is None:
        return f"{ticker} {txn.type} (undated)"
    return f"{ticker} {txn.type} of {long_day(txn.txn_date)}"
```

Replace `create_transaction`:

```python
@router.post("/transactions", response_model=TransactionOut, status_code=201)
async def create_transaction(
    body: TransactionCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> PositionTransaction:
    security = await db.get(Security, body.security_id)
    if security is None:
        raise HTTPException(status_code=422, detail=f"unknown security_id: {body.security_id}")
    fields = _validated_txn_fields(body.type, body.shares, body.price, body.fees, body.split_factor)
    if body.txn_date is not None:
        require_reasonable_date(body.txn_date, "txn_date")
    label = _validated_account(body.account)
    # The append position, under the ledger's lock (decision 16): a reorder in flight
    # commits before the max is read, so this row never lands on a number it is writing.
    await db.execute(order_lock(PositionTransaction))
    sort_index = (await db.execute(next_sort_index())).scalar_one()
    # Resolve only after every 422 above: get-or-create flushes, and a label minted for a
    # request that then fails validation would be a row nobody asked for.
    account = await _resolve_account(db, batch, label)
    # UI rows fold chronologically LAST (locked decision) until the user drags them
    # elsewhere (PUT /transactions/order). A later import appends its new sheet rows after
    # the ledger's max the same way — import_key, not sort_index, is the importer's identity.
    txn = PositionTransaction(
        security_id=body.security_id,
        # The ROW, not the id: the response serializes `account` off this relationship.
        portfolio_account=account,
        type=body.type,
        txn_date=body.txn_date,
        sort_index=sort_index,
        source="ui",
        notes=body.notes,
        **fields,
    )
    db.add(txn)
    await db.flush()
    batch.record_insert(txn)
    batch.label = f"Added {_txn_name(security.ticker, txn)}"
    response.headers.update(batch_header(await batch.commit()))
    return txn
```

Replace `update_transaction`:

```python
@router.patch("/transactions/{txn_id}", response_model=TransactionOut)
async def update_transaction(
    txn_id: int,
    body: TransactionUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> PositionTransaction:
    txn = await _get_transaction(db, txn_id)
    provided = body.model_dump(exclude_unset=True)
    # Validate the MERGED row so a type flip can't leave an inconsistent shape. An explicit
    # null on the NOT NULL type column reads as a no-op request (update_security posture).
    merged_type = provided.get("type") or txn.type
    merged = _validated_txn_fields(
        merged_type,
        provided.get("shares", txn.shares),
        provided.get("price", txn.price),
        provided.get("fees", txn.fees),
        provided.get("split_factor", txn.split_factor),
    )
    if "account" in provided:
        if provided["account"] is None:
            raise HTTPException(status_code=422, detail="account cannot be null")
        provided["account"] = _validated_account(provided["account"])
    if "txn_date" in provided and provided["txn_date"] is not None:
        require_reasonable_date(provided["txn_date"], "txn_date")
    # Resolve after the last raise and before the first mutation: get-or-create flushes,
    # and a flush of a half-mutated row is exactly what the rule below forbids.
    new_account = (
        await _resolve_account(db, batch, provided["account"]) if "account" in provided else None
    )
    before = row_image(txn)
    # Every raise is behind us — mutate only now, or a 422 halfway through a multi-field
    # PATCH would leave part of the row dirty for the next autoflush.
    if new_account is not None:
        txn.portfolio_account = new_account
    if "txn_date" in provided:
        txn.txn_date = provided["txn_date"]
    if "notes" in provided:
        txn.notes = provided["notes"]
    txn.type = merged_type
    txn.shares = merged["shares"]
    txn.price = merged["price"]
    txn.fees = merged["fees"]
    txn.split_factor = merged["split_factor"]
    # source/sort_index/import_key are ownership metadata — never PATCHable (the replay
    # order moves only through PUT /transactions/order). Edits to source='import' rows are
    # legal but the next re-import reverts them (sheet wins).
    # The relationship moves portfolio_account_id only at a flush: image after one.
    await db.flush()
    batch.record_update(txn, before)
    batch.label = f"Edited {_txn_name((await _get_security(db, txn.security_id)).ticker, txn)}"
    response.headers.update(batch_header(await batch.commit()))
    return txn
```

Replace `delete_transaction`:

```python
@router.delete("/transactions/{txn_id}", status_code=204)
async def delete_transaction(
    txn_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """Imaged, so an Undo puts the row back with its id and sort_index — in its old place in
    the replay order, not at the ledger's end."""
    txn = await _get_transaction(db, txn_id)
    # Import-owned rows resurrect on the next re-import — appended at the ledger's end,
    # matched by import_key — documented.
    ticker = (await _get_security(db, txn.security_id)).ticker
    batch.record_delete(txn)
    batch.label = f"Deleted {_txn_name(ticker, txn)}"
    await db.delete(txn)
    batch_id = await batch.commit()
    return Response(status_code=204, headers=batch_header(batch_id))
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `$PY -m pytest tests/test_changelog_portfolio.py tests/test_portfolio_api.py tests/test_portfolio_accounts.py -q`
Expected: all passed.

- [ ] **Step 5: Format, lint, commit**

```bash
$PY -m ruff format app/api/portfolio.py tests/test_changelog_portfolio.py
$PY -m ruff check app tests
git add app/api/portfolio.py tests/test_changelog_portfolio.py
git commit -m "feat(portfolio): transactions are change-logged, the label a write mints included" -m "create/update/delete_transaction record through a ChangeBatch and answer X-Change-Batch. A portfolio_accounts label minted on the way is imaged ahead of the row (an Undo removes it, refusing while another row files under it). update_transaction flushes before imaging, since the relationship moves portfolio_account_id only at a flush. A deleted row returns with its id and sort_index. Polish spec 6.1 / D1."
```

---

### Task 3: The transaction reorder is logged

**Files:**
- Modify: `backend/app/api/portfolio.py` (imports `moved_ids`; `reorder_transactions`)
- Modify: `backend/tests/test_changelog_portfolio.py`
- Modify: `backend/tests/test_reorder_transactions_api.py:1-3, 88`
- Modify: `backend/tests/test_reorder_serialization.py:125-129`

- [ ] **Step 1: Write the failing tests**

Add to the imports of `backend/tests/test_changelog_portfolio.py`:

```python
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.services.changelog import DEPENDENT_REFUSAL, OVERLAP_REFUSAL, REPLAY_REFUSAL, undo_batch
from app.services.ordering import order_lock
```

and `ORDER = f"{TRANSACTIONS}/order"` beside `TRANSACTIONS`. Append:

```python
# ── the replay order ─────────────────────────────────────────────────────────────────


async def test_a_reorder_logs_every_row_it_renumbers_and_undoes_to_the_old_order(auth_client, db):
    first, middle, last = await ledger(db)
    unchanged = await auth_client.put(ORDER, json={"ids": [first, middle, last]})
    assert unchanged.status_code == 200 and "x-change-batch" not in unchanged.headers
    moved = await auth_client.put(ORDER, json={"ids": [last, middle, first]})
    assert moved.status_code == 200, moved.text
    batch_id = moved.headers["x-change-batch"]
    rows = await logged(db, batch_id)
    # The middle row keeps 20, so it is neither written nor logged.
    assert [(r.op, r.pk["id"], r.before["sort_index"], r.after["sort_index"]) for r in rows] == [
        ("update", last, 30, 10),
        ("update", first, 10, 30),
    ]
    assert {row.label for row in rows} == {"Reordered 2 transactions"}
    assert (await undo(auth_client, batch_id)).status_code == 200
    assert await replay(db) == [(first, 10), (middle, 20), (last, 30)]


async def test_a_single_move_names_the_row_it_moved(auth_client, db):
    first, middle, last = await ledger(db)
    moved = await auth_client.put(ORDER, json={"ids": [middle, first, last]})
    assert moved.status_code == 200, moved.text
    labels = {row.label for row in await logged(db, moved.headers["x-change-batch"])}
    assert labels == {"Moved NVDA buy of Sep 2, 2026"}


async def test_an_older_edit_cannot_be_undone_once_a_reorder_moved_its_row(auth_client, db):
    first, middle, last = await ledger(db)
    edited = await auth_client.patch(f"{TRANSACTIONS}/{first}", json={"notes": "first lot"})
    assert edited.status_code == 200, edited.text
    moved = await auth_client.put(ORDER, json={"ids": [middle, first, last]})
    assert moved.status_code == 200, moved.text
    # Unlogged, the reorder would let this Undo write the edit's image — the row's OLD
    # sort_index with it — and silently move the row back. Logged, the overlap refusal says so.
    refused = await undo(auth_client, edited.headers["x-change-batch"])
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == OVERLAP_REFUSAL


async def test_an_undo_of_a_reorder_waits_for_the_ledger_lock(auth_client, db, engine):
    """The ledger is one of services.ordering's ORDERED_LISTS, so an Undo that rewrites its
    replay order serializes with a reorder or an append in another tab, as the accounts' does."""
    first, middle, last = await ledger(db)
    moved = await auth_client.put(ORDER, json={"ids": [last, middle, first]})
    batch_id = UUID(moved.headers["x-change-batch"])
    after_move = await replay(db)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as holder:
        await holder.execute(order_lock(PositionTransaction))  # a reorder in flight elsewhere
        async with sessions() as undoing:
            await undoing.execute(text("SET LOCAL lock_timeout = '200ms'"))
            with pytest.raises(DBAPIError, match="lock timeout"):
                await undo_batch(undoing, batch_id, actor="tab 2")
        assert await replay(db) == after_move  # nothing undone meanwhile
    async with sessions() as undoing:  # the holder's transaction is over: the lock is free
        await undo_batch(undoing, batch_id, actor="tab 2")
    assert await replay(db) == [(first, 10), (middle, 20), (last, 30)]
```

In `backend/tests/test_reorder_transactions_api.py`, the module docstring becomes:

```python
"""PUT /portfolio/transactions/order — the replay order (2026-09-23 drag-to-reorder spec
§3.2, §8.3, §9). Change-logged since 2026-09-25 (polish spec §6.1; the batch itself is pinned
in test_changelog_portfolio.py), so these tests prove the fold report, the scope and the
renumbering."""
```

and line 88's `assert (await db.execute(select(ChangeLog))).scalars().all() == []  # unlogged (§0.10)` becomes:

```python
    # Logged (polish spec §6.1): one update per renumbered row, in ONE batch the header names.
    logged = (await db.execute(select(ChangeLog).order_by(ChangeLog.id))).scalars().all()
    assert [(r.pk["id"], r.before["sort_index"], r.after["sort_index"]) for r in logged] == [
        (t2, 7, 10),
        (t3, 7, 20),
        (t1, 3, 30),
    ]
    assert {str(r.batch_id) for r in logged} == {resp.headers["x-change-batch"]}
```

In `backend/tests/test_reorder_serialization.py` (lines 125-129), the two racing callers pass a `Response` and a batch
(both names are already imported there):

```python
    async def swap_the_first_two(session):  # writes two rows
        batch = ChangeBatch(session, actor="tab 1")
        return await reorder_transactions(
            OrderIn(ids=[t2, t1, t3, t4]), Response(), None, session, batch
        )

    async def last_to_the_top(session):  # writes every row
        batch = ChangeBatch(session, actor="tab 2")
        return await reorder_transactions(
            OrderIn(ids=[t4, t1, t2, t3]), Response(), None, session, batch
        )
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest tests/test_changelog_portfolio.py tests/test_reorder_transactions_api.py tests/test_reorder_serialization.py -q`
Expected: the four new reorder tests and `test_a_cross_holding_move_changes_no_figures_and_spaces_the_ledger` fail
(`KeyError: 'x-change-batch'` / an empty change log), and
`test_two_transaction_reorders_serialize_and_the_later_replay_order_wins` fails with a `TypeError` (the route does not
take five arguments yet).

- [ ] **Step 3: Implement**

Add `moved_ids` to the `app.services.ordering` import in `backend/app/api/portfolio.py`, then replace
`reorder_transactions`:

```python
@router.put("/transactions/order", response_model=TransactionOrderOut)
async def reorder_transactions(
    body: OrderIn,
    response: Response,
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> TransactionOrderOut:
    """Change the REPLAY order (2026-09-23 drag-to-reorder spec §3.2). `ids` is every row
    `GET /transactions?owner=` returns, in its new order. The visible rows take the slots
    the visible rows already hold, hidden rows keep theirs, and the whole ledger is
    renumbered 10, 20, … (only rows whose number moves are written). Both orders are
    folded, and every position whose figures changed is reported, so the page can say what
    the move did to cost basis and gains.

    A scope never splits a holding: a position is keyed by an account label, and a label
    belongs to one owner (or joint), so each position is wholly visible or wholly hidden.

    Change-logged since 2026-09-25 (polish spec §6.1): one update per renumbered row. The
    ledger's CRUD is logged now too, and undo replays whole-row images, so an UNLOGGED reorder
    would let an older edit's Undo write that row's old sort_index back and silently move it;
    logged, that Undo meets the overlap refusal instead. The client's own Undo still re-sends
    the previous order through this route.

    Serialized per ledger (decision 16): the order lock is the first statement, so two tabs'
    replay orders never blend into one neither sent — the later request wins whole, with fresh
    before-images.

    Declared before the /transactions/{txn_id} routes so a later PUT on that path can never
    shadow it."""
    owner_filter = _owner_filter(owner)  # 422 on a garbage owner before anything is read
    await db.execute(order_lock(PositionTransaction))
    ledger = list((await db.execute(_ledger_query(None))).scalars())
    visible = (
        ledger
        if owner_filter is None
        else list((await db.execute(_ledger_query(owner_filter))).scalars())
    )
    visible_ids = [txn.id for txn in visible]
    check_permutation(visible_ids, body.ids, stale_detail=STALE_TRANSACTIONS)
    if body.ids == visible_ids:
        return TransactionOrderOut(
            transactions=[TransactionOut.model_validate(txn) for txn in visible],
            changed_positions=[],
        )
    tickers = {
        security_id: ticker
        for security_id, ticker in await db.execute(select(Security.id, Security.ticker))
    }
    by_id = {txn.id: txn for txn in ledger}
    images = {txn.id: row_image(txn) for txn in ledger}  # BEFORE renumber touches a row
    before = fold_transactions(ledger)  # folded BEFORE renumber touches a row
    new_order = subset_in_slots([txn.id for txn in ledger], body.ids)
    renumbered = renumber(
        [by_id[txn_id] for txn_id in new_order],
        "sort_index",
        start=SORT_INDEX_STEP,
        step=SORT_INDEX_STEP,
    )
    changed = position_changes(before, fold_transactions(ledger), tickers)
    for txn, _old, _new in renumbered:
        batch.record_update(txn, images[txn.id])
    moved = moved_ids(visible_ids, body.ids)
    if len(moved) == 1:
        mover = by_id[moved[0]]
        batch.label = f"Moved {_txn_name(tickers[mover.security_id], mover)}"
    else:
        batch.label = f"Reordered {len(moved)} transactions"
    response.headers.update(batch_header(await batch.commit()))
    return TransactionOrderOut(
        transactions=[TransactionOut.model_validate(by_id[txn_id]) for txn_id in body.ids],
        changed_positions=changed,
    )
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `$PY -m pytest tests/test_changelog_portfolio.py tests/test_reorder_transactions_api.py tests/test_reorder_serialization.py -q`
Expected: all passed.

- [ ] **Step 5: Format, lint, commit**

```bash
$PY -m ruff format app/api/portfolio.py tests/test_changelog_portfolio.py tests/test_reorder_transactions_api.py tests/test_reorder_serialization.py
$PY -m ruff check app tests
git add app/api/portfolio.py tests/test_changelog_portfolio.py tests/test_reorder_transactions_api.py tests/test_reorder_serialization.py
git commit -m "feat(portfolio): the transaction reorder is change-logged" -m "One record_update per renumbered row, labelled 'Moved <row>' or 'Reordered N transactions', and the X-Change-Batch header. The deliberate-unlogged reason no longer holds now that the ledger's CRUD is logged: an unlogged reorder would let an older edit's Undo silently move its row back; logged, OVERLAP_REFUSAL answers instead. The Undo takes the ledger's order lock (ORDERED_LISTS), proven with a held lock. Polish spec 6.1."
```

---

### Task 4: Dividends and a label's owner are logged

**Files:**
- Modify: `backend/app/api/portfolio.py` (`update_portfolio_account`, `create_dividend`, `update_dividend`,
  `delete_dividend`)
- Modify: `backend/tests/test_changelog_portfolio.py`

- [ ] **Step 1: Write the failing tests**

Add `DividendPayment` and `Person` to the test module's `from app.models import …` line and
`DIVIDENDS = f"{PORTFOLIO}/dividends"` beside the other paths. Append:

```python
# ── dividends and label owners ───────────────────────────────────────────────────────


async def test_dividend_writes_are_logged_and_a_delete_undoes_exactly(auth_client, db):
    security_id = await stock(db)
    created = await auth_client.post(
        DIVIDENDS,
        json={
            "security_id": security_id,
            "account": "RH Taxable",
            "pay_date": "2026-08-31",
            "amount": "4.12",
            "notes": "Q3",
        },
    )
    assert created.status_code == 201, created.text
    dividend_id = created.json()["id"]
    rows = await logged(db, created.headers["x-change-batch"])
    assert shape(rows) == [("insert", "portfolio_accounts"), ("insert", "dividend_payments")]
    assert {row.label for row in rows} == {"Added NVDA dividend of Aug 31, 2026"}

    edited = await auth_client.patch(
        f"{DIVIDENDS}/{dividend_id}", json={"amount": "4.20", "account": "Fidelity Taxable"}
    )
    assert edited.status_code == 200, edited.text
    rows = await logged(db, edited.headers["x-change-batch"])
    assert shape(rows) == [("insert", "portfolio_accounts"), ("update", "dividend_payments")]
    assert rows[1].after["portfolio_account_id"] == rows[0].after["id"]  # imaged after the flush
    assert (rows[1].before["amount"], rows[1].after["amount"]) == ("4.12", "4.20")
    assert {row.label for row in rows} == {"Edited NVDA dividend of Aug 31, 2026"}

    before = await images(db, DividendPayment)
    deleted = await auth_client.delete(f"{DIVIDENDS}/{dividend_id}")
    assert deleted.status_code == 204
    batch_id = deleted.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.label) == ("delete", "Deleted NVDA dividend of Aug 31, 2026")
    assert await images(db, DividendPayment) == []
    assert (await undo(auth_client, batch_id)).status_code == 200
    assert await images(db, DividendPayment) == before


async def test_changing_a_labels_owner_is_logged(auth_client, db):
    me, sam = Person(name="Me", is_primary=True), Person(name="Sam")
    db.add_all([me, sam])
    await db.flush()
    label = PortfolioAccount(label="RH Joint Taxable", person_id=me.id)
    db.add(label)
    await db.commit()
    label_id, me_id = label.id, me.id
    path = f"{PORTFOLIO}/accounts/{label_id}"
    joint = await auth_client.patch(path, json={"person_id": None})
    assert joint.status_code == 200, joint.text
    batch_id = joint.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.table_name, row.label) == (
        "update",
        "portfolio_accounts",
        "Changed the owner of RH Joint Taxable",
    )
    assert (row.before["person_id"], row.after["person_id"]) == (me_id, None)
    # The same owner again, or no owner key at all, changes nothing and names no batch.
    for body in ({"person_id": None}, {}):
        same = await auth_client.patch(path, json=body)
        assert same.status_code == 200 and "x-change-batch" not in same.headers
    assert (await undo(auth_client, batch_id)).status_code == 200
    [owned] = (await auth_client.get(f"{PORTFOLIO}/accounts")).json()
    assert owned["person_id"] == me_id
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest tests/test_changelog_portfolio.py -q -k "dividend or owner"`
Expected: 2 failed — `KeyError: 'x-change-batch'`.

- [ ] **Step 3: Implement**

Replace `update_portfolio_account`:

```python
@router.patch("/accounts/{account_id}", response_model=PortfolioAccountOut)
async def update_portfolio_account(
    account_id: int,
    body: PortfolioAccountUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> PortfolioAccount:
    """Ownership only. `person_id: null` is a REAL write — it is how an account becomes
    joint (the net-worth NULLABLE_ACCOUNT_FIELDS posture) — while an absent key is a no-op
    request. The label is immutable (PortfolioAccountUpdate forbids extras)."""
    account = await db.get(PortfolioAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="portfolio account not found")
    provided = body.model_dump(exclude_unset=True)
    if "person_id" not in provided:
        return account
    person_id = provided["person_id"]
    # FK target checked BEFORE the write, so a bad id 422s with a sentence instead of
    # surfacing asyncpg's ForeignKeyViolationError as a 500 (_validate_links' rule).
    if person_id is not None and (await db.get(Person, person_id)) is None:
        raise HTTPException(status_code=422, detail=f"unknown person_id: {person_id}")
    before = row_image(account)
    account.person_id = person_id
    batch.record_update(account, before)
    batch.label = f"Changed the owner of {account.label}"
    response.headers.update(batch_header(await batch.commit()))
    return account
```

Replace `create_dividend`:

```python
@router.post("/dividends", response_model=DividendOut, status_code=201)
async def create_dividend(
    body: DividendCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> DividendPayment:
    security = await db.get(Security, body.security_id)
    if security is None:
        raise HTTPException(status_code=422, detail=f"unknown security_id: {body.security_id}")
    require_reasonable_date(body.pay_date, "pay_date")
    amount = _validated_dividend_amount(body.amount)
    # Blank/whitespace collapse to None — never persist '' as a second spelling of "no
    # account" (Task 9 review I1), and never mint a portfolio_accounts row for it.
    label = (body.account or "").strip() or None
    account = None if label is None else await _resolve_account(db, batch, label)
    dividend = DividendPayment(
        security_id=body.security_id,
        portfolio_account=account,
        pay_date=body.pay_date,
        amount=amount,
        notes=body.notes,
    )
    db.add(dividend)
    await db.flush()
    batch.record_insert(dividend)
    batch.label = f"Added {security.ticker} dividend of {long_day(dividend.pay_date)}"
    response.headers.update(batch_header(await batch.commit()))
    return dividend
```

Replace `update_dividend`:

```python
@router.patch("/dividends/{dividend_id}", response_model=DividendOut)
async def update_dividend(
    dividend_id: int,
    body: DividendUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> DividendPayment:
    dividend = await _get_dividend(db, dividend_id)
    provided = body.model_dump(exclude_unset=True)
    # Validate EVERY field before touching the ORM object (update_security posture): a 422
    # raised halfway through would leave part of the row dirty for the next autoflush.
    validated: dict[str, object] = dict(provided)
    for field_name in ("amount", "pay_date"):
        if field_name in provided and provided[field_name] is None:
            raise HTTPException(status_code=422, detail=f"{field_name} cannot be null")
    if "amount" in provided:
        validated["amount"] = _validated_dividend_amount(provided["amount"])
    if "pay_date" in provided:
        validated["pay_date"] = require_reasonable_date(provided["pay_date"], "pay_date")
    account_change = False
    new_account = None
    if "account" in provided:
        validated.pop("account")  # not a column any more — it is the relationship below
        account_change = True
        label = (provided["account"] or "").strip() or None
        new_account = None if label is None else await _resolve_account(db, batch, label)
    before = row_image(dividend)
    for field_name, value in validated.items():
        setattr(dividend, field_name, value)
    if account_change:
        dividend.portfolio_account = new_account
    # The relationship moves portfolio_account_id only at a flush: image after one.
    await db.flush()
    batch.record_update(dividend, before)
    ticker = (await _get_security(db, dividend.security_id)).ticker
    batch.label = f"Edited {ticker} dividend of {long_day(dividend.pay_date)}"
    response.headers.update(batch_header(await batch.commit()))
    return dividend
```

Replace `delete_dividend`:

```python
@router.delete("/dividends/{dividend_id}", status_code=204)
async def delete_dividend(
    dividend_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """Imaged, so an Undo restores the row as it was. Accepted (spec §6.1): once a refresh has
    written the same auto dividend again, that Undo refuses (REPLAY_REFUSAL) — the auto-event
    key is taken."""
    dividend = await _get_dividend(db, dividend_id)
    ticker = (await _get_security(db, dividend.security_id)).ticker
    batch.record_delete(dividend)
    batch.label = f"Deleted {ticker} dividend of {long_day(dividend.pay_date)}"
    await db.delete(dividend)
    batch_id = await batch.commit()
    return Response(status_code=204, headers=batch_header(batch_id))
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `$PY -m pytest tests/test_changelog_portfolio.py tests/test_portfolio_api.py tests/test_portfolio_accounts.py -q`
Expected: all passed.

- [ ] **Step 5: Format, lint, commit**

```bash
$PY -m ruff format app/api/portfolio.py tests/test_changelog_portfolio.py
$PY -m ruff check app tests
git add app/api/portfolio.py tests/test_changelog_portfolio.py
git commit -m "feat(portfolio): dividends and a label's owner are change-logged" -m "create/update/delete_dividend and update_portfolio_account record through a ChangeBatch and answer X-Change-Batch; a minted label is imaged ahead of the dividend, and the edit flushes before imaging so the new portfolio_account_id is in the after-image. A deleted dividend comes back exactly. Polish spec 6.1 / D1."
```

---

### Task 5: Pin `portfolio.py`

**Files:**
- Modify: `backend/tests/test_changelog_pin.py`

- [ ] **Step 1: Add the module to LOGGED** (after the `"taxes.py"` entry; lane L3b appends its own modules to the same
  dict and the coordinator merges by union):

```python
    # Exact undo everywhere (2026-09-25 polish spec §6.1, D1): every user-intent write in these
    # records its rows, and a delete images what hangs off the row it removes. The two
    # allocation routes have logged since 2026-09-13 and are pinned here now too.
    "portfolio.py": {
        "update_portfolio_account",
        "create_security",
        "update_security",
        "delete_security",
        "reorder_transactions",
        "create_transaction",
        "update_transaction",
        "delete_transaction",
        "create_dividend",
        "update_dividend",
        "delete_dividend",
        "update_classification",
        "save_allocation_targets",
    },
```

- [ ] **Step 2: Run it**

Run: `$PY -m pytest tests/test_changelog_pin.py -q`
Expected: 2 passed (a guard over Tasks 1–4: it would name any committing function left on `db.commit()`).

- [ ] **Step 3: Commit**

```bash
$PY -m ruff format tests/test_changelog_pin.py
git add tests/test_changelog_pin.py
git commit -m "test(changelog): pin portfolio.py — all 13 committing routes commit through their ChangeBatch" -m "Adds the portfolio router to the pin's LOGGED list, including update_classification and save_allocation_targets (logged since 2026-09-13, never pinned). A new write path there now lands red until someone decides. Polish spec 6.1."
```

---

### Task 6: Custom calendar events are logged

**Files:**
- Modify: `backend/app/api/calendar.py` (imports; `create_custom_event`, `update_custom_event`, `delete_custom_event`)
- Create: `backend/tests/test_changelog_calendar.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_changelog_calendar.py` (later tasks append):

```python
"""Exact undo for the calendar router (2026-09-25 polish spec §6.1, D1): custom events, the
override overlay and new feed links record their rows in one change batch and answer
X-Change-Batch. Two routes stay unlogged on purpose — the feed's last-used bump and a link's
revoke; tests/test_changelog_pin.py says why."""

from datetime import date

from app.models import CustomEvent
from tests.exact_undo import images, logged, undo

CALENDAR = "/api/v1/calendar"
TODAY = date(2026, 8, 24)


def freeze_today(monkeypatch):
    monkeypatch.setattr("app.services.clock.product_today", lambda: TODAY)


def overlay(done=False, hidden=False, note=None, amount=None) -> dict:
    """An override PUT body — the whole overlay, the house full-replace law."""
    return {"done": done, "hidden": hidden, "note": note, "amount": amount}


# ── custom events ────────────────────────────────────────────────────────────────────


async def test_custom_event_writes_are_logged_with_their_batch(auth_client, db):
    body = {"date": "2026-09-12", "label": "Car insurance", "amount": "180", "direction": "out"}
    created = await auth_client.post(f"{CALENDAR}/events", json=body)
    assert created.status_code == 201, created.text
    path = f"{CALENDAR}/events/{created.json()['id']}"
    [row] = await logged(db, created.headers["x-change-batch"])
    assert (row.op, row.table_name, row.label) == (
        "insert",
        "custom_events",
        "Added calendar event Car insurance",
    )
    renamed = {**body, "label": "Car insurance renewal"}
    edited = await auth_client.patch(path, json=renamed)
    assert edited.status_code == 200, edited.text
    [row] = await logged(db, edited.headers["x-change-batch"])
    assert (row.op, row.label) == ("update", "Edited calendar event Car insurance renewal")
    assert (row.before["label"], row.after["label"]) == ("Car insurance", "Car insurance renewal")
    unchanged = await auth_client.patch(path, json=renamed)
    assert unchanged.status_code == 200 and "x-change-batch" not in unchanged.headers
    deleted = await auth_client.delete(path)
    assert deleted.status_code == 204
    [row] = await logged(db, deleted.headers["x-change-batch"])
    assert (row.op, row.label) == ("delete", "Deleted calendar event Car insurance renewal")


async def test_undoing_a_custom_event_delete_restores_the_row_under_its_id(auth_client, db):
    created = await auth_client.post(
        f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "Car insurance"}
    )
    before = await images(db, CustomEvent)
    deleted = await auth_client.delete(f"{CALENDAR}/events/{created.json()['id']}")
    assert deleted.status_code == 204
    assert await images(db, CustomEvent) == []
    assert (await undo(auth_client, deleted.headers["x-change-batch"])).status_code == 200
    assert await images(db, CustomEvent) == before
```

(`overlay` and `freeze_today` are used from Task 7 on; ruff does not flag unused module-level functions.)

- [ ] **Step 2: Run it to see it fail**

Run: `$PY -m pytest tests/test_changelog_calendar.py -q`
Expected: 2 failed — `KeyError: 'x-change-batch'`.

- [ ] **Step 3: Implement**

In `backend/app/api/calendar.py`, add the import (Task 7 adds `long_day`, Task 8 adds `pk_of` — each where it is
first used, so ruff's F401 never fires in between):

```python
from app.services.changelog import ChangeBatch, batch_header, change_batch, row_image
```

Replace the three custom-event routes:

```python
@router.post("/events", response_model=CustomEventOut, status_code=201)
async def create_custom_event(
    body: CustomEventIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> CustomEventOut:
    row = CustomEvent(
        event_date=body.date,
        label=body.label,
        detail=body.detail,
        person_id=await _validated_person_id(db, body.person_id),
        amount=_validated_amount(body.amount),
        direction=body.direction,
        recurrence=body.recurrence,
        until=body.until,
    )
    db.add(row)
    await db.flush()
    batch.record_insert(row)
    batch.label = f"Added calendar event {row.label}"
    response.headers.update(batch_header(await batch.commit()))
    return _custom_out(row)


@router.patch("/events/{event_id}", response_model=CustomEventOut)
async def update_custom_event(
    event_id: int,
    body: CustomEventIn,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> CustomEventOut:
    """Full replace — the form always submits every field. Whole-series edits only: a
    recurring row is one row, so this moves every occurrence at once (spec §2)."""
    row = await _get_custom_event(db, event_id)
    person_id = await _validated_person_id(db, body.person_id)
    amount = _validated_amount(body.amount)
    before = row_image(row)
    row.person_id = person_id
    row.event_date = body.date
    row.label = body.label
    row.detail = body.detail
    row.amount = amount
    row.direction = body.direction
    row.recurrence = body.recurrence
    row.until = body.until
    batch.record_update(row, before)
    batch.label = f"Edited calendar event {row.label}"
    response.headers.update(batch_header(await batch.commit()))
    return _custom_out(row)


@router.delete("/events/{event_id}", status_code=204)
async def delete_custom_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """Imaged, so an Undo brings the row back under its id — and any override keyed
    `custom:<id>:<date>`, which this leaves standing, matches it again."""
    row = await _get_custom_event(db, event_id)
    batch.record_delete(row)
    batch.label = f"Deleted calendar event {row.label}"
    await db.delete(row)
    batch_id = await batch.commit()
    return Response(status_code=204, headers=batch_header(batch_id))
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `$PY -m pytest tests/test_changelog_calendar.py tests/test_calendar_api.py -q`
Expected: all passed.

- [ ] **Step 5: Format, lint, commit**

```bash
$PY -m ruff format app/api/calendar.py tests/test_changelog_calendar.py
$PY -m ruff check app tests
git add app/api/calendar.py tests/test_changelog_calendar.py
git commit -m "feat(calendar): custom events are change-logged" -m "create/update/delete_custom_event record through a ChangeBatch and answer X-Change-Batch, so the Activity Undo restores a deleted event under its own id (the client's re-create Undo minted a new one). Polish spec 6.1 / D1."
```

---

### Task 7: Overrides are logged, named after the event they sit on

**Files:**
- Modify: `backend/app/api/calendar.py` (`_event_name`, `_NO_OVERRIDE`, `_override_label`; `put_override`,
  `delete_override`)
- Modify: `backend/tests/test_changelog_calendar.py`

- [ ] **Step 1: Write the failing tests**

Extend the test module's imports:

```python
from app.api.calendar import _override_label
from app.models import CalendarEventOverride, CustomEvent, NetWorthSnapshot
```

Add beside `TODAY`:

```python
Q3 = "tax:2026-q3:2026-09-15"
Q3_NAME = "Tax deadline — Q3 estimated payment of Sep 15, 2026"
```

Append:

```python
# ── overrides ────────────────────────────────────────────────────────────────────────


def test_an_override_label_names_the_one_verb_that_changed():
    name = "Payday of Sep 15, 2026"
    blank = {"done_at": None, "hidden": False, "note": None, "amount": None}
    done = {**blank, "done_at": "2026-09-15T16:00:00+00:00"}
    cases = [
        (None, done, f"Marked {name} done"),  # a first PUT is judged against the defaults
        (done, blank, f"Reopened {name}"),
        (blank, {**blank, "hidden": True}, f"Hid {name}"),
        ({**blank, "hidden": True}, blank, f"Unhid {name}"),
        # "Your figure" carries its note: the figure is the verb.
        (blank, {**blank, "amount": "2750.00", "note": "bonus"}, f"Set your figure for {name}"),
        ({**blank, "amount": "2750.00"}, blank, f"Cleared your figure for {name}"),
        (blank, {**blank, "note": "direct deposit"}, f"Edited the note on {name}"),
        (blank, {**done, "hidden": True}, f"Edited {name}"),  # two verbs at once
    ]
    for before, after, label in cases:
        assert _override_label(before, after, name) == label


async def test_an_override_that_creates_its_row_is_an_insert_its_undo_removes(
    auth_client, db, monkeypatch
):
    freeze_today(monkeypatch)
    hidden = await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json=overlay(hidden=True))
    assert hidden.status_code == 200, hidden.text
    batch_id = hidden.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.table_name, row.label) == (
        "insert",
        "calendar_event_overrides",
        f"Hid {Q3_NAME}",
    )
    # updated_at is the server's: the route read the row back before imaging it.
    assert row.after["event_key"] == Q3 and row.after["updated_at"] is not None
    assert (await undo(auth_client, batch_id)).status_code == 200
    assert await images(db, CalendarEventOverride) == []


async def test_an_override_that_changes_its_row_undoes_to_the_previous_overlay(
    auth_client, db, monkeypatch
):
    freeze_today(monkeypatch)
    done = await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json=overlay(done=True))
    [row] = await logged(db, done.headers["x-change-batch"])
    assert row.label == f"Marked {Q3_NAME} done"
    after_done = await images(db, CalendarEventOverride)
    figure_body = overlay(done=True, note="paid online", amount="1250")
    figure = await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json=figure_body)
    assert figure.status_code == 200, figure.text
    batch_id = figure.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.label) == ("update", f"Set your figure for {Q3_NAME}")
    assert (row.before["amount"], row.after["amount"]) == (None, "1250.00")
    # The same overlay again is no change: nothing logged, no header.
    again = await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json=figure_body)
    assert again.status_code == 200 and "x-change-batch" not in again.headers
    assert (await undo(auth_client, batch_id)).status_code == 200
    assert await images(db, CalendarEventOverride) == after_done  # done_at, updated_at too


async def test_clearing_an_override_is_logged_and_undoes_exactly(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json=overlay(done=True, note="paid"))
    before = await images(db, CalendarEventOverride)
    cleared = await auth_client.delete(f"{CALENDAR}/overrides/{Q3}")
    assert cleared.status_code == 204
    batch_id = cleared.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.label) == ("delete", f"Cleared your edits on {Q3_NAME}")
    assert (await undo(auth_client, batch_id)).status_code == 200
    assert await images(db, CalendarEventOverride) == before


async def test_a_restored_custom_event_meets_its_override_again(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    created = await auth_client.post(
        f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "Car insurance"}
    )
    event_id = created.json()["id"]
    key = f"custom:{event_id}:2026-09-12"
    noted = await auth_client.put(f"{CALENDAR}/overrides/{key}", json=overlay(note="renewed"))
    [row] = await logged(db, noted.headers["x-change-batch"])
    assert row.label == "Edited the note on Car insurance of Sep 12, 2026"
    deleted = await auth_client.delete(f"{CALENDAR}/events/{event_id}")

    async def september() -> list[dict]:
        body = (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()
        return [event for event in body["events"] if event["type"] == "custom"]

    assert await september() == []
    assert (await undo(auth_client, deleted.headers["x-change-batch"])).status_code == 200
    # The same id, so the override keyed by it matches again.
    [event] = await september()
    assert (event["id"], event["key"], event["note"]) == (event_id, key, "renewed")


async def test_an_overdue_monthly_reminder_is_named_from_the_day_it_sits_on(
    auth_client, db, monkeypatch
):
    """Nothing entered since July: the Aug 1 reminder is overdue on Aug 24, so the calendar
    shows it TODAY while its key keeps Aug 1 — the name's window has to run on to today."""
    freeze_today(monkeypatch)
    db.add(NetWorthSnapshot(month=date(2026, 7, 1), recorded_on=date(2026, 7, 1)))
    await db.commit()
    done = await auth_client.put(
        f"{CALENDAR}/overrides/ritual:2026-07:2026-08-01", json=overlay(done=True)
    )
    assert done.status_code == 200, done.text
    [row] = await logged(db, done.headers["x-change-batch"])
    assert row.label == (
        "Marked Monthly update — Aug 1 balances · July spending & take-home of Aug 1, 2026 done"
    )


async def test_a_key_no_event_carries_is_named_by_the_key(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    for key in ("rsu:vest:2099-01-01", "tax:2026-q3:2026-02-30"):  # no grant; no such day
        resp = await auth_client.put(f"{CALENDAR}/overrides/{key}", json=overlay(hidden=True))
        assert resp.status_code == 200, resp.text
        [row] = await logged(db, resp.headers["x-change-batch"])
        assert row.label == f"Hid calendar event {key}"
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest tests/test_changelog_calendar.py -q`
Expected: collection error — `ImportError: cannot import name '_override_label'`.

- [ ] **Step 3: Implement**

Add `from app.services.day_labels import long_day` to `backend/app/api/calendar.py`'s imports. Add after
`_override_out`:

```python
async def _event_name(db: AsyncSession, key: str) -> str:
    """How an Activity label names the event an override sits on: the calendar's own label and
    the day in its key — "Payday of Sep 15, 2026". Composed for that day as GET /calendar would,
    before any write; the overdue monthly reminder sits on today while its key keeps the nominal
    day, so a ritual key's window runs on to today. A key no event carries (or a day no calendar
    has — KEY_RE admits 2026-02-30) is named by the key itself. The label is the only reason an
    override route composes anything."""
    source, _ref, day_text = key.split(":")
    try:
        day = date.fromisoformat(day_text)
    except ValueError:
        return f"calendar event {key}"
    today = clock.product_today()
    end = max(day, today) if source == "ritual" else day
    if (end - day).days <= MAX_SPAN_DAYS:
        events, _health, _quoted_at = await _compose_for(db, day, end, today)
        for event in events:
            if event.key == key:
                return f"{event.label} of {long_day(day)}"
    return f"calendar event {key}"


# The overlay a first PUT is judged against: what "no override row" means.
_NO_OVERRIDE: dict[str, object] = {"done_at": None, "hidden": False, "note": None, "amount": None}


def _override_label(before: dict[str, object] | None, after: dict[str, object], name: str) -> str:
    """The Activity sentence for one override write, read off its images: the drawer sends one
    verb at a time (Mark done, Hide, "Your figure" — which carries its note — and "Use the
    estimate"), so one change names its verb; several at once read as an edit."""
    was = before or _NO_OVERRIDE
    verbs: list[str] = []
    if (was["done_at"] is None) != (after["done_at"] is None):
        verbs.append(f"Marked {name} done" if after["done_at"] is not None else f"Reopened {name}")
    if was["hidden"] != after["hidden"]:
        verbs.append(f"Hid {name}" if after["hidden"] else f"Unhid {name}")
    if was["amount"] != after["amount"]:
        verbs.append(
            f"Set your figure for {name}"
            if after["amount"] is not None
            else f"Cleared your figure for {name}"
        )
    if not verbs and was["note"] != after["note"]:
        verbs.append(f"Edited the note on {name}")
    return verbs[0] if len(verbs) == 1 else f"Edited {name}"
```

Replace the two override routes:

```python
@router.put("/overrides/{key}", response_model=OverrideOut)
async def put_override(
    body: OverrideIn,
    response: Response,
    key: str = Path(pattern=KEY_PATTERN, max_length=120),
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> OverrideOut:
    """Upsert, full replace (the house law): a PUT without an amount clears the figure.
    Logged as the one row's insert or update, so its Undo puts the overlay back as it was."""
    amount = _validated_amount(body.amount)
    name = await _event_name(db, key)
    row = await _find_override(db, key)
    before = None if row is None else row_image(row)
    if row is None:
        row = CalendarEventOverride(event_key=key)
        db.add(row)
    # done_at keeps WHEN it was ticked; a re-PUT with done=True on an already-done row
    # leaves the original stamp alone.
    if body.done and row.done_at is None:
        row.done_at = datetime.now(tz=UTC)
    elif not body.done:
        row.done_at = None
    row.hidden = body.hidden
    row.note = body.note
    row.amount = amount
    await db.flush()
    # updated_at is the server's (a default on insert, onupdate on update): the flush leaves
    # it expired and an async lazy load would raise, so read the row back before imaging it.
    await db.refresh(row)
    after = row_image(row)
    if before is None:
        batch.record_insert(row)
    else:
        batch.record_update(row, before)
    batch.label = _override_label(before, after, name)
    response.headers.update(batch_header(await batch.commit()))
    return _override_out(row)


@router.delete("/overrides/{key}", status_code=204)
async def delete_override(
    key: str = Path(pattern=KEY_PATTERN, max_length=120),
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """No client calls this today (the drawer PUTs a cleared overlay instead); logged all the
    same, so every write in the router answers to an Undo."""
    row = await _find_override(db, key)
    if row is None:
        raise HTTPException(status_code=404, detail="override not found")
    batch.label = f"Cleared your edits on {await _event_name(db, key)}"
    batch.record_delete(row)
    await db.delete(row)
    batch_id = await batch.commit()
    return Response(status_code=204, headers=batch_header(batch_id))
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `$PY -m pytest tests/test_changelog_calendar.py tests/calendar tests/test_calendar_api.py -q`
Expected: all passed (the existing override tests, orphan key included, still answer 200).

- [ ] **Step 5: Format, lint, commit**

```bash
$PY -m ruff format app/api/calendar.py tests/test_changelog_calendar.py
$PY -m ruff check app tests
git add app/api/calendar.py tests/test_changelog_calendar.py
git commit -m "feat(calendar): overrides are change-logged and named after their event" -m "put_override records the one row's insert or update (refreshing first: updated_at is server-generated) and delete_override its delete, both with X-Change-Batch. The label names the verb that changed (Hid / Marked done / Set your figure ...) and the event, whose label is composed for the key's day before the write (a ritual key's window runs to today, where the overdue reminder sits); a key no event carries is named by the key. Polish spec 6.1 / D1."
```

---

### Task 8: A new feed link is logged without its hash; the exempt pair is pinned

**Files:**
- Modify: `backend/app/api/calendar.py` (imports `pk_of`; `create_feed_token`)
- Modify: `backend/tests/test_changelog_calendar.py`
- Modify: `backend/tests/test_changelog_pin.py`

- [ ] **Step 1: Write the failing tests**

Extend the test module's imports:

```python
from sqlalchemy import func, select

from app.models import CalendarEventOverride, CalendarFeedToken, ChangeLog, CustomEvent, NetWorthSnapshot
from app.services.changelog import REPLAY_REFUSAL
```

Append:

```python
# ── feed links ───────────────────────────────────────────────────────────────────────


async def test_a_new_feed_link_is_logged_without_its_hash_and_undo_takes_it_back(
    auth_client, db, monkeypatch
):
    freeze_today(monkeypatch)
    created = await auth_client.post(f"{CALENDAR}/feed-tokens", json={"label": " Phone "})
    assert created.status_code == 201, created.text
    plaintext = created.json()["token"]
    batch_id = created.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.table_name, row.label) == (
        "insert",
        "calendar_feed_tokens",
        "Created calendar feed link Phone",
    )
    # The credential never sits in the log, not even as its hash.
    assert "token_hash" not in row.after and row.after["label"] == "Phone"
    undone = await undo(auth_client, batch_id)
    assert undone.status_code == 200, undone.text
    assert await images(db, CalendarFeedToken) == []
    assert (await auth_client.get(f"{CALENDAR}/feed.ics?token={plaintext}")).status_code == 404
    # Undoing that Undo would need the hash back; it refuses rather than revive the link.
    revived = await undo(auth_client, undone.json()["batch_id"])
    assert revived.status_code == 409, revived.text
    assert revived.json()["detail"] == REPLAY_REFUSAL
    await db.rollback()
    assert await images(db, CalendarFeedToken) == []


async def test_the_feed_bump_and_a_revoke_log_nothing(auth_client, db, monkeypatch):
    """The two exempt routes (tests/test_changelog_pin.py says why)."""
    freeze_today(monkeypatch)
    created = await auth_client.post(f"{CALENDAR}/feed-tokens", json={"label": "Phone"})
    token_id, plaintext = created.json()["id"], created.json()["token"]
    count = select(func.count()).select_from(ChangeLog)
    logged_before = (await db.execute(count)).scalar_one()
    feed = await auth_client.get(f"{CALENDAR}/feed.ics?token={plaintext}")
    assert feed.status_code == 200 and "x-change-batch" not in feed.headers
    assert (await db.get(CalendarFeedToken, token_id)).last_used_at is not None  # it did write
    revoked = await auth_client.delete(f"{CALENDAR}/feed-tokens/{token_id}")
    assert revoked.status_code == 204 and "x-change-batch" not in revoked.headers
    assert (await db.execute(count)).scalar_one() == logged_before
```

In `backend/tests/test_changelog_pin.py`, add to LOGGED (after `"portfolio.py"`):

```python
    "calendar.py": {
        "create_custom_event",
        "update_custom_event",
        "delete_custom_event",
        "put_override",
        "delete_override",
        "create_feed_token",
    },
```

and to EXEMPT (after `"taxes.py"`):

```python
    "calendar.py": {
        "feed_ics": "bumps a token's last_used_at at most hourly on the unauthenticated feed "
        "route — machine bookkeeping, with no signed-in user to own a batch",
        "revoke_feed_token": "an undo would revive a revoked credential; a new link is the way "
        "back",
    },
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest tests/test_changelog_calendar.py tests/test_changelog_pin.py -q`
Expected: the feed-link test fails (`KeyError: 'x-change-batch'`) and the pin test fails with
`calendar.py:create_feed_token must commit through its ChangeBatch, not db.commit()`. The exempt-pair test already
passes (it pins behaviour that must not change).

- [ ] **Step 3: Implement**

Add `pk_of` to the `app.services.changelog` import in `backend/app/api/calendar.py`, then replace `create_feed_token`:

```python
@router.post("/feed-tokens", response_model=FeedTokenCreated, status_code=201)
async def create_feed_token(
    body: FeedTokenIn,
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> FeedTokenCreated:
    """Mint, store the hash, hand back the plaintext ONCE. Logged, so an Undo can take a new
    link back — deleting the row is always safe. The image leaves the hash out: an Undo of that
    Undo then has no credential to put back and refuses, so no chain of Undos can revive a link
    (the reason revoke_feed_token is exempt)."""
    plaintext = secrets.token_urlsafe(32)
    row = CalendarFeedToken(user_id=user.id, token_hash=_hash_token(plaintext), label=body.label)
    db.add(row)
    await db.flush()
    await db.refresh(row)  # created_at is a server default
    image = {column: value for column, value in row_image(row).items() if column != "token_hash"}
    batch.record(row.__tablename__, pk_of(row), None, image)
    batch.label = f"Created calendar feed link {row.label}"
    response.headers.update(batch_header(await batch.commit()))
    return FeedTokenCreated(
        id=row.id, label=row.label, created_at=row.created_at, last_used_at=None, token=plaintext
    )
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `$PY -m pytest tests/test_changelog_calendar.py tests/test_changelog_pin.py tests/calendar -q`
Expected: all passed.

- [ ] **Step 5: Format, lint, commit**

```bash
$PY -m ruff format app/api/calendar.py tests/test_changelog_calendar.py tests/test_changelog_pin.py
$PY -m ruff check app tests
git add app/api/calendar.py tests/test_changelog_calendar.py tests/test_changelog_pin.py
git commit -m "feat(calendar): a new feed link is change-logged without its hash; pin calendar.py" -m "create_feed_token records the new row with X-Change-Batch, so Undo can take a link back. Its image leaves token_hash out: an Undo of that Undo cannot re-insert the row and refuses (REPLAY_REFUSAL), so no chain of Undos revives a credential. calendar.py joins the pin's LOGGED list (six routes) and EXEMPT names feed_ics (unauthenticated machine bookkeeping) and revoke_feed_token (an undo would revive a revoked credential). Polish spec 6.1."
```

---

### Task 9: The five already-logged routes answer their batch

**Files:**
- Modify: `backend/app/api/net_worth.py` (`create_account`, `update_account`)
- Modify: `backend/app/api/spending.py` (`create_category`, `update_category`, `put_category_budget`)
- Create: `backend/tests/test_changelog_completions.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_changelog_completions.py`:

```python
"""The spending and net-worth routes that were already logged, completed (2026-09-25 polish
spec §6.1): every one now answers X-Change-Batch, and the two deletes image what hangs off the
row they remove — a category's budget history and reward-category links, an account's
components and card links — so an Undo restores those too."""

from tests.exact_undo import logged

NW = "/api/v1/net-worth"
SP = "/api/v1/spending"


async def test_account_and_category_writes_answer_their_batch(auth_client, db):
    async def named(resp, label: str) -> None:
        assert resp.status_code in (200, 201), resp.text
        rows = await logged(db, resp.headers["x-change-batch"])
        assert rows and {row.label for row in rows} == {label}

    account = await auth_client.post(f"{NW}/accounts", json={"name": "Brokerage", "group": "taxable"})
    await named(account, "Created account Brokerage")
    account_path = f"{NW}/accounts/{account.json()['id']}"
    retire = {"is_active": False}
    await named(await auth_client.patch(account_path, json=retire), "Updated account Brokerage")
    category = await auth_client.post(f"{SP}/categories", json={"name": "Dining"})
    await named(category, "Created category Dining")
    category_path = f"{SP}/categories/{category.json()['id']}"
    kind = {"kind": "transfer"}
    await named(await auth_client.patch(category_path, json=kind), "Updated category Dining")
    budget = {"amount": "400.00", "effective_month": "2026-09-01"}
    await named(
        await auth_client.put(f"{category_path}/budget", json=budget),
        "Set Dining budget from Sep 2026",
    )
    # A write that changes nothing names no batch, so the client offers no Undo.
    for resp in (
        await auth_client.patch(account_path, json=retire),
        await auth_client.patch(category_path, json=kind),
        await auth_client.put(f"{category_path}/budget", json=budget),
    ):
        assert resp.status_code == 200 and "x-change-batch" not in resp.headers
```

- [ ] **Step 2: Run it to see it fail**

Run: `$PY -m pytest tests/test_changelog_completions.py -q`
Expected: 1 failed — `KeyError: 'x-change-batch'`.

- [ ] **Step 3: Implement**

In `backend/app/api/net_worth.py`, `create_account` and `update_account` each gain `response: Response` after their
body parameter, and each `await batch.commit()` becomes:

```python
    response.headers.update(batch_header(await batch.commit()))
```

so the signatures read:

```python
async def create_account(
    body: AccountCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Account:
```

```python
async def update_account(
    account_id: int,
    body: AccountUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Account:
```

In `backend/app/api/spending.py`, the same for `create_category`, `update_category` and `put_category_budget`:

```python
async def create_category(
    body: CategoryCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> SpendingCategory:
```

```python
async def update_category(
    category_id: int,
    body: CategoryUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> SpendingCategory:
```

```python
async def put_category_budget(
    category_id: int,
    body: BudgetPut,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> list[CategoryBudget]:
```

each with `await batch.commit()` replaced by `response.headers.update(batch_header(await batch.commit()))`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `$PY -m pytest tests/test_changelog_completions.py tests/test_changelog_routes.py tests/test_net_worth_api.py tests/test_spending_api.py -q`
Expected: all passed.

- [ ] **Step 5: Format, lint, commit**

```bash
$PY -m ruff format app/api/net_worth.py app/api/spending.py tests/test_changelog_completions.py
$PY -m ruff check app tests
git add app/api/net_worth.py app/api/spending.py tests/test_changelog_completions.py
git commit -m "feat(changelog): account and category writes answer X-Change-Batch" -m "create/update_account, create/update_category and put_category_budget were logged but threw the batch id away; the kind-change, retire and budget toasts need it for their Undo (contract C1). No header when nothing changed. Polish spec 6.1."
```

---

### Task 10: Deleting a category takes its budgets and links, and Undo restores them

**Files:**
- Modify: `backend/app/api/spending.py` (imports `RewardCategory`; `delete_category`)
- Modify: `backend/tests/test_changelog_completions.py`

- [ ] **Step 1: Write the failing test**

Extend the imports of `backend/tests/test_changelog_completions.py`:

```python
from datetime import date
from decimal import Decimal

from app.models import CategoryBudget, RewardCategory, SpendingCategory
from tests.exact_undo import images, logged, shape, undo
```

Append:

```python
async def test_deleting_a_category_takes_its_budgets_and_links_and_undo_restores_them(
    auth_client, db
):
    food = SpendingCategory(name="Food", slug="food", sort_order=1)
    rent = SpendingCategory(name="Rent", slug="rent", sort_order=2)
    db.add_all([food, rent])
    await db.flush()
    db.add_all(
        [
            CategoryBudget(
                category_id=food.id, effective_month=date(2026, 7, 1), amount=Decimal("600.00")
            ),
            # The dated "budget ends here" marker is history too.
            CategoryBudget(category_id=food.id, effective_month=date(2026, 9, 1), amount=None),
            CategoryBudget(
                category_id=rent.id, effective_month=date(2026, 7, 1), amount=Decimal("2000.00")
            ),
            RewardCategory(name="Dining", slug="dining", sort_order=0, spending_category_id=food.id),
            RewardCategory(
                name="Groceries", slug="groceries", sort_order=1, spending_category_id=food.id
            ),
            RewardCategory(name="Travel", slug="travel", sort_order=2),
        ]
    )
    await db.commit()
    food_id, rent_id = food.id, rent.id
    tables = (SpendingCategory, CategoryBudget, RewardCategory)
    before = {model: await images(db, model) for model in tables}
    deleted = await auth_client.delete(f"{SP}/categories/{food_id}")
    assert deleted.status_code == 204, deleted.text
    batch_id = deleted.headers["x-change-batch"]
    rows = await logged(db, batch_id)
    assert shape(rows) == [
        ("update", "reward_categories"),
        ("update", "reward_categories"),
        ("delete", "category_budgets"),
        ("delete", "category_budgets"),
        ("delete", "spending_categories"),
    ]
    assert [row.after["spending_category_id"] for row in rows[:2]] == [None, None]
    assert [row.month for row in rows] == [None, None, date(2026, 7, 1), date(2026, 9, 1), None]
    assert {row.label for row in rows} == {"Deleted category Food"}
    # Rent's budget and the unlinked Travel row were never touched.
    assert [row["category_id"] for row in await images(db, CategoryBudget)] == [rent_id]
    assert (await undo(auth_client, batch_id)).status_code == 200
    for model in tables:
        assert await images(db, model) == before[model]
```

- [ ] **Step 2: Run it to see it fail**

Run: `$PY -m pytest tests/test_changelog_completions.py -q -k category`
Expected: 1 failed — the shape is only `[("delete", "spending_categories")]` (the FKs' ON DELETE did the rest,
unimaged).

- [ ] **Step 3: Implement**

In `backend/app/api/spending.py`, import the model:

```python
from app.models import (
    CategoryBudget,
    MonthlyCashflow,
    MonthlySpending,
    RewardCategory,
    SpendingCategory,
)
```

and replace `delete_category`:

```python
@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """Refused while monthly rows exist (deactivate instead). Otherwise what points at the
    category goes first — reward categories' links nulled, the budget history deleted — each
    imaged through the ORM rather than left to the FKs' ON DELETE, then the category LAST, so
    an Undo (which replays in reverse) brings the category back first and then everything
    that hung off it, ids included (2026-09-25 polish spec §6.1)."""
    category = await _get_category(db, category_id)
    row_count = (
        await db.execute(
            select(func.count())
            .select_from(MonthlySpending)
            .where(MonthlySpending.category_id == category_id)
        )
    ).scalar_one()
    if row_count:
        raise HTTPException(
            status_code=409,
            detail=f"category has {row_count} monthly rows — deactivate it instead",
        )
    links = (
        await db.execute(
            select(RewardCategory)
            .where(RewardCategory.spending_category_id == category_id)
            .order_by(RewardCategory.id)
        )
    ).scalars()
    for link in links:
        before = row_image(link)
        link.spending_category_id = None
        batch.record_update(link, before)
    for budget in await _budget_history(db, category_id):
        batch.record_delete(budget, month=budget.effective_month)
        await db.delete(budget)
    # Out before the category's own DELETE: no relationship() orders these mappers, and the
    # unit of work would otherwise be free to delete the category first.
    await db.flush()
    batch.record_delete(category)
    batch.label = f"Deleted category {category.name}"
    await db.delete(category)
    batch_id = await batch.commit()
    return Response(status_code=204, headers=batch_header(batch_id))
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `$PY -m pytest tests/test_changelog_completions.py tests/test_changelog_routes.py tests/test_activity_api.py tests/test_spending_api.py -q`
Expected: all passed.

- [ ] **Step 5: Format, lint, commit**

```bash
$PY -m ruff format app/api/spending.py tests/test_changelog_completions.py
$PY -m ruff check app tests
git add app/api/spending.py tests/test_changelog_completions.py
git commit -m "feat(spending): a category delete images its budgets and reward links so Undo restores them" -m "delete_category nulls reward_categories.spending_category_id and deletes its category_budgets through the ORM, each imaged, before the category itself (flushed first). The FKs did the same unimaged, so an Undo brought back a category with no budget history and no reward mapping. Polish spec 6.1."
```

---

### Task 11: Deleting an account unlinks its components and cards, and Undo relinks them

**Files:**
- Modify: `backend/app/api/net_worth.py` (imports `CreditCard`; `delete_account`)
- Modify: `backend/tests/test_changelog_completions.py`

- [ ] **Step 1: Write the failing test**

Add `Account` and `CreditCard` to the test module's `from app.models import …` line. Append:

```python
async def test_deleting_an_account_unlinks_its_components_and_cards_and_undo_relinks_them(
    auth_client, db
):
    balance = Account(
        name="Sapphire balance", slug="sapphire-balance", group="liability", sort_order=1
    )
    db.add(balance)
    await db.flush()
    db.add_all(
        [
            Account(
                name="Sapphire authorized user",
                slug="sapphire-authorized-user",
                group="liability",
                sort_order=2,
                is_component=True,
                parent_account_id=balance.id,
            ),
            Account(name="Checking", slug="checking", group="cash", sort_order=3),
            CreditCard(
                name="Chase Sapphire Reserve",
                slug="chase-sapphire-reserve",
                annual_fee=Decimal("795.00"),
                rewards_currency="points",
                point_value_cents=Decimal("1.5000"),
                account_id=balance.id,
            ),
            CreditCard(name="Citi Double Cash", slug="citi-double-cash", rewards_currency="cash"),
        ]
    )
    await db.commit()
    balance_id = balance.id
    tables = (Account, CreditCard)
    before = {model: await images(db, model) for model in tables}
    deleted = await auth_client.delete(f"{NW}/accounts/{balance_id}")
    assert deleted.status_code == 204, deleted.text
    batch_id = deleted.headers["x-change-batch"]
    rows = await logged(db, batch_id)
    assert shape(rows) == [
        ("update", "accounts"),
        ("update", "credit_cards"),
        ("delete", "accounts"),
    ]
    assert rows[0].after["parent_account_id"] is None and rows[1].after["account_id"] is None
    assert {row.label for row in rows} == {"Deleted account Sapphire balance"}
    assert (await undo(auth_client, batch_id)).status_code == 200
    for model in tables:
        assert await images(db, model) == before[model]
```

- [ ] **Step 2: Run it to see it fail**

Run: `$PY -m pytest tests/test_changelog_completions.py -q -k account`
Expected: 1 failed — the shape is only `[("delete", "accounts")]`.

- [ ] **Step 3: Implement**

In `backend/app/api/net_worth.py`:

```python
from app.models import ACCOUNT_GROUPS, Account, AccountBalance, CreditCard, NetWorthSnapshot, Person
```

and replace `delete_account`:

```python
@router.delete("/accounts/{account_id}", status_code=204)
async def delete_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """Refused while balance rows exist (deactivate instead). Otherwise the links that point at
    the account are nulled first — its components' parent_account_id and credit cards'
    account_id, the end state the FKs' SET NULL left — each imaged through the ORM, then the
    account LAST, so an Undo (which replays in reverse) brings the account back and relinks
    them (2026-09-25 polish spec §6.1)."""
    account = await _get_account(db, account_id)
    balance_count = (
        await db.execute(
            select(func.count())
            .select_from(AccountBalance)
            .where(AccountBalance.account_id == account_id)
        )
    ).scalar_one()
    if balance_count:
        raise HTTPException(
            status_code=409,
            detail=f"account has {balance_count} balance rows — deactivate it instead",
        )
    components = (
        await db.execute(
            select(Account).where(Account.parent_account_id == account_id).order_by(Account.id)
        )
    ).scalars()
    for component in components:
        before = row_image(component)
        component.parent_account_id = None
        batch.record_update(component, before)
    cards = (
        await db.execute(
            select(CreditCard).where(CreditCard.account_id == account_id).order_by(CreditCard.id)
        )
    ).scalars()
    for card in cards:
        before = row_image(card)
        card.account_id = None
        batch.record_update(card, before)
    # Out before the account's own DELETE, so the statements run in the order they were imaged.
    await db.flush()
    batch.record_delete(account)
    batch.label = f"Deleted account {account.name}"
    await db.delete(account)
    batch_id = await batch.commit()
    return Response(status_code=204, headers=batch_header(batch_id))
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `$PY -m pytest tests/test_changelog_completions.py tests/test_changelog_routes.py tests/test_net_worth_api.py tests/test_activity_api.py -q`
Expected: all passed.

- [ ] **Step 5: Format, lint, commit**

```bash
$PY -m ruff format app/api/net_worth.py tests/test_changelog_completions.py
$PY -m ruff check app tests
git add app/api/net_worth.py tests/test_changelog_completions.py
git commit -m "feat(net-worth): an account delete images its component and card links so Undo relinks them" -m "delete_account nulls its components' parent_account_id and its credit cards' account_id through the ORM, each imaged, before the account itself (flushed first). The FKs' SET NULL left the same state unimaged, so an Undo brought the account back with its components orphaned and its cards unlinked. Polish spec 6.1."
```

---

### Task 12: Gates and "As built"

**Files:**
- Modify: `docs/superpowers/plans/2026-09-25-polish-L3a-backend.md` (append "As built")

- [ ] **Step 1: Full backend suite**

Run: `$PY -m pytest -n 4 -q`
Expected: all passed (record the count; a pre-existing flake is re-run alone once and noted if it passes).

- [ ] **Step 2: Lint and format**

Run: `$PY -m ruff check app tests` → `All checks passed!`
Run: `$PY -m ruff format --check app/api/portfolio.py app/api/calendar.py app/api/spending.py app/api/net_worth.py tests/exact_undo.py tests/test_changelog_portfolio.py tests/test_changelog_calendar.py tests/test_changelog_completions.py tests/test_changelog_pin.py tests/test_reorder_transactions_api.py tests/test_reorder_serialization.py`
→ `11 files already formatted`.

- [ ] **Step 3: Append "As built" to this plan** — deviations and why, the per-route table, test counts — and commit:

```bash
git add ../docs/superpowers/plans/2026-09-25-polish-L3a-backend.md
git commit -m "docs(plan): L3a as built — gates, counts, deviations"
```

---

## As built (2026-09-25)

All twelve tasks landed as written, one commit each, on `feat/polish-undo-a` (cut from `657e3d62`), then the five
review fixes below, one commit each. No schema change, no migration. One service touched, at the review's request:
`services/portfolio_accounts.py` (fix 3), with its importer caller.

### Gates

After the review fixes (the pre-review run was 2,774 passed, 4 skipped in 87.9 s):

| Gate | Result |
|---|---|
| `pytest -n 4` (full backend suite, `FINANCE_TEST_DB=finance_test_l3a`) | **2,777 passed, 4 skipped** in 108.5 s — the 4 warnings are the pre-existing `SyntaxWarning` in `tests/test_restore_points.py:531` |
| `ruff check app tests` | All checks passed |
| `ruff format --check` on the 14 touched files | 14 files already formatted |
| Lane tests | 30 new: `test_changelog_portfolio.py` 13, `test_changelog_calendar.py` 14, `test_changelog_completions.py` 3; the pin test stays 2 tests with two more modules and two EXEMPT entries; `test_portfolio_accounts.py`'s resolve tests now pin the minted flag |

Every new test was seen failing first for the planned reason (`KeyError: 'x-change-batch'`, a short `(op, table)`
shape, the missing `_override_label`, the pin naming `create_feed_token`). The overlap test showed the hazard live
before Task 3: the older edit's Undo answered 200 and moved the row back. The cascade tests also pass with
`-W error::sqlalchemy.exc.SAWarning` (no zero-row DELETE anywhere), and the portfolio pin fails against the pre-lane
`portfolio.py` (checked, then restored).

### Per-route result

| Route | Status | Label | Header |
|---|---|---|---|
| `portfolio.update_portfolio_account` | logged | Changed the owner of {label} | 200, when the owner changed |
| `portfolio.create_security` | logged | Added security {ticker} | 201 |
| `portfolio.update_security` | logged | Edited security {ticker} | 200, when something changed |
| `portfolio.delete_security` | logged (events, closes, quote, then security) | Deleted security {ticker} | 204 |
| `portfolio.reorder_transactions` | logged (one update per renumbered row) | Moved {txn} / Reordered {n} transactions | 200, when the order changed |
| `portfolio.create_transaction` | logged (+ minted label first) | Added {ticker} {type} of {date} / … (undated) | 201 |
| `portfolio.update_transaction` | logged (+ minted label first; flushed before imaging) | Edited {txn} | 200, when something changed |
| `portfolio.delete_transaction` | logged | Deleted {txn} | 204 |
| `portfolio.create_dividend` | logged (+ minted label first) | Added {ticker} dividend of {date} | 201 |
| `portfolio.update_dividend` | logged (+ minted label first; flushed before imaging) | Edited {ticker} dividend of {date} | 200, when something changed |
| `portfolio.delete_dividend` | logged | Deleted {ticker} dividend of {date} | 204 |
| `portfolio.update_classification` | logged since 09-13, now pinned | unchanged | unchanged (already answered it) |
| `portfolio.save_allocation_targets` | logged since 09-13, now pinned | unchanged | unchanged (already answered it) |
| `calendar.create_custom_event` | logged | Added calendar event {title} | 201 |
| `calendar.update_custom_event` | logged | Edited calendar event {title} | 200, when something changed |
| `calendar.delete_custom_event` | logged | Deleted calendar event {title} | 204 |
| `calendar.put_override` | logged (insert or update; refreshed before imaging; named after the flush, only when a row was recorded) | Hid / Unhid / Marked … done / Reopened / Set your figure for / Cleared your figure for / Edited the note on / Edited {event} | 200, when something changed |
| `calendar.delete_override` | logged | Cleared your edits on {event} | 204 |
| `calendar.create_feed_token` | logged, image without `token_hash` | Created calendar feed link {label} | 201 |
| `calendar.feed_ics` | EXEMPT (pinned with reason) | — | none |
| `calendar.revoke_feed_token` | EXEMPT (pinned with reason) | — | none |
| `spending.create_category` / `update_category` / `put_category_budget` | already logged; now answer the header | unchanged | 201 / 200 / 200, when something changed |
| `spending.delete_category` | completed: reward links nulled + budgets deleted, imaged, before the category | Deleted category {name} | 204 |
| `net_worth.create_account` / `update_account` | already logged; now answer the header | unchanged | 201 / 200, when something changed |
| `net_worth.delete_account` | completed: component links + card links nulled, imaged, before the account | Deleted account {name} | 204 |

`{event}` = the calendar's own label + the key's day, e.g. `Tax deadline — Q3 estimated payment of Sep 15, 2026`;
a key no event carries reads `calendar event {key}`.

### Deviations and notes

1. **`long_day` import moved from Task 1 to Task 2** — ruff's F401 (first used there). Nothing else deviated from
   the task code.
2. **Feed-link image without the hash** (decision 4) is a deliberate departure from whole-row images: the create's
   Undo still deletes the row exactly; an Undo of that Undo refuses with `REPLAY_REFUSAL` instead of reviving the link.
   Tested.
3. **Naming an overridden event composes the calendar for the key's day** (decision 3). After review fixes 1-2: at
   most one `_compose_for(..., priced=False)` per override write that recorded a row — no withholding tracker, inside a
   SAVEPOINT, and any failure names the event by its key. Tested for a tax deadline, a custom event, the overdue monthly
   reminder (window runs on to today), keys no event carries, extreme years, a failing loader, and a no-op PUT.
4. **Cost of an exact security delete**, measured with a throwaway probe (not committed): 800 price rows delete in
   0.27 s; the Undo takes 1.12 s, because `undo_batch` replays one INSERT per row. Fine for a rare action; a bulk replay
   would be a `services/changelog.py` change, out of this lane's scope.
5. **Beyond the brief's list, also tested:** the Undo of a transaction create refuses (`DEPENDENT_REFUSAL`) while
   another row files under the label it minted; the Undo of a security create refuses once a refresh priced it; an
   Undo of a transaction reorder waits for the ledger's order lock (the existing `ORDERED_LISTS` already covers it).
6. **Stale comments left for the coordinator** (services are out of scope): `services/ordering.py` ("an Activity-card
   Undo (the two logged lists)") and `services/changelog.py` ("An Undo that rewrites accounts or spending categories
   rewrites a list's order too") now undersell: the ledger's reorder is logged as well. The behaviour is already right.
7. **Shared test files:** `tests/test_changelog_pin.py` (merge by union with L3b — both lanes append after
   `"taxes.py"`) and `tests/test_reorder_serialization.py` (this lane changed only the two `reorder_transactions` calls at
   lines 125-135; L3b's card calls sit in a separate hunk).
8. **Not this lane's:** the Activity card's ⓘ copy listing the new kinds (spec §6.1, last bullet) is frontend
   (`src/components/settings/ActivityCard.tsx`, lane L5).

### Review fixes (2026-09-25, verdict "ready with fixes")

Each was test-first: the new or changed test was seen red for the reviewed reason, then green.

| # | Fix | Commit | Proof |
|---|---|---|---|
| 1 | **Naming never fails the write.** `_event_name` composes inside `async with db.begin_nested():` and catches any exception (warning logged, event named by its key). Keys KEY_RE admits with extreme years (`tax:2026-q3:9999-12-31`, `custom:1:0001-01-01`) raised `ValueError: year 10000 is out of range` as a 500; they answer 200 again, as at `657e3d62`. | `19d2198c` | `test_keys_at_the_ends_of_the_calendar_still_take_their_override`; `test_an_event_that_cannot_be_named_still_takes_its_override` (the stand-in compose fails IN THE DATABASE — without the savepoint the write dies with "current transaction is aborted", checked by removing it, then restored) |
| 2 | **Naming is cheaper.** `_load_sources` / `_compose_for` take `priced=False`, which skips the withholding tracker (it prices the tax deadlines, never names one); `_event_name` uses it. `put_override` names after the flush and only when the batch recorded a row. GET, the ICS download and the feed still price. | `0ffca491` | `test_naming_skips_the_tax_pricing_and_a_put_that_changes_nothing_names_nothing` (tracker stubbed to fail: the tax label is unchanged; a no-op PUT makes no compose call) |
| 3 | **The service says whether it minted the label.** `resolve_portfolio_account` returns `(row, minted)`; `_resolve_account` records the insert from the flag instead of repeating the lookup; the importer (`app/importer/apply.py`) takes the row and ignores the flag. | `b34557e2` | `test_portfolio_accounts.py`'s three resolve tests unpack the pair; the first pins `(True, False)` for the minting call and the repeat |
| 4 | **Reorder before-images from `renumber`'s old numbers** (`{**row_image(row), "sort_index": old}`), no up-front image of the whole ledger. | `4c00d868` | a characterization check (green before and after): every logged image is a whole row, differing in `sort_index` alone |
| 5 | **Two accepted behaviours documented:** `reorder_transactions` (undoing a reorder after a later append can land the appended row mid-ledger; rare once the ledger is contiguous) and `update_dividend` (undoing an edit of an auto dividend overwrites what the unlogged ingest wrote since, until the next refresh). | `bd6a5fd3` | docstrings only |

Left to the coordinator's follow-up lane, as agreed: the OVERLAP_REFUSAL "undo those first" semantics in
`changelog.superseded`, parent-row FOR UPDATE locks, merging `tests/exact_undo.py` with L3b's
`tests/changelog_asserts.py`, and label verb consistency.
