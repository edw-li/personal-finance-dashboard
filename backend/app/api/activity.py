"""Activity — the change log and the run trail as one feed, with Undo (2026-09-03
data-lifecycle spec §9). Reads only, except the undo, which is a write like any other and
therefore its own batch. Paging is by instant: `before` is the previous page's
next_before — the two sources have separate id spaces, so a shared id cursor would not be
well-defined."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import ChangeLog, LifecycleRun, User
from app.schemas.lifecycle import (
    ActivityBatchOut,
    ActivityOut,
    ActivityRunDetailOut,
    ActivityRunOut,
)
from app.services.changelog import (
    REPLAY_REFUSAL,
    UNDOABLE_SOURCES,
    UndoRefused,
    superseded,
    undo_batch,
    undone_by,
)

router = APIRouter(prefix="/activity", tags=["activity"], dependencies=[Depends(get_current_user)])


def _run_out(run: LifecycleRun) -> ActivityRunOut:
    return ActivityRunOut(
        run_id=run.id,
        at=run.at,
        kind=run.kind,
        ok=run.ok,
        dry_run=run.dry_run,
        filename=run.filename,
        size_bytes=run.size_bytes,
        has_report=run.report is not None,
    )


@router.get("", response_model=ActivityOut)
async def activity(
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    before: Annotated[datetime | None, Query()] = None,
    db: AsyncSession = Depends(get_db),
) -> ActivityOut:
    first_at = func.min(ChangeLog.at)
    batch_q = (
        select(
            ChangeLog.batch_id,
            first_at.label("at"),
            func.min(ChangeLog.source).label("source"),
            func.min(ChangeLog.actor).label("actor"),
            func.min(ChangeLog.label).label("label"),
            func.min(ChangeLog.month).label("month"),
            func.count().filter(ChangeLog.op != "batch").label("rows"),
        )
        .group_by(ChangeLog.batch_id)
        .order_by(first_at.desc())
        .limit(limit + 1)
    )
    # limit + 1 on BOTH sources, then trim: `more` has to mean "the trail continues", and
    # one source alone can fill the page (four batches and no runs at limit=2), which a
    # plain .limit(limit) makes indistinguishable from an exactly-exhausted trail.
    run_q = (
        select(LifecycleRun)
        .order_by(LifecycleRun.at.desc(), LifecycleRun.id.desc())
        .limit(limit + 1)
    )
    if before is not None:
        batch_q = batch_q.having(first_at < before)
        run_q = run_q.where(LifecycleRun.at < before)
    batches = (await db.execute(batch_q)).all()
    runs = (await db.execute(run_q)).scalars().all()
    batch_ids = [b.batch_id for b in batches]
    undone = await undone_by(db, batch_ids)
    # Page-wide, not per row: the two id-ordering refusals undo_batch would raise.
    stale = await superseded(db, batch_ids)
    entries: list[ActivityBatchOut | ActivityRunOut] = [
        ActivityBatchOut(
            batch_id=b.batch_id,
            at=b.at,
            source=b.source,
            actor=b.actor,
            label=b.label,
            month=b.month,
            rows=b.rows,
            undoable=(
                b.source in UNDOABLE_SOURCES
                and b.rows > 0
                and b.batch_id not in undone
                and b.batch_id not in stale
            ),
            undone_by=undone.get(b.batch_id),
        )
        for b in batches
    ]
    entries.extend(_run_out(run) for run in runs)
    entries.sort(key=lambda entry: entry.at, reverse=True)
    more = len(batches) + len(runs) > limit
    page = entries[:limit]
    return ActivityOut(entries=page, next_before=page[-1].at if more and page else None)


@router.get("/runs/{run_id}", response_model=ActivityRunDetailOut)
async def activity_run(run_id: int, db: AsyncSession = Depends(get_db)) -> ActivityRunDetailOut:
    run = await db.get(LifecycleRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="no such run")
    return ActivityRunDetailOut(run=_run_out(run), report=run.report)


@router.post("/batches/{batch_id}/undo", response_model=ActivityBatchOut)
async def undo(
    batch_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ActivityBatchOut:
    actor = user.email  # before undo_batch expunges the session
    try:
        new_id = await undo_batch(db, batch_id, actor=actor)
    except UndoRefused as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    except IntegrityError:
        # A replay can meet a constraint no pre-check can see: re-inserting a deleted row
        # whose parent has since gone, or an old value a unique index now rejects. That is a
        # refusal, not a server fault — and the rollback leaves the session usable.
        await db.rollback()
        raise HTTPException(status_code=409, detail=REPLAY_REFUSAL) from None
    rows = (
        (
            await db.execute(
                select(ChangeLog).where(ChangeLog.batch_id == new_id).order_by(ChangeLog.id)
            )
        )
        .scalars()
        .all()
    )
    return ActivityBatchOut(
        batch_id=new_id,
        at=rows[0].at,
        source="undo",
        actor=actor,
        label=rows[0].label,
        month=rows[0].month,
        rows=len(rows),
        undoable=True,
        undone_by=None,
    )
