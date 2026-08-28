# Portfolio Accounts: Ownership Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RECONCILIATION (orchestrator, 2026-08-28):** This plan's two disclosed deviations from
> spec §3 are BLESSED as the spec: (1) `dividend_payments.portfolio_account_id` stays
> NULLABLE — the label always was, `account: null` is pinned on the wire, and account-less
> dividends are household-only (excluded from every owner-scoped view); (2) the fold key
> stays `(security_id, label)` while ingest keys on the FK — labels are unique/immutable
> this batch. Your migration id `c9f4a7e2b168` on `b5f2c8d31e7a` is the chain the
> cards/calendar plan builds on — do not renumber. This plan merges FIRST (wave 1, alongside
> the projection plan, which shares no files with you).

**Goal:** Give portfolio positions real, owned accounts. The free-text `account` label on
`position_transactions` / `dividend_payments` becomes a `portfolio_accounts` row with a
`person_id` (NULL = joint), both tables point at it by FK, and the five read endpoints
(`/holdings`, `/allocation`, `/dividends`, `/realized`, `/transactions`) gain the net-worth
`owner` grammar with scope-consistent totals. The wire does not move: every response that
carried `account: <label>` still carries the same string, every request that accepted a
free-text `account` still does. Plan 1 of the 2026-08-28 household-portfolio batch
(spec §9 item 1); the UI (Plan 2) consumes what this builds.

**Architecture:**
- **One table, one door.** `portfolio_accounts (id, label UNIQUE NOT NULL, person_id NULL
  FK→people)`. Every writer — router, importer, any future one — mints labels through
  `services/portfolio_accounts.resolve_portfolio_account(db, label)` (get-or-create,
  `strip()` as today, new labels default to the primary person, **never** rewrites an
  existing row's owner). That is what makes "re-import over a re-tagged label keeps the
  partner's ownership" true by construction.
- **Wire compatibility by relationship, not by column.** Both models keep a
  `portfolio_account` relationship (`lazy="selectin"`, so every SELECT carries the label
  without per-caller loader options) plus a read-only `account` property that returns
  `portfolio_account.label`. Pydantic's `from_attributes` reads the property, so
  `TransactionOut` / `DividendOut` / `HoldingOut.accounts` / `AllocationSlice.key` are
  byte-identical. **Rows must be constructed with `portfolio_account=<row>`, never with a
  bare FK id** — an unloaded many-to-one raises `MissingGreenlet` the moment a response
  serializes `account`.
- **One filtering seam.** `load_portfolio(..., owner_filter=...)` scopes the transaction
  and dividend loads by portfolio-account membership; every derived number (holdings rows,
  totals, XIRR inputs, allocation weights, realized totals) is computed from the rows it
  was handed, so scope-consistency is structural rather than per-endpoint arithmetic.
  `/transactions` and `/dividends` apply the same clause to their own list queries.
- **One ownership grammar.** `services/ownership.parse_owner` becomes the single parser
  (`owner=<person_id>|joint`, absent = household, int4-fenced, `ValueError` → 422);
  `net_worth_calc.owner_clause` and the new `portfolio_accounts.portfolio_owner_clause`
  both build on it, so the two verticals cannot drift.
- **Fold key stays the label.** `PositionKey` remains `(security_id, label)` — `label` is
  UNIQUE NOT NULL and immutable this batch, so folding by label *is* folding by account
  identity, and the label is what allocation-by-account and `Holding.accounts` render.
  `Position` gains `portfolio_account_id` for the dividend ingest's FK-keyed writes.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async ORM + PostgreSQL 16 + Alembic; pytest
(`asyncio_mode=auto`, `Base.metadata.create_all` test schema); ruff 0.16.2. Backend only —
no frontend files change in this plan.

## Conventions for every task

- Run everything **from `backend/`**. Gating commands are run **bare — no pipes, no
  `| tail`, no redirects** (a pipe hides the exit code).
- Test command (verified against `tests/conftest.py`, which reads `FINANCE_TEST_DB` and
  requires a `*_test[_suffix]` name):
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest <args>`
  (Bash tool / Git Bash syntax. In PowerShell set `$env:FINANCE_TEST_DB='finance_test_p4pf'`
  once, then `.venv/Scripts/python.exe -m pytest <args>`.)
- Lint gates: `.venv/Scripts/python.exe -m ruff check app tests` and
  `.venv/Scripts/python.exe -m ruff format --check app tests` (both clean at baseline).
- **Never run `alembic upgrade` / `downgrade` against a live database.** The orchestrator
  applies the migration at merge. `alembic heads` (read-only) is the only alembic command
  in this plan.
- Commit after each task: `feat(portfolio): <what changed>`.
- Baseline: `main @23e1dc7`, 1131 pytest / 1213 vitest green, alembic head `b5f2c8d31e7a`.
- The `N passed` numbers below are indicative (baseline + the tests that task adds). What
  GATES is **zero failures and zero errors**, not the exact integer.

---

### Task 0: Baseline and single-head check

**Files:** none (read-only verification).

- [ ] From `backend/`, confirm the suite is green at baseline:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest -q`
  Expected: `1131 passed` (some seconds; no failures).
- [ ] Confirm a single alembic head:
  `.venv/Scripts/python.exe -m alembic heads`
  Expected: exactly one line, `b5f2c8d31e7a (head)`. **If it prints anything else, stop and
  report** — Task 3's `down_revision` is whatever this command prints, not what this plan
  guesses.
- [ ] Record the head string; Task 3 uses it verbatim.
- [ ] No commit.

---

### Task 1: `PortfolioAccount` model + `resolve_portfolio_account` (additive)

Purely additive: the new table exists, nothing references it yet, the suite stays green.

**Files:**
- `backend/app/models/portfolio.py` (new class after `Security`, ~:44)
- `backend/app/models/__init__.py` (import block ~:22-34, `__all__` ~:38-78)
- `backend/app/services/portfolio_accounts.py` (new)
- `backend/tests/test_portfolio_accounts.py` (new)

- [ ] Write the failing test file `backend/tests/test_portfolio_accounts.py`:

```python
"""portfolio_accounts: the label registry every position row points at."""

from sqlalchemy import select

from app.models import Person, PortfolioAccount
from app.services.portfolio_accounts import resolve_portfolio_account


async def test_resolve_creates_one_row_per_label_owned_by_the_primary(db):
    db.add_all([Person(name="Me", is_primary=True), Person(name="Sam", is_primary=False)])
    await db.commit()
    me = (await db.execute(select(Person).where(Person.is_primary))).scalar_one()

    first = await resolve_portfolio_account(db, "RH Taxable")
    again = await resolve_portfolio_account(db, "  RH Taxable  ")  # stripped, like the router
    other = await resolve_portfolio_account(db, "Fidelity Taxable")
    await db.commit()

    assert again.id == first.id  # get-or-create: one row per label, never two
    assert first.person_id == me.id  # a NEW label defaults to the primary person
    assert other.person_id == me.id
    labels = (
        (await db.execute(select(PortfolioAccount.label).order_by(PortfolioAccount.label)))
        .scalars()
        .all()
    )
    assert labels == ["Fidelity Taxable", "RH Taxable"]


async def test_resolve_never_rewrites_a_retagged_owner(db):
    """Settings re-tags a label to the partner; every later writer must leave it alone —
    this is what makes a sheet re-import safe (2026-08-28 spec §8)."""
    db.add_all([Person(name="Me", is_primary=True), Person(name="Sam", is_primary=False)])
    await db.commit()
    sam = (await db.execute(select(Person).where(Person.name == "Sam"))).scalar_one()

    account = await resolve_portfolio_account(db, "Sam Brokerage")
    account.person_id = sam.id
    await db.commit()

    again = await resolve_portfolio_account(db, "Sam Brokerage")
    await db.commit()
    assert again.id == account.id
    assert again.person_id == sam.id  # get-or-create GETS; it does not re-own


async def test_resolve_on_a_peopleless_database_leaves_the_owner_null(db):
    """A create_all database (pytest, a scratch dev box) has no roster — NULL is exactly
    the pre-ownership spelling, not an error."""
    account = await resolve_portfolio_account(db, "Solo")
    await db.commit()
    assert account.person_id is None
```

- [ ] Run it — expect failure:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest tests/test_portfolio_accounts.py -q`
  Expected: collection error, `ImportError: cannot import name 'PortfolioAccount' from 'app.models'`.
- [ ] Add the model to `backend/app/models/portfolio.py`, immediately after the `Security`
      class (before `PositionTransaction`):

```python
class PortfolioAccount(Base):
    """A brokerage/platform label with an owner — the identity behind every position row.

    `label` is the EXACT string the sheet and the ledger UI already use ("RH Taxable",
    "Fidelity Taxable"). It is the positions' natural key, so it is UNIQUE and immutable
    this batch (the accounts-slug posture): renaming is a data migration, not a PATCH.
    `person_id` NULL means JOINT/household, never "unknown" — migration c9f4a7e2b168
    backfilled every pre-existing label to the primary person, so an unset owner is a
    deliberate statement (the accounts.person_id grammar, 2026-08-26 spec §4).
    """

    __tablename__ = "portfolio_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(80), unique=True)
    person_id: Mapped[int | None] = mapped_column(
        ForeignKey("people.id", ondelete="SET NULL"), default=None
    )

    def __repr__(self) -> str:
        # The importer's diff samples print this ("portfolio_account Old -> New"), so it
        # reads as the label rather than as an object address.
        return self.label if self.label is not None else "<portfolio account>"
```

- [ ] Export it from `backend/app/models/__init__.py`: add `PortfolioAccount` to the
      `from app.models.portfolio import (...)` block (alphabetical: after
      `PortfolioValueHistory`... it sorts before it — place `PortfolioAccount` immediately
      before `PortfolioValueHistory`) and add `"PortfolioAccount",` to `__all__`
      immediately before `"PortfolioValueHistory",`.
- [ ] Create `backend/app/services/portfolio_accounts.py`:

```python
"""Portfolio-account resolution — the one door a free-text label walks through.

`account` stopped being a column on 2026-08-28 (spec §3 item 1): a transaction or dividend
points at a `portfolio_accounts` row, and the label the wire still carries is that row's.
Every writer — the ledger router, the importer, anything later — resolves through here, so
a label can never exist twice and a re-tagged owner can never be silently overwritten.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PortfolioAccount
from app.services.people import load_people, primary_person


async def resolve_portfolio_account(db: AsyncSession, label: str) -> PortfolioAccount:
    """Get-or-create the row for `label` (stripped, exactly as the router always stored it).

    A NEW label defaults to the PRIMARY person — the migration's backfill rule, continued
    for labels that appear later; a database with no roster (create_all tests, a scratch
    dev box) leaves person_id NULL, which is the pre-ownership spelling. An EXISTING row is
    returned untouched: a label the user re-tagged to their partner in Settings stays
    theirs through every re-import (spec §8).

    Flushes, so the row has an id for the caller and is findable by the next call inside
    the same run (the importer resolves many labels before one commit).
    """
    cleaned = label.strip()
    existing = (
        (await db.execute(select(PortfolioAccount).where(PortfolioAccount.label == cleaned)))
        .scalars()
        .first()
    )
    if existing is not None:
        return existing
    primary = primary_person(await load_people(db))
    account = PortfolioAccount(label=cleaned, person_id=None if primary is None else primary.id)
    db.add(account)
    await db.flush()
    return account
```

- [ ] Run to pass:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest tests/test_portfolio_accounts.py -q`
  Expected: `3 passed`.
- [ ] Run the full suite (still green — nothing else changed):
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest -q`
  Expected: `1134 passed`.
- [ ] `.venv/Scripts/python.exe -m ruff check app tests` and
      `.venv/Scripts/python.exe -m ruff format --check app tests` — both clean.
- [ ] Commit: `feat(portfolio): portfolio_accounts model + label get-or-create`

---

### Task 2: The flip — FK columns replace the free-text `account`

**Deliberately one task.** Dropping a column is atomic: the model, the fold, the router,
the importer, the ingest and every hand-built test row move together or the suite is red.
Every step below is mechanical; the behavior pins come first.

**Files:**
- `backend/app/models/portfolio.py` (`PositionTransaction` ~:46-64, `DividendPayment`
  `__table_args__` ~:69-82 and `account` ~:86)
- `backend/app/services/portfolio_calc.py` (`PositionKey` :30, `Position` :33-42,
  `fold_transactions` :45-51)
- `backend/app/api/portfolio.py` (`create_transaction` :257-283, `update_transaction`
  :293-331, `create_dividend` :361-379, `update_dividend` :389-410)
- `backend/app/importer/apply.py` (`apply_positions` :126-206, fields dict :172-181)
- `backend/app/services/dividend_ingest.py` (docstring :10-16, `shares_on` :51-59,
  `existing` :83-94, `desired` :118-155, upsert :165-178)
- `backend/tests/portfolio_factories.py` (new), `backend/tests/conftest.py` (~:90-93)
- `backend/tests/test_portfolio_api.py`, `test_portfolio_calc.py`, `test_models_portfolio.py`,
  `test_dividend_ingest.py`, `test_importer_apply.py`, `test_calendar_api.py`,
  `test_price_service.py`, `test_prices_api.py`, `test_taxes_api.py`

- [ ] Add the test-side factory, `backend/tests/portfolio_factories.py`:

```python
"""Test-only PortfolioAccount factory.

`account` is no longer a column: a transaction or dividend points at a portfolio_accounts
row. Tests that build ORM rows by hand need a label -> row map that is stable WITHIN one
test (the same label must reuse the same instance, or two rows would collide on the unique
label) and empty BETWEEN tests (conftest's autouse reset — the db fixture TRUNCATEs, so an
instance from a previous test is a stale, half-detached trap).

The row is not added to the session on its own: SQLAlchemy's save-update cascade inserts it
with the transaction/dividend that references it. Add it explicitly (`db.add(acct("Solo"))`)
when a test wants the account row and nothing else.

Do not mix this factory and the API for the SAME label inside one test: the router's
resolve_portfolio_account queries the database, finds no pending instance, and mints a
second row.
"""

from app.models import PortfolioAccount

_ACCOUNTS: dict[str, PortfolioAccount] = {}


def acct(label: str | None, *, person_id: int | None = None) -> PortfolioAccount | None:
    """The row for `label`, created on first use in this test. None passes through, so a
    dividend's optional account stays optional."""
    if label is None:
        return None
    row = _ACCOUNTS.get(label)
    if row is None:
        row = PortfolioAccount(label=label, person_id=person_id)
        _ACCOUNTS[label] = row
    elif person_id is not None:
        row.person_id = person_id
    return row


def reset_accounts() -> None:
    _ACCOUNTS.clear()
```

- [ ] Wire the reset into `backend/tests/conftest.py`. Add the import next to the other
      app imports at the top:

```python
from tests.portfolio_factories import reset_accounts
```

  and this fixture immediately after `reset_rate_limiter` (~:90-93):

```python
@pytest.fixture(autouse=True)
def _reset_portfolio_account_factory():
    # The db fixture TRUNCATEs between tests; the label -> row memo must not outlive it.
    reset_accounts()
```

- [ ] Write the failing behavior pins. Append to `backend/tests/test_portfolio_accounts.py`:

```python
TRANSACTIONS = "/api/v1/portfolio/transactions"
DIVIDENDS = "/api/v1/portfolio/dividends"
SECURITIES = "/api/v1/portfolio/securities"


async def _security(auth_client) -> dict:
    resp = await auth_client.post(
        SECURITIES, json={"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "holding_type": "etf"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_transaction_label_round_trips_and_becomes_an_owned_row(auth_client, db):
    """The wire is unchanged — `account` in, `account` out — but the label is now a row."""
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    me = (await db.execute(select(Person).where(Person.is_primary))).scalar_one()
    security = await _security(auth_client)

    created = await auth_client.post(
        TRANSACTIONS,
        json={
            "security_id": security["id"],
            "account": " Fidelity Taxable ",
            "type": "buy",
            "shares": "5",
            "price": "100",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["account"] == "Fidelity Taxable"  # trimmed, exactly as before
    assert (await auth_client.get(TRANSACTIONS)).json()[0]["account"] == "Fidelity Taxable"

    rows = (await db.execute(select(PortfolioAccount))).scalars().all()
    assert [(r.label, r.person_id) for r in rows] == [("Fidelity Taxable", me.id)]


async def test_two_transactions_on_one_label_share_a_single_account_row(auth_client, db):
    security = await _security(auth_client)
    for shares in ("1", "2"):
        resp = await auth_client.post(
            TRANSACTIONS,
            json={
                "security_id": security["id"],
                "account": "RH Taxable",
                "type": "buy",
                "shares": shares,
                "price": "10",
            },
        )
        assert resp.status_code == 201, resp.text
    labels = (await db.execute(select(PortfolioAccount.label))).scalars().all()
    assert labels == ["RH Taxable"]  # get-or-create, not one row per transaction


async def test_patching_a_transaction_account_repoints_the_fk(auth_client, db):
    security = await _security(auth_client)
    created = (
        await auth_client.post(
            TRANSACTIONS,
            json={
                "security_id": security["id"],
                "account": "RH Taxable",
                "type": "buy",
                "shares": "1",
                "price": "10",
            },
        )
    ).json()
    moved = await auth_client.patch(
        f"{TRANSACTIONS}/{created['id']}", json={"account": " Moved "}
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["account"] == "Moved"
    labels = (
        (await db.execute(select(PortfolioAccount.label).order_by(PortfolioAccount.label)))
        .scalars()
        .all()
    )
    assert labels == ["Moved", "RH Taxable"]  # the old label survives; the row moved


async def test_dividend_account_stays_optional(auth_client, db):
    security = await _security(auth_client)
    without = await auth_client.post(
        DIVIDENDS, json={"security_id": security["id"], "pay_date": "2026-06-30", "amount": "5"}
    )
    assert without.status_code == 201, without.text
    assert without.json()["account"] is None  # unattributed, exactly as before
    blank = await auth_client.post(
        DIVIDENDS,
        json={
            "security_id": security["id"],
            "account": "   ",
            "pay_date": "2026-06-30",
            "amount": "5",
        },
    )
    assert blank.status_code == 201, blank.text
    assert blank.json()["account"] is None  # whitespace collapses to None, never a '' row
    assert (await db.execute(select(PortfolioAccount))).scalars().all() == []
```

- [ ] Run — expect failure:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest tests/test_portfolio_accounts.py -q`
  Expected: the new tests fail with `AssertionError` on `rows == []` / `labels == []` (the
  router still writes the free-text column; no portfolio_accounts rows are created).
- [ ] `backend/app/models/portfolio.py` — imports: add `relationship` to the
      `sqlalchemy.orm` import line:

```python
from sqlalchemy.orm import Mapped, mapped_column, relationship
```

- [ ] `backend/app/models/portfolio.py` — `PositionTransaction`: delete line 51
      (`account: Mapped[str] = mapped_column(String(80))`) and put this in its place:

```python
    portfolio_account_id: Mapped[int] = mapped_column(
        ForeignKey(
            "portfolio_accounts.id",
            ondelete="RESTRICT",
            # Named explicitly: the naming convention derives a 64-character name, one past
            # Postgres' 63-byte identifier limit, and SQLAlchemy would silently truncate it
            # to a hash suffix — in create_all AND in the migration. A readable name that
            # both paths agree on beats two identical hashes.
            name="fk_position_transactions_portfolio_account",
        )
    )
    # selectin: every SELECT of a transaction carries its label without a per-caller loader
    # option. An UNLOADED many-to-one raises MissingGreenlet the moment a response
    # serializes `account`, so rows are always constructed with portfolio_account=<row>,
    # never with a bare FK id (routers, importer and the tests' factory all do this).
    portfolio_account: Mapped["PortfolioAccount"] = relationship(lazy="selectin")

    @property
    def account(self) -> str:
        """The wire's `account` label, unchanged since before ownership existed
        (2026-08-28 spec §3 item 1: every response that carried `account: str` still
        does). Read-only — writes go through services.portfolio_accounts."""
        return self.portfolio_account.label
```

- [ ] `backend/app/models/portfolio.py` — `DividendPayment.__table_args__`: change the
      index's second column from `"account"` to `"portfolio_account_id"` and update the
      comment's first line:

```python
    __table_args__ = (
        # The auto-ingest idempotency key: one row per (security, portfolio account, event
        # date) for refresh-written rows. Partial — manual rows stay unconstrained, and the
        # index must live HERE (not only in the migration) because the test database is
        # built by Base.metadata.create_all.
        Index(
            "ux_dividend_auto_event",
            "security_id",
            "portfolio_account_id",
            "ex_date",
            unique=True,
            postgresql_where=text("source = 'auto'"),
        ),
    )
```

- [ ] `backend/app/models/portfolio.py` — `DividendPayment`: delete line 86
      (`account: Mapped[str | None] = mapped_column(String(80))`) and put this in its place:

```python
    # NULLABLE, like the label it replaces: a dividend with no account is unattributed and
    # still crosses the wire as `account: null`. It is therefore HOUSEHOLD-only — an
    # unattributed payment cannot honestly join a person's view (load_portfolio's rule).
    portfolio_account_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "portfolio_accounts.id",
            ondelete="RESTRICT",
            name="fk_dividend_payments_portfolio_account",
        ),
        default=None,
    )
    portfolio_account: Mapped["PortfolioAccount | None"] = relationship(lazy="selectin")

    @property
    def account(self) -> str | None:
        """The wire's optional `account` label (see PositionTransaction.account)."""
        return None if self.portfolio_account is None else self.portfolio_account.label
```

- [ ] `backend/app/services/portfolio_calc.py` — `PositionKey` (:30) comment and the
      `Position` dataclass (:33-42):

```python
PositionKey = tuple[int, str]  # (security_id, portfolio account LABEL)
# The label, not the FK id: portfolio_accounts.label is UNIQUE NOT NULL and immutable
# (2026-08-28 spec §4.1), so folding by label IS folding by account identity — and the
# label is what allocation-by-account and Holding.accounts render. If labels ever become
# editable, this key must move to portfolio_account_id first.


@dataclass
class Position:
    security_id: int
    account: str
    # Carried for the dividend ingest, which keys its rows by the FK (identical semantics
    # to the old account-keyed writes). None on hand-built, never-flushed rows.
    portfolio_account_id: int | None = None
    shares: Decimal = ZERO
    cost_basis: Decimal = ZERO
    realized_gl: Decimal = ZERO
    has_dateless_txn: bool = False
    dated_flows: list[tuple[date, Decimal]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
```

- [ ] `backend/app/services/portfolio_calc.py` — `fold_transactions` (:50-51), keep the
      key, stamp the FK:

```python
        key = (txn.security_id, txn.account)
        pos = positions.setdefault(
            key,
            Position(
                security_id=txn.security_id,
                account=txn.account,
                portfolio_account_id=txn.portfolio_account_id,
            ),
        )
```

- [ ] `backend/app/api/portfolio.py` — imports: add the resolver next to the other service
      imports (the `PortfolioAccount` model import arrives in Task 5, which needs it for the
      owner joins):

```python
from app.services.portfolio_accounts import resolve_portfolio_account
```

- [ ] `backend/app/api/portfolio.py` — `create_transaction` (:257-283), replace the body
      from the `max_index` query down:

```python
    max_index = (
        await db.execute(select(func.coalesce(func.max(PositionTransaction.sort_index), 0)))
    ).scalar_one()
    # Resolve only after every 422 above: get-or-create flushes, and a label minted for a
    # request that then fails validation would be a row nobody asked for.
    account = await resolve_portfolio_account(db, _validated_account(body.account))
    # UI rows fold chronologically LAST (locked decision). A later sheet import may mint
    # the same sort_index for a new row — folding tie-breaks on id; accepted.
    txn = PositionTransaction(
        security_id=body.security_id,
        # The ROW, not the id: the response serializes `account` off this relationship.
        portfolio_account=account,
        type=body.type,
        txn_date=body.txn_date,
        sort_index=max_index + 10,
        source="ui",
        notes=body.notes,
        **fields,
    )
    db.add(txn)
    await db.commit()
    return txn
```

- [ ] `backend/app/api/portfolio.py` — `update_transaction` (:309-327), replace the
      account handling:

```python
    if "account" in provided:
        if provided["account"] is None:
            raise HTTPException(status_code=422, detail="account cannot be null")
        provided["account"] = _validated_account(provided["account"])
    if "txn_date" in provided and provided["txn_date"] is not None:
        require_reasonable_date(provided["txn_date"], "txn_date")
    # Resolve after the last raise and before the first mutation: get-or-create flushes,
    # and a flush of a half-mutated row is exactly what the rule below forbids.
    new_account = (
        await resolve_portfolio_account(db, provided["account"]) if "account" in provided else None
    )
    # Every raise is behind us — mutate only now, or a 422 halfway through a multi-field
    # PATCH would leave part of the row dirty for the next autoflush.
    if new_account is not None:
        txn.portfolio_account = new_account
    if "txn_date" in provided:
        txn.txn_date = provided["txn_date"]
```

- [ ] `backend/app/api/portfolio.py` — `create_dividend` (:361-379):

```python
@router.post("/dividends", response_model=DividendOut, status_code=201)
async def create_dividend(
    body: DividendCreate, db: AsyncSession = Depends(get_db)
) -> DividendPayment:
    if await db.get(Security, body.security_id) is None:
        raise HTTPException(status_code=422, detail=f"unknown security_id: {body.security_id}")
    require_reasonable_date(body.pay_date, "pay_date")
    amount = _validated_dividend_amount(body.amount)
    # Blank/whitespace collapse to None — never persist '' as a second spelling of "no
    # account" (Task 9 review I1), and never mint a portfolio_accounts row for it.
    label = (body.account or "").strip() or None
    account = None if label is None else await resolve_portfolio_account(db, label)
    dividend = DividendPayment(
        security_id=body.security_id,
        portfolio_account=account,
        pay_date=body.pay_date,
        amount=amount,
        notes=body.notes,
    )
    db.add(dividend)
    await db.commit()
    return dividend
```

- [ ] `backend/app/api/portfolio.py` — `update_dividend` (:394-409), replace from
      `provided = ...` to the setattr loop:

```python
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
        new_account = None if label is None else await resolve_portfolio_account(db, label)
    for field_name, value in validated.items():
        setattr(dividend, field_name, value)
    if account_change:
        dividend.portfolio_account = new_account
    await db.commit()
    return dividend
```

- [ ] `backend/app/importer/apply.py` — add the resolver import next to
      `from app.services.people import load_people, primary_person`:

```python
from app.services.portfolio_accounts import resolve_portfolio_account
```

- [ ] `backend/app/importer/apply.py` — `apply_positions` (:161-181): resolve the DISTINCT
      labels once, then point the fields dict at the row. Replace from `existing = {` down
      to the end of the `fields` dict:

```python
    existing = {
        t.sort_index: t
        for t in (
            await db.execute(
                select(PositionTransaction).where(PositionTransaction.source == "import")
            )
        ).scalars()
    }
    # One get-or-create per DISTINCT sheet label, not per row: a re-import of ~200 position
    # rows touches a handful of platforms. New labels land owned by the primary person;
    # a label the user re-tagged in Settings keeps its owner (resolve_portfolio_account).
    accounts = {
        label: await resolve_portfolio_account(db, label)
        for label in sorted({txn.account for txn in parsed.transactions})
    }
    incoming_indexes: set[int] = set()
    for txn in parsed.transactions:
        incoming_indexes.add(txn.sort_index)
        fields = {
            "security_id": lookup[txn.name].id,
            # The relationship, not the id: _diff_update's sample prints the row's
            # __repr__ (the label), and assigning it keeps the loaded attribute in step
            # with the FK it writes.
            "portfolio_account": accounts[txn.account],
            "type": txn.type,
            "txn_date": txn.txn_date,
            "shares": txn.shares,
            "price": txn.price,
            "fees": txn.fees,
            "split_factor": txn.split_factor,
        }
```

- [ ] `backend/app/services/dividend_ingest.py` — module docstring (:10-11): change
      `one row per (security, account)` to `one row per (security, portfolio account)`.
- [ ] `backend/app/services/dividend_ingest.py` — `shares_on` (:51-59):

```python
def shares_on(txns: list[PositionTransaction], as_of: date) -> dict[tuple[int, int], Decimal]:
    """Folded shares per (security_id, portfolio_account_id) counting only transactions
    effective by `as_of` — dateless rows always, dated rows when txn_date <= as_of. Fold
    warnings are ignored here: only the share counts matter. The FK, not the label, is the
    key: it is what the auto rows and their unique index are written on."""
    effective = [t for t in txns if t.txn_date is None or t.txn_date <= as_of]
    return {
        (pos.security_id, pos.portfolio_account_id): pos.shares.quantize(
            SHARE_Q, rounding=ROUND_HALF_UP
        )
        for pos in fold_transactions(effective).values()
    }
```

- [ ] `backend/app/services/dividend_ingest.py` — `existing` (:83-84):

```python
    existing = {
        (row.security_id, row.portfolio_account_id, row.ex_date): row
```

- [ ] `backend/app/services/dividend_ingest.py` — `desired` declaration (:118) and the
      inner loop (:138-155):

```python
    desired: dict[tuple[int, int, date], dict] = {}
```

```python
            for (pos_sec_id, account_id), shares in holdings_by_date[event_date].items():
                if pos_sec_id != sec_id or shares <= 0:
                    continue
                amount = (shares * bar.dividend).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
                if amount == 0:
                    continue  # fractional dust rounds to no money
                desired[(sec_id, account_id, event_date)] = {
                    "security_id": sec_id,
                    "portfolio_account_id": account_id,
                    # Honest approximation: Yahoo's chart feed carries no payment date.
                    "pay_date": event_date,
                    "amount": amount,
                    "source": "auto",
                    "ex_date": event_date,
                    "per_share": bar.dividend,
                    "shares_held": shares,
                    "notes": None,
                }
```

- [ ] `backend/app/services/dividend_ingest.py` — the upsert's conflict target (:169):

```python
                index_elements=["security_id", "portfolio_account_id", "ex_date"],
```

- [ ] Port the hand-built test rows. In EVERY file below add
      `from tests.portfolio_factories import acct` to the imports and replace
      `account=<label>` with `portfolio_account=acct(<label>)` at these anchors:
  - `tests/test_portfolio_calc.py` — helper `txn()` :25 (`account=account,` →
    `portfolio_account=acct(account),`), and the `DividendPayment(...)` at :305
    (`account="Acct",` → `portfolio_account=acct("Acct"),`). Every call site and every
    `positions[(1, "Acct")]` assertion stays as-is (the fold key is still the label).
  - `tests/test_models_portfolio.py` — :28, :39, :74, :138, :157.
  - `tests/test_portfolio_api.py` — :291, :381, :566, :595, :620, :628, :636. The JSON
    payloads at :363, :441, :449, :546, :667, :684, :692, :697, :761, :787, :819, :823,
    :829, :1063 are the WIRE and must not change.
  - `tests/test_dividend_ingest.py` — helper `txn()` :41, `manual()` :53, `auto()` :60.
  - `tests/test_calendar_api.py` — :133, :143, :153.
  - `tests/test_price_service.py` — helper `buy()` :63 and the `DividendPayment` at :323.
    Call sites (`buy(priv.id, account="Other")`) keep passing labels.
  - `tests/test_prices_api.py` — :127, :245, :292, :336, :415 (`:440` is a JSON payload).
  - `tests/test_taxes_api.py` — :687.
  - `tests/test_importer_apply.py` — :167, :178, :206, :248, and the auto dividend at :1132.
    Reads of `row.account` / `ui_row.account` (:268, :1143, :1158) keep working through the
    property and must NOT change.
- [ ] `tests/test_dividend_ingest.py` — the `dividend_rows` helper (:70-80) orders by the
      account column; order by the joined label so the tests' alphabetical expectations
      hold. Add `PortfolioAccount` to the `app.models` import and replace the helper:

```python
async def dividend_rows(db, *, source: str | None = None) -> list[DividendPayment]:
    """All dividend rows, (security, ex_date, account LABEL) ordered — the label, not the
    FK id, so the order stays alphabetical rather than insertion-ordered. populate_existing
    because the ingest upserts through Core — a row already in the identity map would
    otherwise read back its pre-write values."""
    stmt = select(DividendPayment)
    if source is not None:
        stmt = stmt.where(DividendPayment.source == source)
    stmt = (
        stmt.outerjoin(
            PortfolioAccount, PortfolioAccount.id == DividendPayment.portfolio_account_id
        )
        .execution_options(populate_existing=True)
        .order_by(DividendPayment.security_id, DividendPayment.ex_date, PortfolioAccount.label)
    )
    return list((await db.execute(stmt)).scalars())
```

- [ ] `tests/test_importer_apply.py` :192 — the column select no longer exists. Add
      `PortfolioAccount` to the `app.models` import and replace:

```python
    remaining = (
        (
            await db.execute(
                select(PortfolioAccount.label).join(
                    PositionTransaction,
                    PositionTransaction.portfolio_account_id == PortfolioAccount.id,
                )
            )
        )
        .scalars()
        .all()
    )
```

- [ ] Run the new pins:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest tests/test_portfolio_accounts.py -q`
  Expected: `7 passed`.
- [ ] Run the full suite:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest -q`
  Expected: `1138 passed`. If anything reports `MissingGreenlet`, a row was built with a
  bare `portfolio_account_id=` — construct it with `portfolio_account=` instead.
- [ ] `.venv/Scripts/python.exe -m ruff check app tests` and
      `.venv/Scripts/python.exe -m ruff format --check app tests` — both clean.
- [ ] Commit: `feat(portfolio): position/dividend rows point at portfolio_accounts by FK`

---

### Task 3: The migration

**Files:** `backend/alembic/versions/20260828_0900_c9f4a7e2b168_portfolio_accounts.py` (new)

- [ ] Re-check the head before writing the file: `.venv/Scripts/python.exe -m alembic heads`
      Expected: one line, `b5f2c8d31e7a (head)`. Use exactly that string as
      `down_revision` (if it differs, use what the command printed).
- [ ] Create the file with this complete content:

```python
"""portfolio accounts

Portfolio ownership (2026-08-28 household-portfolio spec §3 item 1): the free-text
`account` label on position_transactions / dividend_payments becomes a real
`portfolio_accounts` row with an owner, and both tables point at it by FK.

Backfill: one row per EXACT distinct label found in either column — case and whitespace
preserved, so two historically distinct spellings stay two accounts (a morning-list note,
never a silent merge) — each owned by the PRIMARY person. f3a91c7e2b45 seeds that member
earlier in this chain, so the roster is always there in practice; the guard below is for a
hand-edited database, and it fails LOUDLY rather than quietly minting joint accounts,
because "everything is joint" is not a state this app may drift into.

position_transactions.portfolio_account_id is NOT NULL (its label always was);
dividend_payments.portfolio_account_id is NULLABLE (its label always was) — a dividend with
no account stays unattributed and still crosses the wire as `account: null`. The
auto-ingest partial unique index moves to the FK column with identical semantics: one auto
row per (security, portfolio account, ex-date).

Downgrade restores both text columns from the join before dropping the FKs and the table.
Ownership is LOST on the way down — person_id has nowhere to live in the old shape.

Revision ID: c9f4a7e2b168
Revises: b5f2c8d31e7a
Create Date: 2026-08-28 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9f4a7e2b168"
down_revision: str | Sequence[str] | None = "b5f2c8d31e7a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Named explicitly rather than by convention: the derived name for position_transactions
# would be 64 characters, one past Postgres' 63-byte identifier limit, and SQLAlchemy would
# silently truncate it to a hash suffix. The models carry these same two names.
TXN_FK = "fk_position_transactions_portfolio_account"
DIV_FK = "fk_dividend_payments_portfolio_account"
AUTO_INDEX = "ux_dividend_auto_event"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "portfolio_accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("person_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["person_id"],
            ["people.id"],
            name=op.f("fk_portfolio_accounts_person_id_people"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_portfolio_accounts")),
        sa.UniqueConstraint("label", name=op.f("uq_portfolio_accounts_label")),
    )
    # One row per label across BOTH columns (UNION dedupes), all owned by the primary
    # person. The scalar subquery is safe: ux_people_single_primary caps it at one row.
    op.execute(
        "INSERT INTO portfolio_accounts (label, person_id) "
        "SELECT label, (SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1) "
        "FROM ("
        "  SELECT account AS label FROM position_transactions"
        "  UNION"
        "  SELECT account AS label FROM dividend_payments WHERE account IS NOT NULL"
        ") AS labels"
    )
    unowned = op.get_bind().scalar(
        sa.text("SELECT count(*) FROM portfolio_accounts WHERE person_id IS NULL")
    )
    if unowned:
        # The sentence that says what to do, instead of a database that quietly reads
        # "every portfolio account is joint" the moment owner views land.
        raise RuntimeError(
            f"{unowned} portfolio_accounts rows have no owner: seed the people table "
            "(app.seed.seed_people) before upgrading"
        )

    op.add_column(
        "position_transactions", sa.Column("portfolio_account_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        TXN_FK,
        "position_transactions",
        "portfolio_accounts",
        ["portfolio_account_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute(
        "UPDATE position_transactions t SET portfolio_account_id = pa.id "
        "FROM portfolio_accounts pa WHERE pa.label = t.account"
    )
    orphans = op.get_bind().scalar(
        sa.text("SELECT count(*) FROM position_transactions WHERE portfolio_account_id IS NULL")
    )
    if orphans:
        raise RuntimeError(
            f"{orphans} position_transactions rows did not match a portfolio account label — "
            "the backfill above should be exhaustive; inspect the table before retrying"
        )
    op.alter_column("position_transactions", "portfolio_account_id", nullable=False)

    op.add_column(
        "dividend_payments", sa.Column("portfolio_account_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        DIV_FK,
        "dividend_payments",
        "portfolio_accounts",
        ["portfolio_account_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute(
        "UPDATE dividend_payments d SET portfolio_account_id = pa.id "
        "FROM portfolio_accounts pa WHERE pa.label = d.account"
    )
    # Stays NULLABLE by design (see the docstring): only a row that HAD a label and did not
    # find its account is a bug.
    stragglers = op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM dividend_payments "
            "WHERE account IS NOT NULL AND portfolio_account_id IS NULL"
        )
    )
    if stragglers:
        raise RuntimeError(
            f"{stragglers} dividend_payments rows did not match a portfolio account label — "
            "the backfill above should be exhaustive; inspect the table before retrying"
        )

    # The auto-ingest idempotency key moves to the FK with identical semantics: one auto
    # row per (security, portfolio account, ex-date). Mirrored on the model, which is what
    # builds the pytest database (Base.metadata.create_all runs no migrations).
    op.drop_index(AUTO_INDEX, table_name="dividend_payments")
    op.create_index(
        AUTO_INDEX,
        "dividend_payments",
        ["security_id", "portfolio_account_id", "ex_date"],
        unique=True,
        postgresql_where=sa.text("source = 'auto'"),
    )

    op.drop_column("position_transactions", "account")
    op.drop_column("dividend_payments", "account")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "position_transactions", sa.Column("account", sa.VARCHAR(length=80), nullable=True)
    )
    op.add_column("dividend_payments", sa.Column("account", sa.VARCHAR(length=80), nullable=True))
    # Restore the labels from the join BEFORE the FKs go away — after the drop there is
    # nothing left to read them from.
    op.execute(
        "UPDATE position_transactions t SET account = pa.label "
        "FROM portfolio_accounts pa WHERE pa.id = t.portfolio_account_id"
    )
    op.execute(
        "UPDATE dividend_payments d SET account = pa.label "
        "FROM portfolio_accounts pa WHERE pa.id = d.portfolio_account_id"
    )
    op.alter_column("position_transactions", "account", nullable=False)

    op.drop_index(AUTO_INDEX, table_name="dividend_payments")
    op.create_index(
        AUTO_INDEX,
        "dividend_payments",
        ["security_id", "account", "ex_date"],
        unique=True,
        postgresql_where=sa.text("source = 'auto'"),
    )

    op.drop_constraint(TXN_FK, "position_transactions", type_="foreignkey")
    op.drop_column("position_transactions", "portfolio_account_id")
    op.drop_constraint(DIV_FK, "dividend_payments", type_="foreignkey")
    op.drop_column("dividend_payments", "portfolio_account_id")
    op.drop_table("portfolio_accounts")
```

- [ ] Verify the chain is still single-headed and now ends here:
  `.venv/Scripts/python.exe -m alembic heads`
  Expected: one line, `c9f4a7e2b168 (head)`.
- [ ] `.venv/Scripts/python.exe -m alembic history -r-3:` — expect
      `b5f2c8d31e7a -> c9f4a7e2b168 (head), portfolio accounts` at the end.
- [ ] **Do not run `alembic upgrade`.** The orchestrator applies it to the dev database at
      merge time.
- [ ] `.venv/Scripts/python.exe -m ruff check alembic` and
      `.venv/Scripts/python.exe -m ruff format --check alembic` — clean.
- [ ] `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest -q` — still
      `1138 passed` (the migration does not touch the create_all test schema).
- [ ] Commit: `feat(portfolio): migration c9f4a7e2b168 — portfolio_accounts + FK backfill`

---

### Task 4: Shared owner grammar + the filtered load seam

**Files:**
- `backend/app/services/ownership.py` (new)
- `backend/app/services/net_worth_calc.py` (:23-45)
- `backend/app/services/portfolio_accounts.py` (append)
- `backend/app/services/portfolio_calc.py` (`load_portfolio` :265-298)
- `backend/tests/test_portfolio_accounts.py` (append)

- [ ] Write the failing tests. First extend the file's imports (top of
      `backend/tests/test_portfolio_accounts.py`) to:

```python
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import DividendPayment, Person, PortfolioAccount, PositionTransaction, Security
from app.services.portfolio_accounts import portfolio_owner_clause, resolve_portfolio_account
from app.services.portfolio_calc import fold_transactions, load_portfolio
```

  then append:

```python
async def _owned_book(db):
    """Mine 10 sh, Theirs 5 sh, Ours 2 sh of one security, plus three dividends: one on
    Mine, one on Ours, one with NO account at all."""
    me, sam = Person(name="Me", is_primary=True), Person(name="Sam", is_primary=False)
    db.add_all([me, sam])
    await db.flush()
    mine = PortfolioAccount(label="Mine", person_id=me.id)
    theirs = PortfolioAccount(label="Theirs", person_id=sam.id)
    ours = PortfolioAccount(label="Ours", person_id=None)
    security = Security(ticker="VOO", name="Vanguard", holding_type="etf")
    db.add_all([mine, theirs, ours, security])
    await db.flush()
    db.add_all(
        [
            PositionTransaction(
                security_id=security.id,
                portfolio_account=mine,
                type="buy",
                shares=Decimal("10"),
                price=Decimal("50"),
                sort_index=10,
            ),
            PositionTransaction(
                security_id=security.id,
                portfolio_account=theirs,
                type="buy",
                shares=Decimal("5"),
                price=Decimal("60"),
                sort_index=20,
            ),
            PositionTransaction(
                security_id=security.id,
                portfolio_account=ours,
                type="buy",
                shares=Decimal("2"),
                price=Decimal("40"),
                sort_index=30,
            ),
            DividendPayment(
                security_id=security.id,
                portfolio_account=mine,
                pay_date=date(2026, 6, 30),
                amount=Decimal("10.00"),
            ),
            DividendPayment(
                security_id=security.id,
                portfolio_account=ours,
                pay_date=date(2026, 6, 30),
                amount=Decimal("2.00"),
            ),
            DividendPayment(
                security_id=security.id,
                portfolio_account=None,
                pay_date=date(2026, 6, 30),
                amount=Decimal("99.00"),
            ),
        ]
    )
    await db.commit()
    return me, sam


async def test_load_portfolio_scopes_transactions_and_dividends(db):
    me, sam = await _owned_book(db)

    _s, txns, _l, _h, dividends = await load_portfolio(db)
    assert sorted(t.account for t in txns) == ["Mine", "Ours", "Theirs"]
    assert sum(d.amount for d in dividends) == Decimal("111.00")  # household sees all three

    _s, txns, _l, _h, dividends = await load_portfolio(
        db, owner_filter=portfolio_owner_clause(str(me.id))
    )
    assert sorted(t.account for t in txns) == ["Mine", "Ours"]  # mine AND ours, never theirs
    assert sum(d.amount for d in dividends) == Decimal("12.00")  # the account-less 99 is out

    _s, txns, _l, _h, dividends = await load_portfolio(
        db, owner_filter=portfolio_owner_clause(str(sam.id))
    )
    assert sorted(t.account for t in txns) == ["Ours", "Theirs"]

    _s, txns, _l, _h, dividends = await load_portfolio(
        db, owner_filter=portfolio_owner_clause("joint")
    )
    assert [t.account for t in txns] == ["Ours"]  # joint = NULL-owned only
    assert sum(d.amount for d in dividends) == Decimal("2.00")


async def test_scoped_fold_keeps_the_label_key(db):
    me, _sam = await _owned_book(db)
    _s, txns, _l, _h, _d = await load_portfolio(
        db, owner_filter=portfolio_owner_clause(str(me.id))
    )
    positions = fold_transactions(txns)
    assert sorted(positions) == [(1, "Mine"), (1, "Ours")]
    assert positions[(1, "Mine")].shares == Decimal("10")


def test_portfolio_owner_clause_rejects_anything_that_is_not_an_id_or_joint():
    for bad in ("nobody", "-1", "0", "1.5", "99999999999", "", "²"):
        with pytest.raises(ValueError):
            portfolio_owner_clause(bad)
```

- [ ] Run — expect failure:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest tests/test_portfolio_accounts.py -q`
  Expected: `ImportError: cannot import name 'portfolio_owner_clause'`.
- [ ] Create `backend/app/services/ownership.py`:

```python
"""The household ownership grammar, in one place.

`owner=<person id>|joint`, absent = household — the query vocabulary the net-worth pages
established (2026-08-26 spec §5.2) and the portfolio pages now share. Only the PARSE lives
here; each vertical builds its own clause on its own owner column, because "mine" means a
different table there.
"""

JOINT = "joint"
INT32_MAX = 2**31 - 1


def parse_owner(owner: str) -> int | None:
    """`joint` -> None (the NULL-owned rows only); a person id -> that id.

    Raises ValueError on anything else so the routers answer 422; an out-of-range id would
    otherwise reach asyncpg as an int32 overflow, i.e. a 500. `isascii()` guards the
    superscript digits that `str.isdigit()` accepts and `int()` then rejects.
    """
    if owner == JOINT:
        return None
    if not (owner.isascii() and owner.isdigit()) or not 1 <= int(owner) <= INT32_MAX:
        raise ValueError(f"owner must be a person id or {JOINT!r}")
    return int(owner)
```

- [ ] `backend/app/services/net_worth_calc.py` — replace lines 23-45 (the `JOINT`/
      `INT32_MAX` constants and `owner_clause`'s parsing) with the shared parser. Add the
      import next to the other `app.` imports:

```python
# Re-exported: tests and future readers look for the household vocabulary next to the
# function that uses it, and moving the constant would be churn for nothing.
from app.services.ownership import JOINT, parse_owner  # noqa: F401
```

  and replace `owner_clause`:

```python
def owner_clause(owner: str) -> ColumnElement[bool]:
    """THE definition of net-worth ownership (household spec §5.2) — one function, so the
    two endpoints cannot drift apart. The portfolio's twin is
    services.portfolio_accounts.portfolio_owner_clause; both parse through
    services.ownership.parse_owner, so the GRAMMAR cannot drift either.

    `joint` selects the NULL-owned accounts only. A person id selects that person's accounts
    PLUS the joint ones, because "primary holder, spouse secondary" is what a joint account
    actually is: a person's view is "mine and ours", never "mine alone". The person views
    therefore OVERLAP by design and must never be summed — the disjoint split for stacking
    is owner_totals_for below.

    Raises ValueError (via parse_owner) on anything else so the router answers 422.
    """
    person_id = parse_owner(owner)
    if person_id is None:
        return Account.person_id.is_(None)
    return or_(Account.person_id == person_id, Account.person_id.is_(None))
```

  Delete the now-unused `JOINT = "joint"` / `INT32_MAX = 2**31 - 1` lines (:23-24).

- [ ] Append to `backend/app/services/portfolio_accounts.py`:

```python
def portfolio_owner_clause(owner: str) -> ColumnElement[bool]:
    """THE definition of portfolio ownership — the net-worth grammar applied to portfolio
    accounts (net_worth_calc.owner_clause is its twin; both parse through
    services.ownership.parse_owner).

    `joint` selects the NULL-owned accounts only; a person id selects that person's accounts
    PLUS the joint ones — "mine and ours", the same inclusive person view the net-worth
    pages use. Raises ValueError on anything else so the router answers 422.
    """
    person_id = parse_owner(owner)
    if person_id is None:
        return PortfolioAccount.person_id.is_(None)
    return or_(PortfolioAccount.person_id == person_id, PortfolioAccount.person_id.is_(None))
```

  with the imports at the top becoming:

```python
from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PortfolioAccount
from app.services.ownership import parse_owner
from app.services.people import load_people, primary_person
```

- [ ] `backend/app/services/portfolio_calc.py` — `load_portfolio` (:265-298). Add
      `ColumnElement` to the sqlalchemy import (`from sqlalchemy import ColumnElement, select`)
      and `from app.models import ... PortfolioAccount ...` to the models import, then
      replace the function:

```python
async def load_portfolio(
    db: AsyncSession,
    *,
    with_history: bool = True,
    with_dividends: bool = True,
    owner_filter: ColumnElement[bool] | None = None,
) -> tuple[
    dict[int, Security],
    list[PositionTransaction],
    dict[int, LatestPrice],
    dict[int, list[PriceHistory]],
    list[DividendPayment],
]:
    """/allocation and /realized skip history+dividends they never read (Task 10 review I1).

    `owner_filter` (portfolio_owner_clause's output) scopes the TRANSACTION and DIVIDEND
    loads by portfolio-account membership, and that is the whole filtering seam: holdings,
    totals, XIRR inputs, allocation weights and realized totals are all derived from the
    rows handed back here, so a scoped response is scope-consistent by construction rather
    than by five separate arithmetic decisions. None = the whole household, byte-identical
    to the pre-ownership answer.

    Securities and prices stay whole: they are lookups, not money. Dividends with NO
    portfolio account (the column is nullable there) are HOUSEHOLD-only — an unattributed
    payment cannot honestly join a person's view, and the inner join drops it.
    """
    securities = {s.id: s for s in (await db.execute(select(Security))).scalars()}
    txn_q = select(PositionTransaction).order_by(
        PositionTransaction.sort_index, PositionTransaction.id
    )
    if owner_filter is not None:
        txn_q = txn_q.join(
            PortfolioAccount, PortfolioAccount.id == PositionTransaction.portfolio_account_id
        ).where(owner_filter)
    txns = list((await db.execute(txn_q)).scalars())
    latest = {p.security_id: p for p in (await db.execute(select(LatestPrice))).scalars()}
    history: dict[int, list[PriceHistory]] = {}
    if with_history:
        rows = (
            await db.execute(
                select(PriceHistory).order_by(PriceHistory.security_id, PriceHistory.price_date)
            )
        ).scalars()
        for row in rows:
            history.setdefault(row.security_id, []).append(row)
    dividends: list[DividendPayment] = []
    if with_dividends:
        div_q = select(DividendPayment)
        if owner_filter is not None:
            div_q = div_q.join(
                PortfolioAccount, PortfolioAccount.id == DividendPayment.portfolio_account_id
            ).where(owner_filter)
        dividends = list((await db.execute(div_q)).scalars())
    return securities, txns, latest, history, dividends
```

- [ ] Run the new tests to pass:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest tests/test_portfolio_accounts.py -q`
  Expected: `10 passed`.
- [ ] Run the net-worth suites (the refactored `owner_clause` must not move):
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest tests/test_net_worth_calc.py tests/test_net_worth_api.py -q`
  Expected: all pass, no changes to those files.
- [ ] Full suite + lint gates as in Task 2. Expected: `1141 passed`.
- [ ] Commit: `feat(portfolio): shared owner grammar + owner-scoped load_portfolio seam`

---

### Task 5: `owner` on the five read endpoints

**Files:**
- `backend/app/api/portfolio.py` (imports :1-48, new helpers after `_validated_account`
  :82, `list_transactions` :245-254, `list_dividends` :342-351, `holdings` :421-425,
  `allocation_view` :511-518, `realized` :566-570)
- `backend/tests/test_portfolio_api.py` (append a new section at the end)

- [ ] Write the failing tests. Append to `backend/tests/test_portfolio_api.py` (add
      `from app.models import Person, PortfolioAccount` to the existing models import and
      `from tests.portfolio_factories import acct` if not already present):

```python
# --- ownership views (2026-08-28 household-portfolio spec §4.1) ---------------------------


async def _seed_owned_portfolio(auth_client, db):
    """One security at 100.00, three accounts, hand-checkable everywhere:

    Mine   buy 10 @ 50           -> 10 sh, cost 500, MV 1000
    Theirs buy 5 @ 60, sell 2@100 ->  3 sh, cost 180, MV 300, realized 80
    Ours   buy 2 @ 40            ->  2 sh, cost  80, MV 200
    Dividends: Mine 10.00, Ours 2.00, and 99.00 with NO account (household-only).
    """
    me, sam = Person(name="Me", is_primary=True), Person(name="Sam", is_primary=False)
    db.add_all([me, sam])
    await db.flush()
    security = await _create_security(auth_client)
    mine = PortfolioAccount(label="Mine", person_id=me.id)
    theirs = PortfolioAccount(label="Theirs", person_id=sam.id)
    ours = PortfolioAccount(label="Ours", person_id=None)
    db.add_all([mine, theirs, ours])
    await db.flush()
    db.add_all(
        [
            PositionTransaction(
                security_id=security["id"],
                portfolio_account=mine,
                type="buy",
                shares=Decimal("10"),
                price=Decimal("50"),
                sort_index=10,
            ),
            PositionTransaction(
                security_id=security["id"],
                portfolio_account=theirs,
                type="buy",
                shares=Decimal("5"),
                price=Decimal("60"),
                sort_index=20,
            ),
            PositionTransaction(
                security_id=security["id"],
                portfolio_account=theirs,
                type="sell",
                shares=Decimal("2"),
                price=Decimal("100"),
                sort_index=30,
            ),
            PositionTransaction(
                security_id=security["id"],
                portfolio_account=ours,
                type="buy",
                shares=Decimal("2"),
                price=Decimal("40"),
                sort_index=40,
            ),
            DividendPayment(
                security_id=security["id"],
                portfolio_account=mine,
                pay_date=date(2026, 6, 30),
                amount=Decimal("10.00"),
            ),
            DividendPayment(
                security_id=security["id"],
                portfolio_account=ours,
                pay_date=date(2026, 6, 30),
                amount=Decimal("2.00"),
            ),
            DividendPayment(
                security_id=security["id"],
                pay_date=date(2026, 6, 30),
                amount=Decimal("99.00"),
            ),
            LatestPrice(
                security_id=security["id"],
                price=Decimal("100.0000"),
                quoted_at=datetime(2026, 8, 14, tzinfo=UTC),
                source="yfinance",
            ),
        ]
    )
    await db.commit()
    return me, sam


async def test_holdings_owner_scope_is_consistent_end_to_end(auth_client, db):
    me, sam = await _seed_owned_portfolio(auth_client, db)

    household = (await auth_client.get(HOLDINGS)).json()
    assert household["totals"]["market_value"] == "1500.00"  # 15 shares x 100
    assert household["totals"]["cost_basis"] == "760.00"  # 500 + 180 + 80
    assert household["totals"]["realized_gl"] == "80.00"
    assert household["totals"]["dividends_collected"] == "111.00"
    assert household["holdings"][0]["accounts"] == ["Mine", "Ours", "Theirs"]

    scoped = (await auth_client.get(f"{HOLDINGS}?owner={me.id}")).json()
    row = scoped["holdings"][0]
    assert row["shares"] == "12.000000"  # mine 10 + ours 2, never theirs
    assert row["accounts"] == ["Mine", "Ours"]
    assert row["weight_pct"] == "1.000000"  # the only row -> weights re-normalize
    assert scoped["totals"]["market_value"] == "1200.00"
    assert scoped["totals"]["cost_basis"] == "580.00"
    assert scoped["totals"]["unrealized_gl"] == "620.00"
    assert scoped["totals"]["realized_gl"] == "0.00"  # the sale was Sam's
    assert scoped["totals"]["dividends_collected"] == "12.00"  # the 99 has no account
    assert Decimal(scoped["totals"]["market_value"]) == sum(
        Decimal(h["market_value"]) for h in scoped["holdings"]
    )

    theirs = (await auth_client.get(f"{HOLDINGS}?owner={sam.id}")).json()
    assert theirs["totals"]["market_value"] == "500.00"  # theirs 300 + ours 200
    assert theirs["totals"]["realized_gl"] == "80.00"

    joint = (await auth_client.get(f"{HOLDINGS}?owner=joint")).json()
    assert joint["totals"]["market_value"] == "200.00"
    assert joint["holdings"][0]["accounts"] == ["Ours"]


async def test_allocation_realized_transactions_and_dividends_take_the_same_scope(
    auth_client, db
):
    me, sam = await _seed_owned_portfolio(auth_client, db)

    allocation = (await auth_client.get(f"{ALLOCATION}?by=account&owner={me.id}")).json()
    assert allocation["total_market_value"] == "1200.00"
    assert [(s["key"], s["market_value"], s["weight_pct"]) for s in allocation["slices"]] == [
        ("Mine", "1000.00", "0.833333"),
        ("Ours", "200.00", "0.166667"),  # re-normalized over the filtered set
    ]

    assert (await auth_client.get(f"{REALIZED}?owner={me.id}")).json() == {
        "total": "0.00",
        "rows": [],
    }
    sam_realized = (await auth_client.get(f"{REALIZED}?owner={sam.id}")).json()
    assert sam_realized["total"] == "80.00"
    assert [r["realized_gl"] for r in sam_realized["rows"]] == ["80.00"]

    txns = (await auth_client.get(f"{TRANSACTIONS}?owner=joint")).json()
    assert [t["account"] for t in txns] == ["Ours"]

    dividends = (await auth_client.get(f"{DIVIDENDS}?owner={me.id}")).json()
    assert [(d["account"], d["amount"]) for d in dividends] == [
        ("Mine", "10.00"),
        ("Ours", "2.00"),
    ]  # the account-less 99.00 is household-only
    assert len((await auth_client.get(DIVIDENDS)).json()) == 3


async def test_owner_scoping_moves_the_xirr_gate_with_the_scope(auth_client, db):
    """A dateless row in ANOTHER person's account vetoes the household XIRR (any-account
    dateless-ness gates the security) but must not veto a scope that excludes it."""
    me, _sam = await _seed_owned_portfolio(auth_client, db)
    security = (await auth_client.get(SECURITIES)).json()[0]
    rows = (
        (await db.execute(select(PositionTransaction).order_by(PositionTransaction.id)))
        .scalars()
        .all()
    )
    for row in rows:
        if row.account in ("Mine", "Ours"):
            row.txn_date = date(2025, 8, 14)  # every scoped flow is dated ...
    await db.commit()  # ... while Sam's rows stay dateless

    household = (await auth_client.get(HOLDINGS)).json()
    assert household["holdings"][0]["xirr_pct"] is None
    scoped = (await auth_client.get(f"{HOLDINGS}?owner={me.id}")).json()
    assert scoped["holdings"][0]["xirr_pct"] is not None
    assert security["id"] == scoped["holdings"][0]["security_id"]


async def test_owner_of_the_primary_is_byte_identical_to_the_household_after_backfill(
    auth_client, db
):
    """The post-migration state: every label is the primary person's, so their view IS the
    household view — the promise that today's numbers do not move."""
    me = Person(name="Me", is_primary=True)
    db.add(me)
    await db.commit()
    security = await _create_security(auth_client)
    for account, shares in (("Fidelity Taxable", "5"), ("RH Taxable", "3")):
        created = await auth_client.post(
            TRANSACTIONS, json=_buy(security["id"], account=account, shares=shares)
        )
        assert created.status_code == 201, created.text
    db.add(_latest(security["id"], "100.0000", day=14))
    await db.commit()

    for url in (HOLDINGS, f"{ALLOCATION}?by=account", REALIZED, TRANSACTIONS, DIVIDENDS):
        joiner = "&" if "?" in url else "?"
        household = (await auth_client.get(url)).json()
        scoped = (await auth_client.get(f"{url}{joiner}owner={me.id}")).json()
        assert scoped == household, url


async def test_owner_param_rejects_garbage_on_every_portfolio_endpoint(auth_client, db):
    await _seed_owned_portfolio(auth_client, db)
    for url in (HOLDINGS, ALLOCATION, REALIZED, TRANSACTIONS, DIVIDENDS):
        for bad in ("nobody", "-1", "0", "1.5", "99999999999"):
            resp = await auth_client.get(f"{url}?owner={bad}")
            assert resp.status_code == 422, f"{url} {bad}"
```

  (`_latest` already exists in this file; keep using it. Add `DIVIDENDS`/`TRANSACTIONS`
  constants — both already defined at the top of the file.)

- [ ] Run — expect failure:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest tests/test_portfolio_api.py -q -k owner`
  Expected: failures because `owner` is ignored (scoped totals equal household totals) and
  the garbage cases return 200 instead of 422.
- [ ] `backend/app/api/portfolio.py` — imports:

```python
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import ColumnElement, func, select
```

```python
from app.models import (
    DividendPayment,
    PortfolioAccount,
    PortfolioValueHistory,
    PositionTransaction,
    Security,
)
```

```python
from app.services.portfolio_accounts import portfolio_owner_clause, resolve_portfolio_account
```

- [ ] `backend/app/api/portfolio.py` — add after `_validated_account` (:82):

```python
# A bounded string, not an int: the value is either a person id or the literal "joint", and
# a length cap keeps a garbage query out of the parser. Same shape as net_worth.py's
# OwnerQuery — the SEMANTICS are shared in services/ownership.parse_owner.
OwnerQuery = Annotated[str | None, Query(max_length=32)]


def _owner_filter(owner: str | None) -> ColumnElement[bool] | None:
    """HTTP contract only — portfolio_owner_clause owns the SEMANTICS. Absent means the
    whole household, and the endpoint's answer is then byte-identical to the
    pre-ownership one."""
    if owner is None:
        return None
    try:
        return portfolio_owner_clause(owner)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
```

- [ ] `backend/app/api/portfolio.py` — `list_transactions` (:245-254):

```python
@router.get("/transactions", response_model=list[TransactionOut])
async def list_transactions(
    security_id: int | None = None,
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
) -> list[PositionTransaction]:
    query = select(PositionTransaction).order_by(
        PositionTransaction.sort_index, PositionTransaction.id
    )
    if security_id is not None:
        query = query.where(PositionTransaction.security_id == security_id)
    owner_filter = _owner_filter(owner)
    if owner_filter is not None:
        query = query.join(
            PortfolioAccount, PortfolioAccount.id == PositionTransaction.portfolio_account_id
        ).where(owner_filter)
    return list((await db.execute(query)).scalars())
```

- [ ] `backend/app/api/portfolio.py` — `list_dividends` (:342-351):

```python
@router.get("/dividends", response_model=list[DividendOut])
async def list_dividends(
    security_id: int | None = None,
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
) -> list[DividendPayment]:
    query = select(DividendPayment).order_by(
        DividendPayment.pay_date.desc(), DividendPayment.id.desc()
    )
    if security_id is not None:
        query = query.where(DividendPayment.security_id == security_id)
    owner_filter = _owner_filter(owner)
    if owner_filter is not None:
        # Inner join: a dividend with no portfolio account is unattributed and stays
        # household-only (load_portfolio's rule, so the list and the analytics agree).
        query = query.join(
            PortfolioAccount, PortfolioAccount.id == DividendPayment.portfolio_account_id
        ).where(owner_filter)
    return list((await db.execute(query)).scalars())
```

- [ ] `backend/app/api/portfolio.py` — the three calc endpoints' signatures and loads:

```python
@router.get("/holdings", response_model=HoldingsOut)
async def holdings(owner: OwnerQuery = None, db: AsyncSession = Depends(get_db)) -> HoldingsOut:
    securities, txns, latest, history, dividends = await load_portfolio(
        db, owner_filter=_owner_filter(owner)
    )
```

```python
@router.get("/allocation", response_model=AllocationOut)
async def allocation_view(
    by: Literal["industry", "type", "account"] = "industry",
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
) -> AllocationOut:
    securities, txns, latest, _history, _dividends = await load_portfolio(
        db, with_history=False, with_dividends=False, owner_filter=_owner_filter(owner)
    )
```

```python
@router.get("/realized", response_model=RealizedOut)
async def realized(owner: OwnerQuery = None, db: AsyncSession = Depends(get_db)) -> RealizedOut:
    securities, txns, _latest, _history, _dividends = await load_portfolio(
        db, with_history=False, with_dividends=False, owner_filter=_owner_filter(owner)
    )
```

  (`/history` — the weekly series and its benchmark — takes **no** owner param: one row per
  Monday is a household fact by design, spec §2.)

- [ ] Run to pass:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest tests/test_portfolio_api.py -q`
  Expected: every test in the file passes, the pre-existing ones unchanged.
- [ ] Full suite + lint gates. Expected: `1146 passed`.
- [ ] Commit: `feat(portfolio): owner param on holdings/allocation/dividends/realized/transactions`

---

### Task 6: `GET /portfolio/accounts` + `PATCH /portfolio/accounts/{id}`

**Files:**
- `backend/app/schemas/portfolio.py` (append after `AllocationOut` ~:178)
- `backend/app/api/portfolio.py` (new endpoints after `_owner_filter`; imports)
- `backend/tests/test_portfolio_accounts.py` (append)

- [ ] Write the failing tests. Append to `backend/tests/test_portfolio_accounts.py`:

```python
ACCOUNTS = "/api/v1/portfolio/accounts"


async def test_list_accounts_is_label_ordered_with_owners(auth_client, db):
    me, sam = await _owned_book(db)
    body = (await auth_client.get(ACCOUNTS)).json()
    assert [(a["label"], a["person_id"]) for a in body] == [
        ("Mine", me.id),
        ("Ours", None),  # NULL = joint; the client owns that word, not the server
        ("Theirs", sam.id),
    ]
    assert set(body[0]) == {"id", "label", "person_id"}


async def _mine(db) -> PortfolioAccount:
    return (
        await db.execute(select(PortfolioAccount).where(PortfolioAccount.label == "Mine"))
    ).scalar_one()


async def test_patch_account_retags_and_unowns(auth_client, db):
    _me, sam = await _owned_book(db)
    mine = await _mine(db)

    retagged = await auth_client.patch(f"{ACCOUNTS}/{mine.id}", json={"person_id": sam.id})
    assert retagged.status_code == 200, retagged.text
    assert retagged.json() == {"id": mine.id, "label": "Mine", "person_id": sam.id}

    # Explicit null is a REAL write here: it is how an account becomes joint.
    joint = await auth_client.patch(f"{ACCOUNTS}/{mine.id}", json={"person_id": None})
    assert joint.status_code == 200, joint.text
    assert joint.json()["person_id"] is None

    noop = await auth_client.patch(f"{ACCOUNTS}/{mine.id}", json={})
    assert noop.status_code == 200
    assert noop.json()["person_id"] is None


async def test_patch_account_rejects_unknown_people_labels_and_ids(auth_client, db):
    await _owned_book(db)
    mine = await _mine(db)

    unknown = await auth_client.patch(f"{ACCOUNTS}/{mine.id}", json={"person_id": 9999})
    assert unknown.status_code == 422
    assert "unknown person_id" in unknown.json()["detail"]

    # Labels are the positions' identity this batch — a rename is a loud 422, never a
    # silently dropped key.
    rename = await auth_client.patch(f"{ACCOUNTS}/{mine.id}", json={"label": "Renamed"})
    assert rename.status_code == 422

    assert (await auth_client.patch(f"{ACCOUNTS}/999", json={"person_id": None})).status_code == 404


async def test_portfolio_accounts_require_auth(client):
    assert (await client.get(ACCOUNTS)).status_code == 401
    assert (await client.patch(f"{ACCOUNTS}/1", json={"person_id": None})).status_code == 401
```

  `_owned_book` must `await db.refresh(...)`-free access `me.id`/`sam.id` — it already
  returns the flushed `Person` rows.

- [ ] Run — expect failure:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest tests/test_portfolio_accounts.py -q -k account`
  Expected: 404s from FastAPI (`{"detail":"Not Found"}`) — the routes do not exist.
- [ ] `backend/app/schemas/portfolio.py` — append after `AllocationOut`:

```python
class PortfolioAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    # NULL = JOINT/household (the accounts.person_id grammar), never "unknown": migration
    # c9f4a7e2b168 backfilled every pre-existing label to the primary person.
    person_id: int | None


class PortfolioAccountUpdate(BaseModel):
    # extra="forbid": labels ARE the positions' identity this batch, so an attempted rename
    # must be a loud 422 rather than a key pydantic quietly drops.
    model_config = ConfigDict(extra="forbid")

    # int32-bounded so a garbage id 422s instead of surfacing asyncpg's DataError; null is
    # a real write (it is how an account becomes joint), so absence is what "no change"
    # means — the router reads model_fields_set, not the value.
    person_id: int | None = Field(default=None, ge=1, le=2_147_483_647)
```

- [ ] `backend/app/api/portfolio.py` — add `Person` to the models import and the two
      schemas to the schemas import, then add the endpoints immediately after
      `_owner_filter`:

```python
@router.get("/accounts", response_model=list[PortfolioAccountOut])
async def list_portfolio_accounts(db: AsyncSession = Depends(get_db)) -> list[PortfolioAccount]:
    """Every label the ledger has ever seen, label-ordered — the roster Settings edits.
    Rows are never deleted here: a label with no live transactions is still the identity
    of the history that used it."""
    return list(
        (await db.execute(select(PortfolioAccount).order_by(PortfolioAccount.label))).scalars()
    )


@router.patch("/accounts/{account_id}", response_model=PortfolioAccountOut)
async def update_portfolio_account(
    account_id: int, body: PortfolioAccountUpdate, db: AsyncSession = Depends(get_db)
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
    account.person_id = person_id
    await db.commit()
    return account
```

- [ ] Run to pass:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest tests/test_portfolio_accounts.py -q`
  Expected: all pass (`14 passed`).
- [ ] Full suite + lint gates. Expected: `1150 passed`.
- [ ] Commit: `feat(portfolio): portfolio-accounts roster + owner PATCH`

---

### Task 7: Importer and ingest ownership pins

Both code paths already moved in Task 2; this task pins the BEHAVIOR the spec names, so a
later refactor cannot quietly break it.

**Files:**
- `backend/tests/test_importer_apply.py` (append near the other positions tests, ~:270)
- `backend/tests/test_dividend_ingest.py` (append)

- [ ] Add the importer pins to `backend/tests/test_importer_apply.py` (imports:
      `Person`, `PortfolioAccount` from `app.models`):

```python
async def test_apply_positions_creates_primary_owned_portfolio_accounts(db):
    """Sheet labels become owned rows: the importer resolves through the same door the
    router does (2026-08-28 spec §8), so a re-import needs zero workbook changes."""
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    me = (await db.execute(select(Person).where(Person.is_primary))).scalar_one()

    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await db.commit()

    rows = (
        (await db.execute(select(PortfolioAccount).order_by(PortfolioAccount.label)))
        .scalars()
        .all()
    )
    assert [(r.label, r.person_id) for r in rows] == [("Fido", me.id), ("RH Taxable", me.id)]


async def test_reimport_keeps_a_retagged_label_with_its_new_owner(db):
    """The user re-tags "Fido" to their partner in Settings; the next sheet import must
    leave that alone — get-or-create GETS."""
    me, sam = Person(name="Me", is_primary=True), Person(name="Sam", is_primary=False)
    db.add_all([me, sam])
    await db.commit()

    wb = sheets()
    report = SheetReport()
    by_name = await apply_reference_data(db, parse_reference_data(wb["ReferenceData"]), report)
    await apply_positions(db, parse_positions(wb["Positions"]), by_name, report)
    await db.commit()
    fido = (
        await db.execute(select(PortfolioAccount).where(PortfolioAccount.label == "Fido"))
    ).scalar_one()
    fido.person_id = sam.id
    await db.commit()

    wb2 = sheets()
    report2 = SheetReport()
    by_name2 = await apply_reference_data(db, parse_reference_data(wb2["ReferenceData"]), report2)
    await apply_positions(db, parse_positions(wb2["Positions"]), by_name2, report2)
    await db.commit()

    after = (
        (await db.execute(select(PortfolioAccount).order_by(PortfolioAccount.label)))
        .scalars()
        .all()
    )
    assert [(r.label, r.person_id) for r in after] == [("Fido", sam.id), ("RH Taxable", me.id)]
    assert report2.entities["position_transactions"].updates == 0  # and no phantom diffs
```

- [ ] Add the ingest pins to `backend/tests/test_dividend_ingest.py` (imports: `pytest`,
      `IntegrityError` from `sqlalchemy.exc`, `PortfolioAccount` from `app.models`):

```python
async def test_auto_rows_are_unique_per_security_account_and_ex_date(db):
    """The ported index: (security_id, portfolio_account_id, ex_date) WHERE source='auto'
    — the same uniqueness the label-keyed index enforced."""
    sec = await seed_security(db)
    db.add(auto(sec.id, "RH Taxable", date(2026, 6, 19), "8.20"))
    await db.commit()
    db.add(auto(sec.id, "RH Taxable", date(2026, 6, 19), "8.20"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()

    # Same event, DIFFERENT account -> a second row is legal (per-account grain).
    db.add(auto(sec.id, "Fidelity", date(2026, 6, 19), "4.10"))
    await db.commit()
    assert len(await dividend_rows(db, source="auto")) == 2

    # Manual rows stay unconstrained (the index is partial).
    db.add_all(
        [
            manual(sec.id, date(2026, 6, 19), "1.00", account="RH Taxable"),
            manual(sec.id, date(2026, 6, 19), "1.00", account="RH Taxable"),
        ]
    )
    await db.commit()
    assert len(await dividend_rows(db, source="manual")) == 2


async def test_self_heal_scope_is_keyed_by_the_account_row(db):
    """Two accounts hold the same security; the holding in one is sold off. The next run
    removes THAT account's auto row and leaves the other's — the old account-keyed
    behavior, now on the FK."""
    sec = await seed_security(db)
    db.add_all(
        [
            txn(sec.id, "RH Taxable", "10", sort_index=0),
            txn(sec.id, "Fidelity", "5", sort_index=1),
        ]
    )
    await db.commit()
    first = await ingest_dividends(db, {sec.id: [bar(date(2026, 6, 19), "0.8200")]}, today=TODAY)
    await db.commit()
    assert counts(first) == (2, 0, 0, 0)

    db.add(txn(sec.id, "Fidelity", "5", type_="sell", price="100.0000", sort_index=2))
    await db.commit()
    second = await ingest_dividends(db, {sec.id: [bar(date(2026, 6, 19), "0.8200")]}, today=TODAY)
    await db.commit()
    assert counts(second) == (0, 1, 1, 0)  # RH rewritten, Fidelity's row removed
    assert [r.account for r in await dividend_rows(db)] == ["RH Taxable"]
```

- [ ] Run the two files:
  `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest tests/test_importer_apply.py tests/test_dividend_ingest.py -q`
  Expected: all pass. (These pin behavior that Task 2 already implemented — if one fails,
  the Task 2 port is wrong; fix the code, not the pin.)
- [ ] Full suite + lint gates. Expected: `1154 passed`.
- [ ] Commit: `feat(portfolio): pin importer + dividend-ingest ownership semantics`

---

### Task 8: Batch gates

**Files:** none (verification only).

- [ ] `FINANCE_TEST_DB=finance_test_p4pf .venv/Scripts/python.exe -m pytest -q`
      Expected: `1154 passed`, zero failures, zero errors.
- [ ] `.venv/Scripts/python.exe -m ruff check app tests alembic` — `All checks passed!`
- [ ] `.venv/Scripts/python.exe -m ruff format --check app tests alembic` — all formatted.
- [ ] `.venv/Scripts/python.exe -m alembic heads` — one line, `c9f4a7e2b168 (head)`.
- [ ] Confirm nothing outside the backend changed: `git status --short` shows only
      `backend/` files plus this plan.
- [ ] Report to the orchestrator: head to apply at merge is `c9f4a7e2b168`; the frontend
      (Plan 2) can now call `GET /portfolio/accounts`, `PATCH /portfolio/accounts/{id}` and
      `?owner=` on the five read endpoints.
- [ ] No commit (or an empty-tree `chore` commit if the runner requires one).

---

## Forward notes (deliberately out of scope)

- **No DELETE for portfolio accounts.** A label with no live transactions still lingers in
  the roster; it is the identity of the history that used it. If the Settings table grows a
  cleanup affordance later, the FK is `RESTRICT` — it will need a guard, like
  `delete_account`'s balance-count 409.
- **Case-folding is not attempted.** `"Fidelity"` and `"fidelity "` backfill as two
  accounts (spec §2: exact labels preserved). Merging them is a morning-list item, not a
  migration.
- **Downgrade drops ownership.** `person_id` has nowhere to live in the old shape; the
  migration's docstring says so.
- **The weekly performance series and the contribution benchmark stay household-wide** —
  one row per Monday is a household fact (spec §2). `/portfolio/history` takes no `owner`.
- **XIRR under a scope is a different number by design.** Flows, dividends and market value
  are all scoped, so a person's XIRR answers "what did MY slice return"; an unattributed
  (account-less) dividend is household-only and therefore absent from every scoped XIRR.
  The dateless-veto also moves with the scope (Task 5 pins it).
