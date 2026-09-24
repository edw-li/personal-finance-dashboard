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
from collections.abc import Awaitable, Callable, Hashable, Iterable
from datetime import date

from sqlalchemy import TextClause, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Account,
    AccountBalance,
    AppSetting,
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
from app.services.month_review import ReviewBook, load_review_book, load_review_book_snapshot
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
# reconciliation. `price_history` is the one it reads only PART of: the employer ticker's bars
# (`api/comp._employer_bars`), so its fingerprint cell is restricted to those rows — the nightly
# refresh of every other holding's history must not cost the card its memo.
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
EMPLOYER_BARS_TABLE = PriceHistory.__tablename__

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


def _fingerprint_statement(tables: Iterable[str]) -> TextClause:
    """One round trip, one snapshot: per table `count:Σhash` over the whole-row text. The sum
    is numeric, so it cannot overflow; being order-independent is right, because every
    loader's answer depends on the rows, never on the order Postgres returns them in."""
    cells = ", ".join(
        "(SELECT count(*)::text || ':' || "
        "coalesce(sum(hashtextextended(fp_row::text, 0)), 0)::text"
        f' FROM "{name}" AS fp_row)'
        for name in tables
    )
    return text(f"SELECT {cells}")


_REVIEW_BOOK_FINGERPRINT = _fingerprint_statement(REVIEW_BOOK_TABLES)
_MONTH_SAVINGS_FINGERPRINT = _fingerprint_statement(MONTH_SAVINGS_TABLES)


def _withholding_fingerprint_statement() -> TextClause:
    """`_fingerprint_statement` over the withholding tables, with the `price_history` cell
    restricted to the employer ticker's security — the `:ticker` bind, read first by
    `_employer_ticker` and bound per request. A NULL ticker matches no security: no bars."""
    whole = [name for name in WITHHOLDING_TABLES if name != EMPLOYER_BARS_TABLE]
    cells = [
        "(SELECT count(*)::text || ':' || "
        "coalesce(sum(hashtextextended(fp_row::text, 0)), 0)::text"
        f' FROM "{name}" AS fp_row)'
        for name in whole
    ]
    cells.append(
        "(SELECT count(*)::text || ':' || "
        "coalesce(sum(hashtextextended(fp_row::text, 0)), 0)::text"
        f' FROM "{EMPLOYER_BARS_TABLE}" AS fp_row'
        f' WHERE fp_row.security_id IN (SELECT id FROM "{Security.__tablename__}"'
        " WHERE ticker = :ticker))"
    )
    return text(f"SELECT {', '.join(cells)}")


_WITHHOLDING_FINGERPRINT = _withholding_fingerprint_statement()


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
) -> V:
    """The value for `key`: cached, awaited from a build already in flight, or built here.

    Waiters take the builder's value even when its stability check failed — under READ
    COMMITTED that is exactly what each would have built itself — but only a stable build
    is cached (rule 1). A waiter shields the shared build, so its own cancellation cannot
    cancel it. When a build fails or is abandoned, its waiters look again: the first to wake
    builds and the rest await that one."""
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


async def _employer_ticker(db: AsyncSession) -> str | None:
    """The employer ticker exactly as the GET resolves it — `api/espp._espp_quote`'s first hop,
    normalization included (blank/absent/malformed → none, "nvda" → "NVDA"). Mirrored rather
    than imported because a service may not import a router; `api/app_settings` keeps the
    other copy and the two are one rule."""
    setting = await db.get(AppSetting, "espp_ticker")
    if setting is None or not isinstance(setting.value, dict):
        return None
    raw = setting.value.get("value")
    ticker = raw.strip().upper() if isinstance(raw, str) else ""
    return ticker or None


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
    fingerprint AND the ticker the `price_history` cell was restricted with; a ticker changed
    between the two fingerprints also changes `app_settings`' cell, so such a build is never
    filed (rule 1). 422s and 404s raise out of `build` and are never cached."""
    if _has_pending_changes(db):
        return await build()
    ticker = await _employer_ticker(db)
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
