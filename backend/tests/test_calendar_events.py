"""compose() driven entirely by literals — the ROUTER owns loading, these tests own the
rules. Date facts used below (2026-01-01 is a Thursday): Mar 18 2026 and Jun 17, Sep 16,
Dec 16 2026 are third Wednesdays; Feb 28 2026 is a Saturday so last_weekday_of(2026, 2)
is Feb 27; Aug 31 2026 is a Monday. Every test filters to the type it exercises, so the
suite survives Task 7 adding the always-on sources (tax deadlines) to shared windows."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.calendar_events import compose
from app.services.espp_calc import OfferingInfo, StoredPeriod


def _grant(label="2025 offer", shares=400, cliff="0.25", first_vest=date(2026, 3, 18)):
    return SimpleNamespace(
        label=label,
        shares=shares,
        cliff_pct=Decimal(cliff),
        first_vest_date=first_vest,
        vest_quantum=1,
    )


def _compose(start, end, **over):
    inputs = dict(
        today=date(2026, 8, 24),
        grants=[],
        stored_periods=[],
        offerings=[],
        unsold_lots=[],
        announced_ex_divs=[],
        payday_semi_monthly=False,
        missing_update_month=None,
    )
    inputs.update(over)
    return compose(start, end, **inputs)


def _of_type(events, type_):
    return [e for e in events if e.type == type_]


def test_rsu_vests_clip_to_the_range():
    events = _of_type(_compose(date(2026, 3, 1), date(2026, 6, 30), grants=[_grant()]), "rsu_vest")
    # 400 sh @ 25% cliff: 100 on the stored 2026-03-18, then 25 per quarterly third
    # Wednesday — Jun 17 in range, Sep 16 clipped out.
    assert [(e.event_date, e.label, e.detail) for e in events] == [
        (date(2026, 3, 18), "RSU vest — 2025 offer", "100 sh — 2025 offer"),
        (date(2026, 6, 17), "RSU vest — 2025 offer", "25 sh — 2025 offer"),
    ]
    assert all(e.href == "/comp" for e in events)


def test_bad_grant_degrades_with_a_warning_not_a_crash(caplog):
    bad = _grant(label="hand-edited", cliff="0.30")  # 0.70 is not a whole 6.25% count
    events = _of_type(
        _compose(date(2026, 1, 1), date(2026, 12, 31), grants=[bad, _grant()]),
        "rsu_vest",
    )
    # The good grant's four 2026 vests stand; the bad one contributes nothing but a log.
    assert {e.label for e in events} == {"RSU vest — 2025 offer"}
    assert len(events) == 4  # Mar 18, Jun 17, Sep 16, Dec 16
    assert any("hand-edited" in record.message for record in caplog.records)


def test_espp_purchases_stored_and_derived():
    stored = [
        StoredPeriod(
            id=1,
            label="1H26",
            period_start=date(2025, 9, 1),
            period_end=date(2026, 2, 27),
            semi_annual_base=Decimal("60000"),
            additional_payments=Decimal("0"),
            contribution_pct=Decimal("0.14"),
        )
    ]
    events = _of_type(
        _compose(date(2026, 1, 1), date(2026, 12, 31), stored_periods=stored),
        "espp_purchase",
    )
    # Stored 1H26 verbatim; the empty Mar–Aug slot derives its last-weekday end.
    assert [(e.event_date, e.detail, e.href) for e in events] == [
        (date(2026, 2, 27), "1H26", "/espp"),
        (date(2026, 8, 31), "Mar–Aug 2026", "/espp"),
    ]
    assert events[0].label == "ESPP purchase — 1H26"


def test_espp_qualify_renders_and_clips_the_lots_it_is_given():
    # The ROUTER filters to unsold lots; compose renders whatever it receives and clips.
    events = _of_type(
        _compose(
            date(2026, 1, 1),
            date(2026, 12, 31),
            unsold_lots=[
                (date(2024, 2, 29), date(2026, 3, 1)),
                (date(2025, 8, 29), date(2027, 8, 29)),  # qualifies outside the range
            ],
        ),
        "espp_qualify",
    )
    assert [(e.event_date, e.label, e.detail) for e in events] == [
        (
            date(2026, 3, 1),
            "ESPP lot qualifies — 2024-02-29",
            "2024-02-29 lot qualifies",
        )
    ]
    assert events[0].href == "/espp"


def test_offering_start_events():
    offerings = [
        OfferingInfo(offering_start=date(2025, 9, 1), subscription_price=Decimal("175.25")),
        OfferingInfo(offering_start=date(2026, 9, 1), subscription_price=Decimal("120")),
    ]
    events = _of_type(
        _compose(date(2026, 1, 1), date(2026, 12, 31), offerings=offerings),
        "offering_start",
    )
    assert [(e.event_date, e.label, e.detail) for e in events] == [
        (date(2026, 9, 1), "ESPP offering starts", "subscription price 120")
    ]


def test_events_sort_by_date_then_type_then_label():
    # One-day window so only the two seeded same-day events exist: "espp_qualify" sorts
    # before "rsu_vest" by type name.
    events = _compose(
        date(2026, 9, 16),
        date(2026, 9, 16),
        grants=[_grant()],  # Sep 16 vest
        unsold_lots=[(date(2025, 8, 29), date(2026, 9, 16))],
    )
    assert [(e.event_date, e.type) for e in events] == [
        (date(2026, 9, 16), "espp_qualify"),
        (date(2026, 9, 16), "rsu_vest"),
    ]
