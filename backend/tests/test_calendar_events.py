"""compose() driven entirely by literals — the ROUTER owns loading, these tests own the
rules. Date facts used below (2026-01-01 is a Thursday): Mar 18 2026 and Jun 17, Sep 16,
Dec 16 2026 are third Wednesdays; Feb 28 2026 is a Saturday so last_weekday_of(2026, 2)
is Feb 27; Aug 31 2026 is a Monday. Every test filters to the type it exercises, so the
suite survives Task 7 adding the always-on sources (tax deadlines) to shared windows."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.calendar_events import CustomRow, PaydaySource, compose, person_suffix
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
        custom_rows=[],
        payday_sources=[],
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
    events = _of_type(
        _compose(*window, payday_sources=[PaydaySource(name="Me", semi_monthly=True)]), "payday"
    )
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
        _compose(
            date(2026, 8, 20),
            date(2026, 9, 10),
            payday_sources=[PaydaySource(name="Me", semi_monthly=True)],
        ),
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


def test_custom_rows_render_and_clip():
    events = _of_type(
        _compose(
            date(2026, 9, 1),
            date(2026, 9, 30),
            custom_rows=[
                CustomRow(7, date(2026, 9, 12), "Car insurance renewal", "policy 8841"),
                CustomRow(8, date(2026, 10, 2), "Out of range", None),
            ],
        ),
        "custom",
    )
    assert [(e.event_date, e.label, e.detail, e.href, e.event_id) for e in events] == [
        (date(2026, 9, 12), "Car insurance renewal", "policy 8841", None, 7)
    ]
    # UNTAGGED rows are byte-identical to before the person column: no suffix, no detail
    # change, and person_id rides as None.
    assert events[0].person_id is None


def test_computed_events_carry_no_event_id():
    events = _compose(
        date(2026, 1, 1),
        date(2026, 12, 31),
        payday_sources=[PaydaySource(name="Me", semi_monthly=True)],
    )
    assert events and all(e.event_id is None for e in events)


def test_custom_rows_sort_with_computed_events():
    # Same-day merge position pinned directly: (date, type, label) slots "custom"
    # alphabetically before "payday" and "tax_deadline" (Sep 15 is also Q3's due date —
    # the always-on source this file's header warns shares windows).
    events = _compose(
        date(2026, 9, 15),
        date(2026, 9, 15),
        payday_sources=[PaydaySource(name="Me", semi_monthly=True)],
        custom_rows=[CustomRow(3, date(2026, 9, 15), "Zoo membership", None)],
    )
    assert [(e.type, e.label) for e in events] == [
        ("custom", "Zoo membership"),
        ("payday", "Payday"),
        ("tax_deadline", "Tax deadline — Q3 estimated payment"),
    ]


def test_two_profiled_people_get_labelled_paydays():
    events = _of_type(
        _compose(
            date(2026, 8, 1),
            date(2026, 8, 31),
            payday_sources=[
                PaydaySource(name="Me", semi_monthly=True),
                PaydaySource(name="Sam", semi_monthly=True),
            ],
        ),
        "payday",
    )
    # Two chips per date, sorted by label within the day (compose's (date, type, label)).
    assert [(e.event_date, e.label, e.detail) for e in events] == [
        (date(2026, 8, 14), "Payday — Me", "Me"),
        (date(2026, 8, 14), "Payday — Sam", "Sam"),
        (date(2026, 8, 31), "Payday — Me", "Me"),
        (date(2026, 8, 31), "Payday — Sam", "Sam"),
    ]
    # The ICS UID is {type}-{date}-{slug(label)}: same-date chips must not collide.
    assert len({(e.event_date, e.label) for e in events}) == len(events)


def test_the_cadence_gate_is_per_person_and_the_label_is_not():
    # One semi-monthly earner beside a biweekly one: the biweekly side is omitted rather
    # than guessed (the standing rule), and the surviving chips are STILL labelled —
    # otherwise a two-earner household would read the remaining chips as household-wide.
    events = _of_type(
        _compose(
            date(2026, 8, 1),
            date(2026, 8, 31),
            payday_sources=[
                PaydaySource(name="Me", semi_monthly=True),
                PaydaySource(name="Sam", semi_monthly=False),
            ],
        ),
        "payday",
    )
    assert [(e.event_date, e.label) for e in events] == [
        (date(2026, 8, 14), "Payday — Me"),
        (date(2026, 8, 31), "Payday — Me"),
    ]


def test_one_profiled_person_keeps_the_bare_unlabelled_payday():
    events = _of_type(
        _compose(
            date(2026, 8, 1),
            date(2026, 8, 31),
            payday_sources=[PaydaySource(name="Me", semi_monthly=True)],
        ),
        "payday",
    )
    assert all(e.label == "Payday" and e.detail is None and e.href == "/paycheck" for e in events)


def test_a_tagged_custom_row_wears_the_person_suffix():
    # The SAME grammar the payday chips use — one helper, so an event tagged to Sam and a
    # payday of Sam's read identically and the frontend has one shape to strip.
    events = _of_type(
        _compose(
            date(2026, 9, 1),
            date(2026, 9, 30),
            custom_rows=[
                CustomRow(
                    9, date(2026, 9, 12), "Dentist", "cleaning", person_id=2, person_name="Sam"
                )
            ],
        ),
        "custom",
    )
    assert [(e.label, e.detail, e.person_id) for e in events] == [("Dentist — Sam", "cleaning", 2)]


def test_person_suffix_is_the_one_grammar_paydays_already_use():
    events = _of_type(
        _compose(
            date(2026, 8, 1),
            date(2026, 8, 31),
            payday_sources=[
                PaydaySource(name="Me", semi_monthly=True),
                PaydaySource(name="Sam", semi_monthly=True),
            ],
        ),
        "payday",
    )
    assert {e.label for e in events} == {
        "Payday" + person_suffix("Me"),
        "Payday" + person_suffix("Sam"),
    }
    assert person_suffix("Sam") == " — Sam"
