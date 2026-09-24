"""Read-path memoisation keyed by a transactional data fingerprint (2026-09-23 spec §P4).

The month-review book and the month savings are pure functions of a handful of tables (plus,
for the book, the product day and any extra months asked for). One Overview load used to
rebuild the book four times — 39 months of canonical inputs and SHA-256 revisions each time.
Now ONE statement fingerprints exactly the tables a value reads — per table its row count and
the sum of a 64-bit hash of every row's text — and the value is cached under that
fingerprint. Any committed write by any writer (ORM, a Core undo or restore, the importer
CLI, another process, psql) changes it, so a cached value is only ever served for the table
contents it was built from: no event hooks, TTLs or triggers to keep in step.

Four rules keep that promise airtight and the first paint fast:

1. Store only if stable. A miss fingerprints again after building and stores only when
   nothing moved. Under READ COMMITTED every statement of the build sees fresh commits, so a
   book built from a state committed mid-build must not be filed under the key taken before
   it — an Undo of that insert (a delete) restores exactly the old key.
2. Pending ORM changes bypass the cache. The uncached loaders' ORM queries autoflush and a
   Core fingerprint does not; a session carrying new, dirty or deleted objects keeps today's
   exact semantics. (Read paths never carry any.)
3. Read paths only. Write paths (month save/close, batch close, adoption) keep the uncached,
   lock-protected `load_review_book`, whose ORM rows they update in place. A cached value
   holds no session-bound object — the book carries frozen ReviewSnapshot values in
   read-only mappings, the savings frozen rows read as plain columns — and it is shared
   between requests, so a caller must treat it as immutable.
4. Single-flight. The Overview asks for the book three times at once (coverage, metrics,
   matrix); on a cold key the first request builds and the others await that build instead
   of building their own.

Per process, at most CACHE_SIZE entries per value; conftest clears both between tests.
"""

import asyncio
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Hashable, Iterable, Mapping
from datetime import date

from sqlalchemy import TextClause, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Account,
    AccountBalance,
    AppSetting,
    CategoryBudget,
    ContributionLimit,
    EsppLot,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    PriceHistory,
    RsuGrant,
    Security,
    SpendingCategory,
    TaxBracket,
    TaxInput,
    TaxYear,
)
from app.models.month_review import MonthReview, MonthReviewAdoption
from app.services import clock
from app.services.employer_ticker import (
    ESPP_TICKER_KEY,
    read_committed_employer_ticker,
    read_employer_ticker,
)
from app.services.month_review import ReviewBook, load_review_book, load_review_book_snapshot
from app.services.net_worth_calc import PLAN_UNTIL_KEY
from app.services.savings import MonthSavings, load_month_savings

CACHE_SIZE = 8

# Exactly the tables each loader reads, derived from their code — and pinned by a test that
# captures the SQL the loaders execute, so a new read can never slip past its fingerprint.
REVIEW_BOOK_TABLES: tuple[str, ...] = tuple(
    model.__tablename__
    for model in (
        Account,
        NetWorthSnapshot,
        AccountBalance,
        SpendingCategory,
        MonthlySpending,
        MonthlyCashflow,
        PaycheckProfile,
        MonthReview,
        MonthReviewAdoption,
    )
)
MONTH_SAVINGS_TABLES: tuple[str, ...] = tuple(
    model.__tablename__
    for model in (MonthlySpending, SpendingCategory, MonthlyCashflow, PaycheckProfile)
)

# Every table the withholding GET reads (2026-09-23 spec §W12) — the engine feed, the profiles
# and grants, the employer's quote and bars, the year's limits and the sold ESPP lots of the
# reconciliation. Pinned by the SQL-capture tests in test_withholding_cache.py.
WITHHOLDING_TABLES: tuple[str, ...] = tuple(
    model.__tablename__
    for model in (
        TaxYear,
        TaxInput,
        TaxBracket,
        Person,
        PaycheckProfile,
        ContributionLimit,
        RsuGrant,
        Security,
        LatestPrice,
        AppSetting,
        EsppLot,
        PriceHistory,
    )
)
# Three of those tables it reads only PART of, so their fingerprint cells cover only those rows
# (batch 2 integration, 2026-09-24; the projection's cells below have the same shape): two
# settings — the employer ticker, and the plan's ESPP discount that prices a lot sold this year —
# and the employer ticker's one quote and its bars (`api/comp._employer_bars`). A price refresh
# writes its own bookkeeping keys and every holding's quote and bars; none of that can move the
# card, so none of it costs the card its memo. The employer's own quote and bars still do.
# Pinned complete by test_withholding_cache's capture of every setting and quote a build reads.
WITHHOLDING_SETTING_KEYS: tuple[str, ...] = (ESPP_TICKER_KEY, "espp_discount_pct")

type Fingerprint = tuple[str, ...]
type BookKey = tuple[Fingerprint, date, tuple[date, ...]]
type Savings = tuple[MonthSavings, ...]


class LRU[K: Hashable, V]:
    """A tiny least-recently-used map for one value type. No lock: the event loop is the only
    thread (the scheduler's jobs are coroutines on it too)."""

    def __init__(self, size: int) -> None:
        self.size = size
        self._entries: OrderedDict[K, V] = OrderedDict()

    def get(self, key: K) -> V | None:
        value = self._entries.get(key)
        if value is not None:
            self._entries.move_to_end(key)
        return value

    def put(self, key: K, value: V) -> None:
        self._entries[key] = value
        self._entries.move_to_end(key)
        while len(self._entries) > self.size:
            self._entries.popitem(last=False)

    def keys(self) -> list[K]:
        return list(self._entries)

    def clear(self) -> None:
        self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)


REVIEW_BOOKS: LRU[BookKey, ReviewBook] = LRU(CACHE_SIZE)
MONTH_SAVINGS: LRU[Fingerprint, Savings] = LRU(CACHE_SIZE)
# (fingerprint, employer ticker, product day, year) -> the GET's serialized JSON bytes (§W12).
type WithholdingKey = tuple[Fingerprint, str | None, date, int]
WITHHOLDINGS: LRU[WithholdingKey, bytes] = LRU(CACHE_SIZE)
# The builds in flight, per key: the single-flight half of each cache (rule 4).
_BOOK_BUILDS: dict[BookKey, asyncio.Future[ReviewBook]] = {}
_SAVINGS_BUILDS: dict[Fingerprint, asyncio.Future[Savings]] = {}
_WITHHOLDING_BUILDS: dict[WithholdingKey, asyncio.Future[bytes]] = {}


def clear_read_caches() -> None:
    REVIEW_BOOKS.clear()
    MONTH_SAVINGS.clear()
    WITHHOLDINGS.clear()
    _BOOK_BUILDS.clear()
    _SAVINGS_BUILDS.clear()
    _WITHHOLDING_BUILDS.clear()
    PROJECTIONS.clear()
    _PROJECTION_BUILDS.clear()


def _fingerprint_statement(
    tables: Iterable[str], narrowed: Mapping[str, str] | None = None
) -> TextClause:
    """One round trip, one snapshot: per table `count:Σhash` over the whole-row text. The sum
    is numeric, so it cannot overflow; being order-independent is right, because every
    loader's answer depends on the rows, never on the order Postgres returns them in.

    `narrowed` restricts a table's cell to the rows a value reads (a WHERE over `fp_row`) — for
    a value that reads a few rows of a table everything else writes to (the projection's
    settings and quote, 2026-09-24 review minor 4)."""
    where = narrowed or {}
    cells = ", ".join(
        "(SELECT count(*)::text || ':' || "
        "coalesce(sum(hashtextextended(fp_row::text, 0)), 0)::text"
        f' FROM "{name}" AS fp_row{f" WHERE {where[name]}" if name in where else ""})'
        for name in tables
    )
    return text(f"SELECT {cells}")


_REVIEW_BOOK_FINGERPRINT = _fingerprint_statement(REVIEW_BOOK_TABLES)
_MONTH_SAVINGS_FINGERPRINT = _fingerprint_statement(MONTH_SAVINGS_TABLES)

# The employer ticker's rows of a table keyed by security: the `:ticker` bind, read by
# `read_employer_ticker` just before the fingerprint and bound per request. A NULL ticker matches
# no security, so no rows — as the build, with no ticker, reads none.
_EMPLOYER_ROWS = (
    f'fp_row.security_id IN (SELECT id FROM "{Security.__tablename__}" WHERE ticker = :ticker)'
)


def _setting_rows(keys: Iterable[str]) -> str:
    """The app_settings rows a value reads: its keys, as literals (they are code, never input)."""
    return "fp_row.key IN ({})".format(", ".join(f"'{key}'" for key in keys))


_WITHHOLDING_FINGERPRINT = _fingerprint_statement(
    WITHHOLDING_TABLES,
    {
        AppSetting.__tablename__: _setting_rows(WITHHOLDING_SETTING_KEYS),
        LatestPrice.__tablename__: _EMPLOYER_ROWS,
        PriceHistory.__tablename__: _EMPLOYER_ROWS,
    },
)


async def _fingerprint(db: AsyncSession, statement: TextClause) -> Fingerprint:
    return tuple((await db.execute(statement)).one())


def _has_pending_changes(db: AsyncSession) -> bool:
    return bool(db.new or db.dirty or db.deleted)


class _BuildAbandoned(Exception):
    """What a build's waiters see when the builder failed or was cancelled — always a fresh
    one. Never the builder's own exception: raising that object again in another request
    rewrites its traceback while the builder's request may be logging it (its 500 would show
    another request's frames). Never CancelledError: in a waiter that reads as the waiter's
    OWN cancellation."""


async def _memoised[K: Hashable, V](
    db: AsyncSession,
    cache: LRU[K, V],
    builds: dict[K, asyncio.Future[V]],
    key: K,
    before: Fingerprint,
    statement: TextClause,
    build: Callable[[], Awaitable[V]],
    still_current: Callable[[], Awaitable[bool]] | None = None,
) -> V:
    """The value for `key`: cached, awaited from a build already in flight, or built here.

    Waiters take the builder's value even when its stability check failed — under READ
    COMMITTED that is exactly what each would have built itself — but only a stable build
    is cached (rule 1). `still_current`, when given, is asked after a stable build and can
    veto the filing: it checks what the fingerprint cannot, a bind the caller read before it
    (the employer ticker, `_ticker_unchanged`). A waiter shields the shared build, so its own
    cancellation cannot cancel it. When a build fails or is abandoned, its waiters look again:
    the first to wake builds and the rest await that one."""
    while True:
        cached = cache.get(key)
        if cached is not None:
            return cached
        in_flight = builds.get(key)
        if in_flight is None:
            break
        try:
            return await asyncio.shield(in_flight)
        except Exception:
            continue  # that build failed or was abandoned
    flight: asyncio.Future[V] = asyncio.get_running_loop().create_future()
    builds[key] = flight
    try:
        value = await build()
        stable = await _fingerprint(db, statement) == before
        if stable and still_current is not None:
            stable = await still_current()
    except BaseException:
        flight.set_exception(_BuildAbandoned())  # the builder re-raises its own, untouched
        flight.exception()  # retrieved: no "never retrieved" log when nobody was waiting
        raise
    finally:
        # A FINISHED build must never stay in the in-flight map: awaiting a finished future
        # does not yield, so a waiter's `continue` above would spin on it forever. Removed
        # here on every path — success, failure, cancellation — before the flight settles.
        if builds.get(key) is flight:
            del builds[key]
    if stable:
        cache.put(key, value)
    flight.set_result(value)
    return value


async def cached_review_book(
    db: AsyncSession,
    *,
    extra_months: list[date] | None = None,
    today: date | None = None,
) -> ReviewBook:
    """`load_review_book` for READ paths: the same book, built once per data version.

    Keyed (fingerprint, today, extra months). A cached no-extras book also answers for extra
    months it already contains: the loader fills every first-of-month between its earliest and
    latest month, so such a month adds nothing and the book is provably the same (spec §P4's
    key, refined so a Spending drill does not rebuild the book or churn the LRU)."""
    if _has_pending_changes(db):
        return await load_review_book(db, extra_months=extra_months, today=today)
    today = today or clock.product_today()
    extras = tuple(sorted(set(extra_months or ())))
    before = await _fingerprint(db, _REVIEW_BOOK_FINGERPRINT)
    base = REVIEW_BOOKS.get((before, today, ()))
    if base is not None and all(month in base.months for month in extras):
        return base
    return await _memoised(
        db,
        REVIEW_BOOKS,
        _BOOK_BUILDS,
        (before, today, extras),
        before,
        _REVIEW_BOOK_FINGERPRINT,
        lambda: load_review_book_snapshot(db, extra_months=list(extras), today=today),
    )


def _ticker_unchanged(db: AsyncSession, ticker: str | None) -> Callable[[], Awaitable[bool]]:
    """Rule 1 for the employer ticker a cache bound its quote cells with (integration review,
    item 6). The ticker is read BEFORE the first fingerprint, so a Settings change committed
    between the two leaves the settings cell on the new ticker and the quote cells on the old
    one. The fingerprint after the build agrees with that key, so the stability check passes, but
    the key's two halves disagree about the ticker. Such an entry is filed only if the committed
    ticker, read once more after the build, is still the bound one — read with
    `read_committed_employer_ticker`, not `read_employer_ticker`: `db.get` answers from the
    identity map while anything in the session still holds the row, and could hand back the
    very value being checked."""

    async def unchanged() -> bool:
        return await read_committed_employer_ticker(db) == ticker

    return unchanged


async def cached_withholding(
    db: AsyncSession,
    year: int,
    build: Callable[[], Awaitable[bytes]],
    *,
    today: date,
) -> bytes:
    """The withholding GET's serialized bytes for READ paths (2026-09-23 spec §W12), built once
    per data version, product day and year.

    Bytes, not a model (R9's rule): the route returns them as they are, a direct caller decodes
    a model of its own, and nothing shared can be mutated by the next reader. Keyed on the
    fingerprint AND the ticker the `latest_prices` and `price_history` cells were restricted
    with, which is read by `read_employer_ticker`, the reader the build's quote chain
    (`api/espp._espp_quote`) uses too. A ticker changed between the two fingerprints also
    changes `app_settings`' cell (its narrowed keys include the ticker's), and one changed
    before the first is caught by `_ticker_unchanged`, so neither build is ever filed (rule 1).
    422s and 404s raise out of `build` and are never cached."""
    if _has_pending_changes(db):
        return await build()
    ticker = await read_employer_ticker(db)
    statement = _WITHHOLDING_FINGERPRINT.bindparams(ticker=ticker)
    before = await _fingerprint(db, statement)
    return await _memoised(
        db,
        WITHHOLDINGS,
        _WITHHOLDING_BUILDS,
        (before, ticker, today, year),
        before,
        statement,
        build,
        _ticker_unchanged(db, ticker),
    )


async def cached_month_savings(db: AsyncSession) -> list[MonthSavings]:
    """`load_month_savings` for READ paths, once per data version of its four tables. The rows
    are frozen dataclasses and the cache keeps a tuple; every caller gets its own list, so
    appending to or sorting an answer can never reach the next request."""
    if _has_pending_changes(db):
        return await load_month_savings(db)
    before = await _fingerprint(db, _MONTH_SAVINGS_FINGERPRINT)

    async def build() -> Savings:
        return tuple(await load_month_savings(db))

    savings = await _memoised(
        db, MONTH_SAVINGS, _SAVINGS_BUILDS, before, before, _MONTH_SAVINGS_FINGERPRINT, build
    )
    return list(savings)


# --- the projection's result cache (2026-09-23 spec §R9) ---

# Every table GET /projection reads — the review book's and the savings' tables, plus the
# people and their limits, the settings (SWR, ticker, plan-until year), the budgets and the
# grants with their quote. Pinned by the SQL-capture test in test_projection_cache.py, so a
# new read cannot slip past the fingerprint and serve a stale success rate.
PROJECTION_TABLES: tuple[str, ...] = tuple(
    model.__tablename__
    for model in (
        Account,
        NetWorthSnapshot,
        AccountBalance,
        SpendingCategory,
        MonthlySpending,
        MonthlyCashflow,
        PaycheckProfile,
        MonthReview,
        MonthReviewAdoption,
        Person,
        ContributionLimit,
        AppSetting,
        CategoryBudget,
        RsuGrant,
        Security,
        LatestPrice,
    )
)
# The rows of two of those tables the projection reads, and so all its fingerprint covers of
# them (2026-09-24 review minor 4): three settings — the withdrawal rate, the employer ticker and
# the lasting plan-until year — and the employer ticker's one quote. A price refresh writes its
# own bookkeeping keys and every holding's quote; none of that can move a projection, so none of
# it costs the cache its entries. Pinned complete by test_projection_cache's capture of every
# setting and quote a build reads.
PROJECTION_SETTING_KEYS: tuple[str, ...] = ("swr_pct", ESPP_TICKER_KEY, PLAN_UNTIL_KEY)
_PROJECTION_NARROWED = {
    AppSetting.__tablename__: _setting_rows(PROJECTION_SETTING_KEYS),
    # A NULL ticker matches no security: no quote, as the build (no ticker, no vests) reads none.
    LatestPrice.__tablename__: _EMPLOYER_ROWS,
}
PROJECTION_CACHE_SIZE = 16
# The SERIALIZED JSON bytes, never ProjectionOut models: seven series of up to 721 Decimals per
# entry would sit in memory on a 1 GB box, and bytes cannot be mutated by one caller under
# another — the route returns them as they are, a direct caller validates its own model.
PROJECTIONS: LRU[Hashable, bytes] = LRU(PROJECTION_CACHE_SIZE)
_PROJECTION_BUILDS: dict[Hashable, asyncio.Future[bytes]] = {}
_PROJECTION_FINGERPRINT = _fingerprint_statement(PROJECTION_TABLES, _PROJECTION_NARROWED)


async def cached_projection(
    db: AsyncSession, key: Hashable, build: Callable[[], Awaitable[bytes]]
) -> bytes:
    """The projection's bytes for `key` (the product day and the normalized knobs), built
    once per data version of what it reads: stable-store, single-flight and the pending-
    changes bypass are `_memoised`'s. A build that raises (a 422, the empty book's 404) is
    never stored — its waiters look again.

    The quote cell is restricted to the employer ticker as the build resolves it —
    `read_employer_ticker`, the one reader of the setting, which the build's quote chain and the
    withholding cache call too — read only AFTER the pending-changes check, since its read would
    autoflush them. The key carries it: a ticker changed between the two fingerprints changes
    the settings cell as well, and one changed before the first is caught by
    `_ticker_unchanged`, so neither build is ever filed (rule 1)."""
    if _has_pending_changes(db):
        return await build()
    ticker = await read_employer_ticker(db)
    statement = _PROJECTION_FINGERPRINT.bindparams(ticker=ticker)
    before = await _fingerprint(db, statement)
    return await _memoised(
        db,
        PROJECTIONS,
        _PROJECTION_BUILDS,
        (before, ticker, key),
        before,
        statement,
        build,
        _ticker_unchanged(db, ticker),
    )
