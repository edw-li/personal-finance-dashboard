"""Endpoint tests: loading + validation + the GET-never-rejects law. Composition RULES
are pinned in tests/calendar/ — here each type appears once to prove its loader (the
fold's held-filter, the sold-lot filter, the cadence gate, the snapshot probe)."""

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import select

from app.api import calendar as calendar_api
from app.models import (
    AppSetting,
    CardCredit,
    CreditCard,
    EsppLot,
    EsppOffering,
    LatestPrice,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    PositionTransaction,
    RsuGrant,
    Security,
    SecurityDividendEvent,
    TaxBracket,
    TaxInput,
    TaxYear,
)
from app.seed import seed_tax_definitions
from app.services import rsu_vesting
from tests.portfolio_factories import acct

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
            portfolio_account=acct("RH Taxable"),
            type="buy",
            shares=Decimal("10"),
            price=Decimal("100"),
            sort_index=10,
        )
    )
    db.add(
        PositionTransaction(
            security_id=gone.id,
            portfolio_account=acct("RH Taxable"),
            type="buy",
            shares=Decimal("5"),
            price=Decimal("100"),
            sort_index=20,
        )
    )
    db.add(
        PositionTransaction(
            security_id=gone.id,
            portfolio_account=acct("RH Taxable"),
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

    assert [(e["date"], e["detail"], e["amount"], e["key"]) for e in by_type["rsu_vest"]] == [
        ("2026-09-16", "25 sh — 2025 offer", None, "rsu:vest:2026-09-16")
    ]  # the broken grant is silently absent; no ticker → unpriced (amount null, never 0)
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
    # 120000 / 24 checks, no deductions → net 5000 per check, folded across ONE person.
    assert {e["amount"] for e in by_type["payday"]} == {"5000.00"}
    assert by_type["payday"][0]["items"] == [
        {
            "label": "Me",
            "amount": "5000.00",
            "person_id": by_type["payday"][0]["items"][0]["person_id"],
            "detail": None,
        }
    ]
    assert resp.json()["quote_as_of"] is None
    assert [source["source"] for source in resp.json()["sources"]] == [
        "rsu",
        "espp",
        "dividend",
        "payroll",
        "tax",
        "card",
        "ritual",
        "custom",
    ]
    assert [(e["date"], e["detail"]) for e in by_type["tax_deadline"]] == [
        ("2026-09-15", "Q3 estimated payment")
    ]
    # August's reminder (enter July) was due Aug 1 — overdue, re-dated to today with its
    # key unchanged; September's (enter August) is scheduled.
    assert [(e["date"], e["label"], e["key"], e["href"]) for e in by_type["update_due"]] == [
        ("2026-08-24", "Monthly update — enter July 2026", "ritual:2026-07:2026-08-01", "/update"),
        (
            "2026-09-01",
            "Monthly update — enter August 2026",
            "ritual:2026-08:2026-09-01",
            "/update",
        ),
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


async def test_calendar_update_due_only_scheduled_when_previous_month_entered(
    auth_client, db, monkeypatch
):
    freeze_today(monkeypatch)
    db.add(NetWorthSnapshot(month=date(2026, 7, 1)))
    await db.commit()
    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-09-30")
    assert [
        (e["date"], e["label"]) for e in resp.json()["events"] if e["type"] == "update_due"
    ] == [("2026-09-01", "Monthly update — enter August 2026")]


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
        "person_id": None,
        "amount": None,
        "direction": "neutral",
        "recurrence": "none",
        "until": None,
    }

    listed = await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")
    assert [e for e in listed.json()["events"] if e["type"] == "custom"] == [
        {
            "date": "2026-09-12",
            "type": "custom",
            "source": "custom",
            "key": f"custom:{event_id}:2026-09-12",
            "entity_ref": str(event_id),
            "label": "Car insurance renewal",
            "short_label": "Car insurance renewal",
            "detail": None,
            "amount": None,
            "direction": "neutral",
            "basis": "confirmed",
            "items": [],
            "href": None,
            "id": event_id,
            "person_id": None,
            "recurrence": None,
            "until": None,
            "series_start": None,
            "done": False,
            "hidden": False,
            "note": None,
            "amount_overridden": False,
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
        "person_id": None,
        "amount": None,
        "direction": "neutral",
        "recurrence": "none",
        "until": None,
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
    # Both are named — but same-day checks FOLD into one household chip (spec §7); the
    # per-person constituents ride in `items` (pinned in the folding test below).
    paydays = [e for e in resp.json()["events"] if e["type"] == "payday"]
    assert [(e["date"], e["label"], e["detail"]) for e in paydays] == [
        ("2026-08-14", "Payday — Me & Sam", "2 paychecks"),
        ("2026-08-31", "Payday — Me & Sam", "2 paychecks"),
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


async def test_custom_event_person_tag_stamps_the_label(auth_client, db):
    me = Person(name="Me", is_primary=True)
    sam = Person(name="Sam", is_primary=False)
    db.add_all([me, sam])
    await db.commit()

    created = await auth_client.post(
        f"{CALENDAR}/events",
        json={"date": "2026-09-12", "label": "Dentist", "detail": None, "person_id": sam.id},
    )
    assert created.status_code == 201, created.text
    # The STORED label is what the user typed — the suffix is composed, never persisted, so
    # a rename of Sam re-reads correctly and a re-save cannot compound it.
    assert created.json() == {
        "id": created.json()["id"],
        "date": "2026-09-12",
        "label": "Dentist",
        "detail": None,
        "person_id": sam.id,
        "amount": None,
        "direction": "neutral",
        "recurrence": "none",
        "until": None,
    }
    event_id = created.json()["id"]

    listed = await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")
    custom = [e for e in listed.json()["events"] if e["type"] == "custom"]
    assert [(e["label"], e["person_id"]) for e in custom] == [("Dentist — Sam", sam.id)]

    # Full replace: an explicit null untags the row and the label goes back to bare.
    cleared = await auth_client.patch(
        f"{CALENDAR}/events/{event_id}",
        json={"date": "2026-09-12", "label": "Dentist", "detail": None, "person_id": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["person_id"] is None
    after = await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")
    assert [e["label"] for e in after.json()["events"] if e["type"] == "custom"] == ["Dentist"]


async def test_custom_event_person_must_exist(auth_client):
    ghost = await auth_client.post(
        f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "ok", "person_id": 999}
    )
    assert ghost.status_code == 422
    assert ghost.json()["detail"] == "unknown person_id: 999"


async def test_calendar_prices_vests_from_the_employer_quote(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    nvda = Security(ticker="NVDA", name="NVDA Inc", holding_type="stock")
    db.add_all([nvda, AppSetting(key="espp_ticker", value={"value": "NVDA"})])
    await db.flush()
    db.add(
        LatestPrice(
            security_id=nvda.id,
            price=Decimal("500.0000"),
            quoted_at=datetime(2026, 8, 21, 20, tzinfo=UTC),
            source="yfinance",
        )
    )
    db.add_all(
        [
            RsuGrant(
                kind="new_hire",
                label="2025 offer",
                focal_year=None,
                shares=400,
                grant_price=Decimal("100"),
                first_vest_date=date(2026, 3, 18),
                cliff_pct=Decimal("0.25"),
                vest_quantum=1,
            ),
            RsuGrant(
                kind="refresh",
                label="2026 refresh",
                focal_year=2026,
                shares=160,
                grant_price=Decimal("100"),
                first_vest_date=date(2026, 3, 18),
                cliff_pct=Decimal("0.25"),
                vest_quantum=1,
            ),
        ]
    )
    await db.commit()
    body = (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()
    [vest] = [e for e in body["events"] if e["type"] == "rsu_vest"]
    assert (vest["label"], vest["short_label"], vest["amount"], vest["basis"]) == (
        "RSU vest — 2 grants",
        "RSU vest · 2 grants",
        "17500.00",
        "estimated",
    )
    assert [(i["label"], i["amount"], i["detail"]) for i in vest["items"]] == [
        ("2025 offer", "12500.00", "25 sh"),
        ("2026 refresh", "5000.00", "10 sh"),
    ]
    assert body["quote_as_of"] == "2026-08-21T20:00:00Z"
    assert next(s for s in body["sources"] if s["source"] == "rsu") == {
        "source": "rsu",
        "status": "ok",
        "note": "valued at the NVDA quote",
    }


async def test_calendar_folds_two_paydays_and_names_an_omitted_cadence(
    auth_client, db, monkeypatch
):
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
    body = (await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-08-31")).json()
    paydays = [e for e in body["events"] if e["type"] == "payday"]
    assert [(e["date"], e["label"], e["short_label"], e["amount"]) for e in paydays] == [
        ("2026-08-14", "Payday — Me & Sam", "Payday · 2", "8750.00"),
        ("2026-08-31", "Payday — Me & Sam", "Payday · 2", "8750.00"),
    ]
    assert [(i["label"], i["amount"], i["person_id"]) for i in paydays[0]["items"]] == [
        ("Me", "5000.00", me.id),
        ("Sam", "3750.00", sam.id),
    ]
    assert next(s for s in body["sources"] if s["source"] == "payroll") == {
        "source": "payroll",
        "status": "ok",
        "note": None,
    }

    # Flip Sam to biweekly: her chips are omitted and the footer says so.
    sam_profile = (
        (await db.execute(select(PaycheckProfile).where(PaycheckProfile.person_id == sam.id)))
        .scalars()
        .one()
    )
    sam_profile.pay_periods_per_year = 26
    await db.commit()
    body = (await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-08-31")).json()
    assert [e["label"] for e in body["events"] if e["type"] == "payday"] == [
        "Payday — Me",
        "Payday — Me",
    ]
    assert next(s for s in body["sources"] if s["source"] == "payroll") == {
        "source": "payroll",
        "status": "partial",
        "note": "Sam: paid on another cadence — paydays omitted",
    }


async def test_custom_event_money_and_recurrence_round_trip(auth_client):
    created = await auth_client.post(
        f"{CALENDAR}/events",
        json={
            "date": "2026-01-31",
            "label": "Rent",
            "amount": "2400",
            "direction": "out",
            "recurrence": "monthly",
            "until": "2026-04-30",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["amount"], body["direction"], body["recurrence"], body["until"]) == (
        "2400.00",
        "out",
        "monthly",
        "2026-04-30",
    )
    listed = (await auth_client.get(f"{CALENDAR}?start=2026-02-01&end=2026-05-31")).json()["events"]
    rent = [e for e in listed if e["type"] == "custom"]
    assert [
        (e["date"], e["key"], e["amount"], e["series_start"], e["recurrence"]) for e in rent
    ] == [
        ("2026-02-28", f"custom:{body['id']}:2026-02-28", "2400.00", "2026-01-31", "monthly"),
        ("2026-03-31", f"custom:{body['id']}:2026-03-31", "2400.00", "2026-01-31", "monthly"),
        ("2026-04-30", f"custom:{body['id']}:2026-04-30", "2400.00", "2026-01-31", "monthly"),
    ]
    # Whole-series edit: the PATCH moves every occurrence.
    patched = await auth_client.patch(
        f"{CALENDAR}/events/{body['id']}",
        json={
            "date": "2026-01-31",
            "label": "Rent",
            "amount": "2500",
            "direction": "out",
            "recurrence": "monthly",
            "until": "2026-03-31",
        },
    )
    assert patched.status_code == 200
    listed = (await auth_client.get(f"{CALENDAR}?start=2026-02-01&end=2026-05-31")).json()["events"]
    assert [e["amount"] for e in listed if e["type"] == "custom"] == ["2500.00", "2500.00"]


async def test_custom_event_money_validation(auth_client):
    base = {"date": "2026-09-12", "label": "ok"}
    assert (
        await auth_client.post(f"{CALENDAR}/events", json={**base, "direction": "sideways"})
    ).status_code == 422
    assert (
        await auth_client.post(f"{CALENDAR}/events", json={**base, "recurrence": "daily"})
    ).status_code == 422
    # until without a series
    assert (
        await auth_client.post(f"{CALENDAR}/events", json={**base, "until": "2026-12-31"})
    ).status_code == 422
    # until before date
    assert (
        await auth_client.post(
            f"{CALENDAR}/events", json={**base, "recurrence": "weekly", "until": "2026-09-01"}
        )
    ).status_code == 422
    too_big = await auth_client.post(f"{CALENDAR}/events", json={**base, "amount": "10000000000"})
    assert too_big.status_code == 422  # Numeric(12,2) fence via quantize_money
    # `direction` carries the sign, so a negative amount would render an "out" event as
    # money coming IN — refused in the parser rather than stored and drawn backwards.
    negative = await auth_client.post(
        f"{CALENDAR}/events", json={**base, "amount": "-5", "direction": "out"}
    )
    assert negative.status_code == 422


async def test_calendar_card_events_and_the_card_health_row(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    venture = CreditCard(
        name="Venture X",
        slug="venture-x",
        annual_fee=Decimal("395.00"),
        rewards_currency="miles",
        point_value_cents=Decimal("1.7"),
        opened_on=date(2024, 5, 12),
    )
    undated = CreditCard(
        name="SavorOne",
        slug="savorone",
        annual_fee=Decimal("0"),
        rewards_currency="cash",
        point_value_cents=Decimal("1"),
        opened_on=None,
    )
    archived = CreditCard(
        name="Old",
        slug="old",
        annual_fee=Decimal("95"),
        rewards_currency="cash",
        point_value_cents=Decimal("1"),
        opened_on=date(2020, 1, 15),
        is_active=False,
    )
    db.add_all([venture, undated, archived])
    await db.flush()
    counted = CardCredit(
        card_id=venture.id,
        label="$300 travel credit",
        annual_value=Decimal("300"),
        counts=True,
        reset_cadence="anniversary",
    )
    db.add_all(
        [
            counted,
            # counts=False is the "I never use this" toggle - it earns no calendar event.
            CardCredit(
                card_id=venture.id, label="ignored", annual_value=Decimal("50"), counts=False
            ),
        ]
    )
    await db.flush()
    venture_id, credit_id = venture.id, counted.id
    await db.commit()
    body = (await auth_client.get(f"{CALENDAR}?start=2026-05-01&end=2026-05-31")).json()
    cards = [e for e in body["events"] if e["source"] == "card"]
    assert [(e["type"], e["date"], e["key"], e["amount"], e["direction"]) for e in cards] == [
        ("card_anniversary", "2026-05-12", f"card:{venture_id}:2026-05-12", None, "neutral"),
        ("card_credit", "2026-05-12", f"card:credit-{credit_id}:2026-05-12", "300.00", "neutral"),
        ("card_fee", "2026-05-12", f"card:{venture_id}-fee:2026-05-12", "395.00", "out"),
    ]
    assert cards[0]["detail"] == "Year 2 with Venture X — falls off 5/24"
    # The archived card is filtered out; SavorOne has no opened date, so it produces nothing
    # and is named in the footer instead.
    assert [s["source"] for s in body["sources"]] == [
        "rsu",
        "espp",
        "dividend",
        "payroll",
        "tax",
        "card",
        "ritual",
        "custom",
    ]
    assert next(s for s in body["sources"] if s["source"] == "card") == {
        "source": "card",
        "status": "partial",
        "note": "1 card(s) without an opened date — no fee or anniversary events",
    }


async def test_calendar_tax_amounts_ride_the_withholding_tracker(auth_client, db, monkeypatch):
    freeze_today(monkeypatch)
    # Without a 2026 tax year: dates only, and the footer says why.
    body = (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()
    q3 = next(e for e in body["events"] if e["key"] == "tax:2026-q3:2026-09-15")
    assert (q3["amount"], q3["basis"]) == (None, "scheduled")
    assert next(s for s in body["sources"] if s["source"] == "tax") == {
        "source": "tax",
        "status": "partial",
        "note": "no 2026 tax year entered — dates only",
    }

    # A priceable 2026: one W-2 input, flat brackets, a semi-monthly profile (the shape
    # test_withholding_api seeds).
    await seed_tax_definitions(db)
    db.add(TaxYear(year=2026, filing_status="single"))
    await db.flush()
    db.add(TaxInput(year=2026, key="latest_w2_income", value=Decimal("240000")))
    for name, table in {
        "federal": [("0.1000", "0.00")],
        "state": [("0.0500", "0.00")],
        "medicare": [("0.0145", "0.00")],
        "social_security": [("0.0620", "0.00"), ("0.0000", "168600.00")],
        "disability": [("0.0110", "0.00")],
        "capital_gains": [("0.1500", "0.00")],
    }.items():
        for index, (rate, threshold) in enumerate(table, start=1):
            db.add(
                TaxBracket(
                    year=2026,
                    jurisdiction=name,
                    bracket_index=index,
                    rate=Decimal(rate),
                    threshold=Decimal(threshold),
                )
            )
    db.add(
        PaycheckProfile(
            person_id=(await seed_primary(db)).id,
            effective_date=date(2025, 1, 1),
            annual_salary=Decimal("240000"),
            withholding_pct=Decimal("0.05"),
        )
    )
    await db.commit()

    body = (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()
    q3 = next(e for e in body["events"] if e["key"] == "tax:2026-q3:2026-09-15")
    # 5% withholding against a ~15% liability: a shortfall, split across Sep 15 and Jan 15.
    assert q3["basis"] == "estimated" and Decimal(q3["amount"]) > 0
    assert q3["detail"].startswith("Shortfall $")
    assert "current-year leg — $" in q3["detail"]
    assert next(s for s in body["sources"] if s["source"] == "tax")["status"] == "ok"


async def test_calendar_prices_ex_dividends_from_the_latest_stored_per_share(
    auth_client, db, monkeypatch
):
    freeze_today(monkeypatch)
    nvda = Security(
        ticker="NVDA", name="NVDA Inc", holding_type="stock", next_ex_div_date=date(2026, 9, 3)
    )
    db.add(nvda)
    await db.flush()
    db.add(
        PositionTransaction(
            security_id=nvda.id,
            portfolio_account=acct("RH Taxable"),
            type="buy",
            shares=Decimal("10"),
            price=Decimal("100"),
            sort_index=10,
        )
    )
    db.add_all(
        [
            SecurityDividendEvent(
                security_id=nvda.id, ex_date=date(2026, 3, 4), per_share=Decimal("0.010000")
            ),
            # The announcement carries no amount, so the LATEST stored per-share prices it.
            SecurityDividendEvent(
                security_id=nvda.id, ex_date=date(2026, 6, 3), per_share=Decimal("0.020000")
            ),
        ]
    )
    await db.commit()
    body = (await auth_client.get(f"{CALENDAR}?start=2026-09-01&end=2026-09-30")).json()
    [ex] = [e for e in body["events"] if e["type"] == "ex_dividend"]
    assert (ex["amount"], ex["basis"], ex["detail"]) == (
        "0.20",
        "estimated",
        "NVDA · 10 sh × $0.020000",
    )
    assert next(s for s in body["sources"] if s["source"] == "dividend") == {
        "source": "dividend",
        "status": "ok",
        "note": None,
    }


async def test_the_rsu_health_note_names_the_missing_quote_and_the_refused_grant_together(
    auth_client, db, monkeypatch
):
    freeze_today(monkeypatch)
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
    db.add(
        RsuGrant(
            kind="refresh",
            label="broken",
            focal_year=None,
            shares=100,
            grant_price=Decimal("100"),
            first_vest_date=date(2026, 9, 16),
            cliff_pct=Decimal("0.30"),  # rsu_vesting refuses this row
            vest_quantum=1,
        )
    )
    await db.commit()
    body = (await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-09-30")).json()
    # Both gaps, not just the first one found: fixing the ticker would otherwise reveal the
    # refused grant only on the NEXT load.
    assert next(s for s in body["sources"] if s["source"] == "rsu") == {
        "source": "rsu",
        "status": "partial",
        "note": "no ESPP/employer ticker configured — vest values unknown; "
        "1 grant(s) cannot be scheduled",
    }


async def test_one_roster_read_and_one_schedule_call_per_grant_per_get(
    auth_client, db, monkeypatch
):
    """The loaders and the generators are on the same request: a roster read or a vest
    schedule computed twice is also two chances for the health footer and the events to
    disagree."""
    freeze_today(monkeypatch)
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
    db.add(
        PaycheckProfile(
            person_id=(await seed_primary(db)).id,
            effective_date=date(2026, 1, 1),
            annual_salary=Decimal("120000"),
        )
    )
    await db.commit()

    roster_reads = 0
    schedule_calls = 0
    real_load_people = calendar_api.load_people
    real_schedule = rsu_vesting.schedule

    async def counting_load_people(db_):
        nonlocal roster_reads
        roster_reads += 1
        return await real_load_people(db_)

    def counting_schedule(grant):
        nonlocal schedule_calls
        schedule_calls += 1
        return real_schedule(grant)

    monkeypatch.setattr(calendar_api, "load_people", counting_load_people)
    monkeypatch.setattr(rsu_vesting, "schedule", counting_schedule)
    resp = await auth_client.get(f"{CALENDAR}?start=2026-08-01&end=2026-09-30")
    assert resp.status_code == 200
    assert (roster_reads, schedule_calls) == (1, 1)
