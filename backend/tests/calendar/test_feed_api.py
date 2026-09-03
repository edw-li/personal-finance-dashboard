"""The two ICS routes and the token CRUD (2026-09-03 calendar spec §11, §17): the download
behind the bearer, the feed behind its token, ETag/304, the last-used throttle, the per-IP
ceiling, plaintext-once tokens."""

import hashlib
from datetime import UTC, date, datetime, timedelta

from app.models import CalendarFeedToken

CALENDAR = "/api/v1/calendar"
TODAY = date(2026, 8, 24)


def freeze_today(monkeypatch):
    monkeypatch.setattr("app.api.calendar.product_today", lambda: TODAY)


async def make_token(auth_client, label="phone") -> tuple[int, str]:
    created = await auth_client.post(f"{CALENDAR}/feed-tokens", json={"label": label})
    assert created.status_code == 201, created.text
    return created.json()["id"], created.json()["token"]


# --- export --------------------------------------------------------------------------------


async def test_export_and_tokens_require_auth(client):
    # `client` ALONE, never beside `auth_client`: conftest's auth fixture sets the bearer on
    # this very client, so asking for both would leave nothing unauthenticated to test.
    export = await client.get(f"{CALENDAR}/export.ics?start=2026-08-01&end=2026-08-31")
    assert export.status_code == 401
    assert (await client.get(f"{CALENDAR}/feed-tokens")).status_code == 401
    assert (await client.post(f"{CALENDAR}/feed-tokens", json={"label": "x"})).status_code == 401
    assert (await client.delete(f"{CALENDAR}/feed-tokens/1")).status_code == 401


async def test_export_validates_the_span(auth_client):
    reversed_ = await auth_client.get(f"{CALENDAR}/export.ics?start=2026-08-31&end=2026-08-01")
    assert reversed_.status_code == 422
    too_wide = await auth_client.get(f"{CALENDAR}/export.ics?start=2026-01-01&end=2027-02-06")
    assert too_wide.status_code == 422


async def test_export_returns_the_rendered_window_as_an_attachment(auth_client, monkeypatch):
    freeze_today(monkeypatch)
    await auth_client.post(
        f"{CALENDAR}/events",
        json={"date": "2026-09-12", "label": "Car insurance", "amount": "180", "direction": "out"},
    )
    resp = await auth_client.get(f"{CALENDAR}/export.ics?start=2026-09-01&end=2026-09-30")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/calendar; charset=utf-8"
    assert resp.headers["content-disposition"] == 'attachment; filename="financial-calendar.ics"'
    text = resp.text
    assert text.startswith("BEGIN:VCALENDAR\r\n") and text.endswith("END:VCALENDAR\r\n")
    assert "SUMMARY:Car insurance · -$180.00" in text
    assert "UID:tax:2026-q3:2026-09-15@finance-dashboard" in text


# --- tokens --------------------------------------------------------------------------------


async def test_token_plaintext_is_returned_once_and_only_the_hash_is_stored(auth_client, db):
    token_id, plaintext = await make_token(auth_client, "  phone ")
    assert len(plaintext) >= 32
    row = await db.get(CalendarFeedToken, token_id)
    assert row.token_hash == hashlib.sha256(plaintext.encode()).hexdigest()
    assert row.label == "phone" and row.last_used_at is None and row.created_at is not None
    listed = (await auth_client.get(f"{CALENDAR}/feed-tokens")).json()
    assert listed == [
        {
            "id": token_id,
            "label": "phone",
            "created_at": listed[0]["created_at"],
            "last_used_at": None,
        }
    ]
    assert "token" not in listed[0]


async def test_token_validation_and_revoke(auth_client):
    blank = await auth_client.post(f"{CALENDAR}/feed-tokens", json={"label": "   "})
    assert blank.status_code == 422
    too_long = await auth_client.post(f"{CALENDAR}/feed-tokens", json={"label": "x" * 61})
    assert too_long.status_code == 422
    token_id, _ = await make_token(auth_client)
    assert (await auth_client.delete(f"{CALENDAR}/feed-tokens/{token_id}")).status_code == 204
    assert (await auth_client.delete(f"{CALENDAR}/feed-tokens/{token_id}")).status_code == 404


# --- feed ----------------------------------------------------------------------------------


async def test_feed_404s_for_missing_unknown_and_revoked_tokens(client, auth_client):
    assert (await client.get(f"{CALENDAR}/feed.ics")).status_code == 422  # token is required
    unknown = await client.get(f"{CALENDAR}/feed.ics?token={'z' * 43}")
    assert unknown.status_code == 404 and unknown.json()["detail"] == "feed not found"
    token_id, plaintext = await make_token(auth_client)
    await auth_client.delete(f"{CALENDAR}/feed-tokens/{token_id}")
    assert (await client.get(f"{CALENDAR}/feed.ics?token={plaintext}")).status_code == 404


async def test_feed_serves_the_calendar_with_etag_and_answers_304(
    client, auth_client, db, monkeypatch
):
    freeze_today(monkeypatch)
    await auth_client.post(
        f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "Car insurance"}
    )
    token_id, plaintext = await make_token(auth_client)
    # No bearer on the feed: a calendar app has none.
    del client.headers["Authorization"]
    first = await client.get(f"{CALENDAR}/feed.ics?token={plaintext}")
    assert first.status_code == 200, first.text
    assert first.headers["content-type"] == "text/calendar; charset=utf-8"
    assert first.headers["cache-control"] == "private, max-age=3600"
    etag = first.headers["etag"]
    assert etag == f'"{hashlib.sha256(first.content).hexdigest()}"'
    assert "SUMMARY:Car insurance" in first.text
    # Window: 30 days back, 365 forward — Q3 2026 and Q2 2027 are inside; Q4 2025 is not.
    assert "UID:tax:2026-q3:2026-09-15@" in first.text
    assert "UID:tax:2027-q2:2027-06-15@" in first.text
    assert "UID:tax:2025-q4:2026-01-15@" not in first.text
    unchanged = await client.get(
        f"{CALENDAR}/feed.ics?token={plaintext}", headers={"If-None-Match": etag}
    )
    assert unchanged.status_code == 304 and unchanged.content == b""
    assert unchanged.headers["etag"] == etag
    stale = await client.get(
        f"{CALENDAR}/feed.ics?token={plaintext}", headers={"If-None-Match": '"nope"'}
    )
    assert stale.status_code == 200
    row = await db.get(CalendarFeedToken, token_id)
    assert row.last_used_at is not None


async def test_feed_bumps_last_used_at_most_hourly(client, auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    token_id, plaintext = await make_token(auth_client)
    del client.headers["Authorization"]
    row = await db.get(CalendarFeedToken, token_id)
    recent = datetime.now(UTC) - timedelta(minutes=10)
    row.last_used_at = recent
    await db.commit()
    await client.get(f"{CALENDAR}/feed.ics?token={plaintext}")
    await db.refresh(row)
    assert row.last_used_at == recent  # inside the hour: untouched
    row.last_used_at = datetime.now(UTC) - timedelta(hours=2)
    await db.commit()
    await client.get(f"{CALENDAR}/feed.ics?token={plaintext}")
    await db.refresh(row)
    assert row.last_used_at > recent


async def test_feed_is_rate_limited_per_ip(client):
    for _ in range(60):
        assert (await client.get(f"{CALENDAR}/feed.ics?token={'z' * 43}")).status_code == 404
    assert (await client.get(f"{CALENDAR}/feed.ics?token={'z' * 43}")).status_code == 429
