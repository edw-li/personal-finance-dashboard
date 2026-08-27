# Net-Worth Ownership Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the net-worth surfaces answer "whose money is this?" without inventing a second source of truth. `GET /net-worth/timeseries` and `/summary` gain an `owner` query param (`<person_id>` = that person's accounts **plus** joint ones; `joint` = NULL-owned only; **absent = today's household answer, byte-identical**); `/summary` gains `owner_totals` and `/timeseries` gains `owner_series` (both **exclusive** ownership, both summing exactly to `net_worth`). The Net Worth page gets All / \<primary\> / \<partner\> / Joint chips, a "By owner" stacking toggle on the main area chart, and a dashed marriage-date markLine on the trend. The Monthly Update wizard groups its balance grid owner → group → components with a per-owner subtotal, and its net-pay box is relabelled "Household take-home". **No migrations.**

**Architecture:** Ownership is defined in exactly **one** function — `owner_clause(owner)` in `backend/app/services/net_worth_calc.py` — which returns a SQLAlchemy WHERE clause. `load_balance_matrix` applies that clause to its **account** query, and because `net_worth_for`, `group_totals_for` and the new `owner_totals_for` all sum over whatever account list they are handed, scoping the loader scopes every rollup at once (and the endpoints' `accounts`/`series` payloads with them). That is the "single filtering seam": one clause builder, one application point, three consumers that need no parameter of their own. A second pure function, `owner_totals_for`, provides the **disjoint** split (each account counted once under its stored `person_id`, `None` = Joint) that a *stack* requires — deliberately not the inclusive person view, because summing three inclusive views would double-count every joint dollar. `investable_base`/`investable_bases` are untouched (household concepts; spec §5.2).

**By-owner stack data path (decision):** the per-owner series is **computed server-side and shipped on the existing timeseries response** as `owner_series`, *not* fetched as N owner-filtered timeseries calls. Reasons: (a) the N-call path is **wrong** — `owner=<id>` is inclusive of joint by design, so three such calls cannot be stacked without double-counting; (b) the balance matrix is already fully loaded in memory, so the extra series is a pure regroup with zero new queries; (c) it makes the toggle a **client-side re-render with no refetch**; (d) `Σ owner_series == net_worth` holds by construction, so the stack always lands on the net-worth line.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Postgres 16 (real-DB pytest), React 19 + TypeScript + ECharts 6 + Vitest. No new dependencies, no migrations, no new npm/pip packages.

**Specs:** `docs/superpowers/specs/2026-08-26-household-foundation-married-taxes-design.md` §5.2 + §6 (Net Worth / Monthly Update bullets) and `docs/superpowers/specs/2026-08-26-marriage-readiness-audit.md` §3.1 are binding for semantics.

**Preconditions (this plan runs AFTER the household-foundation plan merges — do NOT re-create any of it):**
- `people` table + `Person` model (`id`, `name`, `is_primary`), `'Me'` seeded primary.
- `accounts.person_id` nullable FK → `people.id` (NULL = joint), existing rows backfilled to the primary person.
- `GET /api/v1/household` → `{"people":[{id,name,is_primary}],"marriage_date":"YYYY-MM-DD"|null}`.
- `src/api/household.ts` exporting `fetchHousehold()`; `src/types/api.ts` carrying `PersonOut`/`HouseholdOut`.
- `AccountOut` (backend schema **and** `src/types/api.ts`) already carries `person_id`.

**House rules that bind every task:** Decimal strings on the wire; `+ ZERO`/quantize at the schema boundary is already handled by the existing response models; comments explain constraints, not narration; no file deletions; frequent small commits; never push.

---

## File structure

| File | Change |
|---|---|
| `backend/app/services/net_worth_calc.py` | `JOINT`, `owner_clause()`, `owner_totals_for()`, `load_balance_matrix(db, owner_filter=)` |
| `backend/app/schemas/net_worth.py` | `OwnerTotal`, `OwnerSeries`; `SummaryOut.owner_totals`, `TimeseriesOut.owner_series` |
| `backend/app/api/net_worth.py` | `owner` query param on `/timeseries` + `/summary`; `_owner_filter()`, `_owner_rows()` |
| `backend/tests/test_net_worth_calc.py` | owner fixture + 5 calc tests |
| `backend/tests/test_net_worth_api.py` | owner API tests; repair `test_summary_empty_db` |
| `src/types/api.ts` | `OwnerTotal`, `OwnerSeries`; fields on `NetWorthTimeseries`/`NetWorthSummary` |
| `src/api/netWorth.ts` | `OwnerScope`; `owner` arg on `fetchTimeseries`/`fetchSummary` |
| `src/api/netWorth.test.ts` (new) | query-string plumbing |
| `src/components/networth/netWorthChartOptions.ts` (+ its test) | `marriageMarkLine()` |
| `src/pages/NetWorthPage.tsx` + `.css` | owner chips, "By owner" toggle, marriage markLine, household fetch |
| `src/pages/NetWorthPage.test.tsx` (new) | chips gate/wiring, owner stack, markLine, degraded household |
| `src/pages/MonthlyUpdatePage.tsx` + `.css` | owner sections + per-owner subtotals; "Household take-home" |
| `src/pages/MonthlyUpdatePage.test.tsx` | owner-grouping tests; relabel repairs |
| `src/pages/OverviewPage.test.tsx`, `src/pages/ProjectionPage.test.tsx`, `src/pages/CreditCardsPage.test.tsx` | fixture repairs for the two new required wire fields |

---

## Phase 0 — Preconditions & environment

### Task 0: Verify the household foundation landed and the toolchain answers

**Files:** none (environment only)

- [ ] **Step 1: Confirm a clean tree on a feature branch.**

```bash
git status --porcelain          # expected: EMPTY
git rev-parse --abbrev-ref HEAD # expected: a feature branch, NOT main
```

If you are on `main`, create the branch first: `git checkout -b net-worth-ownership`. Do not stash or discard anyone else's work.

- [ ] **Step 2: Verify the household preconditions exist.** Run:

```bash
cd backend && .venv/Scripts/python -c "from app.models import Account, Person; print('person_id' in Account.__table__.c, [c.name for c in Person.__table__.c])"
```

Expected: `True ['id', 'name', 'is_primary']`.

If this raises `ImportError: cannot import name 'Person'`, the household-foundation plan has **not** merged — STOP and report. If it imports under a **different name** (e.g. `HouseholdMember`), adapt every `Person` reference in this plan to that name and note the substitution in each commit message; everything else in the plan is unaffected.

- [ ] **Step 3: Verify the frontend preconditions.** Run:

```bash
grep -n "person_id" src/types/api.ts | head -3
grep -n "export function fetchHousehold" src/api/household.ts
grep -n "PersonOut\|HouseholdOut" src/types/api.ts | head -4
```

Expected: `person_id` present on `AccountOut`, `fetchHousehold` exported, `PersonOut`/`HouseholdOut` declared. If any is missing, STOP and report.

- [ ] **Step 4: Establish the backend baseline.** Run:

```bash
cd backend && .venv/Scripts/python -m pytest tests/test_net_worth_api.py tests/test_net_worth_calc.py -q
```

Expected: all pass (25 tests at the time of writing, plus whatever the household plan added).

**Two known environment traps, both pre-existing and NOT caused by this plan:**
1. **Never run two pytest sessions against the same test database at once.** The session-scoped `engine` fixture does `drop_all` at start; a concurrent session deadlocks it (`DeadlockDetectedError ... DROP TABLE ...`) and every subsequent test errors with cascading `IntegrityError`/`DBAPIError`. `backend/tests/conftest.py` now supports `FINANCE_TEST_DB` for exactly this — if another run (a sibling worktree agent, CI shard, or your own earlier session) may still be attached, claim your own database:
   `cd backend && FINANCE_TEST_DB=finance_test_nwowner .venv/Scripts/python -m pytest tests/... -q`
   (the name must match `<name>_test[_suffix]`, which the conftest enforces). If you inherit a session that is already deadlocked, terminate the stragglers on the test database with `pg_terminate_backend` before retrying.
2. An intermittent `duplicate key ... uq_users_email` at fixture setup is a known flake (the `db` fixture's TRUNCATE teardown occasionally races). Re-run the file once before investigating.

- [ ] **Step 5: Frontend baseline.**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx src/components/networth/netWorthChartOptions.test.ts`
Expected: all pass.

---

## Phase 1 — Backend

### Task 1: The ownership seam — `owner_clause`, `owner_totals_for`, and a scoped loader

**Files:**
- Modify: `backend/app/services/net_worth_calc.py` (imports `:8-14`, `load_balance_matrix` `:24-39`, insert after `group_totals_for` `:53-61`)
- Test: `backend/tests/test_net_worth_calc.py` (append at end of file)

- [ ] **Step 1: Write the failing tests.** Append to `backend/tests/test_net_worth_calc.py`:

```python
# --- ownership views (2026-08-26 household spec §5.2) -------------------------------------


@pytest.fixture
async def owned_world(db):
    """One account per ownership kind plus a component, in a single snapshot.

    The component belongs to the partner and is deliberately fat (400) — every rollup here
    excludes it, so any number that moves by 400 is a rollup that forgot the exclusion.
    """
    me = Person(name="Me", is_primary=True)
    partner = Person(name="Sam", is_primary=False)
    db.add_all([me, partner])
    await db.flush()
    mine = Account(
        name="My Checking", slug="my-checking", group="cash", sort_order=1, person_id=me.id
    )
    theirs = Account(
        name="Sam 401k", slug="sam-401k", group="pre_tax", sort_order=2, person_id=partner.id
    )
    bucket = Account(
        name="Sam 401k Bucket",
        slug="sam-401k-bucket",
        group="pre_tax",
        sort_order=3,
        is_component=True,
        person_id=partner.id,
    )
    joint = Account(
        name="Joint Savings", slug="joint-savings", group="cash", sort_order=4, person_id=None
    )
    snap = NetWorthSnapshot(month=date(2026, 8, 1))
    db.add_all([mine, theirs, bucket, joint, snap])
    await db.flush()
    for account, value in (
        (mine, "100.00"),
        (theirs, "1000.00"),
        (bucket, "400.00"),
        (joint, "70.00"),
    ):
        db.add(
            AccountBalance(snapshot_id=snap.id, account_id=account.id, balance=Decimal(value))
        )
    await db.commit()
    return me, partner, snap


async def test_person_view_is_owned_plus_joint(db, owned_world):
    me, _partner, snap = owned_world
    _snaps, accounts, balances = await load_balance_matrix(db, owner_clause(str(me.id)))
    assert [a.slug for a in accounts] == ["my-checking", "joint-savings"]
    # "Primary holder + spouse secondary" is what a joint account IS: my view is mine AND ours.
    assert net_worth_for(snap.id, accounts, balances) == Decimal("170.00")
    assert group_totals_for(snap.id, accounts, balances)["cash"] == Decimal("170.00")


async def test_joint_view_is_null_owned_only(db, owned_world):
    _me, _partner, snap = owned_world
    _snaps, accounts, balances = await load_balance_matrix(db, owner_clause(JOINT))
    assert [a.slug for a in accounts] == ["joint-savings"]
    assert net_worth_for(snap.id, accounts, balances) == Decimal("70.00")


async def test_partner_view_excludes_their_own_component(db, owned_world):
    _me, partner, snap = owned_world
    _snaps, accounts, balances = await load_balance_matrix(db, owner_clause(str(partner.id)))
    assert [a.slug for a in accounts] == ["sam-401k", "sam-401k-bucket", "joint-savings"]
    # 1000 + 70; the 400 component is listed but never counted.
    assert net_worth_for(snap.id, accounts, balances) == Decimal("1070.00")


async def test_absent_owner_loads_the_whole_household(db, owned_world):
    _me, _partner, snap = owned_world
    _snaps, accounts, balances = await load_balance_matrix(db)
    assert len(accounts) == 4
    assert net_worth_for(snap.id, accounts, balances) == Decimal("1170.00")


async def test_owner_totals_are_disjoint_and_sum_to_net_worth(db, owned_world):
    me, partner, snap = owned_world
    _snaps, accounts, balances = await load_balance_matrix(db)
    totals = owner_totals_for(snap.id, accounts, balances)
    # Each account counted ONCE, under its stored owner; None is the Joint bucket.
    assert totals == {
        me.id: Decimal("100.00"),
        partner.id: Decimal("1000.00"),
        None: Decimal("70.00"),
    }
    assert sum(totals.values()) == net_worth_for(snap.id, accounts, balances)


def test_owner_clause_rejects_anything_that_is_not_an_id_or_joint():
    for bad in ("", "nobody", "-1", "0", "1.5", "1e3", " 1", "99999999999", "²"):
        with pytest.raises(ValueError):
            owner_clause(bad)
```

Extend the module's existing imports at the top of `backend/tests/test_net_worth_calc.py` — replace the two import blocks (`:6-16`) with:

```python
from app.models import Account, AccountBalance, AppSetting, NetWorthSnapshot, Person
from app.services.net_worth_calc import (
    INVESTABLE_GROUPS,
    JOINT,
    get_swr_pct,
    group_totals_for,
    investable_base,
    investable_bases,
    load_balance_matrix,
    net_worth_for,
    owner_clause,
    owner_totals_for,
)
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_net_worth_calc.py -q`
Expected: a collection error — `ImportError: cannot import name 'JOINT' from 'app.services.net_worth_calc'`.

- [ ] **Step 3: Implement.** In `backend/app/services/net_worth_calc.py`, replace the import block (`:11-12`):

```python
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
```

Then, immediately after `BalanceKey = tuple[int, int]  # (snapshot_id, account_id)` (`:21`), insert:

```python
JOINT = "joint"
INT32_MAX = 2**31 - 1


def owner_clause(owner: str) -> ColumnElement[bool]:
    """THE definition of net-worth ownership (household spec §5.2) — one function, so the
    two endpoints cannot drift apart.

    `joint` selects the NULL-owned accounts only. A person id selects that person's accounts
    PLUS the joint ones, because "primary holder, spouse secondary" is what a joint account
    actually is: a person's view is "mine and ours", never "mine alone". The person views
    therefore OVERLAP by design and must never be summed — the disjoint split for stacking
    is owner_totals_for below.

    Raises ValueError on anything else so the router answers 422; an out-of-range id would
    otherwise reach asyncpg as an int32 overflow, i.e. a 500. `isascii()` guards the
    superscript digits that `str.isdigit()` accepts and `int()` then rejects.
    """
    if owner == JOINT:
        return Account.person_id.is_(None)
    if not (owner.isascii() and owner.isdigit()) or not 1 <= int(owner) <= INT32_MAX:
        raise ValueError(f"owner must be a person id or {JOINT!r}")
    return or_(Account.person_id == int(owner), Account.person_id.is_(None))
```

Replace `load_balance_matrix` (`:24-39`) with:

```python
async def load_balance_matrix(
    db: AsyncSession,
    owner_filter: ColumnElement[bool] | None = None,
) -> tuple[list[NetWorthSnapshot], list[Account], dict[BalanceKey, Decimal]]:
    """`owner_filter` (owner_clause's output) scopes the ACCOUNT list, and that is the whole
    filtering seam: net_worth_for / group_totals_for / owner_totals_for each sum over the
    list they are handed, so scoping it here scopes every rollup at once — plus the
    endpoints' own `accounts`/`series` payloads, which should show the same scope the totals
    describe. A per-function owner argument would be three places to forget.

    Balances stay loaded whole: the out-of-scope rows are inert (nothing looks them up), and
    a join to filter them would buy nothing at 25 accounts x ~40 snapshots.
    """
    snapshots = list(
        (await db.execute(select(NetWorthSnapshot).order_by(NetWorthSnapshot.month)))
        .scalars()
        .all()
    )
    account_q = select(Account).order_by(Account.sort_order, Account.id)
    if owner_filter is not None:
        account_q = account_q.where(owner_filter)
    accounts = list((await db.execute(account_q)).scalars().all())
    balances = {
        (b.snapshot_id, b.account_id): b.balance
        for b in (await db.execute(select(AccountBalance))).scalars()
    }
    return snapshots, accounts, balances
```

Finally, insert after `group_totals_for` (i.e. after the line `        totals[account.group] += balances.get((snapshot_id, account.id), ZERO)` / `    return totals`):

```python
def owner_totals_for(
    snapshot_id: int, accounts: list[Account], balances: dict[BalanceKey, Decimal]
) -> dict[int | None, Decimal]:
    """EXCLUSIVE ownership: every account counts once, under its stored person_id, with None
    its own ("Joint") bucket. Deliberately NOT owner_clause's inclusive person view — a stack
    has to be disjoint, and stacking three inclusive views would count every joint dollar
    two or three times. The invariant this buys: sum(owner_totals_for(...).values()) ==
    net_worth_for(...) over the same account list, which is what lets the owner stack land
    exactly on the net-worth line.

    Only owners that actually hold a non-component account appear; a person with nothing to
    their name is absent rather than a zero row.
    """
    totals: dict[int | None, Decimal] = {}
    for account in accounts:
        if account.is_component:
            continue
        totals[account.person_id] = totals.get(account.person_id, ZERO) + balances.get(
            (snapshot_id, account.id), ZERO
        )
    return totals
```

- [ ] **Step 4: Run to pass.**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_net_worth_calc.py -q`
Expected: all pass (the 6 pre-existing tests plus the 6 new ones).

- [ ] **Step 5: Lint.**

Run: `cd backend && .venv/Scripts/python -m ruff check app tests && .venv/Scripts/python -m ruff format --check app tests`
Expected: clean. (If `ruff format --check` complains, run `.venv/Scripts/python -m ruff format app tests` and re-run the tests.)

- [ ] **Step 6: Commit.**

```bash
git add backend/app/services/net_worth_calc.py backend/tests/test_net_worth_calc.py
git commit -m "feat(net-worth): ownership seam — owner_clause, owner_totals_for, scoped balance matrix"
```

---

### Task 2: `owner` param + `owner_totals` / `owner_series` on the two endpoints

**Files:**
- Modify: `backend/app/schemas/net_worth.py` (`:84-107`)
- Modify: `backend/app/api/net_worth.py` (imports `:12-27`, `timeseries` `:143-174`, `summary` `:177-203`)
- Test: `backend/tests/test_net_worth_api.py` (append + repair `test_summary_empty_db` at `:227`)

- [ ] **Step 1: Write the failing tests.** First **repair** the existing exact-shape assertion — in `backend/tests/test_net_worth_api.py`, replace the body of `test_summary_empty_db` with:

```python
async def test_summary_empty_db(auth_client):
    resp = await auth_client.get("/api/v1/net-worth/summary")
    body = resp.json()
    assert body == {
        "month": None,
        "net_worth": None,
        "mom_delta": None,
        "mom_pct": None,
        "groups": [],
        "owner_totals": [],
    }
```

(Keep whatever follows the dict literal in the current test — the assertion is the whole test.)

Then append to the same file:

```python
# --- ownership views (2026-08-26 household spec §5.2) -------------------------------------


async def _seed_owned_timeseries(db):
    """Two months x {mine, theirs, joint}. Every figure below is hand-checkable:
    household 1170 -> 1330, my view 170 -> 230, their view 1070 -> 1180, joint 70 -> 80."""
    me = Person(name="Me", is_primary=True)
    partner = Person(name="Sam", is_primary=False)
    db.add_all([me, partner])
    await db.flush()
    mine = Account(
        name="My Checking", slug="my-checking", group="cash", sort_order=1, person_id=me.id
    )
    theirs = Account(
        name="Sam Brokerage", slug="sam-brokerage", group="taxable", sort_order=2,
        person_id=partner.id,
    )
    joint = Account(
        name="Joint Savings", slug="joint-savings", group="cash", sort_order=3, person_id=None
    )
    snaps = [NetWorthSnapshot(month=date(2026, 7, 1)), NetWorthSnapshot(month=date(2026, 8, 1))]
    db.add_all([mine, theirs, joint, *snaps])
    await db.flush()
    for snap, account, value in (
        (snaps[0], mine, "100.00"),
        (snaps[0], theirs, "1000.00"),
        (snaps[0], joint, "70.00"),
        (snaps[1], mine, "150.00"),
        (snaps[1], theirs, "1100.00"),
        (snaps[1], joint, "80.00"),
    ):
        db.add(AccountBalance(snapshot_id=snap.id, account_id=account.id, balance=Decimal(value)))
    await db.commit()
    return me, partner


async def test_timeseries_without_owner_is_the_whole_household(auth_client, db):
    me, partner = await _seed_owned_timeseries(db)
    body = (await auth_client.get("/api/v1/net-worth/timeseries")).json()
    assert body["net_worth"] == ["1170.00", "1330.00"]
    assert len(body["accounts"]) == 3
    # Exclusive per-owner series: primary first, then the rest by id, Joint last, and the
    # three columns add up to net_worth month by month.
    assert body["owner_series"] == [
        {"person_id": me.id, "name": "Me", "values": ["100.00", "150.00"]},
        {"person_id": partner.id, "name": "Sam", "values": ["1000.00", "1100.00"]},
        {"person_id": None, "name": None, "values": ["70.00", "80.00"]},
    ]


async def test_timeseries_owner_person_is_owned_plus_joint(auth_client, db):
    me, _partner = await _seed_owned_timeseries(db)
    body = (await auth_client.get(f"/api/v1/net-worth/timeseries?owner={me.id}")).json()
    assert body["net_worth"] == ["170.00", "230.00"]
    assert [a["slug"] for a in body["accounts"]] == ["my-checking", "joint-savings"]
    assert body["group_totals"]["cash"] == ["170.00", "230.00"]
    assert body["group_totals"]["taxable"] == ["0.00", "0.00"]
    # The scoped view's own owner split still sums to the scoped net worth.
    assert body["owner_series"] == [
        {"person_id": me.id, "name": "Me", "values": ["100.00", "150.00"]},
        {"person_id": None, "name": None, "values": ["70.00", "80.00"]},
    ]


async def test_timeseries_owner_joint_is_null_owned_only(auth_client, db):
    await _seed_owned_timeseries(db)
    body = (await auth_client.get("/api/v1/net-worth/timeseries?owner=joint")).json()
    assert body["net_worth"] == ["70.00", "80.00"]
    assert [a["slug"] for a in body["accounts"]] == ["joint-savings"]
    assert body["owner_series"] == [
        {"person_id": None, "name": None, "values": ["70.00", "80.00"]}
    ]


async def test_summary_owner_totals_and_scoped_deltas(auth_client, db):
    me, partner = await _seed_owned_timeseries(db)

    household = (await auth_client.get("/api/v1/net-worth/summary")).json()
    assert household["net_worth"] == "1330.00"
    assert household["mom_delta"] == "160.00"
    assert household["owner_totals"] == [
        {"person_id": me.id, "name": "Me", "total": "150.00"},
        {"person_id": partner.id, "name": "Sam", "total": "1100.00"},
        {"person_id": None, "name": None, "total": "80.00"},
    ]

    scoped = (await auth_client.get(f"/api/v1/net-worth/summary?owner={me.id}")).json()
    assert scoped["net_worth"] == "230.00"
    assert scoped["mom_delta"] == "60.00"
    assert scoped["mom_pct"] == "0.352941"  # 60/170, 6dp HALF_UP
    assert scoped["owner_totals"] == [
        {"person_id": me.id, "name": "Me", "total": "150.00"},
        {"person_id": None, "name": None, "total": "80.00"},
    ]

    joint = (await auth_client.get("/api/v1/net-worth/summary?owner=joint")).json()
    assert joint["net_worth"] == "80.00"
    assert joint["mom_pct"] == "0.142857"  # 10/70
    assert joint["owner_totals"] == [{"person_id": None, "name": None, "total": "80.00"}]


async def test_owner_param_rejects_garbage_on_both_endpoints(auth_client, db):
    await _seed_owned_timeseries(db)
    for bad in ("nobody", "-1", "0", "1.5", "99999999999"):
        assert (
            await auth_client.get(f"/api/v1/net-worth/timeseries?owner={bad}")
        ).status_code == 422, bad
        assert (
            await auth_client.get(f"/api/v1/net-worth/summary?owner={bad}")
        ).status_code == 422, bad


async def test_owner_series_on_a_peopleless_database_is_one_joint_row(auth_client, db):
    """The pre-household shape: no people rows, every account NULL-owned. The payload must
    still be honest and still sum to net_worth rather than 500 on the missing join."""
    await _seed_timeseries(db)
    body = (await auth_client.get("/api/v1/net-worth/timeseries")).json()
    assert body["owner_series"] == [
        {"person_id": None, "name": None, "values": ["900.00", "1120.00", "1500.00"]}
    ]
```

Extend the file's import line (`:4`) to:

```python
from app.models import Account, AccountBalance, NetWorthSnapshot, Person
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_net_worth_api.py -q`
Expected: the new tests fail with `KeyError: 'owner_series'` / `KeyError: 'owner_totals'`, `test_owner_param_rejects_garbage_on_both_endpoints` fails (unknown params are ignored → 200), and `test_summary_empty_db` fails on the missing `owner_totals` key.

- [ ] **Step 3: Implement the schemas.** In `backend/app/schemas/net_worth.py`, insert immediately before `class TimeseriesOut(BaseModel):` (`:84`):

```python
class OwnerSeries(BaseModel):
    """One EXCLUSIVE owner column, aligned with `months`. `name` is null for the joint
    (NULL-owned) row — the client owns that label, the server does not invent a person."""

    person_id: int | None
    name: str | None
    values: list[Decimal]
```

Add `owner_series` to `TimeseriesOut`, after `notes` (`:93`):

```python
    # Exclusive per-owner net worth, primary person first and Joint last. Sums to
    # `net_worth` month by month by construction — that is what lets the page stack it.
    owner_series: list[OwnerSeries]
```

Insert before `class SummaryOut(BaseModel):` (`:102`):

```python
class OwnerTotal(BaseModel):
    person_id: int | None
    name: str | None
    total: Decimal
```

Add to `SummaryOut`, after `groups` (`:107`):

```python
    # Beside `groups`, never instead of it: the same latest snapshot split the other way.
    # Empty when there are no snapshots. Sums to `net_worth`.
    owner_totals: list[OwnerTotal]
```

- [ ] **Step 4: Implement the router.** In `backend/app/api/net_worth.py`, replace the import block (`:1-27`) header pieces:

```python
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import ACCOUNT_GROUPS, Account, AccountBalance, NetWorthSnapshot, Person
from app.schemas.net_worth import (
    AccountCreate,
    AccountOut,
    AccountSeries,
    AccountUpdate,
    BalanceEntry,
    GroupSummary,
    MonthBalancesOut,
    MonthUpsert,
    MonthUpsertResult,
    OwnerSeries,
    OwnerTotal,
    SummaryOut,
    TimeseriesOut,
)
from app.services.money import mom_pct, quantize_money, require_first_of_month
from app.services.net_worth_calc import (
    ZERO,
    group_totals_for,
    load_balance_matrix,
    net_worth_for,
    owner_clause,
    owner_totals_for,
)
```

Replace the `QUARTER_END_MONTHS` block and both endpoints (`:140-203`) with:

```python
QUARTER_END_MONTHS = (3, 6, 9, 12)

# A bounded string, not an int: the value is either a person id or the literal "joint", and
# a length cap keeps a garbage query out of the parser before owner_clause even sees it.
OwnerQuery = Annotated[str | None, Query(max_length=32)]


def _owner_filter(owner: str | None) -> ColumnElement[bool] | None:
    """HTTP contract only — owner_clause owns the SEMANTICS. Absent means household, and
    the endpoint's answer is then byte-identical to the pre-ownership one."""
    if owner is None:
        return None
    try:
        return owner_clause(owner)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


async def _owner_rows(
    db: AsyncSession, accounts: list[Account]
) -> list[tuple[int | None, str | None]]:
    """The owner identities present in `accounts`: primary person first, the rest by id,
    Joint (NULL-owned) last. Components are excluded from every rollup, so they must not
    conjure an owner row either — otherwise a partner whose only row is a 401(k) bucket
    would appear with a phantom $0.00 column."""
    owned = {a.person_id for a in accounts if not a.is_component}
    people = list(
        (await db.execute(select(Person).order_by(Person.is_primary.desc(), Person.id)))
        .scalars()
        .all()
    )
    rows: list[tuple[int | None, str | None]] = [(p.id, p.name) for p in people if p.id in owned]
    if None in owned:
        rows.append((None, None))  # Joint — the client owns that word, not the server
    return rows


@router.get("/timeseries", response_model=TimeseriesOut)
async def timeseries(
    granularity: Literal["monthly", "quarterly"] = "monthly",
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
) -> TimeseriesOut:
    snapshots, accounts, balances = await load_balance_matrix(db, _owner_filter(owner))
    if granularity == "quarterly":
        snapshots = [s for s in snapshots if s.month.month in QUARTER_END_MONTHS]
    net_worth = [net_worth_for(s.id, accounts, balances) for s in snapshots]
    mom = [
        None if i == 0 else mom_pct(net_worth[i], net_worth[i - 1]) for i in range(len(net_worth))
    ]
    per_snapshot_groups = [group_totals_for(s.id, accounts, balances) for s in snapshots]
    group_totals = {
        group: [totals[group] for totals in per_snapshot_groups] for group in ACCOUNT_GROUPS
    }
    # Same in-memory matrix, regrouped: no extra queries, and the toggle on the page is a
    # re-render rather than a refetch.
    per_snapshot_owners = [owner_totals_for(s.id, accounts, balances) for s in snapshots]
    owner_rows = await _owner_rows(db, accounts)
    return TimeseriesOut(
        months=[s.month for s in snapshots],
        accounts=[AccountOut.model_validate(a) for a in accounts],
        series=[
            AccountSeries(
                account_id=a.id,
                values=[balances.get((s.id, a.id)) for s in snapshots],
            )
            for a in accounts
        ],
        group_totals=group_totals,
        net_worth=net_worth,
        mom_pct=mom,
        # After the quarterly filter, so the list stays aligned with `months`.
        notes=[s.notes for s in snapshots],
        owner_series=[
            OwnerSeries(
                person_id=person_id,
                name=name,
                values=[totals.get(person_id, ZERO) for totals in per_snapshot_owners],
            )
            for person_id, name in owner_rows
        ],
    )


@router.get("/summary", response_model=SummaryOut)
async def summary(
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
) -> SummaryOut:
    snapshots, accounts, balances = await load_balance_matrix(db, _owner_filter(owner))
    if not snapshots:
        return SummaryOut(
            month=None,
            net_worth=None,
            mom_delta=None,
            mom_pct=None,
            groups=[],
            owner_totals=[],
        )
    latest = snapshots[-1]
    previous = snapshots[-2] if len(snapshots) > 1 else None
    latest_nw = net_worth_for(latest.id, accounts, balances)
    latest_groups = group_totals_for(latest.id, accounts, balances)
    prev_nw = net_worth_for(previous.id, accounts, balances) if previous else None
    prev_groups = group_totals_for(previous.id, accounts, balances) if previous else None
    latest_owners = owner_totals_for(latest.id, accounts, balances)
    owner_rows = await _owner_rows(db, accounts)
    return SummaryOut(
        month=latest.month,
        net_worth=latest_nw,
        mom_delta=None if prev_nw is None else latest_nw - prev_nw,
        mom_pct=mom_pct(latest_nw, prev_nw),
        groups=[
            GroupSummary(
                group=group,
                total=latest_groups[group],
                mom_delta=None
                if prev_groups is None
                else latest_groups[group] - prev_groups[group],
            )
            for group in ACCOUNT_GROUPS
        ],
        owner_totals=[
            OwnerTotal(person_id=person_id, name=name, total=latest_owners.get(person_id, ZERO))
            for person_id, name in owner_rows
        ],
    )
```

- [ ] **Step 5: Run to pass.**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_net_worth_api.py tests/test_net_worth_calc.py -q`
Expected: all pass.

- [ ] **Step 6: Prove nothing else regressed** (overview/projection/spending all read these helpers).

Run: `cd backend && .venv/Scripts/python -m pytest -q`
Expected: the full suite is green (910+ tests). If you hit the `uq_users_email` flake, re-run once.

- [ ] **Step 7: Lint.**

Run: `cd backend && .venv/Scripts/python -m ruff check app tests`
Expected: clean.

- [ ] **Step 8: Commit.**

```bash
git add backend/app/schemas/net_worth.py backend/app/api/net_worth.py backend/tests/test_net_worth_api.py
git commit -m "feat(net-worth): owner query param on timeseries/summary, owner_totals + owner_series"
```

---

## Phase 2 — Wire types & client

### Task 3: Wire types and the `owner` param on the two clients

**Files:**
- Modify: `src/types/api.ts` (`:42-65`)
- Modify: `src/api/netWorth.ts` (`:23-31`)
- Create: `src/api/netWorth.test.ts`
- Repair fixtures: `src/pages/OverviewPage.test.tsx` (`:130`, `:147`), `src/pages/ProjectionPage.test.tsx` (`:101`), `src/pages/CreditCardsPage.test.tsx` (`:132`), `src/pages/MonthlyUpdatePage.test.tsx` (`:48`, `:244`)

- [ ] **Step 1: Write the failing test.** Create `src/api/netWorth.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest'
import { fetchSummary, fetchTimeseries } from './netWorth'

// Only the transport is stubbed — the query string this module builds IS the test
// (src/api/projection.test.ts's posture).
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

beforeEach(() => vi.clearAllMocks())

const path = () => vi.mocked(api).mock.calls[0][0]

it('omits owner entirely for the household view', async () => {
  // Byte-identical to the pre-ownership request: absent means household, server-side.
  await fetchTimeseries()
  expect(path()).toBe('/net-worth/timeseries?granularity=monthly')
})

it('omits owner from the summary too', async () => {
  await fetchSummary()
  expect(path()).toBe('/net-worth/summary')
})

it('sends a person id as the owner scope, after granularity', async () => {
  await fetchTimeseries('quarterly', 3)
  expect(path()).toBe('/net-worth/timeseries?granularity=quarterly&owner=3')
})

it('sends the joint literal, and it is the summary query string on its own', async () => {
  await fetchSummary('joint')
  expect(path()).toBe('/net-worth/summary?owner=joint')
  vi.clearAllMocks()
  await fetchTimeseries('monthly', 'joint')
  expect(path()).toBe('/net-worth/timeseries?granularity=monthly&owner=joint')
})
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/api/netWorth.test.ts`
Expected: FAIL — `fetchTimeseries('quarterly', 3)` is a TS/arity error and the owner suffix is absent.

- [ ] **Step 3: Implement the types.** In `src/types/api.ts`, insert before `export interface NetWorthTimeseries` (`:42`):

```ts
/** One EXCLUSIVE owner column of the timeseries — `name` is null for the joint
 *  (NULL-owned) row; the UI supplies the word "Joint". Values are aligned with `months`
 *  and sum to `net_worth` month by month, which is why they can be stacked. */
export interface OwnerSeries {
  person_id: number | null
  name: string | null
  values: string[]
}

export interface OwnerTotal {
  person_id: number | null
  name: string | null
  total: string
}
```

Add to `NetWorthTimeseries`, after `notes` (`:50`):

```ts
  /** Per-owner net worth, primary person first and Joint last — the "By owner" stack. */
  owner_series: OwnerSeries[]
```

Add to `NetWorthSummary`, after `groups` (`:64`):

```ts
  /** The latest snapshot split by owner instead of by group; empty with no snapshots. */
  owner_totals: OwnerTotal[]
```

- [ ] **Step 4: Implement the client.** In `src/api/netWorth.ts`, extend the type import (`:2-10`) with `OwnerScope`'s dependencies untouched, and replace `fetchTimeseries`/`fetchSummary` (`:23-31`) with:

```ts
/** The page-level ownership scope. `null` is the household view and sends NO param at all,
 *  so an unfiltered request stays byte-identical to the pre-ownership one. */
export type OwnerScope = number | 'joint' | null

export function fetchTimeseries(
  granularity: 'monthly' | 'quarterly' = 'monthly',
  owner: OwnerScope = null,
): Promise<NetWorthTimeseries> {
  const scope = owner === null ? '' : `&owner=${owner}`
  return api<NetWorthTimeseries>(`/net-worth/timeseries?granularity=${granularity}${scope}`)
}

export function fetchSummary(owner: OwnerScope = null): Promise<NetWorthSummary> {
  const scope = owner === null ? '' : `?owner=${owner}`
  return api<NetWorthSummary>(`/net-worth/summary${scope}`)
}
```

- [ ] **Step 5: Repair the six existing fixtures** (the two new fields are REQUIRED, and `tsconfig.app.json` typechecks `src/**` including tests).

`src/pages/OverviewPage.test.tsx` — in `summaryOut` (`:130`) add `owner_totals: [],` after `groups: [],`; in `timeseriesOut` (`:147`) add `owner_series: [],` after `notes: [null, null, null],`.

`src/pages/ProjectionPage.test.tsx` — in `timeseries` (`:101`) add `owner_series: [],` after `notes: [null, null, null],`.

`src/pages/CreditCardsPage.test.tsx` (`:132`) — replace the `fetchSummary` mock with:

```tsx
  vi.mocked(fetchSummary).mockResolvedValue({
    month: null, net_worth: null, mom_delta: null, mom_pct: null, groups: [], owner_totals: [],
  })
```

`src/pages/MonthlyUpdatePage.test.tsx` — in BOTH `fetchTimeseries` mocks (`:48` in `beforeEach` and `:244` inside the current-month test) add `owner_series: [],` after `notes: [null],`.

- [ ] **Step 6: Run to pass.**

Run: `npx vitest run src/api/netWorth.test.ts`
Expected: 4 passed.

Run: `npx tsc -b`
Expected: no output (clean).

Run: `npx vitest run`
Expected: the whole frontend suite green (982+ tests).

- [ ] **Step 7: Commit.**

```bash
git add src/types/api.ts src/api/netWorth.ts src/api/netWorth.test.ts src/pages/OverviewPage.test.tsx src/pages/ProjectionPage.test.tsx src/pages/CreditCardsPage.test.tsx src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat(net-worth): owner scope on the timeseries/summary clients + owner wire types"
```

---

## Phase 3 — Net Worth page

### Task 4: `marriageMarkLine` — the pure wedding-month annotation

**Files:**
- Modify: `src/components/networth/netWorthChartOptions.ts` (imports `:4-7`, append at end)
- Test: `src/components/networth/netWorthChartOptions.test.ts` (append)

- [ ] **Step 1: Write the failing test.** Append to `src/components/networth/netWorthChartOptions.test.ts`:

```ts
import { marriageMarkLine } from './netWorthChartOptions'

describe('marriageMarkLine', () => {
  const MONTHS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']

  it('anchors on the wedding MONTH, whatever day of it the wedding falls on', () => {
    const mark = marriageMarkLine(MONTHS, '2026-08-14')
    // The x-axis carries formatMonth labels, so the markLine has to speak the same words.
    expect(mark?.data).toEqual([{ xAxis: 'Aug 2026' }])
    expect(mark?.label.formatter).toBe('Married')
    expect(mark?.lineStyle.type).toBe('dashed')
    expect(mark?.silent).toBe(true)
  })

  it('falls forward to the first month on record when the wedding month has no snapshot', () => {
    expect(marriageMarkLine(['2026-06-01', '2026-09-01'], '2026-08-14')?.data).toEqual([
      { xAxis: 'Sep 2026' },
    ])
  })

  it('draws nothing it cannot honestly place', () => {
    expect(marriageMarkLine(MONTHS, null)).toBeUndefined()
    expect(marriageMarkLine(MONTHS, '')).toBeUndefined()
    expect(marriageMarkLine([], '2026-08-14')).toBeUndefined()
    // The wedding is after every snapshot: there is no month to mark YET, and clamping it
    // onto the last one would draw a line at a date that has not happened.
    expect(marriageMarkLine(MONTHS, '2027-01-02')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/components/networth/netWorthChartOptions.test.ts`
Expected: FAIL — `marriageMarkLine is not a function` / import error.

- [ ] **Step 3: Implement.** In `src/components/networth/netWorthChartOptions.ts`, replace the two imports (`:4-7`):

```ts
import { GROUP_LABELS, GROUP_ORDER, MUTED } from '../../charts/theme'
import type { NetWorthTimeseries } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { escapeHtml, formatCurrency, formatMonth } from '../../utils/format'
```

Append at the end of the file:

```ts
/** The wedding annotation's shape — narrow on purpose, so the test can read it without
 *  echarts' `any`-ish option types. */
export interface MarriageMarkLine {
  silent: true
  symbol: 'none'
  lineStyle: { color: string; width: number; type: 'dashed' }
  label: { show: true; formatter: string; position: 'insideEndTop'; color: string; fontSize: number }
  data: { xAxis: string }[]
}

/**
 * A dashed vertical rule on the trend at the marriage month (household spec §6). The step
 * at that boundary is REAL — partner history starts fresh there, by decision — so it has to
 * read as intentional rather than as a data glitch.
 *
 * The x-axis is a CATEGORY axis of formatMonth labels, so the markLine's value must be a
 * label, not an ISO date. The wedding day is normalised to its month; if that exact month
 * has no snapshot (a gap, or quarterly granularity) the mark falls FORWARD to the first
 * month on record after it. A wedding later than every snapshot draws nothing — there is
 * no month to mark yet, and clamping it to the last one would date a line to the future.
 */
export function marriageMarkLine(
  months: string[],
  marriageDate: string | null | undefined,
): MarriageMarkLine | undefined {
  if (!marriageDate || months.length === 0) return undefined
  // ISO first-of-month strings compare lexicographically (utils/months.ts's contract).
  const bucket = `${marriageDate.slice(0, 7)}-01`
  const index = months.findIndex((month) => month >= bucket)
  if (index === -1) return undefined
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { color: MUTED, width: 1, type: 'dashed' },
    label: {
      show: true,
      formatter: 'Married',
      position: 'insideEndTop',
      color: MUTED,
      fontSize: 11,
    },
    data: [{ xAxis: formatMonth(months[index]) }],
  }
}
```

- [ ] **Step 4: Run to pass.**

Run: `npx vitest run src/components/networth/netWorthChartOptions.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/components/networth/netWorthChartOptions.ts src/components/networth/netWorthChartOptions.test.ts
git commit -m "feat(net-worth): marriageMarkLine — dashed wedding-month rule for the trend"
```

---

### Task 5: Owner chips on the Net Worth page

**Files:**
- Modify: `src/pages/NetWorthPage.tsx` (imports `:1-39`, state `:54-88`, `load` `:94-123`, render `:284-347`)
- Modify: `src/pages/NetWorthPage.css` (append)
- Create: `src/pages/NetWorthPage.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `src/pages/NetWorthPage.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HouseholdOut, NetWorthSummary, NetWorthTimeseries } from '../types/api'
import NetWorthPage from './NetWorthPage'

vi.mock('../api/netWorth', () => ({ fetchTimeseries: vi.fn(), fetchSummary: vi.fn() }))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what each chart
// DRAWS is pinned in netWorthChartOptions.test.ts; this marker exposes only the option
// slices this page owns: series names, their stack ids, and any markLine anchor.
vi.mock('../components/EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
    }: {
      option: {
        series?: {
          name?: string
          stack?: string
          markLine?: { data?: { xAxis?: string }[] }
        }[]
      }
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'data-series': (option.series ?? []).map((s) => s.name ?? '').join('|'),
        'data-stacks': (option.series ?? []).map((s) => s.stack ?? '-').join('|'),
        'data-marriage': (option.series ?? [])
          .flatMap((s) => s.markLine?.data ?? [])
          .map((d) => d.xAxis ?? '')
          .join('|'),
      }),
  }
})

import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { fetchHousehold } from '../api/household'

const ME = { id: 1, name: 'Me', is_primary: true }
const SAM = { id: 2, name: 'Sam', is_primary: false }

function timeseriesOut(over: Partial<NetWorthTimeseries> = {}): NetWorthTimeseries {
  return {
    months: ['2026-07-01', '2026-08-01'],
    accounts: [
      {
        id: 1, name: 'My Checking', slug: 'my-checking', group: 'cash', sort_order: 1,
        is_active: true, is_component: false, parent_account_id: null, person_id: 1,
      },
      {
        id: 2, name: 'Joint Savings', slug: 'joint-savings', group: 'cash', sort_order: 2,
        is_active: true, is_component: false, parent_account_id: null, person_id: null,
      },
    ],
    series: [
      { account_id: 1, values: ['100.00', '150.00'] },
      { account_id: 2, values: ['70.00', '80.00'] },
    ],
    group_totals: {
      cash: ['170.00', '230.00'], pre_tax: ['0.00', '0.00'], post_tax: ['0.00', '0.00'],
      taxable: ['0.00', '0.00'], equity: ['0.00', '0.00'], other: ['0.00', '0.00'],
      liability: ['0.00', '0.00'],
    },
    net_worth: ['170.00', '230.00'],
    mom_pct: [null, '0.352941'],
    notes: [null, null],
    owner_series: [
      { person_id: 1, name: 'Me', values: ['100.00', '150.00'] },
      { person_id: null, name: null, values: ['70.00', '80.00'] },
    ],
    ...over,
  }
}

function summaryOut(over: Partial<NetWorthSummary> = {}): NetWorthSummary {
  return {
    month: '2026-08-01',
    net_worth: '230.00',
    mom_delta: '60.00',
    mom_pct: '0.352941',
    groups: [],
    owner_totals: [
      { person_id: 1, name: 'Me', total: '150.00' },
      { person_id: null, name: null, total: '80.00' },
    ],
    ...over,
  }
}

function household(over: Partial<HouseholdOut> = {}): HouseholdOut {
  return { people: [ME, SAM], marriage_date: null, ...over }
}

beforeEach(() => {
  vi.mocked(fetchTimeseries).mockResolvedValue(timeseriesOut())
  vi.mocked(fetchSummary).mockResolvedValue(summaryOut())
  vi.mocked(fetchHousehold).mockResolvedValue(household())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <NetWorthPage />
    </MemoryRouter>,
  )
}

it('hides the owner controls entirely for a one-person household', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ people: [ME] }))
  renderPage()
  await screen.findByText('Net worth')
  await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
  // Nothing to choose between: chips and the stack toggle would both be one-option UI.
  expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull()
  expect(screen.queryByRole('group', { name: 'Stack by' })).toBeNull()
})

it('renders All / each person / Joint once a partner exists', async () => {
  renderPage()
  const chips = await screen.findByRole('group', { name: 'Owner' })
  expect(
    [...chips.querySelectorAll('button')].map((b) => b.textContent),
  ).toEqual(['All', 'Me', 'Sam', 'Joint'])
})

it('scopes BOTH fetches to the picked owner, and back to the household on All', async () => {
  renderPage()
  const chips = await screen.findByRole('group', { name: 'Owner' })
  fireEvent.click(screen.getByRole('button', { name: 'Sam' }))
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', SAM.id))
  expect(fetchSummary).toHaveBeenCalledWith(SAM.id)
  expect(screen.getByRole('button', { name: 'Sam' }).getAttribute('aria-pressed')).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: 'Joint' }))
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', 'joint'))
  expect(fetchSummary).toHaveBeenCalledWith('joint')

  fireEvent.click(chips.querySelectorAll('button')[0])
  // null, not omitted: the client turns null into no param at all (netWorth.test.ts).
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalledWith('monthly', null))
  expect(fetchSummary).toHaveBeenLastCalledWith(null)
})

it('keeps the page alive when the household endpoint fails', async () => {
  vi.mocked(fetchHousehold).mockRejectedValue(new Error('household down'))
  renderPage()
  // The scope control is an affordance; losing it must cost the chips and nothing else.
  expect(await screen.findByText('Net worth')).toBeTruthy()
  await waitFor(() => expect(fetchTimeseries).toHaveBeenCalled())
  expect(screen.queryByRole('group', { name: 'Owner' })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/pages/NetWorthPage.test.tsx`
Expected: FAIL — `Unable to find role="group" and name "Owner"`, and `fetchTimeseries` is called with one argument.

- [ ] **Step 3: Implement.** In `src/pages/NetWorthPage.tsx`:

(a) Add to the imports, after the `fetchSummary, fetchTimeseries` line (`:4`):

```tsx
import type { OwnerScope } from '../api/netWorth'
import { fetchHousehold } from '../api/household'
```

and extend the `types/api` type import (`:28`) to:

```tsx
import type {
  AccountGroup,
  HouseholdOut,
  NetWorthSummary,
  NetWorthTimeseries,
} from '../types/api'
```

(b) Add state, right after `const [granularity, setGranularity] = useState<'monthly' | 'quarterly'>('monthly')` (`:56`):

```tsx
  // The page's ownership scope: null = the whole household (and NO owner param at all, so
  // the request is byte-identical to the pre-ownership one). It scopes the tiles, both
  // charts and the accounts table, which is why the chips sit above the tiles rather than
  // inside a card header.
  const [owner, setOwner] = useState<OwnerScope>(null)
  // Fetched on its own, never inside the page's Promise.all: the chips are an affordance,
  // and a household hiccup must not blank the net worth (OverviewPage's isolated-fetch
  // posture). null covers both "not loaded yet" and "failed".
  const [household, setHousehold] = useState<HouseholdOut | null>(null)
```

(c) Rewrite the fetch pair inside `load` (`:95`) and its dep list (`:123`):

```tsx
    Promise.all([fetchTimeseries(granularity, owner), fetchSummary(owner)])
```

```tsx
  }, [granularity, owner])
```

(d) Add the household effect immediately after the existing `useEffect(() => { load() }, [load])` (`:132-134`):

```tsx
  // Once per visit, and deliberately not part of `load`: setState lives in the promise
  // continuations, never in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    fetchHousehold()
      .then(setHousehold)
      .catch(() => setHousehold(null))
  }, [])
```

(e) Add the derived scope list and the chip handler, just above `const filledMonths = ...` (`:136`):

```tsx
  const people = household?.people ?? []
  // Primary first, then everyone else by id — the same order the server uses for
  // owner_series/owner_totals, so chips and stack read left-to-right the same way.
  const orderedPeople = useMemo(
    () =>
      [...people].sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
      ),
    [people],
  )
  // One person means there is nothing to choose between: no chips, no stack toggle.
  const ownerScopes: { scope: OwnerScope; label: string }[] =
    orderedPeople.length > 1
      ? [
          { scope: null, label: 'All' },
          ...orderedPeople.map((p) => ({ scope: p.id as OwnerScope, label: p.name })),
          { scope: 'joint' as OwnerScope, label: 'Joint' },
        ]
      : []

  const selectOwner = (next: OwnerScope) => {
    if (next === owner) return
    beginLoad()
    // The drill-down holds ACCOUNT ids, and the next scope may not contain them — clear it
    // and let the seed pick this scope's biggest account instead of leaving empty series.
    setDrill([])
    seededDrillRef.current = false
    setOwner(next)
  }
```

(f) Render the chips. Insert between the closing `</div>` of `page-header` (`:297`) and the `{error && (` block (`:299`):

```tsx
      {ownerScopes.length > 0 && (
        <div className="networth-owner-row">
          <span className="eyebrow">Whose money</span>
          <div className="segmented" role="group" aria-label="Owner">
            {ownerScopes.map(({ scope, label }) => (
              <button
                key={label}
                type="button"
                className={owner === scope ? 'active' : ''}
                aria-pressed={owner === scope}
                onClick={() => selectOwner(scope)}
              >
                {label}
              </button>
            ))}
          </div>
          <InfoHint text="A person's view is their own accounts plus the joint ones — that is what a joint account is. Joint shows only the shared accounts." />
        </div>
      )}
```

(g) Append to `src/pages/NetWorthPage.css`:

```css
/* Page-level ownership scope. It sits ABOVE the tiles because it scopes them too — a
   control that changes the hero number must not be buried in a card header. */
.networth-owner-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.networth-owner-row .eyebrow {
  margin: 0;
}
```

- [ ] **Step 4: Run to pass.**

Run: `npx vitest run src/pages/NetWorthPage.test.tsx`
Expected: 4 passed.

Run: `npx tsc -b && npx eslint src/pages/NetWorthPage.tsx`
Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add src/pages/NetWorthPage.tsx src/pages/NetWorthPage.css src/pages/NetWorthPage.test.tsx
git commit -m "feat(net-worth): owner chips scope the page's tiles, charts and table"
```

---

### Task 6: "By owner" stacking toggle + the marriage markLine on the trend

**Files:**
- Modify: `src/pages/NetWorthPage.tsx` (`stackedOption` memo `:143-231`, chart header `:351-377`)
- Modify: `src/pages/NetWorthPage.css` (comment at `:10`)
- Test: `src/pages/NetWorthPage.test.tsx` (append)

- [ ] **Step 1: Write the failing tests.** Append to `src/pages/NetWorthPage.test.tsx`:

```tsx
const stacked = () => screen.getAllByTestId('echart')[0]

it('stacks by group by default and by owner on demand — no refetch either way', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Stack by' })
  expect(stacked().getAttribute('data-series')).toBe(
    'Cash|Pre-tax|Post-tax|Taxable|Equity|Other|Liabilities|Net worth',
  )
  const callsBefore = vi.mocked(fetchTimeseries).mock.calls.length

  fireEvent.click(screen.getByRole('button', { name: 'By owner' }))
  // owner_series ships on the SAME payload, so the toggle is a re-render, not a request.
  expect(vi.mocked(fetchTimeseries).mock.calls.length).toBe(callsBefore)
  expect(stacked().getAttribute('data-series')).toBe('Me|Joint|Net worth')
  // One stack id across the owner columns, so they land on the net-worth line; the line
  // itself is never stacked.
  expect(stacked().getAttribute('data-stacks')).toBe('owner|owner|-')

  fireEvent.click(screen.getByRole('button', { name: 'By group' }))
  expect(stacked().getAttribute('data-series')).toContain('Cash|')
})

it('marks the wedding month on the trend once a marriage date is set', async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household({ marriage_date: '2026-08-14' }))
  renderPage()
  await waitFor(() => expect(stacked().getAttribute('data-marriage')).toBe('Aug 2026'))
})

it('draws no marriage rule when the household has no date yet', async () => {
  renderPage()
  await screen.findByRole('group', { name: 'Owner' })
  expect(stacked().getAttribute('data-marriage')).toBe('')
})
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/pages/NetWorthPage.test.tsx`
Expected: FAIL — no `role="group"` named "Stack by"; `data-marriage` is `''` in the marriage test.

- [ ] **Step 3: Implement.** In `src/pages/NetWorthPage.tsx`:

(a) Extend the chart-options import (`:12-16`) to:

```tsx
import {
  NOTES_SERIES,
  marriageMarkLine,
  netWorthCsv,
  netWorthStackedTooltipFormatter,
} from '../components/networth/netWorthChartOptions'
```

(b) Add state beside `owner` (right after the `household` state added in Task 5):

```tsx
  // Group stacking stays the default (spec §6): "how is it invested" is the question this
  // chart has always answered; "whose is it" is the new second reading of the same total.
  const [stackBy, setStackBy] = useState<'group' | 'owner'>('group')
```

(c) Replace the `series:` array of `stackedOption` (`:174-229`) with the following, and extend the memo's dep list (`:231`) to `[data, range, legendSelected, stackBy, household]`:

```tsx
      series: [
        ...(stackBy === 'owner'
          ? (data.owner_series ?? []).map((series, i) => ({
              // The server's owner_series is EXCLUSIVE and sums to net_worth, so the stack
              // lands exactly on the line below. `?? []` is stale-deploy armor, like notes.
              name: series.name ?? 'Joint',
              type: 'line' as const,
              stack: 'owner',
              // Owner columns are NET (assets minus that owner's liabilities), so one of
              // them can go negative. echarts' default 'samesign' strategy would then park
              // it on the baseline and the stack would stop meeting the net-worth line;
              // 'all' keeps the sum honest.
              stackStrategy: 'all' as const,
              symbol: 'none' as const,
              lineStyle: { width: 1 },
              areaStyle: { opacity: 0.5 },
              // Fixed slot order IS the CVD-safety mechanism (theme.ts) — never more than
              // PALETTE.length owners, and the order is the server's, so a colour follows
              // a person rather than their rank in a re-sort.
              color: PALETTE[i % PALETTE.length],
              data: series.values.map(Number),
            }))
          : [
              ...ASSET_GROUPS.map((group) => ({
                name: GROUP_LABELS[group],
                type: 'line' as const,
                stack: 'assets',
                symbol: 'none' as const,
                lineStyle: { width: 1 },
                areaStyle: { opacity: 0.5 },
                color: GROUP_COLORS[group],
                data: data.group_totals[group].map(Number),
              })),
              {
                name: GROUP_LABELS.liability,
                type: 'line' as const,
                symbol: 'none' as const,
                lineStyle: { width: 1 },
                areaStyle: { opacity: 0.5 },
                color: GROUP_COLORS.liability,
                data: data.group_totals.liability.map(Number),
              },
            ]),
        {
          name: 'Net worth',
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 2.5 },
          color: INK,
          z: 10,
          endLabel: {
            show: true,
            color: INK,
            fontWeight: 600,
            formatter: (params: { value?: unknown }) =>
              formatCurrencyCompact(params.value as number),
          },
          // The wedding rule rides the net-worth line: one annotation, on the series that
          // is present in BOTH stack modes.
          ...(marriageMark ? { markLine: marriageMark } : {}),
          data: data.net_worth.map(Number),
        },
        ...(noted.length > 0
          ? [
              {
                name: NOTES_SERIES,
                // Plain scatter, deliberately not effectScatter: a note is history, and
                // the ripple is the live ping's reserved "this is now" signal. Diamond +
                // MUTED = identity by SHAPE and a neutral tone — the wizard's notes are
                // an annotation layer, not a fourth data hue (theme.ts's ≤3-hue law).
                type: 'scatter' as const,
                symbol: 'diamond' as const,
                symbolSize: 9,
                color: MUTED,
                itemStyle: { borderColor: INK, borderWidth: 1 },
                emphasis: { itemStyle: { borderColor: INK } },
                z: 11,
                data: noted.map((p) => ({ value: [p.label, p.value], note: p.note })),
              },
            ]
          : []),
      ],
```

(d) Inside the same memo, just after the `noted` const (`:155`), add:

```tsx
    const marriageMark = marriageMarkLine(data.months, household?.marriage_date ?? null)
```

(e) In the same memo, make the tooltip mode-aware — replace the `formatter:` line (`:167`) with:

```tsx
        // Owner columns already sum to the net-worth row, so an "Assets" subtotal would
        // just print the same number twice: no asset set in owner mode, no subtotal row.
        formatter: netWorthStackedTooltipFormatter(
          stackBy === 'owner' ? [] : ASSET_GROUPS.map((g) => GROUP_LABELS[g]),
        ),
```

(f) Render the toggle. In `networth-chart-controls` (`:356`), insert **before** the `<RangeChips ... />` line:

```tsx
              {ownerScopes.length > 0 && (
                <div className="segmented" role="group" aria-label="Stack by">
                  {(['group', 'owner'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={stackBy === mode ? 'active' : ''}
                      aria-pressed={stackBy === mode}
                      onClick={() => setStackBy(mode)}
                    >
                      {mode === 'group' ? 'By group' : 'By owner'}
                    </button>
                  ))}
                </div>
              )}
```

(g) Update the CSS comment at `src/pages/NetWorthPage.css:10`:

```css
/* Up to three segmented controls side by side (stack-by + time range + granularity);
   wraps on narrow. */
```

**Deliberate non-goal:** the ⤓ CSV export stays `netWorthCsv(data)` (months × the seven fixed groups + net worth) in both modes — the export is defined as the group table, and a mode-dependent CSV would make "the net-worth export" mean two different files.

- [ ] **Step 4: Run to pass.**

Run: `npx vitest run src/pages/NetWorthPage.test.tsx`
Expected: 7 passed.

Run: `npx tsc -b && npx eslint src/pages/NetWorthPage.tsx`
Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add src/pages/NetWorthPage.tsx src/pages/NetWorthPage.css src/pages/NetWorthPage.test.tsx
git commit -m "feat(net-worth): by-owner stacking toggle and the marriage-date markLine"
```

---

## Phase 4 — Monthly Update wizard

### Task 7: Group the balance grid by owner, with a per-owner subtotal

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx` (imports `:1-30`, load `:171-284`, `orderedBalanceRows` `:462-463`, `groupTotals` `:552-560`, table body `:668-745`)
- Modify: `src/pages/MonthlyUpdatePage.css` (after `.entry-subtotal-row td` `:85-89`)
- Test: `src/pages/MonthlyUpdatePage.test.tsx`

- [ ] **Step 1: Write the failing tests.** In `src/pages/MonthlyUpdatePage.test.tsx`, add the household mock beside the two existing `vi.mock` calls (`:6-17`):

```tsx
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
```

and add `import * as householdApi from '../api/household'` beside the other namespace imports (`:19-20`).

Every existing fixture account needs an owner; give the two module-level ones the primary person and add a partner + joint pair. Replace the `account` / `savings` consts (`:23-32`) with:

```tsx
const account = {
  id: 1, name: 'Checking', slug: 'checking', group: 'cash' as const,
  sort_order: 1, is_active: true, is_component: false, parent_account_id: null,
  person_id: 1,
}
// The default fixture is one account, which cannot show ORDER — the paste tests that care
// about where a range lands opt into this second row.
const savings = {
  id: 2, name: 'Savings', slug: 'savings', group: 'cash' as const,
  sort_order: 2, is_active: true, is_component: false, parent_account_id: null,
  person_id: 1,
}
// Owner-grouping fixtures: one per ownership kind, in three different groups so the walk's
// owner → group → row nesting is unambiguous in the assertions.
const samBrokerage = {
  id: 3, name: 'Sam Brokerage', slug: 'sam-brokerage', group: 'taxable' as const,
  sort_order: 3, is_active: true, is_component: false, parent_account_id: null,
  person_id: 2,
}
const jointSavings = {
  id: 4, name: 'Joint Savings', slug: 'joint-savings', group: 'cash' as const,
  sort_order: 4, is_active: true, is_component: false, parent_account_id: null,
  person_id: null,
}
```

Add to `beforeEach` (`:35`), alongside the other default mocks:

```tsx
  // One-person household by default: every pre-existing test in this file asserts the FLAT
  // group walk, and that is exactly what a single person must keep rendering.
  vi.mocked(householdApi.fetchHousehold).mockResolvedValue({
    people: [{ id: 1, name: 'Me', is_primary: true }],
    marriage_date: null,
  })
```

Then append these tests to the file:

```tsx
// --- owner grouping (2026-08-26 household spec §6) ---------------------------------------

function twoPersonHousehold() {
  vi.mocked(householdApi.fetchHousehold).mockResolvedValue({
    people: [
      { id: 1, name: 'Me', is_primary: true },
      { id: 2, name: 'Sam', is_primary: false },
    ],
    marriage_date: '2026-09-12',
  })
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, samBrokerage, jointSavings])
  vi.mocked(netWorthApi.fetchMonthBalances).mockImplementation(async (month: string) => ({
    month,
    exists: month === '2026-07-01',
    recorded_on: null,
    notes: null,
    balances:
      month === '2026-07-01'
        ? [
            { account_id: 1, balance: '100.00' },
            { account_id: 3, balance: '1000.00' },
            { account_id: 4, balance: '70.00' },
          ]
        : [],
  }))
}

it('walks owner -> group -> rows with a subtotal per owner, primary first and Joint last', async () => {
  twoPersonHousehold()
  renderWizard()
  await screen.findByLabelText('Checking')

  const ownerHeads = [...document.querySelectorAll('tr.entry-owner-row')] as HTMLElement[]
  expect(ownerHeads.map((r) => r.textContent)).toEqual(['Me', 'Sam', 'Joint'])

  const ownerTotals = [
    ...document.querySelectorAll('tr.entry-owner-subtotal-row'),
  ] as HTMLElement[]
  expect(ownerTotals.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual([
    'Me total', 'Sam total', 'Joint total',
  ])
  // Cells are [label, last month, this month, Δ]; the month seeds from the prior one, so
  // "this month" equals "last month" and every Δ is a clean $0.00.
  expect(ownerTotals.map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual([
    '$100.00', '$1,000.00', '$70.00',
  ])

  // The group subtotals survive UNDERNEATH the owner ones — one level finer, not replaced.
  const groupSubtotals = [...document.querySelectorAll('tr.entry-subtotal-row')] as HTMLElement[]
  expect(groupSubtotals.map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual([
    '$100.00', '$1,000.00', '$70.00',
  ])
})

it('makes the owner walk the DOM order a positional paste fills down', async () => {
  twoPersonHousehold()
  renderWizard()
  const checking = (await screen.findByLabelText('Checking')) as HTMLInputElement
  // Three values down the rendered column: Me's row, then Sam's, then Joint's.
  fireEvent.paste(checking, { clipboardData: { getData: () => '1\n2\n3' } })

  expect(checking.value).toBe('1')
  expect((screen.getByLabelText('Sam Brokerage') as HTMLInputElement).value).toBe('$2.00')
  expect((screen.getByLabelText('Joint Savings') as HTMLInputElement).value).toBe('$3.00')
})

it('keeps the flat group walk for a one-person household', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([account, savings])
  renderWizard()
  await screen.findByLabelText('Checking')
  // No owner layer at all — not an empty header, not a "Me" section of one.
  expect(document.querySelector('tr.entry-owner-row')).toBeNull()
  expect(document.querySelector('tr.entry-owner-subtotal-row')).toBeNull()
  expect(document.querySelectorAll('tr.entry-subtotal-row').length).toBe(1)
})
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: FAIL — `Cannot find module '../api/household'` is mocked but never imported by the page, so `fetchHousehold` is never called and `tr.entry-owner-row` never renders (the first two new tests fail on empty arrays).

- [ ] **Step 3: Implement.** In `src/pages/MonthlyUpdatePage.tsx`:

(a) Add imports after the `../api/netWorth` block (`:11`):

```tsx
import { fetchHousehold } from '../api/household'
```

and extend the types import (`:22`) to:

```tsx
import type { AccountOut, CategoryOut, HouseholdOut, SpendingMatrix } from '../types/api'
```

and extend the theme import (`:21`) to:

```tsx
import { GROUP_LABELS, GROUP_ORDER } from '../charts/theme'
```

(unchanged — listed so the splice is unambiguous).

(b) Add state beside `categories` (`:108`):

```tsx
  // Who lives in this household — the balance grid's outer grouping. Server-derived like
  // `matrix`, and deliberately NOT part of the draft snapshot.
  const [people, setPeople] = useState<HouseholdOut['people']>([])
```

(c) Add the fetch to the existing `Promise.all` (`:172-183`) as the last entry, mirroring `fetchMatrix`'s degraded-state posture:

```tsx
      fetchMatrix().catch((): SpendingMatrix | null => null),
      // The owner grouping is an entry AID like the Typical column: if the household
      // endpoint is down, the grid falls back to today's flat group walk rather than
      // refusing to render the month.
      fetchHousehold().catch((): HouseholdOut | null => null),
```

and extend the destructure (`:184-192`) with a trailing `householdData,`:

```tsx
      .then(([
        accountList,
        categoryList,
        thisMonth,
        priorMonth,
        spendMonth,
        timeseries,
        matrixData,
        householdData,
      ]) => {
```

and set it beside `setMatrix(matrixData)` (`:202`):

```tsx
        setMatrix(matrixData)
        setPeople(householdData?.people ?? [])
```

(d) Replace `groupTotals` (`:546-560`) with a row-set helper:

```tsx
  // Live subtotal + its prior twin for ANY row set (components excluded, exactly like net
  // worth) — one helper now serves the per-group rows and the per-owner section above them.
  // DELIBERATE scope divergence, not an oversight: prevNetWorth (and so the footer's "vs
  // prior month") reduces over the RAW accountList — inactive accounts included — because
  // that is the true net-worth delta; these subtotals and the Last-month column cover the
  // ACTIVE rows on screen only, because they are an entry aid. "Fixing" the footer to
  // match active-only would falsify the delta the month is actually judged by.
  const subtotalOf = (rows: AccountOut[]) => {
    const counted = rows.filter((a) => !a.is_component)
    const now = counted.reduce((acc, a) => acc + committed(balances[a.id]), 0)
    const prior = counted.reduce(
      (acc, a) => acc + (priorBalances[a.id] === undefined ? 0 : Number(priorBalances[a.id])),
      0,
    )
    return { now, prior }
  }
```

(e) Replace `orderedBalanceRows` / `firstBalanceId` (`:458-463`) with the section walk:

```tsx
  // The balance grid's outer grouping. ONE person (or a household endpoint that failed)
  // means one unlabelled section holding every account — byte-identical to the pre-owner
  // rendering, which is what keeps this page's whole existing test suite honest.
  const ownerSections = useMemo<{ key: string; label: string | null; rows: AccountOut[] }[]>(
    () => {
      if (people.length < 2) return [{ key: 'all', label: null, rows: accounts }]
      const ordered = [...people].sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
      )
      // nestComponents is re-run PER SECTION on purpose: a component whose parent sits in
      // another owner's bucket keeps its own position, which is exactly that helper's
      // documented contract for an absent parent.
      const sections = ordered.map((person) => ({
        key: `p${person.id}`,
        label: person.name,
        rows: nestComponents(accounts.filter((a) => a.person_id === person.id)),
      }))
      sections.push({
        key: 'joint',
        label: 'Joint',
        rows: nestComponents(accounts.filter((a) => a.person_id === null)),
      })
      // An owner with nothing to enter gets no header and no subtotal row.
      return sections.filter((section) => section.rows.length > 0)
    },
    [accounts, people],
  )

  // The balances rows in RENDERED order — the same walk the table below performs. Hoisted
  // because three things must agree on it: the autofocus target, the Enter/arrow protocol's
  // DOM order, and where a positional paste puts its first value. Deriving it twice is how
  // those three drift apart.
  const orderedBalanceRows = ownerSections.flatMap((section) =>
    GROUP_ORDER.flatMap((g) => section.rows.filter((a) => a.group === g)),
  )
  const firstBalanceId = orderedBalanceRows[0]?.id
```

(f) Replace the table body's `GROUP_ORDER.map(...)` block (`:668-745`) with:

```tsx
              {ownerSections.map((section) => {
                const ownerTotals = subtotalOf(section.rows)
                // Same cents rule as every other subtotal here.
                const ownerCents = Math.round((ownerTotals.now - ownerTotals.prior) * 100)
                return (
                  <Fragment key={section.key}>
                    {section.label !== null && (
                      <tr className="entry-owner-row">
                        <th colSpan={4}>{section.label}</th>
                      </tr>
                    )}
                    {GROUP_ORDER.map((group) => {
                      const groupAccounts = section.rows.filter((a) => a.group === group)
                      if (groupAccounts.length === 0) return null
                      const totals = subtotalOf(groupAccounts)
                      // Same cents rule as the footer's delta above (and the spending Δ
                      // below): two sums of doubles that ought to cancel can miss by a few
                      // ulp, and this row is exactly where a conserving transfer shows up.
                      // Text only — the subtotal Δ carries no tone class, so rounding here
                      // fixes the "-$0.00".
                      const subCents = Math.round((totals.now - totals.prior) * 100)
                      return (
                        <Fragment key={group}>
                          <tr className="entry-group-row">
                            <th colSpan={4}>{GROUP_LABELS[group]}</th>
                          </tr>
                          {groupAccounts.map((account) => {
                            const value = balances[account.id] ?? ''
                            const prior = priorBalances[account.id]
                            const delta =
                              prior === undefined ? null : committed(value) - Number(prior)
                            return (
                              <tr key={account.id}>
                                <td
                                  className={account.is_component ? 'entry-component' : undefined}
                                >
                                  <label htmlFor={`bal-${account.id}`}>
                                    {account.name}
                                    {account.is_component && (
                                      <span className="badge">component</span>
                                    )}
                                  </label>
                                </td>
                                <td className="num entry-ref">
                                  {prior === undefined ? '—' : formatCurrency(prior)}
                                </td>
                                <td className="num entry-cell-col">
                                  <AmountInput
                                    id={`bal-${account.id}`}
                                    className={
                                      `${isAmount(value) ? '' : 'invalid'}${
                                        flashIds.has(`bal-${account.id}`) ? ' pasted-flash' : ''
                                      }`.trim() || undefined
                                    }
                                    autoFocus={account.id === firstBalanceId}
                                    value={value}
                                    onValueChange={(next) =>
                                      setBalances((cur) => ({ ...cur, [account.id]: next }))
                                    }
                                  />
                                </td>
                                <td
                                  className={`num entry-delta${
                                    delta === null || delta === 0
                                      ? ''
                                      : delta > 0
                                        ? ' delta-positive'
                                        : ' delta-negative'
                                  }`}
                                >
                                  {/* Typo tripwire: a fat-fingered digit shows a huge Δ instantly. */}
                                  {delta === null ? '—' : formatCurrency(delta)}
                                </td>
                              </tr>
                            )
                          })}
                          <tr className="entry-subtotal-row">
                            <td>Subtotal</td>
                            {/* No prior month at all (the first-ever entry) means there is
                                no prior subtotal — '—', never a fabricated $0.00 that would
                                read as "you had nothing" and make every Δ look like pure
                                growth. Per-row cells already say '—' via the missing
                                priorBalances. */}
                            <td className="num entry-ref">
                              {prevNetWorth === null ? '—' : formatCurrency(totals.prior)}
                            </td>
                            <td className="num">{formatCurrency(totals.now)}</td>
                            <td className="num entry-delta">
                              {prevNetWorth === null
                                ? '—'
                                : formatCurrency(subCents === 0 ? 0 : subCents / 100)}
                            </td>
                          </tr>
                        </Fragment>
                      )
                    })}
                    {/* The owner total sits a LEVEL ABOVE the group subtotals — coarser,
                        not a replacement — and closes its section the way every subtotal in
                        this table follows the rows it sums. */}
                    {section.label !== null && (
                      <tr className="entry-owner-subtotal-row">
                        <td>{section.label} total</td>
                        <td className="num entry-ref">
                          {prevNetWorth === null ? '—' : formatCurrency(ownerTotals.prior)}
                        </td>
                        <td className="num">{formatCurrency(ownerTotals.now)}</td>
                        <td className="num entry-delta">
                          {prevNetWorth === null
                            ? '—'
                            : formatCurrency(ownerCents === 0 ? 0 : ownerCents / 100)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
```

(g) Add to `src/pages/MonthlyUpdatePage.css`, immediately after the `.entry-subtotal-row td` rule (`:85-89`):

```css
/* The owner layer: a heavier version of .entry-group-row (it is the coarser heading), and
   a subtotal that reads as a total rather than as another muted group line. */
.entry-owner-row th {
  text-align: left;
  padding-top: 1.4rem;
  font-size: 0.85rem;
  letter-spacing: 0.02em;
  color: var(--text);
  font-weight: 600;
}
.entry-owner-subtotal-row td {
  border-top: 1px solid var(--border);
  color: var(--text);
  font-size: 0.85rem;
  font-weight: 600;
}
```

- [ ] **Step 4: Run to pass.**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: all pass — the three new tests plus every pre-existing one (the single-person default keeps their rendering identical).

Run: `npx tsc -b && npx eslint src/pages/MonthlyUpdatePage.tsx`
Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.css src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat(net-worth): wizard balance grid grouped owner -> group, with per-owner subtotals"
```

---

### Task 8: Relabel the net-pay field "Household take-home"

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx` (`:403`, `:791-805`)
- Test: `src/pages/MonthlyUpdatePage.test.tsx` (11 call sites)

- [ ] **Step 1: Write the failing test.** Append to `src/pages/MonthlyUpdatePage.test.tsx`:

```tsx
it('names the pay box as a HOUSEHOLD figure — one stream, two earners', async () => {
  renderWizard()
  fireEvent.click(await screen.findByRole('button', { name: /next: spending/i }))
  // The field, the step heading and the ⓘ hint all say the same word; a box still called
  // "Net pay" on a married household reads as one person's paycheck.
  expect(await screen.findByLabelText('Household take-home')).toBeTruthy()
  expect(screen.queryByLabelText('Net pay (take-home)')).toBeNull()
  expect(screen.getByRole('heading', { name: /spending & take-home/i })).toBeTruthy()
})
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx -t "HOUSEHOLD figure"`
Expected: FAIL — `Unable to find a label with the text of: Household take-home`.

- [ ] **Step 3: Implement.** In `src/pages/MonthlyUpdatePage.tsx`, replace the spending step's heading/hint/label (`:791-805`) with:

```tsx
          <h2 className="eyebrow">
            Spending & take-home
            <InfoHint text="The month&apos;s spend per category plus the household&apos;s take-home pay — a blank take-home skips the cashflow row." />
          </h2>
          <div className="meta-row">
            <label>
              Household take-home
              <AmountInput
                className={netPay.trim() === '' || isAmount(netPay) ? undefined : 'invalid'}
                autoFocus
                value={netPay}
                onValueChange={setNetPay}
                placeholder="leave blank to skip"
              />
            </label>
          </div>
```

and the save confirmation (`:403`):

```tsx
          (spendResult.net_pay_cleared ? ' Household take-home cleared.' : ''),
```

(The wire field stays `net_pay` — this is a label change, not a payload change. Draft keys, endpoints and the tri-state rider are untouched.)

- [ ] **Step 4: Repair the existing assertions.** In `src/pages/MonthlyUpdatePage.test.tsx`, replace every `'Net pay (take-home)'` string with `'Household take-home'` (10 sites: `:116`, `:120`, `:278`, `:448`, `:465`, `:488`, `:524`, `:535`, `:690`, and the comment at `:118` which should now read "the step's ⓘ hint carries 'take-home' in its aria-label"), and change the confirmation assertion at `:477`:

```tsx
  await screen.findByText(/household take-home cleared/i)
```

Run: `grep -n "Net pay (take-home)" src/pages/MonthlyUpdatePage.test.tsx src/pages/MonthlyUpdatePage.tsx`
Expected: no output.

- [ ] **Step 5: Run to pass.**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: all pass.

- [ ] **Step 6: Commit.**

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat(net-worth): relabel the wizard's pay box 'Household take-home'"
```

---

## Phase 5 — Verification

### Task 9: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Backend, whole suite.**

Run: `cd backend && .venv/Scripts/python -m pytest -q`
Expected: green. Re-run once if the known `uq_users_email` teardown flake fires; investigate only if it repeats on the same test.

- [ ] **Step 2: Backend lint.**

Run: `cd backend && .venv/Scripts/python -m ruff check app tests`
Expected: clean.

- [ ] **Step 3: Frontend, whole suite + typecheck + lint.**

```bash
npx vitest run
npx tsc -b
npx eslint .
```
Expected: all green, no output from `tsc -b`.

- [ ] **Step 4: Confirm the household path is byte-identical.** The one regression that would matter most is a changed *unfiltered* answer. Run:

```bash
cd backend && .venv/Scripts/python -m pytest tests/test_net_worth_api.py -q -k "timeseries_shapes or summary_latest or quarterly"
```
Expected: pass, untouched — those three tests were written before ownership existed and assert the household numbers to the cent.

- [ ] **Step 5: Commit anything the lint/format steps rewrote** (if the tree is dirty):

```bash
git add -A
git commit -m "feat(net-worth): ownership views — lint and format pass"
```

- [ ] **Step 6: Report.** Summarise: tasks completed, test counts before/after, and anything deferred. Do **not** push and do **not** merge — the orchestrator owns integration.

---

## Manual smoke (after merge, per the 2026-08-25 sankey-incident lesson)

Real echarts + real data, in a browser, before this is called done:

1. `/net-worth` with a single-person household — **no owner chips, no stack toggle**, page identical to before.
2. Add a partner in Settings → Household, tag one account to them and one to Joint, then reload `/net-worth`: chips appear; each chip changes the hero tile, the stack, the drill chips and the accounts table together; **All** restores the original numbers exactly.
3. Toggle **By owner** — the stacked areas must meet the black net-worth line at every month (that is the `stackStrategy: 'all'` + exclusive-`owner_series` invariant showing up visually). Toggle back.
4. Set a marriage date and confirm the dashed "Married" rule lands on the right month in both stack modes and at both granularities.
5. `/update` — the balance grid shows owner headers, group subheads, group subtotals and owner totals; Enter/arrow walks straight down the column across section boundaries; a column paste fills in the visible order; the pay box reads "Household take-home".
