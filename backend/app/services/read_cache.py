"""Read-path memoisation keyed by a transactional data fingerprint (2026-09-23 spec §P4).

The month-review book and the month savings are pure functions of a handful of tables (plus,
for the book, the product day and any extra months asked for). One Overview load used to
rebuild the book four times — 39 months of canonical inputs and SHA-256 revisions each time.
Now ONE statement fingerprints exactly the tables a value reads — per table its row count and
the sum of a 64-bit hash of every row's text — and the value is cached under that
fingerprint. Any committed write by any writer (ORM, a Core undo or restore, the importer
CLI, another process, psql) changes it, so a cached value is only ever served for the table
contents it was built from: no event hooks, TTLs or triggers to keep in step.

Three rules keep that promise airtight:

1. Store only if stable. A miss fingerprints again after building and stores only when
   nothing moved. Under READ COMMITTED every statement of the build sees fresh commits, so a
   book built from a state committed mid-build must not be filed under the key taken before
   it — an Undo of that insert (a delete) restores exactly the old key.
2. Pending ORM changes bypass the cache. The uncached loaders' ORM queries autoflush and a
   Core fingerprint does not; a session carrying new, dirty or deleted objects keeps today's
   exact semantics. (Read paths never carry any.)
3. Read paths only. Write paths (month save/close, batch close, adoption) keep the uncached,
   lock-protected `load_review_book`, whose ORM rows they update in place. A cached book
   holds frozen ReviewSnapshot values in read-only mappings — nothing bound to a request's
   session — and is shared between requests, so a caller must treat it as immutable.

Per process, at most CACHE_SIZE entries per value; conftest clears both between tests.
"""

from collections import OrderedDict
from collections.abc import Hashable, Iterable
from datetime import date

from sqlalchemy import TextClause, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Account,
    AccountBalance,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    SpendingCategory,
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


class LRU:
    """A tiny least-recently-used map. No lock: the event loop is the only thread, and two
    requests that miss together just build twice and store equal values."""

    def __init__(self, size: int) -> None:
        self.size = size
        self._entries: OrderedDict[Hashable, object] = OrderedDict()

    def get(self, key: Hashable):
        value = self._entries.get(key)
        if value is not None:
            self._entries.move_to_end(key)
        return value

    def put(self, key: Hashable, value: object) -> None:
        self._entries[key] = value
        self._entries.move_to_end(key)
        while len(self._entries) > self.size:
            self._entries.popitem(last=False)

    def keys(self) -> list[Hashable]:
        return list(self._entries)

    def clear(self) -> None:
        self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)


REVIEW_BOOKS = LRU(CACHE_SIZE)
MONTH_SAVINGS = LRU(CACHE_SIZE)


def clear_read_caches() -> None:
    REVIEW_BOOKS.clear()
    MONTH_SAVINGS.clear()


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


async def _fingerprint(db: AsyncSession, statement: TextClause) -> tuple[str, ...]:
    return tuple((await db.execute(statement)).one())


def _has_pending_changes(db: AsyncSession) -> bool:
    return bool(db.new or db.dirty or db.deleted)


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
    key = (before, today, extras)
    hit = REVIEW_BOOKS.get(key)
    if hit is not None:
        return hit
    book = await load_review_book_snapshot(db, extra_months=list(extras), today=today)
    if await _fingerprint(db, _REVIEW_BOOK_FINGERPRINT) == before:
        REVIEW_BOOKS.put(key, book)
    return book


async def cached_month_savings(db: AsyncSession) -> list[MonthSavings]:
    """`load_month_savings` for READ paths, once per data version of its four tables. The rows
    are frozen dataclasses and the cache keeps a tuple; every caller gets its own list, so
    appending to or sorting an answer can never reach the next request."""
    if _has_pending_changes(db):
        return await load_month_savings(db)
    before = await _fingerprint(db, _MONTH_SAVINGS_FINGERPRINT)
    hit = MONTH_SAVINGS.get(before)
    if hit is not None:
        return list(hit)
    rows = await load_month_savings(db)
    if await _fingerprint(db, _MONTH_SAVINGS_FINGERPRINT) == before:
        MONTH_SAVINGS.put(before, tuple(rows))
    return rows
