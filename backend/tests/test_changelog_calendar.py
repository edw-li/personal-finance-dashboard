"""Exact undo for the calendar router (2026-09-25 polish spec §6.1, D1): custom events, the
override overlay and new feed links record their rows in one change batch and answer
X-Change-Batch. Two routes stay unlogged on purpose — the feed's last-used bump and a link's
revoke; tests/test_changelog_pin.py says why."""

from datetime import date

from app.models import CustomEvent
from tests.exact_undo import images, logged, undo

CALENDAR = "/api/v1/calendar"
TODAY = date(2026, 8, 24)


def freeze_today(monkeypatch):
    monkeypatch.setattr("app.services.clock.product_today", lambda: TODAY)


def overlay(done=False, hidden=False, note=None, amount=None) -> dict:
    """An override PUT body — the whole overlay, the house full-replace law."""
    return {"done": done, "hidden": hidden, "note": note, "amount": amount}


# ── custom events ────────────────────────────────────────────────────────────────────


async def test_custom_event_writes_are_logged_with_their_batch(auth_client, db):
    body = {"date": "2026-09-12", "label": "Car insurance", "amount": "180", "direction": "out"}
    created = await auth_client.post(f"{CALENDAR}/events", json=body)
    assert created.status_code == 201, created.text
    path = f"{CALENDAR}/events/{created.json()['id']}"
    [row] = await logged(db, created.headers["x-change-batch"])
    assert (row.op, row.table_name, row.label) == (
        "insert",
        "custom_events",
        "Added calendar event Car insurance",
    )
    renamed = {**body, "label": "Car insurance renewal"}
    edited = await auth_client.patch(path, json=renamed)
    assert edited.status_code == 200, edited.text
    [row] = await logged(db, edited.headers["x-change-batch"])
    assert (row.op, row.label) == ("update", "Edited calendar event Car insurance renewal")
    assert (row.before["label"], row.after["label"]) == ("Car insurance", "Car insurance renewal")
    unchanged = await auth_client.patch(path, json=renamed)
    assert unchanged.status_code == 200 and "x-change-batch" not in unchanged.headers
    deleted = await auth_client.delete(path)
    assert deleted.status_code == 204
    [row] = await logged(db, deleted.headers["x-change-batch"])
    assert (row.op, row.label) == ("delete", "Deleted calendar event Car insurance renewal")


async def test_undoing_a_custom_event_delete_restores_the_row_under_its_id(auth_client, db):
    created = await auth_client.post(
        f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "Car insurance"}
    )
    before = await images(db, CustomEvent)
    deleted = await auth_client.delete(f"{CALENDAR}/events/{created.json()['id']}")
    assert deleted.status_code == 204
    assert await images(db, CustomEvent) == []
    assert (await undo(auth_client, deleted.headers["x-change-batch"])).status_code == 200
    assert await images(db, CustomEvent) == before
