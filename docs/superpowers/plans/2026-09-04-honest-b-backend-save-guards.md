# Honest numbers — Lane B: server save guards (`confirm_zero`, derived parents, account link consistency) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/superpowers/specs/2026-09-04-honest-numbers-design.md` lane B (§8): the SERVER stops accepting the two dishonest saves this program is named for. §4's guard — `SpendingMonthUpsert.confirm_zero: bool = False` and a 422 carrying the spec's exact sentence when every amount is zero, no take-home was entered and the client did not say it meant it; the importer applies the same rule to a sheet row and never trips it on a month the sheet does not have. §5's server half — `PUT /net-worth/months/{m}` DERIVES every parent-with-components from the components in the same payload (a component the payload omits falls back to the month's stored row), refuses a typed parent that disagrees with the sum, echoes `MonthUpsertResult.derived`, and writes the DERIVED value into the change log. §5's Settings half — accounts `POST`/`PATCH` refuse `is_component` without `parent_account_id` (and the reverse) with a 422 naming the missing field, while rows that already disagree are left exactly as they are (§6: the drift check reports, never rewrites).

**Architecture:** Two new pure service modules carry the rules so nothing can drift between callers. `services/derived_accounts.py` holds `derived_parent_balances(accounts, balances_by_account_id)` — no session, no I/O, callable on rows a caller already has in memory; the balances PUT calls it on `stored | payload` before writing, and lane A's `check_parent_component_drift` (in `services/health_checks.py`, which THIS lane does not open) calls it on a snapshot's stored rows. `services/spending_guard.py` holds the refusal sentence and `records_something(amounts, net_pay)`, used by the spending PUT and by `importer/apply.py`. The routers change only where they write: `api/net_worth.py` gains derivation inside `put_month` plus one module-level `_check_component_link` used by the two account writers; `api/spending.py` gains three lines inside `put_month` and one import. Change-log semantics are untouched — every write still rides the existing request-scoped `ChangeBatch` and commits through `batch.commit()`, so `test_changelog_pin` stays green with no edit (no new route, no new commit path).

**Tech Stack:** FastAPI + Pydantic 2 (`SpendingMonthUpsert`, `MonthUpsertResult`, `BalanceEntry`), SQLAlchemy 2.0 async ORM, `Decimal` end to end (no float ever touches a balance or an amount), pytest + pytest-asyncio (`asyncio_mode = auto`, shared-session `db`/`auth_client` fixtures), ruff 0.16 (line-length 100, target py312).

**Worktree / commands:** Worktree `C:/Users/edyli/personal-finance-dashboard/.worktrees/honest-b`, branch `honest-b` (already created off `main`). Run everything from `C:/Users/edyli/personal-finance-dashboard/.worktrees/honest-b/backend`. The interpreter is the MAIN checkout's venv:

```
FINANCE_TEST_DB=finance_test_hb C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m pytest tests/<file> -q
C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m ruff check app tests
C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe -m ruff format --check app tests
```

Below, `<py>` = `C:/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe`. `FINANCE_TEST_DB=finance_test_hb` gives this lane its own database so lane A's runner cannot deadlock against it. Nothing frontend in this lane.

**House rules:** `Decimal` arithmetic only. Comments say WHY, never what. Every task ends with a mutation check (break the rule on purpose, watch the test fail, put it back). LF line endings. One commit per task, `git add` the exact paths listed. NEVER push, NEVER merge — the caller does that. The code below is written at ruff's 100-column wrapping; if `ruff format --check` still disagrees with a snippet's line breaks, run `<py> -m ruff format app tests` and keep the formatter's wrapping — the formatter is the authority on layout, never on content (no line may be deleted or reworded to satisfy it).

**Merge note:** Lane A owns the GET routes, the services and the schemas of `api/spending.py` and merges FIRST. After A lands on `main`, rebase `honest-b` onto `main` (`git -C C:/Users/edyli/personal-finance-dashboard/.worktrees/honest-b rebase main`) before review. This lane's `api/spending.py` diff is deliberately two hunks — one import line and the guard INSIDE `put_month` — so the rebase is mechanical. Do not touch `services/health_checks.py`, `api/coverage.py`, `services/savings.py` or any GET handler: those are lane A's, and an edit here is a conflict, not a contribution.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/app/services/derived_accounts.py` (new) | `derived_parent_balances(accounts, balances_by_account_id)` — the ONE definition of "a parent is the sum of its components", shared by the balances PUT now and lane A's drift rule later |
| `backend/tests/test_derived_accounts.py` (new) | pure unit tests: sums, the unflagged-child exclusion, absent parents, Decimal exactness |
| `backend/app/services/spending_guard.py` (new) | `EMPTY_MONTH_REFUSAL` (the spec's exact sentence) + `records_something(amounts, net_pay)` |
| `backend/app/schemas/net_worth.py` (modify) | `MonthUpsertResult.derived: list[BalanceEntry] = []` |
| `backend/app/api/net_worth.py` (modify) | derivation + the disagreement 422 inside `put_month`; `_check_component_link` on `create_account` / `update_account` |
| `backend/app/schemas/spending.py` (modify) | `SpendingMonthUpsert.confirm_zero: bool = False` |
| `backend/app/api/spending.py` (modify) | the empty-month guard inside `put_month` — PUT handler + one import, nothing else |
| `backend/app/importer/apply.py` (modify) | `apply_spending` skips a sheet month that records nothing, with a report warning |
| `backend/tests/test_net_worth_api.py` (modify) | derivation accept/ignore/422, the `derived` echo, the logged value, link-consistency 422s, two response-shape assertions updated |
| `backend/tests/test_spending_api.py` (modify) | `confirm_zero` refusal and accept paths; one existing no-op test updated |
| `backend/tests/test_importer_apply.py` (modify) | an all-zero sheet month is skipped and warned about |

Untouched on purpose: `backend/tests/test_changelog_pin.py` (no new route, no new commit path), `backend/app/services/changelog.py`, `backend/app/services/net_worth_calc.py` (`is_component` stays the rollup key), every frontend file (lanes C–E).

---

### Task 1: `derived_parent_balances` — the shared parent-is-its-components helper

**Files:**
- Create: `backend/app/services/derived_accounts.py`
- Create: `backend/tests/test_derived_accounts.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_derived_accounts.py
from decimal import Decimal

from app.models import Account
from app.services.derived_accounts import derived_parent_balances


def account(
    account_id: int, *, component: bool = False, parent: int | None = None, name: str | None = None
) -> Account:
    # mapped_column(default=...) only fires at flush, so every flag is passed explicitly:
    # an unset is_component would be None here, not False, and could hide a real bug.
    return Account(
        id=account_id,
        name=name or f"Account {account_id}",
        slug=f"account-{account_id}",
        group="pre_tax",
        sort_order=account_id,
        is_active=True,
        is_component=component,
        parent_account_id=parent,
    )


def test_parent_is_the_sum_of_the_components_present():
    parent = account(1, name="Fidelity Traditional 401(k)")
    first = account(2, component=True, parent=1)
    second = account(3, component=True, parent=1)
    result = derived_parent_balances(
        [parent, first, second],
        {2: Decimal("100.00"), 3: Decimal("50.50")},
    )
    assert result == {1: Decimal("150.50")}
    assert str(result[1]) == "150.50"  # Decimal in, Decimal out, 2dp preserved


def test_a_component_missing_from_the_mapping_contributes_nothing():
    parent = account(1)
    first = account(2, component=True, parent=1)
    second = account(3, component=True, parent=1)
    assert derived_parent_balances([parent, first, second], {2: Decimal("100.00")}) == {
        1: Decimal("100.00")
    }


def test_a_parent_with_no_component_value_is_absent_not_zero():
    # A month nobody recorded a component for has nothing to derive from; returning 0 would
    # let a caller overwrite a hand-typed history value with a fake zero.
    parent = account(1)
    child = account(2, component=True, parent=1)
    other = account(3)
    assert derived_parent_balances([parent, child, other], {3: Decimal("42.00")}) == {}
    assert derived_parent_balances([parent, child, other], {}) == {}


def test_a_linked_child_that_is_not_flagged_is_not_summed():
    # is_component alone is the rollup key (services/net_worth_calc): an unflagged child
    # still counts on its own in every total, so summing it into the parent double-counts.
    parent = account(1)
    unflagged = account(2, component=False, parent=1)
    flagged = account(3, component=True, parent=1)
    assert derived_parent_balances(
        [parent, unflagged, flagged], {2: Decimal("100.00"), 3: Decimal("5.00")}
    ) == {1: Decimal("5.00")}


def test_a_flagged_component_with_no_parent_link_is_ignored():
    lone = account(2, component=True, parent=None)
    assert derived_parent_balances([lone], {2: Decimal("100.00")}) == {}


def test_a_component_whose_parent_is_not_in_the_account_list_is_ignored():
    # parent_account_id is ON DELETE SET NULL, but a caller may also hand over a filtered
    # list; a parent we cannot name is a parent we must not write.
    orphan = account(2, component=True, parent=99)
    assert derived_parent_balances([orphan], {2: Decimal("100.00")}) == {}


def test_negative_components_and_several_parents():
    trad = account(1, name="Trad")
    roth = account(2, name="Roth")
    result = derived_parent_balances(
        [
            trad,
            roth,
            account(3, component=True, parent=1),
            account(4, component=True, parent=1),
            account(5, component=True, parent=2),
        ],
        {
            3: Decimal("1234.56"),
            4: Decimal("-234.56"),
            5: Decimal("0.00"),
        },
    )
    assert result == {1: Decimal("1000.00"), 2: Decimal("0.00")}
    assert str(result[1]) == "1000.00"


def test_an_unknown_account_id_in_the_mapping_is_ignored():
    parent = account(1)
    child = account(2, component=True, parent=1)
    assert derived_parent_balances([parent, child], {2: Decimal("7.00"), 404: Decimal("9.00")}) == {
        1: Decimal("7.00")
    }
```

- [ ] **Step 2: Run to verify they fail**

Run (from `.worktrees/honest-b/backend`):
`FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_derived_accounts.py -q`
Expected: FAIL — collection error `ModuleNotFoundError: No module named 'app.services.derived_accounts'`.

- [ ] **Step 3: Write the helper**

```python
# backend/app/services/derived_accounts.py
"""Parent accounts whose balance IS the sum of their components (2026-09-04 honest-numbers
spec §5).

Shared on purpose. The balances PUT derives with this before it writes, and lane A's
`check_parent_component_drift` reads stored snapshots through the same function, so "what
the parent should be" has exactly one definition and the health card can never disagree
with the save that produced the row. Pure — no session, no query — so both callers pass
rows they already hold.

Production's shape (census 2026-09-04): Fidelity Traditional 401(k) has 3 components and
Fidelity Roth 401(k) has 2, and both totals have been typed by hand for 37 months.
"""

from collections.abc import Iterable, Mapping
from decimal import Decimal

from app.models import Account


def derived_parent_balances(
    accounts: Iterable[Account],
    balances_by_account_id: Mapping[int, Decimal],
) -> dict[int, Decimal]:
    """`{parent account id: the sum of its components' balances}` over the components
    PRESENT in `balances_by_account_id`.

    A component is `is_component` AND linked to a parent. `is_component` alone is the key
    every rollup excludes on (services/net_worth_calc), so a linked-but-unflagged child
    still counts on its own — summing it into its parent as well would double-count it.

    A parent with no component value in the mapping is ABSENT from the result, not zero: a
    month nobody recorded a component for has nothing to derive from, and a 0.00 written
    there would erase a hand-typed history value (spec §6 — the drift check reports, never
    rewrites).

    One level only. The sheet nests exactly one (the two Fidelity 401(k)s) and a
    grandparent would need its children resolved first; a deeper chain is left to the drift
    rule rather than guessed at here.
    """
    by_id = {account.id: account for account in accounts}
    totals: dict[int, Decimal] = {}
    for account_id, balance in balances_by_account_id.items():
        account = by_id.get(account_id)
        if account is None or not account.is_component:
            continue
        parent_id = account.parent_account_id
        if parent_id is None or parent_id not in by_id:
            continue  # unlinked component, or a parent this caller cannot name
        totals[parent_id] = totals.get(parent_id, Decimal("0")) + balance
    return totals
```

- [ ] **Step 4: Run to verify they pass**

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_derived_accounts.py -q`
Expected: `8 passed`.

- [ ] **Step 5: Mutation check**

Apply this exact edit to `backend/app/services/derived_accounts.py`:

```python
        if account is None or not account.is_component:
```
becomes
```python
        if account is None:
```

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_derived_accounts.py -q`
Expected: FAIL — `test_a_linked_child_that_is_not_flagged_is_not_summed`, `assert {1: Decimal('105.00')} == {1: Decimal('5.00')}`.

Undo it — restore the line to:

```python
        if account is None or not account.is_component:
```

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_derived_accounts.py -q`
Expected: `8 passed`.

- [ ] **Step 6: Lint and commit**

```
<py> -m ruff check app tests
<py> -m ruff format --check app tests
git add backend/app/services/derived_accounts.py backend/tests/test_derived_accounts.py
git commit -m "feat(net-worth): derived_parent_balances, one definition of a parent's component sum"
```
Expected: `All checks passed!`, `N files already formatted`, one new commit. Do NOT push.

---

### Task 2: the balances PUT derives every parent, refuses a disagreeing one, and echoes `derived`

**Files:**
- Modify: `backend/app/schemas/net_worth.py`
- Modify: `backend/app/api/net_worth.py`
- Modify: `backend/tests/test_net_worth_api.py`

- [ ] **Step 1: Write the failing tests**

First widen the model import at the top of `backend/tests/test_net_worth_api.py` — the log assertion needs `ChangeLog`:

```python
from app.models import Account, AccountBalance, ChangeLog, NetWorthSnapshot, Person
```

Then add `"derived": []` to the two response-shape assertions inside
`test_put_month_creates_snapshot_and_upserts` (both dicts, right after `"unchanged"`), so the
first reads:

```python
    assert resp.json() == {
        "month": "2026-05-01",
        "snapshot_created": True,
        "created": 2,
        "updated": 0,
        "unchanged": 0,
        # No account here has components, so the server derived nothing (spec §5).
        "derived": [],
        # The creating PUT now logs a change batch (2026-09-03 data-lifecycle spec section 9).
        "batch_id": ANY,
    }
```

and the second:

```python
    assert resp.json() == {
        "month": "2026-05-01",
        "snapshot_created": False,
        "created": 0,
        "updated": 1,
        "unchanged": 0,
        "derived": [],
        "batch_id": ANY,
    }
```

Then append these tests after `test_put_month_refuses_empty_create_but_allows_meta_update`:

```python
async def _seed_parent_and_components(db) -> tuple[Account, Account, Account]:
    """Production's shape: an aggregate 401(k) and the two buckets that make it up."""
    parent = Account(
        name="Fidelity Traditional 401(k)",
        slug="fidelity-traditional-401-k",
        group="pre_tax",
        sort_order=1,
        is_component=False,
    )
    db.add(parent)
    await db.flush()
    employer = Account(
        name="Employer Match",
        slug="employer-match",
        group="pre_tax",
        sort_order=2,
        is_component=True,
        parent_account_id=parent.id,
    )
    rollover = Account(
        name="Reverse Rollover",
        slug="reverse-rollover",
        group="pre_tax",
        sort_order=3,
        is_component=True,
        parent_account_id=parent.id,
    )
    db.add_all([employer, rollover])
    await db.commit()
    return parent, employer, rollover


async def test_put_month_derives_the_parent_from_its_components(auth_client, db):
    parent, employer, rollover = await _seed_parent_and_components(db)
    put = "/api/v1/net-worth/months/2026-05-01"
    resp = await auth_client.put(
        put,
        json={
            "balances": [
                {"account_id": employer.id, "balance": "100.00"},
                {"account_id": rollover.id, "balance": "50.50"},
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # The parent was never sent and still got a row: three written, not two.
    assert body["created"] == 3
    assert body["derived"] == [{"account_id": parent.id, "balance": "150.50"}]
    read = {b["account_id"]: b["balance"] for b in (await auth_client.get(put)).json()["balances"]}
    assert read[parent.id] == "150.50"

    # A component the payload leaves out falls back to the row this month already stores.
    second = await auth_client.put(
        put, json={"balances": [{"account_id": employer.id, "balance": "200.00"}]}
    )
    assert second.status_code == 200, second.text
    assert second.json()["derived"] == [{"account_id": parent.id, "balance": "250.50"}]
    assert second.json()["updated"] == 2  # the component, and the parent it derives
    read = {b["account_id"]: b["balance"] for b in (await auth_client.get(put)).json()["balances"]}
    assert read[parent.id] == "250.50" and read[rollover.id] == "50.50"


async def test_put_month_accepts_a_parent_that_agrees_and_refuses_one_that_disagrees(
    auth_client, db
):
    parent, employer, rollover = await _seed_parent_and_components(db)
    put = "/api/v1/net-worth/months/2026-05-01"
    agreeing = await auth_client.put(
        put,
        json={
            "balances": [
                {"account_id": employer.id, "balance": "100.00"},
                {"account_id": rollover.id, "balance": "50.00"},
                {"account_id": parent.id, "balance": "150.00"},
            ]
        },
    )
    assert agreeing.status_code == 200, agreeing.text
    # Accepted and ignored: the same number arrived twice, so there is nothing to argue about.
    assert agreeing.json()["created"] == 3
    assert agreeing.json()["derived"] == [{"account_id": parent.id, "balance": "150.00"}]

    disagreeing = await auth_client.put(
        put,
        json={
            "balances": [
                {"account_id": employer.id, "balance": "100.00"},
                {"account_id": rollover.id, "balance": "50.00"},
                {"account_id": parent.id, "balance": "999.00"},
            ]
        },
    )
    assert disagreeing.status_code == 422
    assert disagreeing.json()["detail"] == (
        "Fidelity Traditional 401(k) is derived from its components (150.00); "
        "leave it out or send the components"
    )
    read = {b["account_id"]: b["balance"] for b in (await auth_client.get(put)).json()["balances"]}
    assert read[parent.id] == "150.00"  # the refusal wrote nothing


async def test_put_month_derivation_refusal_creates_no_snapshot(auth_client, db):
    parent, employer, _rollover = await _seed_parent_and_components(db)
    refused = await auth_client.put(
        "/api/v1/net-worth/months/2026-07-01",
        json={
            "balances": [
                {"account_id": employer.id, "balance": "10.00"},
                {"account_id": parent.id, "balance": "11.00"},
            ]
        },
    )
    assert refused.status_code == 422
    # Validation runs before the snapshot is minted — a rejected body leaves no month behind
    # (the app and this test share one session, so even an unflushed insert would show up).
    assert (await auth_client.get("/api/v1/net-worth/months/2026-07-01")).json()["exists"] is False
    count = (await db.execute(select(func.count()).select_from(NetWorthSnapshot))).scalar_one()
    assert count == 0


async def test_put_month_logs_the_derived_value(auth_client, db):
    parent, employer, rollover = await _seed_parent_and_components(db)
    resp = await auth_client.put(
        "/api/v1/net-worth/months/2026-05-01",
        json={
            "balances": [
                {"account_id": employer.id, "balance": "100.00"},
                {"account_id": rollover.id, "balance": "50.50"},
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    logged = list(
        (
            await db.execute(
                select(ChangeLog)
                .where(ChangeLog.batch_id == resp.json()["batch_id"])
                .order_by(ChangeLog.id)
            )
        )
        .scalars()
        .all()
    )
    parent_row = next(
        row
        for row in logged
        if row.table_name == "account_balances" and row.after["account_id"] == parent.id
    )
    # Undo must restore what the server STORED, not a number nobody sent.
    assert parent_row.op == "insert" and parent_row.after["balance"] == "150.50"


async def test_put_month_leaves_a_parent_alone_when_no_component_was_recorded(auth_client, db):
    parent, _employer, _rollover = await _seed_parent_and_components(db)
    cash = Account(name="Cash", slug="cash", group="cash", sort_order=9, is_component=False)
    snapshot = NetWorthSnapshot(month=date(2024, 1, 1))
    db.add_all([cash, snapshot])
    await db.flush()
    db.add(AccountBalance(snapshot_id=snapshot.id, account_id=parent.id, balance=Decimal("999")))
    await db.commit()

    resp = await auth_client.put(
        "/api/v1/net-worth/months/2024-01-01",
        json={"balances": [{"account_id": cash.id, "balance": "5.00"}]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["derived"] == []  # nothing to derive from — history is not rewritten
    read = {
        b["account_id"]: b["balance"]
        for b in (await auth_client.get("/api/v1/net-worth/months/2024-01-01")).json()["balances"]
    }
    assert read[parent.id] == "999.00"
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_net_worth_api.py -q`
Expected: FAIL — `6 failed, 35 passed`. `test_put_month_creates_snapshot_and_upserts` fails on the
missing `derived` key in both shape assertions; `test_put_month_derives_the_parent_from_its_components`
fails at `assert 2 == 3`; the agree/disagree test fails with `KeyError: 'derived'`; the refusal test
fails at `assert 200 == 422`; the log test fails with `StopIteration`; the leave-alone test fails on
`KeyError: 'derived'`.

- [ ] **Step 3: Add the `derived` echo to the schema**

In `backend/app/schemas/net_worth.py`, replace `MonthUpsertResult` with:

```python
class MonthUpsertResult(BaseModel):
    month: date
    snapshot_created: bool
    created: int
    updated: int
    unchanged: int
    # Parents the server computed from their components (2026-09-04 honest-numbers spec §5).
    # BalanceEntry — the same {account_id, balance} pair the request sends — so the wizard's
    # read-only derived rows echo back in the shape they were typed in.
    derived: list[BalanceEntry] = []
    # The change batch this save wrote (2026-09-03 data-lifecycle spec §9) — None until the
    # router records one, and None when nothing changed (an all-unchanged PUT logs nothing).
    batch_id: UUID | None = None
```

- [ ] **Step 4: Derive inside the balances PUT**

In `backend/app/api/net_worth.py`, add the import between the changelog and money imports (ruff's
isort order: `changelog` < `derived_accounts` < `money`):

```python
from app.services.derived_accounts import derived_parent_balances
```

Then replace the whole `put_month` handler with:

```python
@router.put("/months/{month}", response_model=MonthUpsertResult)
async def put_month(
    month: date,
    body: MonthUpsert,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> MonthUpsertResult:
    require_first_of_month(month)
    ids = [entry.account_id for entry in body.balances]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="duplicate account_id in balances")
    # Validate everything BEFORE any write so a rejected body creates no snapshot.
    quantized: dict[int, Decimal] = {
        entry.account_id: quantize_money(entry.balance, f"balance[account_id={entry.account_id}]")
        for entry in body.balances
    }
    # The whole table, not just the submitted ids: derivation needs every account's
    # is_component/parent_account_id, and the refusal sentence needs the parent's NAME.
    accounts = list((await db.execute(select(Account))).scalars().all())
    by_id = {account.id: account for account in accounts}
    missing = sorted(set(ids) - set(by_id))
    if missing:
        raise HTTPException(status_code=422, detail=f"unknown account_id(s): {missing}")

    snapshot = (
        await db.execute(select(NetWorthSnapshot).where(NetWorthSnapshot.month == month))
    ).scalar_one_or_none()
    # The month's stored rows are read BEFORE the snapshot is created: a derivation refusal
    # must not leave a flushed snapshot behind, and the tests share one session with the app,
    # so even an uncommitted insert would be visible to the next request.
    existing = (
        {}
        if snapshot is None
        else {
            row.account_id: row
            for row in (
                await db.execute(
                    select(AccountBalance).where(AccountBalance.snapshot_id == snapshot.id)
                )
            ).scalars()
        }
    )
    # Spec §5: a parent with components has no balance of its own — it IS the sum of its
    # components this month. The payload wins; a component the payload leaves out falls back
    # to what the month already stores, and one absent from both contributes nothing.
    merged = {account_id: row.balance for account_id, row in existing.items()} | quantized
    derived = derived_parent_balances(accounts, merged)
    for parent_id, total in sorted(derived.items()):
        submitted = quantized.get(parent_id)
        if submitted is not None and submitted != total:
            # Storing a typed total that contradicts the components on the same screen is
            # exactly the drift this program removes — name the value the server would keep.
            raise HTTPException(
                status_code=422,
                detail=(
                    f"{by_id[parent_id].name} is derived from its components ({total}); "
                    "leave it out or send the components"
                ),
            )
    # A parent submitted EQUAL to the sum is accepted and ignored: the union below simply
    # writes the derived value, which is the same number.
    to_write = quantized | derived

    snapshot_created = snapshot is None
    if snapshot is None:
        if not body.balances:
            # An empty month would poison the summary KPI and the coverage ribbon.
            # DELETE /months/{month} exists now (2026-08-31 spec §B2), but the refusal
            # stays: an accidental empty create should not need an undo. Meta-only
            # PUTs remain legal on months that already exist.
            raise HTTPException(
                status_code=422,
                detail="refusing to create an empty month — include at least one balance",
            )
        snapshot = NetWorthSnapshot(
            month=month,
            recorded_on=body.recorded_on or date.today(),
            notes=body.notes,
        )
        db.add(snapshot)
        await db.flush()
        batch.record_insert(snapshot, month=month)
    else:
        provided = body.model_fields_set
        if "recorded_on" in provided:
            snapshot.recorded_on = body.recorded_on
        if "notes" in provided:
            snapshot.notes = body.notes

    created = updated = unchanged = 0
    new_rows: list[AccountBalance] = []
    for account_id, value in to_write.items():
        row = existing.get(account_id)
        if row is None:
            row = AccountBalance(snapshot_id=snapshot.id, account_id=account_id, balance=value)
            db.add(row)
            new_rows.append(row)
            created += 1
        elif row.balance != value:
            before = row_image(row)
            row.balance = value
            batch.record_update(row, before, month=month)
            updated += 1
        else:
            unchanged += 1
    if new_rows:
        await db.flush()  # ids for the insert images
        for row in new_rows:
            batch.record_insert(row, month=month)
    # Meta-only edits (recorded_on, notes) are deliberately not logged (spec section 9).
    batch.label = (
        f"Entered {month:%b %Y} balances — {created} accounts"
        if snapshot_created
        else f"Saved {month:%b %Y} balances — {created + updated} updated"
    )
    batch_id = await batch.commit()
    return MonthUpsertResult(
        month=month,
        snapshot_created=snapshot_created,
        created=created,
        updated=updated,
        unchanged=unchanged,
        derived=[
            BalanceEntry(account_id=account_id, balance=value)
            for account_id, value in sorted(derived.items())
        ],
        batch_id=batch_id,
    )
```

(`BalanceEntry` is already imported by this module — check the import block at the top and leave
it alone. Note that a meta-only PUT on a month with components re-derives too: a month you
touch is left consistent, and the rewrite is logged like any other change.)

- [ ] **Step 5: Run to verify they pass**

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_net_worth_api.py -q`
Expected: `41 passed`.

Then prove the neighbours still hold (the PUT is a change-log-hooked route):
Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_changelog_routes.py tests/test_changelog_pin.py tests/test_activity_api.py tests/test_schemas_lifecycle.py -q`
Expected: all passed, no failures.

- [ ] **Step 6: Mutation check**

Apply this exact edit to `backend/app/api/net_worth.py`:

```python
    to_write = quantized | derived
```
becomes
```python
    to_write = quantized
```

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_net_worth_api.py -q`
Expected: FAIL — `test_put_month_derives_the_parent_from_its_components` at `assert 2 == 3` (the
echo still claims a derived parent the server never wrote).

Undo it — restore the line to:

```python
    to_write = quantized | derived
```

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_net_worth_api.py -q`
Expected: `41 passed`.

- [ ] **Step 7: Lint and commit**

```
<py> -m ruff check app tests
<py> -m ruff format --check app tests
git add backend/app/api/net_worth.py backend/app/schemas/net_worth.py backend/tests/test_net_worth_api.py
git commit -m "feat(net-worth): derive parent balances in the months PUT and echo them as derived"
```
Expected: `All checks passed!`, `N files already formatted`, one new commit. Do NOT push.

---

### Task 3: accounts POST/PATCH refuse half a component fact

**Files:**
- Modify: `backend/app/api/net_worth.py`
- Modify: `backend/tests/test_net_worth_api.py`

- [ ] **Step 1: Write the failing tests**

Two existing tests set one half alone and must now send both. In
`test_patch_account_updates_fields_not_slug`, replace the whole test with:

```python
async def test_patch_account_updates_fields_not_slug(auth_client, db):
    parent = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "Fleet", "group": "other"}
        )
    ).json()
    created = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "Vehicle(s)", "group": "other"}
        )
    ).json()
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{created['id']}",
        json={
            "name": "Vehicles",
            # Both halves of the component fact travel together now (spec §5): the flag is
            # the rollup key, the link is where the money lands.
            "is_component": True,
            "parent_account_id": parent["id"],
            "is_active": False,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Vehicles"
    assert body["slug"] == "vehicle-s"  # slug is the importer's natural key — immutable
    assert body["is_component"] is True
    assert body["parent_account_id"] == parent["id"]
    assert body["is_active"] is False
```

In `test_account_owner_and_parent_round_trip`, replace the unlink block (the PATCH sending
`{"person_id": None, "parent_account_id": None}` and its three assertions) with:

```python
    # An explicit null is a WRITE on these two columns: retag to joint, unlink the parent.
    # Unlinking drops the component flag in the same body — half the fact is a 422 (spec §5).
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{child['id']}",
        json={"person_id": None, "parent_account_id": None, "is_component": False},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["person_id"] is None
    assert resp.json()["parent_account_id"] is None
    assert resp.json()["is_component"] is False
```

Then append these two tests after `test_account_link_validation`:

```python
async def test_account_component_halves_must_travel_together(auth_client, db):
    parent = (
        await auth_client.post(
            "/api/v1/net-worth/accounts", json={"name": "Fidelity Roth 401(k)", "group": "pre_tax"}
        )
    ).json()

    flagged_only = await auth_client.post(
        "/api/v1/net-worth/accounts",
        json={"name": "Loose Bucket", "group": "pre_tax", "is_component": True},
    )
    assert flagged_only.status_code == 422
    assert flagged_only.json()["detail"] == (
        "is_component needs parent_account_id — name the account it folds into"
    )

    linked_only = await auth_client.post(
        "/api/v1/net-worth/accounts",
        json={"name": "Linked Bucket", "group": "pre_tax", "parent_account_id": parent["id"]},
    )
    assert linked_only.status_code == 422
    assert linked_only.json()["detail"] == (
        "parent_account_id needs is_component — a linked account must be a component"
    )

    both = await auth_client.post(
        "/api/v1/net-worth/accounts",
        json={
            "name": "After-tax 401(k)",
            "group": "pre_tax",
            "is_component": True,
            "parent_account_id": parent["id"],
        },
    )
    assert both.status_code == 201, both.text
    child = both.json()

    # PATCH judges the RESULTING row, not just the keys the body carries.
    assert (
        await auth_client.patch(
            f"/api/v1/net-worth/accounts/{child['id']}", json={"parent_account_id": None}
        )
    ).status_code == 422
    assert (
        await auth_client.patch(
            f"/api/v1/net-worth/accounts/{child['id']}", json={"is_component": False}
        )
    ).status_code == 422
    unlinked = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{child['id']}",
        json={"is_component": False, "parent_account_id": None},
    )
    assert unlinked.status_code == 200, unlinked.text
    assert unlinked.json()["is_component"] is False
    assert unlinked.json()["parent_account_id"] is None
    # ...and the flag can only come back with a link attached.
    assert (
        await auth_client.patch(
            f"/api/v1/net-worth/accounts/{child['id']}", json={"is_component": True}
        )
    ).status_code == 422


async def test_an_account_that_already_disagrees_is_left_alone(auth_client, db):
    # Legacy rows (importer-made, or hand-SQL) can carry half the fact. The rule guards the
    # WRITE; existing drift is lane A's health rule to report, never this router's to rewrite.
    legacy = Account(
        name="Orphaned Bucket",
        slug="orphaned-bucket",
        group="pre_tax",
        sort_order=4,
        is_component=True,
        parent_account_id=None,
    )
    db.add(legacy)
    await db.commit()
    resp = await auth_client.patch(
        f"/api/v1/net-worth/accounts/{legacy.id}", json={"sort_order": 7}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["sort_order"] == 7
    assert resp.json()["is_component"] is True  # still half a fact, and still untouched
    assert resp.json()["parent_account_id"] is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_net_worth_api.py -q`
Expected: FAIL — `1 failed, 42 passed`: `test_account_component_halves_must_travel_together` at
`assert 201 == 422` (the POST carrying only `is_component` was accepted). The other new test and
both rewritten tests pass before AND after this task — sending both halves was always legal, and
leaving a legacy row alone is the behaviour being pinned.

- [ ] **Step 3: Add the consistency rule**

In `backend/app/api/net_worth.py`, add this function directly below `_validate_links`:

```python
def _check_component_link(is_component: bool | None, parent_account_id: int | None) -> None:
    """`is_component` and `parent_account_id` are two halves of ONE fact (2026-09-04
    honest-numbers spec §5): the flag is the key every rollup excludes on, the link is the
    parent the money folds into. Half of it produces the Settings card's "unlinked component
    — counts nowhere" row, or a component that is silently double-counted, so a request that
    sets one without the other is refused NAMING the missing half.

    Rows that already disagree are not touched: this fires only when a request supplies one
    of the two, so a legacy account keeps its shape until someone edits that part of it.
    """
    if is_component and parent_account_id is None:
        raise HTTPException(
            status_code=422,
            detail="is_component needs parent_account_id — name the account it folds into",
        )
    if parent_account_id is not None and not is_component:
        raise HTTPException(
            status_code=422,
            detail="parent_account_id needs is_component — a linked account must be a component",
        )
```

In `create_account`, immediately after the existing `await _validate_links(db, body.person_id,
body.parent_account_id, None)` line, add:

```python
    _check_component_link(body.is_component, body.parent_account_id)
```

In `update_account`, immediately after the existing

```python
    await _validate_links(
        db, updates.get("person_id"), updates.get("parent_account_id"), account_id
    )
```

add:

```python
    if "is_component" in updates or "parent_account_id" in updates:
        # Judge the row the PATCH would LEAVE BEHIND, not the keys it happens to carry:
        # `updates` already drops explicit nulls for every column except the two nullable
        # ones, so an unlink really is in here and an `is_component: null` really is not.
        _check_component_link(
            updates.get("is_component", account.is_component),
            updates.get("parent_account_id", account.parent_account_id),
        )
```

- [ ] **Step 4: Run to verify they pass**

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_net_worth_api.py -q`
Expected: `43 passed`.

Then the neighbours that write accounts through the API:
Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_changelog_routes.py tests/test_activity_api.py tests/test_export_api.py tests/test_restore_api.py -q`
Expected: all passed, no failures.

- [ ] **Step 5: Mutation check**

Apply this exact edit to `backend/app/api/net_worth.py` — delete the second guard, leaving:

```python
    if is_component and parent_account_id is None:
        raise HTTPException(
            status_code=422,
            detail="is_component needs parent_account_id — name the account it folds into",
        )
```

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_net_worth_api.py -q`
Expected: FAIL — `test_account_component_halves_must_travel_together` at `assert 201 == 422`
(the link-only POST was accepted).

Undo it — restore:

```python
    if parent_account_id is not None and not is_component:
        raise HTTPException(
            status_code=422,
            detail="parent_account_id needs is_component — a linked account must be a component",
        )
```

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_net_worth_api.py -q`
Expected: `43 passed`.

- [ ] **Step 6: Lint and commit**

```
<py> -m ruff check app tests
<py> -m ruff format --check app tests
git add backend/app/api/net_worth.py backend/tests/test_net_worth_api.py
git commit -m "feat(net-worth): accounts POST/PATCH refuse is_component without a parent, and back"
```
Expected: `All checks passed!`, `N files already formatted`, one new commit. Do NOT push.

---

### Task 4: `confirm_zero` — the spending PUT refuses a month that records nothing

**Files:**
- Create: `backend/app/services/spending_guard.py`
- Modify: `backend/app/schemas/spending.py`
- Modify: `backend/app/api/spending.py` (the PUT handler and one import — nothing else)
- Modify: `backend/tests/test_spending_api.py`

- [ ] **Step 1: Write the failing tests**

Replace `test_put_spending_month_net_pay_omitted_is_still_a_no_op` with:

```python
async def test_put_spending_month_net_pay_omitted_is_still_a_no_op(auth_client):
    put = "/api/v1/spending/months/2026-07-01"
    await auth_client.put(put, json={"net_pay": "5000.00", "amounts": []})
    # A body carrying nothing at all is refused now (spec §4); say it on purpose, and the
    # omitted net_pay is still left exactly where it was — omission is not a clear.
    assert (await auth_client.put(put, json={"amounts": []})).status_code == 422
    result = (await auth_client.put(put, json={"amounts": [], "confirm_zero": True})).json()
    assert result["net_pay_set"] is False
    assert result["net_pay_cleared"] is False
    assert (await auth_client.get(put)).json()["net_pay"] == "5000.00"
```

Then append these two tests after `test_put_spending_month_net_pay_null_rides_along_with_amounts`:

```python
async def test_put_spending_month_refuses_an_all_zero_save(auth_client, db):
    food, rent = await _seed_spending(db)
    put = "/api/v1/spending/months/2026-10-01"
    zeros = [
        {"category_id": food.id, "amount": "0"},
        {"category_id": rent.id, "amount": "0.00"},
    ]
    refused = await auth_client.put(put, json={"amounts": zeros})
    assert refused.status_code == 422
    assert refused.json()["detail"] == (
        "Nothing to record: every category is $0.00 and no take-home was entered — "
        "set confirm_zero to write an empty month on purpose"
    )
    # Production's Sep 2026 in one line: 19 rows of $0.00 and no net pay, which every chart
    # then drew as a real month.
    assert (await auth_client.get(put)).json()["exists"] is False

    # The wizard's checkbox path: a month you truly spent nothing in stays recordable.
    confirmed = await auth_client.put(put, json={"amounts": zeros, "confirm_zero": True})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["created"] == 2
    body = (await auth_client.get(put)).json()
    assert body["exists"] is True
    assert {a["category_id"]: a["amount"] for a in body["amounts"]} == {
        food.id: "0.00",
        rent.id: "0.00",
    }


async def test_put_spending_month_lets_through_anything_that_records_something(auth_client, db):
    food, rent = await _seed_spending(db)
    # One non-zero amount is content, zeros beside it or not.
    mixed = await auth_client.put(
        "/api/v1/spending/months/2026-10-01",
        json={
            "amounts": [
                {"category_id": food.id, "amount": "0.00"},
                {"category_id": rent.id, "amount": "2100.00"},
            ]
        },
    )
    assert mixed.status_code == 200, mixed.text
    # Take-home alone is content: net pay saves the cashflow row and no category rows (§4).
    pay_only = await auth_client.put(
        "/api/v1/spending/months/2026-11-01", json={"net_pay": "6000.00", "amounts": []}
    )
    assert pay_only.status_code == 200, pay_only.text
    # An EXPLICIT null records something as well — it DELETES the month's cashflow row — so
    # the guard must not answer "nothing to record" to a body that deletes a row.
    cleared = await auth_client.put(
        "/api/v1/spending/months/2026-11-01", json={"net_pay": None, "amounts": []}
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["net_pay_cleared"] is True
```

- [ ] **Step 2: Run to verify they fail**

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_spending_api.py -q`
Expected: FAIL — `2 failed, 24 passed`: `test_put_spending_month_net_pay_omitted_is_still_a_no_op`
at `assert 200 == 422`, and `test_put_spending_month_refuses_an_all_zero_save` at
`assert 200 == 422`. (`test_put_spending_month_lets_through_anything_that_records_something` passes
before and after — it pins the paths the guard must never touch.)

- [ ] **Step 3: Write the shared rule**

```python
# backend/app/services/spending_guard.py
"""The empty-spending-month guard (2026-09-04 honest-numbers spec §4).

One rule, two callers: the months PUT refuses a body that records nothing unless the client
sets `confirm_zero`, and the importer applies the same test to a sheet row before writing
it — that is what "the importer passes confirm_zero=True only for months that carry a net
pay figure or any non-zero amount" means for a writer that never goes through HTTP.

The bug it removes, in production's own numbers (census 2026-09-04): Sep 2026 held 19 rows
of $0.00 and no net pay, so the footer read "Spending through Sep 2026", the movers read
−100%, and Housing's 12-month average came out $181/month low.
"""

from collections.abc import Iterable
from decimal import Decimal

EMPTY_MONTH_REFUSAL = (
    "Nothing to record: every category is $0.00 and no take-home was entered — "
    "set confirm_zero to write an empty month on purpose"
)


def records_something(amounts: Iterable[Decimal], net_pay: Decimal | None) -> bool:
    """True when a month's payload carries real content: any non-zero amount, or a
    take-home figure. Zeros alone are NOT content — a typed zero and an untouched blank
    are indistinguishable once they are stored, which is the whole bug."""
    return net_pay is not None or any(amount != 0 for amount in amounts)
```

- [ ] **Step 4: Add the request field**

In `backend/app/schemas/spending.py`, replace `SpendingMonthUpsert` with:

```python
class SpendingMonthUpsert(BaseModel):
    net_pay: Decimal | None = None
    amounts: list[AmountEntry] = []
    # Spec §4: an all-zero month with no take-home is refused unless the client SAYS it
    # means it (the wizard's "Record this month as $0" checkbox). Default False, so an
    # older client cannot write an empty month by omission.
    confirm_zero: bool = False
```

- [ ] **Step 5: Guard the PUT**

In `backend/app/api/spending.py`, add this import directly below the existing
`from app.services.net_worth_calc import get_swr_pct, investable_bases` line (ruff's isort order
puts `spending_guard` after `net_worth_calc`):

```python
from app.services.spending_guard import EMPTY_MONTH_REFUSAL, records_something
```

Then, inside `put_month`, immediately after the existing negative-net-pay block

```python
    if net_pay_value is not None and net_pay_value < 0:
        # Take-home pay can't be negative; a typo'd minus sign would flip the
        # savings-rate denominator into flattering nonsense (Task 7 review).
        raise HTTPException(status_code=422, detail="net_pay must be non-negative")
```

insert:

```python
    # Spec §4: every category $0.00 with no take-home is what put a fake $0 month on
    # production's Sep 2026 — refuse it unless the client says it means it. An EXPLICIT
    # net_pay null still passes: that body DOES record something (it deletes the month's
    # cashflow row), so answering "nothing to record" would be a lie about it.
    if not (
        body.confirm_zero or net_pay_clear or records_something(quantized.values(), net_pay_value)
    ):
        raise HTTPException(status_code=422, detail=EMPTY_MONTH_REFUSAL)
```

Nothing else in this file changes: the GET routes, the matrix/yearly builders and the schemas
around them are lane A's, and this lane's whole diff here is one import plus this block.

- [ ] **Step 6: Run to verify they pass**

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_spending_api.py -q`
Expected: `26 passed`.

Then the suites that PUT spending months through the same route:
Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_changelog_routes.py tests/test_changelog_pin.py tests/test_activity_api.py tests/test_coverage_api.py tests/test_health_checks.py tests/test_schemas_lifecycle.py -q`
Expected: all passed, no failures.

- [ ] **Step 7: Mutation check**

Apply this exact edit to `backend/app/services/spending_guard.py`:

```python
    return net_pay is not None or any(amount != 0 for amount in amounts)
```
becomes
```python
    return net_pay is not None or any(amount is not None for amount in amounts)
```

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_spending_api.py -q`
Expected: FAIL — `test_put_spending_month_refuses_an_all_zero_save` at `assert 200 == 422` (a
present zero was counted as content, which is exactly the mistake being fixed).

Undo it — restore the line to:

```python
    return net_pay is not None or any(amount != 0 for amount in amounts)
```

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_spending_api.py -q`
Expected: `26 passed`.

- [ ] **Step 8: Lint and commit**

```
<py> -m ruff check app tests
<py> -m ruff format --check app tests
git add backend/app/services/spending_guard.py backend/app/schemas/spending.py backend/app/api/spending.py backend/tests/test_spending_api.py
git commit -m "feat(spending): confirm_zero guard — refuse a month that records nothing"
```
Expected: `All checks passed!`, `N files already formatted`, one new commit. Do NOT push.

---

### Task 5: the importer says `confirm_zero` only for a sheet row that carries something

**Files:**
- Modify: `backend/app/importer/apply.py`
- Modify: `backend/tests/test_importer_apply.py`

- [ ] **Step 1: Write the failing test**

Append after `test_apply_spending_duplicate_slug_is_report_error` in
`backend/tests/test_importer_apply.py`:

```python
async def test_apply_spending_skips_a_sheet_month_that_records_nothing(db):
    from tests.workbook_builder import default_spending_rows

    rows = default_spending_rows()
    # Explicit zeros with no net pay — the sheet's own version of production's Sep 2026.
    # The parser deliberately KEEPS sheet zeros (a real $0 category is data), so only the
    # applier can tell "spent nothing" from "never entered".
    rows[5] = [date(2024, 3, 1), 0.0, 0.0, 0.0, None, None, None]
    report = SheetReport()
    await apply_spending(db, parse_spending(sheets(spending=rows)["Spending"]), report)
    await db.commit()
    assert report.entities["monthly_spending"].creates == 4  # January and February only
    assert report.entities["monthly_cashflow"].creates == 2
    assert any("2024-03" in w and "nothing to record" in w for w in report.warnings)
    march = list(
        (
            await db.execute(
                select(MonthlySpending).where(MonthlySpending.month == date(2024, 3, 1))
            )
        )
        .scalars()
        .all()
    )
    assert march == []
    assert (await db.get(MonthlyCashflow, date(2024, 3, 1))) is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_importer_apply.py -q`
Expected: FAIL — `1 failed, 45 passed`:
`test_apply_spending_skips_a_sheet_month_that_records_nothing` at `assert 6 == 4` (the zero row
was written as two more `monthly_spending` rows).

- [ ] **Step 3: Skip the empty sheet month**

In `backend/app/importer/apply.py`, add the import between the `portfolio_accounts` and
`tax_service` service imports (ruff's isort order):

```python
from app.services.spending_guard import records_something
```

Then, inside `apply_spending`, make the month loop start with the guard — the loop head becomes:

```python
    for month_row in parsed.months:
        if not records_something(month_row.amounts.values(), month_row.net_pay):
            # Spec §4: a sheet row of zeros with no net pay is not a $0 month. Skipping it
            # here IS the importer's confirm_zero — True only for a row carrying a net pay
            # figure or a non-zero amount, and never for a month the sheet does not have
            # (those never reach this loop: the parser drops all-blank rows as templates).
            # Rows already stored for such a month are left alone; the importer never
            # deletes, and lane A's health rule is what reports them.
            report.warnings.append(
                f"Spending {month_row.month.isoformat()[:7]}: every category is 0 and no "
                "net pay — month skipped (nothing to record)"
            )
            continue
        for category_name, amount in month_row.amounts.items():
```

Everything below `for category_name, amount in month_row.amounts.items():` stays exactly as it is.

- [ ] **Step 4: Run to verify it passes**

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_importer_apply.py -q`
Expected: `46 passed`.

Then the importer's end-to-end suites, which run the real sample workbook:
Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_importer_service.py tests/test_import_api.py tests/test_import_trail.py tests/test_importer_parsers.py -q`
Expected: all passed, no failures — the sample workbook has no all-zero month, so no count moves.

- [ ] **Step 5: Mutation check**

Apply this exact edit to `backend/app/importer/apply.py` — delete the `continue` line, so the
guard ends at the `report.warnings.append(...)` call.

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_importer_apply.py -q`
Expected: FAIL — `test_apply_spending_skips_a_sheet_month_that_records_nothing` at `assert 6 == 4`
(warned about, then written anyway).

Undo it — restore the `continue` as the last line of the guard block.

Run: `FINANCE_TEST_DB=finance_test_hb <py> -m pytest tests/test_importer_apply.py -q`
Expected: `46 passed`.

- [ ] **Step 6: Lint and commit**

```
<py> -m ruff check app tests
<py> -m ruff format --check app tests
git add backend/app/importer/apply.py backend/tests/test_importer_apply.py
git commit -m "feat(importer): skip a sheet month that records nothing, with a report warning"
```
Expected: `All checks passed!`, `N files already formatted`, one new commit. Do NOT push.

---

### Task 6: whole-lane verification and the rebase onto lane A

**Files:** none — this task writes no code and makes no commit. Its output is evidence.

- [ ] **Step 1: Run the whole backend suite on this lane's database**

Run (from `.worktrees/honest-b/backend`):
`FINANCE_TEST_DB=finance_test_hb <py> -m pytest -q`
Expected: `0 failed`. The lane adds 18 tests (8 helper + 5 derivation + 2 account-link + 2
spending-guard + 1 importer), so the count is main's count plus 18 — `1643 passed` against the
1625 recorded on 2026-09-03; if main has moved, the only thing that matters is zero failures and a
count exactly 18 higher than main's.

- [ ] **Step 2: Lint the whole backend**

```
<py> -m ruff check app tests
<py> -m ruff format --check app tests
```
Expected: `All checks passed!` and `N files already formatted` — no reformat, no warning.

- [ ] **Step 3: Confirm the lane's shape**

```
git -C C:/Users/edyli/personal-finance-dashboard/.worktrees/honest-b status --short
git -C C:/Users/edyli/personal-finance-dashboard/.worktrees/honest-b log --oneline main..honest-b
git -C C:/Users/edyli/personal-finance-dashboard/.worktrees/honest-b diff --stat main..honest-b
```
Expected: `status --short` prints nothing (every change committed); `log` lists exactly five
commits (Tasks 1–5, newest first); `diff --stat` touches exactly these nine files —
`backend/app/api/net_worth.py`, `backend/app/api/spending.py`, `backend/app/importer/apply.py`,
`backend/app/schemas/net_worth.py`, `backend/app/schemas/spending.py`,
`backend/app/services/derived_accounts.py`, `backend/app/services/spending_guard.py`,
`backend/tests/test_derived_accounts.py`, plus the three test files
(`test_net_worth_api.py`, `test_spending_api.py`, `test_importer_apply.py`) — and NOTHING under
`backend/app/services/health_checks.py`, `backend/app/api/coverage.py` or `src/`. This lane writes
no Alembic migration: the spec allows exactly one for the whole program and it is lane A's `kind`
column, so `alembic check` is lane A's step, not this one.

- [ ] **Step 4: Rebase onto main once lane A has merged**

```
git -C C:/Users/edyli/personal-finance-dashboard/.worktrees/honest-b fetch --all
git -C C:/Users/edyli/personal-finance-dashboard/.worktrees/honest-b rebase main
```
Expected: `Successfully rebased and updated refs/heads/honest-b`. If `api/spending.py` conflicts,
the conflict can only be the import block or the PUT handler — keep BOTH lane A's GET-side
changes and this lane's import line plus the guard block inside `put_month`; never resolve by
dropping either side. Then re-run Steps 1 and 2 and confirm the same expectations.

- [ ] **Step 5: Report, do not integrate**

Leave the branch as it is: no merge, no push, no branch deletion. Report to the caller: the five
commits, the suite count, ruff clean, and the two behaviour changes lanes C–E must absorb (below).

---

## Self-review

**Spec §4 (server guard).** `SpendingMonthUpsert.confirm_zero: bool = False` → Task 4 Step 4. The
422 carries the spec's sentence CHARACTER FOR CHARACTER — "Nothing to record: every category is
$0.00 and no take-home was entered — set confirm_zero to write an empty month on purpose" — held
once in `EMPTY_MONTH_REFUSAL` and asserted whole in `test_put_spending_month_refuses_an_all_zero_save`
(Task 4 Steps 1, 3). The trip condition is the spec's: all amounts zero (an empty `amounts` list
included), no `net_pay` value, `confirm_zero` false. One deliberate carve-out beyond the spec's
sentence: an EXPLICIT `net_pay: null` passes, because that body deletes the month's cashflow row —
a real mutation, so "nothing to record" would be false, and refusing it would strand a user who
blanked a take-home-only month with no way to unsay it (the wizard's blank-clears rider,
`test_put_spending_month_net_pay_null_clears`, keeps working). The importer half — "confirm_zero
only for a month whose sheet row carries a net pay figure or any non-zero amount, never for an
absent month" — is Task 5: the applier calls the SAME `records_something`, and a month the sheet
lacks never reaches the loop (the parser drops all-blank rows as future template months), so the
"never for absent months" clause holds structurally, not by convention. §4's wizard, checkbox,
review-step wording and repair banner are lane C's; the delete this lane relies on
(`DELETE /spending/months/{m}`) already exists and is untouched.

**Spec §5 (server) + Settings PATCH consistency.** "Stored balance = Σ components from the SAME
payload, missing component → prior stored balance, else 0" → Task 2 Step 4, `merged = stored |
payload` fed to `derived_parent_balances`, with absence contributing nothing (identical to adding
0) and `test_put_month_derives_the_parent_from_its_components` pinning both halves. "A submitted
parent equal to the sum is accepted and ignored" → the union writes the same number; pinned by the
`agreeing` branch. "One that differs → 422 `{parent} is derived from its components ({sum}); leave
it out or send the components`" → the exact sentence, asserted whole with a real parent name and a
`150.00` sum. "`MonthUpsertResult.derived: list[{account_id, balance}]`" → Task 2 Step 3, typed as
`list[BalanceEntry]`. "The change-log rows record the DERIVED value" → the derived value is the
only value written, pinned directly on the `ChangeLog` row in `test_put_month_logs_the_derived_value`;
batch semantics are untouched, so `test_changelog_pin` needs no edit and is re-run in Tasks 2 and 4.
The PATCH/POST rule "sets one without the other is refused with a 422 naming the other field" →
Task 3, judged on the row the request would LEAVE BEHIND, and only when the request touches one of
the two halves, so accounts that already disagree stay exactly as they are
(`test_an_account_that_already_disagrees_is_left_alone`) — the drift is reported by lane A's
`check_parent_component_drift`, which this lane never opens and instead feeds with the shared
`derived_parent_balances`. §5's wizard rows, Settings cues and export sentence are lanes C/E.

**Spec §6 (edge cases) touched here.** "Parent with a component whose balance is missing from
history months: the sum uses the stored rows that exist; the drift check reports, never rewrites" →
the helper returns nothing for a parent with no component value, so a legacy month keeps its
hand-typed total (`test_put_month_leaves_a_parent_alone_when_no_component_was_recorded`); a month
where SOME component exists derives from what exists. "A month with net pay but no category rows"
stays legal (`test_put_spending_month_lets_through_anything_that_records_something`) — the guard
never blocks it, and it is lane A's Health note that keeps it from masquerading as a frugal month.

**Type consistency.** `derived_parent_balances(accounts: Iterable[Account], balances_by_account_id:
Mapping[int, Decimal]) -> dict[int, Decimal]` and `records_something(amounts: Iterable[Decimal],
net_pay: Decimal | None) -> bool` are the only two new signatures, and both are pure, so lane A's
health rule calls the first with a snapshot's rows and needs no adapter. `derived` reuses the
existing `BalanceEntry` rather than minting a parallel `{account_id, balance}` model, so the
request and response speak the same shape and `src/types/api.ts` gains one line, not a type. Money
is `Decimal` from request to row to log image: `quantize_money` runs before any sum, the sums are
`Decimal("0") + Decimal(...)`, and no float exists anywhere in the lane. `confirm_zero` defaults
False so every existing caller keeps compiling and only dishonest bodies change meaning.

**Placeholders:** none — every code block is complete, every path absolute or repo-rooted, every
run has an expected result.

**Two behaviour changes lanes C–E must absorb** (report them to the caller): (1) until lane C
ships, today's wizard save of a blank spending step 422s instead of writing zeros — that is the
point, and lane C's per-step save plus the checkbox is the client half; (2) `MonthUpsertResult`
now carries `derived`, so lane C adds `derived?: { account_id: number; balance: string }[]` to
`MonthUpsertResult` in `src/types/api.ts` and renders those rows read-only. Neither is a
regression in this lane's own suites, which are green at Task 6.
