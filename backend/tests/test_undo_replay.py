"""How an Undo writes its re-inserts (2026-09-25 polish L3c): consecutive re-inserts into one
table go out together (changelog._reinsert), but a run splits where the images' columns differ —
an image logged before a column existed takes the column's default in a statement of its own —
and below asyncpg's bind-parameter limit (changelog.REINSERT_PARAMETERS)."""

from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from app.models import CalendarEventOverride, ChangeLog, PriceHistory, Security
from app.services import changelog
from app.services.changelog import row_image
from tests.exact_undo import images, undo
from tests.ordering_helpers import recorded_sql


def inserts_into(statements: list[tuple[str, object]], table: str) -> list[tuple[str, object]]:
    return [(sql, params) for sql, params in statements if sql.startswith(f"INSERT INTO {table} ")]


async def test_a_run_splits_where_the_images_columns_differ(auth_client, db):
    """A hand-made delete batch: two calendar overrides, the second imaged without updated_at
    (as a delete logged before that column existed would be). Replayed in reverse, the ragged
    image comes first — and one multi-row INSERT takes its columns from its first row, so the
    whole image's updated_at would be dropped without a word and the server's now() written in
    its place. Split, the whole image comes back exactly and the ragged one takes the server's
    default in a statement of its own."""
    overrides = [
        CalendarEventOverride(event_key=key, hidden=True, note=note)
        for key, note in (("tax:2026-q3:2026-09-15", "paid early"), ("custom:1:2026-10-01", None))
    ]
    db.add_all(overrides)
    await db.flush()
    await db.refresh(overrides[0])  # updated_at is the server's
    await db.refresh(overrides[1])
    whole, ragged = (row_image(override) for override in overrides)
    del ragged["updated_at"]
    batch_id = uuid4()
    for image in (whole, ragged):
        db.add(
            ChangeLog(
                batch_id=batch_id,
                source="ui",
                actor="me@example.com",
                label="Cleared your edits on two events",
                table_name="calendar_event_overrides",
                pk={"id": image["id"]},
                op="delete",
                before=image,
                after=None,
            )
        )
    for override in overrides:
        await db.delete(override)
    await db.commit()
    with recorded_sql(db) as statements:
        resp = await undo(auth_client, batch_id)
    assert resp.status_code == 200, resp.text
    assert len(inserts_into(statements, "calendar_event_overrides")) == 2
    restored = await images(db, CalendarEventOverride)
    assert restored[0] == whole
    assert {**restored[1], "updated_at": None} == {**ragged, "updated_at": None}
    assert restored[1]["updated_at"] is not None  # the server's default


async def test_a_run_splits_below_the_parameter_limit(auth_client, db, monkeypatch):
    """Five closes of four columns each, with room for ten parameters a statement: two rows a
    statement, so three statements — and every close back exactly, ids included."""
    monkeypatch.setattr(changelog, "REINSERT_PARAMETERS", 10)
    security = Security(ticker="VOO", name="Vanguard S&P 500 ETF", holding_type="etf")
    db.add(security)
    await db.flush()
    db.add_all(
        [
            PriceHistory(
                security_id=security.id,
                price_date=date(2026, 9, 1) + timedelta(days=day),
                close=Decimal("540.0000") + day,
            )
            for day in range(5)
        ]
    )
    await db.commit()
    before = await images(db, PriceHistory)
    deleted = await auth_client.delete(f"/api/v1/portfolio/securities/{security.id}")
    assert deleted.status_code == 204, deleted.text
    with recorded_sql(db) as statements:
        restored = await undo(auth_client, deleted)
    assert restored.status_code == 200, restored.text
    closes = inserts_into(statements, "price_history")
    assert [len(params) for _, params in closes] == [8, 8, 4]
    assert await images(db, PriceHistory) == before
