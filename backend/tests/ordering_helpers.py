"""Shared by the reorder-route tests (2026-09-23 drag-to-reorder spec §3.7). "Only changed
rows are written" is a claim about the FLUSH, so the proof listens to the flush."""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession


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
