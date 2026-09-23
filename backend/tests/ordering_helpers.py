"""Shared by the reorder-route tests (2026-09-23 drag-to-reorder spec §3.7). "Only changed
rows are written" is a claim about the FLUSH, so the proof listens to the flush; "reorders
serialize" is a claim about two sessions, so the proof runs two."""

import asyncio
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker


@contextmanager
def flushed_updates(db: AsyncSession, model: type) -> Iterator[set[int]]:
    """Inside the block, collect the id of every `model` row the shared test session
    flushes as modified. A row lands in `session.dirty` only when one of its attributes was
    SET, and services.ordering.renumber sets only the rows whose value moves — so this set
    is exactly the rows a reorder request wrote. Attached to the sync session underneath
    the AsyncSession (where ORM events fire) and removed in `finally`, like conftest's
    forbid_writes guard."""
    written: set[int] = set()

    def capture(session, flush_context, instances):
        written.update(row.id for row in session.dirty if isinstance(row, model))

    sync_session = db.sync_session
    event.listen(sync_session, "before_flush", capture)
    try:
        yield written
    finally:
        event.remove(sync_session, "before_flush", capture)


@contextmanager
def recorded_sql(db: AsyncSession) -> Iterator[list[tuple[str, object]]]:
    """Every statement the test engine sends while the block runs, as (sql, parameters) —
    the only proof that a lock came BEFORE a read, which no result can show. Listens on
    the sync engine under the shared session's AsyncEngine; removed in `finally`."""
    statements: list[tuple[str, object]] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append((statement, parameters))

    engine = db.bind.sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


def lock_position(statements: list[tuple[str, object]], table: str) -> int:
    """Where the list's order lock (services.ordering.order_lock) was taken; fails the test
    when it never was."""
    key = f"reorder:{table}"
    hits = [
        index
        for index, (sql, parameters) in enumerate(statements)
        if "pg_advisory_xact_lock" in sql and key in (parameters or ())
    ]
    assert hits, f"the {key!r} lock was never taken"
    return hits[0]


def first_position(statements: list[tuple[str, object]], fragment: str) -> int:
    """The first statement whose SQL contains `fragment`; fails the test when none does."""
    hits = [index for index, (sql, _) in enumerate(statements) if fragment in sql]
    assert hits, f"no statement contained {fragment!r}"
    return hits[0]


class GatedSession(AsyncSession):
    """A session whose COMMIT waits at a gate: the request running on it has taken its locks,
    read and changed its rows, and stands still right before committing until the test
    opens the gate. Nothing is flushed before the gate for a reorder, so the gated request
    holds no row locks — only whatever advisory lock its route took."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.at_commit = asyncio.Event()
        self.gate = asyncio.Event()

    async def commit(self) -> None:
        self.at_commit.set()
        await self.gate.wait()
        await super().commit()


# How long a race may take before it is a hang, not a slow machine.
RACE_SECONDS = 30.0

# A session of THIS database waiting for an advisory lock another one holds.
WAITING_FOR_A_LOCK = text(
    "SELECT count(*) FROM pg_locks JOIN pg_database ON pg_database.oid = pg_locks.database "
    "WHERE pg_locks.locktype = 'advisory' AND NOT pg_locks.granted "
    "AND pg_database.datname = current_database()"
)


async def race[A, B](
    engine: AsyncEngine,
    first: Callable[[AsyncSession], Awaitable[A]],
    second: Callable[[AsyncSession], Awaitable[B]],
) -> tuple[A, B]:
    """Two requests on two sessions, interleaved the way two browser tabs can: `first` runs
    until it stands at COMMIT, then `second` starts. The gate opens once `second` has either
    finished (nothing held it back — the unserialized interleaving) or is waiting for an
    advisory lock (serialized). Both results come back; either one's exception propagates.
    Deterministic both ways — no sleep decides anything."""
    gated = async_sessionmaker(engine, class_=GatedSession, expire_on_commit=False)
    plain = async_sessionmaker(engine, expire_on_commit=False)
    loop = asyncio.get_running_loop()
    async with gated() as first_session, plain() as second_session, plain() as watcher:
        first_task = asyncio.create_task(first(first_session))
        at_commit = asyncio.create_task(first_session.at_commit.wait())
        second_task: asyncio.Task[B] | None = None
        try:
            done, _ = await asyncio.wait(
                {first_task, at_commit}, timeout=RACE_SECONDS, return_when=asyncio.FIRST_COMPLETED
            )
            if first_task in done:
                first_task.result()  # it failed before COMMIT: say how
                raise AssertionError("the first request finished without reaching COMMIT")
            assert at_commit in done, "the first request never reached COMMIT"
            second_task = asyncio.create_task(second(second_session))
            deadline = loop.time() + RACE_SECONDS
            while not second_task.done():
                if (await watcher.execute(WAITING_FOR_A_LOCK)).scalar_one():
                    break
                assert loop.time() < deadline, "the second request neither finished nor waited"
                await asyncio.sleep(0.02)
            first_session.gate.set()
            first_result = await asyncio.wait_for(first_task, RACE_SECONDS)
            second_result = await asyncio.wait_for(second_task, RACE_SECONDS)
            return first_result, second_result
        finally:
            # A failed race must not leave a request running on a session that is closing.
            first_session.gate.set()
            pending = [
                task
                for task in (at_commit, first_task, second_task)
                if task is not None and not task.done()
            ]
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
