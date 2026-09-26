"""Exact undo for the calendar router (2026-09-25 polish spec §6.1, D1): custom events, the
override overlay and new feed links record their rows in one change batch and answer
X-Change-Batch. Two routes stay unlogged on purpose — the feed's last-used bump and a link's
revoke; tests/test_changelog_pin.py says why."""

from datetime import date

from sqlalchemy import func, select, text

from app.api import calendar as calendar_api
from app.api.calendar import _override_label
from app.models import (
    CalendarEventOverride,
    CalendarFeedToken,
    ChangeLog,
    CustomEvent,
    NetWorthSnapshot,
)
from app.services.changelog import REPLAY_REFUSAL
from tests.exact_undo import images, logged, undo

CALENDAR = "/api/v1/calendar"
TODAY = date(2026, 8, 24)
Q3 = "tax:2026-q3:2026-09-15"
Q3_NAME = "Tax deadline — Q3 estimated payment of Sep 15, 2026"


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


# ── overrides ────────────────────────────────────────────────────────────────────────


def test_an_override_label_names_the_one_verb_that_changed():
    name = "Payday of Sep 15, 2026"
    blank = {"done_at": None, "hidden": False, "note": None, "amount": None}
    done = {**blank, "done_at": "2026-09-15T16:00:00+00:00"}
    cases = [
        (None, done, f"Marked {name} done"),  # a first PUT is judged against the defaults
        (done, blank, f"Reopened {name}"),
        (blank, {**blank, "hidden": True}, f"Hid {name}"),
        ({**blank, "hidden": True}, blank, f"Unhid {name}"),
        # "Your figure" carries its note: the figure is the verb.
        (blank, {**blank, "amount": "2750.00", "note": "bonus"}, f"Set your figure for {name}"),
        ({**blank, "amount": "2750.00"}, blank, f"Cleared your figure for {name}"),
        (blank, {**blank, "note": "direct deposit"}, f"Edited the note on {name}"),
        (blank, {**done, "hidden": True}, f"Edited {name}"),  # two verbs at once
    ]
    for before, after, label in cases:
        assert _override_label(before, after, name) == label


async def test_an_override_that_creates_its_row_is_an_insert_its_undo_removes(
    auth_client, db, monkeypatch
):
    freeze_today(monkeypatch)
    hidden = await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json=overlay(hidden=True))
    assert hidden.status_code == 200, hidden.text
    batch_id = hidden.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.table_name, row.label) == (
        "insert",
        "calendar_event_overrides",
        f"Hid {Q3_NAME}",
    )
    # updated_at is the server's: the route read the row back before imaging it.
    assert row.after["event_key"] == Q3 and row.after["updated_at"] is not None
    assert (await undo(auth_client, batch_id)).status_code == 200
    assert await images(db, CalendarEventOverride) == []


async def test_an_override_that_changes_its_row_undoes_to_the_previous_overlay(
    auth_client, db, monkeypatch
):
    freeze_today(monkeypatch)
    done = await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json=overlay(done=True))
    [row] = await logged(db, done.headers["x-change-batch"])
    assert row.label == f"Marked {Q3_NAME} done"
    after_done = await images(db, CalendarEventOverride)
    figure_body = overlay(done=True, note="paid online", amount="1250")
    figure = await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json=figure_body)
    assert figure.status_code == 200, figure.text
    batch_id = figure.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.label) == ("update", f"Set your figure for {Q3_NAME}")
    assert (row.before["amount"], row.after["amount"]) == (None, "1250.00")
    # The same overlay again is no change: nothing logged, no header.
    again = await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json=figure_body)
    assert again.status_code == 200 and "x-change-batch" not in again.headers
    assert (await undo(auth_client, batch_id)).status_code == 200
    assert await images(db, CalendarEventOverride) == after_done  # done_at, updated_at too


async def test_clearing_an_override_is_logged_and_undoes_exactly(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json=overlay(done=True, note="paid"))
    before = await images(db, CalendarEventOverride)
    cleared = await auth_client.delete(f"{CALENDAR}/overrides/{Q3}")
    assert cleared.status_code == 204
    batch_id = cleared.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.label) == ("delete", f"Cleared your edits on {Q3_NAME}")
    assert (await undo(auth_client, batch_id)).status_code == 200
    assert await images(db, CalendarEventOverride) == before


async def test_a_restored_custom_event_meets_its_override_again(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    created = await auth_client.post(
        f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "Car insurance"}
    )
    event_id = created.json()["id"]
    key = f"custom:{event_id}:2026-09-12"
    noted = await auth_client.put(f"{CALENDAR}/overrides/{key}", json=overlay(note="renewed"))
    [row] = await logged(db, noted.headers["x-change-batch"])
    assert row.label == "Edited the note on Car insurance of Sep 12, 2026"
    deleted = await auth_client.delete(f"{CALENDAR}/events/{event_id}")

    async def september() -> list[dict]:
        body = (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()
        return [event for event in body["events"] if event["type"] == "custom"]

    assert await september() == []
    assert (await undo(auth_client, deleted.headers["x-change-batch"])).status_code == 200
    # The same id, so the override keyed by it matches again.
    [event] = await september()
    assert (event["id"], event["key"], event["note"]) == (event_id, key, "renewed")


async def test_an_overdue_monthly_reminder_is_named_from_the_day_it_sits_on(
    auth_client, db, monkeypatch
):
    """Nothing entered since July: the Aug 1 reminder is overdue on Aug 24, so the calendar
    shows it TODAY while its key keeps Aug 1 — the name's window has to run on to today."""
    freeze_today(monkeypatch)
    db.add(NetWorthSnapshot(month=date(2026, 7, 1), recorded_on=date(2026, 7, 1)))
    await db.commit()
    done = await auth_client.put(
        f"{CALENDAR}/overrides/ritual:2026-07:2026-08-01", json=overlay(done=True)
    )
    assert done.status_code == 200, done.text
    [row] = await logged(db, done.headers["x-change-batch"])
    assert row.label == (
        "Marked Monthly update — Aug 1 balances · July spending & take-home of Aug 1, 2026 done"
    )


async def test_a_key_no_event_carries_is_named_by_the_key(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    for key in ("rsu:vest:2099-01-01", "tax:2026-q3:2026-02-30"):  # no grant; no such day
        resp = await auth_client.put(f"{CALENDAR}/overrides/{key}", json=overlay(hidden=True))
        assert resp.status_code == 200, resp.text
        [row] = await logged(db, resp.headers["x-change-batch"])
        assert row.label == f"Hid calendar event {key}"


async def test_keys_at_the_ends_of_the_calendar_still_take_their_override(
    auth_client, db, monkeypatch
):
    """KEY_RE admits any four-digit year, and the generators cannot step past year 1 or 9999.
    Such a key is named by the key — and saved, exactly as it was before overrides had labels."""
    freeze_today(monkeypatch)
    for key in ("tax:2026-q3:9999-12-31", "custom:1:0001-01-01"):
        resp = await auth_client.put(f"{CALENDAR}/overrides/{key}", json=overlay(hidden=True))
        assert resp.status_code == 200, resp.text
        [row] = await logged(db, resp.headers["x-change-batch"])
        assert row.label == f"Hid calendar event {key}"


async def test_an_event_that_cannot_be_named_still_takes_its_override(auth_client, db, monkeypatch):
    """The name is a nicety. A loader that fails — here with a database error, which would abort
    the write's own transaction but for the savepoint — costs the label its event name, never
    the write."""
    freeze_today(monkeypatch)

    async def failing_compose(session, *_args, **_kwargs):
        await session.execute(text("SELECT 1 / 0"))

    monkeypatch.setattr(calendar_api, "_compose_for", failing_compose)
    hidden = await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json=overlay(hidden=True))
    assert hidden.status_code == 200, hidden.text
    [row] = await logged(db, hidden.headers["x-change-batch"])
    assert row.label == f"Hid calendar event {Q3}"
    cleared = await auth_client.delete(f"{CALENDAR}/overrides/{Q3}")
    assert cleared.status_code == 204, cleared.text
    [row] = await logged(db, cleared.headers["x-change-batch"])
    assert row.label == f"Cleared your edits on calendar event {Q3}"
    assert await images(db, CalendarEventOverride) == []  # both writes went through


# ── feed links ───────────────────────────────────────────────────────────────────────


async def test_a_new_feed_link_is_logged_without_its_hash_and_undo_takes_it_back(
    auth_client, db, monkeypatch
):
    freeze_today(monkeypatch)
    created = await auth_client.post(f"{CALENDAR}/feed-tokens", json={"label": " Phone "})
    assert created.status_code == 201, created.text
    plaintext = created.json()["token"]
    batch_id = created.headers["x-change-batch"]
    [row] = await logged(db, batch_id)
    assert (row.op, row.table_name, row.label) == (
        "insert",
        "calendar_feed_tokens",
        "Created calendar feed link Phone",
    )
    # The credential never sits in the log, not even as its hash.
    assert "token_hash" not in row.after and row.after["label"] == "Phone"
    undone = await undo(auth_client, batch_id)
    assert undone.status_code == 200, undone.text
    assert await images(db, CalendarFeedToken) == []
    assert (await auth_client.get(f"{CALENDAR}/feed.ics?token={plaintext}")).status_code == 404
    # Undoing that Undo would need the hash back; it refuses rather than revive the link.
    revived = await undo(auth_client, undone.json()["batch_id"])
    assert revived.status_code == 409, revived.text
    assert revived.json()["detail"] == REPLAY_REFUSAL
    await db.rollback()
    assert await images(db, CalendarFeedToken) == []


async def test_the_feed_bump_and_a_revoke_log_nothing(auth_client, db, monkeypatch):
    """The two exempt routes (tests/test_changelog_pin.py says why)."""
    freeze_today(monkeypatch)
    created = await auth_client.post(f"{CALENDAR}/feed-tokens", json={"label": "Phone"})
    token_id, plaintext = created.json()["id"], created.json()["token"]
    count = select(func.count()).select_from(ChangeLog)
    logged_before = (await db.execute(count)).scalar_one()
    feed = await auth_client.get(f"{CALENDAR}/feed.ics?token={plaintext}")
    assert feed.status_code == 200 and "x-change-batch" not in feed.headers
    assert (await db.get(CalendarFeedToken, token_id)).last_used_at is not None  # it did write
    revoked = await auth_client.delete(f"{CALENDAR}/feed-tokens/{token_id}")
    assert revoked.status_code == 204 and "x-change-batch" not in revoked.headers
    assert (await db.execute(count)).scalar_one() == logged_before
