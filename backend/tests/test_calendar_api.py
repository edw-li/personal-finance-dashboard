"""Endpoint tests: loading + validation + the GET-never-rejects law. Composition RULES
are pinned in test_calendar_events.py — here each type appears once to prove its loader
(the fold's held-filter, the sold-lot filter, the cadence gate, the snapshot probe)."""

from datetime import date
from decimal import Decimal

from app.models import (
    EsppLot,
    EsppOffering,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    PositionTransaction,
    RsuGrant,
    Security,
)

CALENDAR = "/api/v1/calendar"
TODAY = date(2026, 8, 24)  # a Monday; the router's clock is product_today()


def freeze_today(monkeypatch):
    # The router imports the name, so the patch lands on app.api.calendar (the
    # test_prices_api freeze_service_today precedent).
    monkeypatch.setattr("app.api.calendar.product_today", lambda: TODAY)


async def seed_primary(db) -> Person:
    """paycheck_profiles.person_id is NOT NULL and `create_all` seeds no roster."""
    person = Person(name="Me", is_primary=True)
    db.add(person)
    await db.flush()
    return person


async def test_calendar_requires_auth(client):
    resp = await client.get(f"{CALENDAR}?start=2026-08-01&end=2026-10-31")
    assert resp.status_code == 401


async def test_calendar_validates_the_span(auth_client):
    reversed_ = await auth_client.get(f"{CALENDAR}?start=2026-10-31&end=2026-08-01")
    assert reversed_.status_code == 422
    assert "start must be on or before end" in reversed_.json()["detail"]
    too_long = await auth_client.get(f"{CALENDAR}?start=2026-01-01&end=2027-02-06")
    assert too_long.status_code == 422
    assert "400 days" in too_long.json()["detail"]
    # 400 days exactly is allowed (<=, not <) — 2026-01-01 + 400d = 2027-02-05.
    boundary = await auth_client.get(f"{CALENDAR}?start=2026-01-01&end=2027-02-05")
    assert boundary.status_code == 200
    missing_end = await auth_client.get(f"{CALENDAR}?start=2026-01-01")
    assert missing_end.status_code == 422  # both params are required


async def test_calendar_composes_the_whole_household_datebook(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    # RSU: 400 sh @ 25% cliff from Mar 18 2026 — the Sep 16 quarterly lands in range.
    db.add(
        RsuGrant(
            kind="new_hire",
            label="2025 offer",
            focal_year=None,
            shares=400,
            grant_price=Decimal("100"),
            first_vest_date=date(2026, 3, 18),
            cliff_pct=Decimal("0.25"),
            vest_quantum=1,
        )
    )
    # A hand-edited grant the scheduler refuses — must degrade, never 500 (house law).
    db.add(
        RsuGrant(
            kind="refresh",
            label="broken",
            focal_year=None,
            shares=100,
            grant_price=Decimal("100"),
            first_vest_date=date(2026, 9, 16),
            cliff_pct=Decimal("0.30"),
            vest_quantum=1,
        )
    )
    # ESPP: one unsold lot qualifying in range, one SOLD lot (excluded), one offering
    # starting in range.
    db.add(
        EsppLot(
            purchase_date=date(2024, 8, 30),
            qualifying_date=date(2026, 9, 1),
            shares=Decimal("10"),
            subscription_price=Decimal("48.509"),
            purchase_fmv=Decimal("120"),
            purchase_price=Decimal("41.23265"),
        )
    )
    db.add(
        EsppLot(
            purchase_date=date(2024, 2, 29),
            qualifying_date=date(2026, 8, 28),
            shares=Decimal("10"),
            subscription_price=Decimal("48.509"),
            purchase_fmv=Decimal("120"),
            purchase_price=Decimal("41.23265"),
            sold_date=date(2025, 1, 2),
            sold_price=Decimal("130"),
        )
    )
    db.add(EsppOffering(offering_start=date(2026, 9, 1), subscription_price=Decimal("120")))
    # Ex-dividends: NVDA is held; GHOST has no position; GONE was fully sold out.
    nvda = Security(
        ticker="NVDA",
        name="NVDA Inc",
        holding_type="stock",
        next_ex_div_date=date(2026, 9, 3),
    )
    ghost = Security(
        ticker="GHOST",
        name="Ghost",
        holding_type="stock",
        next_ex_div_date=date(2026, 9, 10),
    )
    gone = Security(
        ticker="GONE",
        name="Gone",
        holding_type="stock",
        next_ex_div_date=date(2026, 9, 11),
    )
    db.add_all([nvda, ghost, gone])
    await db.flush()
    db.add(
        PositionTransaction(
            security_id=nvda.id,
            account="RH Taxable",
            type="buy",
            shares=Decimal("10"),
            price=Decimal("100"),
            sort_index=10,
        )
    )
    db.add(
        PositionTransaction(
            security_id=gone.id,
            account="RH Taxable",
            type="buy",
            shares=Decimal("5"),
            price=Decimal("100"),
            sort_index=20,
        )
    )
    db.add(
        PositionTransaction(
            security_id=gone.id,
            account="RH Taxable",
            type="sell",
            shares=Decimal("5"),
            price=Decimal("110"),
            sort_index=30,
        )
    )
    # Semi-monthly profile (model default pay_periods_per_year=24) -> paydays; a June
    # snapshot exists but July 2026 does not -> update_due.
    db.add(
        PaycheckProfile(
            person_id=(await seed_primary(db)).id,
            effective_date=date(2026, 1, 1),
            annual_salary=Decimal("120000"),
        )
    )
    db.add(NetWorthSnapshot(month=date(2026, 6, 1)))
    await db.commit()

    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-09-30")
    assert resp.status_code == 200
    events = resp.json()["events"]
    by_type: dict[str, list[dict]] = {}
    for event in events:
        by_type.setdefault(event["type"], []).append(event)

    assert [(e["date"], e["detail"]) for e in by_type["rsu_vest"]] == [
        ("2026-09-16", "25 sh — 2025 offer")
    ]  # the broken grant is silently absent — that absence IS the degradation
    assert [(e["date"], e["label"]) for e in by_type["espp_qualify"]] == [
        ("2026-09-01", "ESPP lot qualifies — 2024-08-30")
    ]  # the sold lot contributes nothing
    # Numeric(14,5) round-trips at column scale; the detail echoes it verbatim.
    assert [(e["date"], e["detail"]) for e in by_type["offering_start"]] == [
        ("2026-09-01", "subscription price 120.00000")
    ]
    assert [(e["date"], e["detail"]) for e in by_type["ex_dividend"]] == [
        ("2026-09-03", "NVDA")
    ]  # GHOST (never held) and GONE (folded to zero) are filtered out
    assert [e["date"] for e in by_type["payday"]] == [
        "2026-08-14",
        "2026-08-31",
        "2026-09-15",
        "2026-09-30",
    ]
    assert [(e["date"], e["detail"]) for e in by_type["tax_deadline"]] == [
        ("2026-09-15", "Q3 estimated payment")
    ]
    assert [(e["date"], e["detail"], e["href"]) for e in by_type["update_due"]] == [
        ("2026-08-24", "Enter July 2026", "/update")
    ]
    # No stored periods: the derived Mar–Aug 2026 slot's purchase is Aug 31 (Feb 27 is
    # clipped by the range — the clip works through the API too).
    assert [(e["date"], e["detail"]) for e in by_type["espp_purchase"]] == [
        ("2026-08-31", "Mar–Aug 2026")
    ]
    # The payload is sorted by (date, type, label) end to end.
    assert events == sorted(events, key=lambda e: (e["date"], e["type"], e["label"]))


async def test_calendar_omits_paydays_for_other_cadences(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    db.add(
        PaycheckProfile(
            person_id=(await seed_primary(db)).id,
            effective_date=date(2026, 1, 1),
            annual_salary=Decimal("120000"),
            pay_periods_per_year=26,
        )
    )
    await db.commit()
    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-09-30")
    assert resp.status_code == 200
    assert [e for e in resp.json()["events"] if e["type"] == "payday"] == []


async def test_calendar_update_due_absent_when_previous_month_entered(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    db.add(NetWorthSnapshot(month=date(2026, 7, 1)))
    await db.commit()
    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-09-30")
    assert [e for e in resp.json()["events"] if e["type"] == "update_due"] == []


async def test_custom_event_crud_roundtrip(auth_client):
    created = await auth_client.post(
        f"{CALENDAR}/events",
        json={"date": "2026-09-12", "label": "  Car insurance renewal ", "detail": ""},
    )
    assert created.status_code == 201
    body = created.json()
    event_id = body["id"]
    # Whitespace trims; an empty detail stores as null.
    assert body == {
        "id": event_id,
        "date": "2026-09-12",
        "label": "Car insurance renewal",
        "detail": None,
    }

    listed = await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")
    assert [e for e in listed.json()["events"] if e["type"] == "custom"] == [
        {
            "date": "2026-09-12",
            "type": "custom",
            "label": "Car insurance renewal",
            "detail": None,
            "href": None,
            "id": event_id,
        }
    ]

    updated = await auth_client.patch(
        f"{CALENDAR}/events/{event_id}",
        json={"date": "2026-09-13", "label": "Renewal", "detail": "moved a day"},
    )
    assert updated.status_code == 200
    assert updated.json() == {
        "id": event_id,
        "date": "2026-09-13",
        "label": "Renewal",
        "detail": "moved a day",
    }

    # Full-replace also CLEARS: an emptied detail box stores as null (spec §9.3).
    cleared = await auth_client.patch(
        f"{CALENDAR}/events/{event_id}",
        json={"date": "2026-09-13", "label": "Renewal", "detail": ""},
    )
    assert cleared.status_code == 200
    assert cleared.json()["detail"] is None

    deleted = await auth_client.delete(f"{CALENDAR}/events/{event_id}")
    assert deleted.status_code == 204
    after = await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")
    assert [e for e in after.json()["events"] if e["type"] == "custom"] == []


async def test_custom_event_validation(auth_client):
    blank = await auth_client.post(
        f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "   "}
    )
    assert blank.status_code == 422
    over = await auth_client.post(
        f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "x" * 121}
    )
    assert over.status_code == 422
    long_detail = await auth_client.post(
        f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "ok", "detail": "y" * 301}
    )
    assert long_detail.status_code == 422
    missing = await auth_client.patch(
        f"{CALENDAR}/events/999", json={"date": "2026-09-12", "label": "ok"}
    )
    assert missing.status_code == 404
    gone = await auth_client.delete(f"{CALENDAR}/events/999")
    assert gone.status_code == 404


async def test_custom_events_load_only_the_requested_range(auth_client):
    for day, label in (("2026-08-31", "before"), ("2026-09-15", "inside"), ("2026-10-01", "after")):
        resp = await auth_client.post(f"{CALENDAR}/events", json={"date": day, "label": label})
        assert resp.status_code == 201
    listed = await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")
    assert [e["label"] for e in listed.json()["events"] if e["type"] == "custom"] == ["inside"]


async def test_custom_event_requires_auth(client):
    resp = await client.post(f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "nope"})
    assert resp.status_code == 401


async def test_calendar_labels_paydays_when_two_people_have_profiles(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    me = Person(name="Me", is_primary=True)
    sam = Person(name="Sam", is_primary=False)
    db.add_all([me, sam])
    await db.flush()
    db.add_all(
        [
            PaycheckProfile(
                effective_date=date(2026, 1, 1),
                annual_salary=Decimal("120000"),
                person_id=me.id,
            ),
            PaycheckProfile(
                effective_date=date(2026, 2, 1),
                annual_salary=Decimal("90000"),
                person_id=sam.id,
            ),
        ]
    )
    await db.commit()

    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-08-31")
    assert resp.status_code == 200
    paydays = [e for e in resp.json()["events"] if e["type"] == "payday"]
    assert [(e["date"], e["label"], e["detail"]) for e in paydays] == [
        ("2026-08-14", "Payday — Me", "Me"),
        ("2026-08-14", "Payday — Sam", "Sam"),
        ("2026-08-31", "Payday — Me", "Me"),
        ("2026-08-31", "Payday — Sam", "Sam"),
    ]


async def test_calendar_uses_each_persons_IN_FORCE_profile_not_the_newest_row(
    auth_client, db, monkeypatch
):
    # "In force" (spec §4.4), not "the latest row in the table": a raise dated next year —
    # which may even change cadence — must not silence the checks landing this month.
    freeze_today(monkeypatch)
    me = Person(name="Me", is_primary=True)
    db.add(me)
    await db.flush()
    db.add_all(
        [
            PaycheckProfile(
                effective_date=date(2026, 1, 1),
                annual_salary=Decimal("120000"),
                pay_periods_per_year=24,
                person_id=me.id,
            ),
            PaycheckProfile(
                effective_date=date(2027, 1, 1),
                annual_salary=Decimal("150000"),
                pay_periods_per_year=26,
                person_id=me.id,
            ),
        ]
    )
    await db.commit()

    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-08-31")
    assert [e["date"] for e in resp.json()["events"] if e["type"] == "payday"] == [
        "2026-08-14",
        "2026-08-31",
    ]


async def test_calendar_falls_back_to_a_future_only_profile(auth_client, db, monkeypatch):
    # paycheck.py's own rule, mirrored: a brand-new user whose only profile starts next
    # month gets the checks that are COMING rather than an empty calendar.
    freeze_today(monkeypatch)
    me = Person(name="Me", is_primary=True)
    db.add(me)
    await db.flush()
    db.add(
        PaycheckProfile(
            effective_date=date(2026, 12, 1),
            annual_salary=Decimal("120000"),
            person_id=me.id,
        )
    )
    await db.commit()

    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-08-31")
    assert [e["date"] for e in resp.json()["events"] if e["type"] == "payday"] == [
        "2026-08-14",
        "2026-08-31",
    ]
