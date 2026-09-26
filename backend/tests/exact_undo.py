"""Shared by the exact-undo tests (2026-09-25 polish spec §6.1): what one batch logged, every
row of a table as its change-log image, and the Activity card's Undo. "Exact" means the rows an
Undo puts back are the rows the write took — the same images, ids included — so the tests
compare whole images, never a handful of fields.

A batch is named by its id or by the response of the write that recorded it: `logged` and
`undo` then read its X-Change-Batch header, and a KeyError there IS the finding — the route
answered without it."""

from uuid import UUID

from httpx import Response
from sqlalchemy import select

from app.models import ChangeLog
from app.services.changelog import row_image

ACTIVITY = "/api/v1/activity"


def batch_id_of(batch: str | UUID | Response) -> str:
    """The batch id itself, or the one a logged write's response names in X-Change-Batch."""
    return batch.headers["x-change-batch"] if isinstance(batch, Response) else str(batch)


async def logged(db, batch: str | UUID | Response) -> list[ChangeLog]:
    """The batch's change-log rows in the order the route recorded them."""
    return list(
        (
            await db.execute(
                select(ChangeLog)
                .where(ChangeLog.batch_id == batch_id_of(batch))
                .order_by(ChangeLog.id)
            )
        )
        .scalars()
        .all()
    )


def shape(rows: list[ChangeLog]) -> list[tuple[str, str]]:
    """(op, table) per row — the sequence an Undo replays in reverse."""
    return [(row.op, row.table_name) for row in rows]


def label_of(rows: list[ChangeLog]) -> str:
    """The batch's one label — every row of a batch carries the same."""
    [label] = {row.label for row in rows}
    return label


async def images(db, model) -> list[dict]:
    """Every row of `model` as its change-log image, in primary-key order: the export's JSON
    spellings ("500.00", never Decimal("500")), so even a scale change shows. Read with
    populate_existing, so an instance the shared session still holds answers with what the
    DATABASE holds: an Undo's Core statements bypass the identity map."""
    keys = list(model.__table__.primary_key.columns)
    result = await db.execute(
        select(model).order_by(*keys).execution_options(populate_existing=True)
    )
    return [row_image(row) for row in result.scalars().all()]


async def table_images(db, *models) -> dict[str, list[dict]]:
    """images() for several tables, keyed by table name — one assertion compares them all."""
    return {model.__tablename__: await images(db, model) for model in models}


async def undo(auth_client, batch: str | UUID | Response) -> Response:
    """The Activity card's Undo of the batch."""
    return await auth_client.post(f"{ACTIVITY}/batches/{batch_id_of(batch)}/undo")
