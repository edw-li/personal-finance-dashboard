"""Shared by the exact-undo tests (2026-09-25 polish spec §6.1): what one batch logged, every
row of a table as its change-log image, and the Undo round trip. "Exact" means the rows an
Undo puts back are the rows the delete took — the same images, ids included — so the tests
compare whole images, never a handful of fields."""

from sqlalchemy import select

from app.models import ChangeLog
from app.services.changelog import row_image

ACTIVITY = "/api/v1/activity"


async def logged(db, batch_id: str) -> list[ChangeLog]:
    """The batch's change-log rows in the order the route recorded them."""
    return list(
        (
            await db.execute(
                select(ChangeLog).where(ChangeLog.batch_id == batch_id).order_by(ChangeLog.id)
            )
        )
        .scalars()
        .all()
    )


def shape(rows: list[ChangeLog]) -> list[tuple[str, str]]:
    """(op, table) per row — the sequence an Undo replays in reverse."""
    return [(row.op, row.table_name) for row in rows]


async def images(db, model) -> list[dict]:
    """Every row of `model` as its change-log image, in primary-key order. Read with
    populate_existing, so an instance the shared session still holds answers with what the
    DATABASE holds: an Undo's Core statements bypass the identity map."""
    keys = list(model.__table__.primary_key.columns)
    result = await db.execute(
        select(model).order_by(*keys).execution_options(populate_existing=True)
    )
    return [row_image(row) for row in result.scalars().all()]


async def undo(auth_client, batch_id: str):
    return await auth_client.post(f"{ACTIVITY}/batches/{batch_id}/undo")
