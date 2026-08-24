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


def test_ex_dividend_events_render_the_passed_holdings():
    events = _of_type(
        _compose(
            date(2026, 9, 1),
            date(2026, 9, 30),
            announced_ex_divs=[("NVDA", date(2026, 9, 3)), ("SCHD", date(2026, 10, 7))],
        ),
        "ex_dividend",
    )
    # SCHD's date is outside the range; NVDA's renders with the ticker as detail.
    assert [(e.event_date, e.label, e.detail, e.href) for e in events] == [
        (date(2026, 9, 3), "Ex-dividend — NVDA", "NVDA", "/portfolio")
    ]


def test_paydays_only_for_semi_monthly_cadence():
    window = (date(2026, 8, 1), date(2026, 9, 30))
    assert _of_type(_compose(*window), "payday") == []  # cadence != 24: none, ever
    events = _of_type(_compose(*window, payday_semi_monthly=True), "payday")
    # Aug 15 2026 is a Saturday -> Fri Aug 14; the other three stand (golden table).
    assert [e.event_date for e in events] == [
        date(2026, 8, 14),
        date(2026, 8, 31),
        date(2026, 9, 15),
        date(2026, 9, 30),
    ]
    assert all(e.label == "Payday" and e.detail is None and e.href == "/paycheck" for e in events)


def test_paydays_clip_inside_the_boundary_months():
    events = _of_type(
        _compose(date(2026, 8, 20), date(2026, 9, 10), payday_semi_monthly=True),
        "payday",
    )
    # Aug 14 is before the start, Sep 15 after the end — only Aug 31 survives.
    assert [e.event_date for e in events] == [date(2026, 8, 31)]


def test_tax_deadlines_static_rules():
    events = _of_type(_compose(date(2026, 1, 1), date(2026, 12, 31)), "tax_deadline")
    # None of 2026's five fall on a weekend/holiday — they stand unadjusted.
    assert [(e.event_date, e.detail) for e in events] == [
        (date(2026, 1, 15), "Q4 2025 estimated payment"),
        (date(2026, 4, 15), "federal filing + Q1 estimated payment"),
        (date(2026, 6, 15), "Q2 estimated payment"),
        (date(2026, 9, 15), "Q3 estimated payment"),
        (date(2026, 10, 15), "extension filing deadline"),
    ]
    assert all(e.href == "/taxes" and e.label == f"Tax deadline — {e.detail}" for e in events)


def test_tax_deadline_rolls_forward_over_weekend_and_holiday():
    # Sat Jan 15 2028 -> Sun 16 -> MLK Mon 17 -> Tue Jan 18 (the real IRS behavior).
    events = _of_type(_compose(date(2028, 1, 1), date(2028, 1, 31)), "tax_deadline")
    assert [(e.event_date, e.detail) for e in events] == [
        (date(2028, 1, 18), "Q4 2027 estimated payment")
    ]


def test_update_due_present_when_previous_month_lacks_a_snapshot():
    events = _of_type(
        _compose(
            date(2026, 8, 1),
            date(2026, 10, 31),
            missing_update_month=date(2026, 7, 1),
        ),
        "update_due",
    )
    # max(Aug 1, today=Aug 24) = Aug 24: the reminder never sits in the past.
    assert [(e.event_date, e.label, e.detail, e.href) for e in events] == [
        (date(2026, 8, 24), "Monthly update due", "Enter July 2026", "/update")
    ]


def test_update_due_absent_when_entered_or_out_of_range():
    window = (date(2026, 8, 1), date(2026, 10, 31))
    assert _of_type(_compose(*window), "update_due") == []  # snapshot exists -> no input
    # Missing, but the requested window excludes today: no reminder either.
    later = _compose(date(2026, 9, 1), date(2026, 10, 31), missing_update_month=date(2026, 7, 1))
    assert _of_type(later, "update_due") == []
