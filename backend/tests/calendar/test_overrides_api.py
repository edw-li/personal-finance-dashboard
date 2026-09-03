"""PUT/DELETE /calendar/overrides/{key} (2026-09-03 calendar spec §13) and the overlay
riding GET /calendar."""

from datetime import date

from sqlalchemy import select

from app.models import CalendarEventOverride, NetWorthSnapshot

CALENDAR = "/api/v1/calendar"
Q3 = "tax:2026-q3:2026-09-15"


def freeze_today(monkeypatch):
    monkeypatch.setattr("app.api.calendar.product_today", lambda: date(2026, 8, 24))


async def test_a_negative_override_amount_is_refused(auth_client):
    """`direction` carries the sign on a generated event too — "your figure" may be zero
    but never negative."""
    resp = await auth_client.put(
        f"{CALENDAR}/overrides/{Q3}",
        json={"done": False, "hidden": False, "note": None, "amount": "-1"},
    )
    assert resp.status_code == 422


async def test_put_upserts_full_replace_and_get_applies_it(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    db.add(NetWorthSnapshot(month=date(2026, 7, 1)))
    await db.commit()
    first = await auth_client.put(
        f"{CALENDAR}/overrides/{Q3}",
        json={"done": True, "hidden": False, "note": " paid ", "amount": "1250"},
    )
    assert first.status_code == 200, first.text
    assert first.json() == {
        "key": Q3,
        "done": True,
        "hidden": False,
        "note": "paid",
        "amount": "1250.00",
    }
    [q3] = [
        e
        for e in (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()[
            "events"
        ]
        if e["key"] == Q3
    ]
    assert (q3["done"], q3["note"], q3["amount"], q3["basis"], q3["amount_overridden"]) == (
        True,
        "paid",
        "1250.00",
        "confirmed",
        True,
    )

    # Full replace: a second PUT without the amount CLEARS it (and the row is reused).
    second = await auth_client.put(
        f"{CALENDAR}/overrides/{Q3}",
        json={"done": False, "hidden": True, "note": None, "amount": None},
    )
    assert second.json() == {
        "key": Q3,
        "done": False,
        "hidden": True,
        "note": None,
        "amount": None,
    }
    rows = (await db.execute(select(CalendarEventOverride))).scalars().all()
    assert len(rows) == 1 and rows[0].done_at is None and rows[0].hidden is True
    [q3] = [
        e
        for e in (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()[
            "events"
        ]
        if e["key"] == Q3
    ]
    assert (q3["hidden"], q3["amount"], q3["amount_overridden"]) == (True, None, False)


async def test_delete_clears_and_404s_when_unknown(auth_client):
    await auth_client.put(
        f"{CALENDAR}/overrides/{Q3}",
        json={"done": True, "hidden": False, "note": None, "amount": None},
    )
    assert (await auth_client.delete(f"{CALENDAR}/overrides/{Q3}")).status_code == 204
    assert (await auth_client.delete(f"{CALENDAR}/overrides/{Q3}")).status_code == 404


async def test_key_grammar_is_validated(auth_client):
    body = {"done": True, "hidden": False, "note": None, "amount": None}
    assert (await auth_client.put(f"{CALENDAR}/overrides/nokey", json=body)).status_code == 422
    assert (
        await auth_client.put(f"{CALENDAR}/overrides/RSU:vest:2026-09-16", json=body)
    ).status_code == 422
    assert (
        await auth_client.put(f"{CALENDAR}/overrides/rsu:vest:2026-9-16", json=body)
    ).status_code == 422
    assert (
        await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json={**body, "note": "x" * 301})
    ).status_code == 422
    assert (
        await auth_client.put(f"{CALENDAR}/overrides/{Q3}", json={**body, "amount": "1e15"})
    ).status_code == 422


async def test_an_orphan_override_is_harmless(auth_client, monkeypatch):
    freeze_today(monkeypatch)
    assert (
        await auth_client.put(
            f"{CALENDAR}/overrides/rsu:vest:2099-01-01",
            json={"done": True, "hidden": True, "note": None, "amount": None},
        )
    ).status_code == 200
    assert (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).status_code == 200


async def test_overrides_require_auth(client):
    assert (
        await client.put(
            f"{CALENDAR}/overrides/{Q3}",
            json={"done": True, "hidden": False, "note": None, "amount": None},
        )
    ).status_code == 401
