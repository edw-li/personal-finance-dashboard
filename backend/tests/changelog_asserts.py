"""Shared by lane L3b's change-log tests (2026-09-25 polish spec §6.1): the change-log rows of
the batch one logged write named in its X-Change-Batch header, and every row of a table as the
DATABASE holds it — so an Undo can be held to "the same rows, ids included"."""

from sqlalchemy import select

from app.models import ChangeLog

ACTIVITY = "/api/v1/activity"


async def logged(db, response) -> list[ChangeLog]:
    """The rows of the batch `response` names, in the order they were recorded. A KeyError
    here IS the finding: the route answered without the header."""
    batch_id = response.headers["x-change-batch"]
    return list(
        (
            await db.execute(
                select(ChangeLog).where(ChangeLog.batch_id == batch_id).order_by(ChangeLog.id)
            )
        )
        .scalars()
        .all()
    )


def ops(rows: list[ChangeLog]) -> list[tuple[str, str]]:
    return [(row.op, row.table_name) for row in rows]


def label_of(rows: list[ChangeLog]) -> str:
    """The batch's one label — every row of a batch carries the same."""
    [label] = {row.label for row in rows}
    return label


async def table_rows(db, *models) -> dict[str, list[dict]]:
    """Every row of each model's table in primary-key order, read with a Core SELECT — never
    through the session's identity map, which can still hold objects a route deleted or an
    undo replaced behind it."""
    out: dict[str, list[dict]] = {}
    for model in models:
        table = model.__table__
        result = await db.execute(select(table).order_by(*table.primary_key.columns))
        out[table.name] = [dict(row._mapping) for row in result]
    return out


async def undo(auth_client, response):
    """The Activity card's Undo of the batch `response` names."""
    return await auth_client.post(f"{ACTIVITY}/batches/{response.headers['x-change-batch']}/undo")
