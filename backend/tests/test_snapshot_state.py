"""Snapshot state — provisional, as-of and current (2026-09-23 spec §0.4(b), §K2)."""

from datetime import date

from app.models import NetWorthSnapshot
from app.services.snapshot_state import (
    SnapshotState,
    current_and_previous,
    load_snapshot_states,
    snapshot_state,
    state_out,
)

TODAY = date(2026, 9, 23)
AUG, SEP, OCT, NOV, DEC = (date(2026, month, 1) for month in (8, 9, 10, 11, 12))
SEP_22 = date(2026, 9, 22)


def test_recorded_on_its_first_it_is_final_as_of_the_first():
    assert snapshot_state(1, SEP, SEP, TODAY) == SnapshotState(1, SEP, SEP, False, SEP)


def test_recorded_after_its_first_it_is_final_as_of_the_first():
    # The book's first snapshot: Sep 2023, recorded Sep 24 (§0.6 decision 1).
    state = snapshot_state(1, date(2023, 9, 1), date(2023, 9, 24), TODAY)
    assert (state.provisional, state.as_of) == (False, date(2023, 9, 1))


def test_recorded_before_its_first_it_is_provisional_as_of_the_recorded_day():
    # The copy's Oct 1 balances, typed on Sep 22.
    assert snapshot_state(38, OCT, SEP_22, TODAY) == SnapshotState(38, OCT, SEP_22, True, SEP_22)


def test_a_null_date_is_final():
    assert snapshot_state(1, SEP, None, TODAY) == SnapshotState(1, SEP, None, False, SEP)


def test_a_month_still_ahead_is_provisional_with_no_known_date():
    for recorded_on in (None, NOV, date(2026, 11, 5)):
        state = snapshot_state(1, NOV, recorded_on, TODAY)
        assert (state.provisional, state.as_of) == (True, None), recorded_on


def test_a_begun_month_recorded_after_today_is_final_by_the_rule():
    # Only an API client or an import can store such a date.
    state = snapshot_state(1, SEP, date(2026, 9, 30), TODAY)
    assert (state.provisional, state.as_of) == (False, SEP)


def states(*pairs):
    return [
        snapshot_state(i, month, recorded_on, TODAY)
        for i, (month, recorded_on) in enumerate(pairs, 1)
    ]


def test_the_current_snapshot_is_the_latest_up_to_next_month():
    current, previous = current_and_previous(states((AUG, AUG), (SEP, SEP), (OCT, SEP_22)), TODAY)
    assert (current.month, previous.month) == (OCT, SEP)


def test_a_snapshot_two_months_ahead_is_never_current():
    found = states((SEP, SEP), (OCT, SEP_22), (NOV, None))
    current, previous = current_and_previous(found, TODAY)
    assert (current.month, previous.month) == (OCT, SEP)
    # Unsorted input is sorted first.
    assert current_and_previous(list(reversed(found)), TODAY)[0].month == OCT


def test_nothing_is_current_when_every_snapshot_is_further_ahead():
    assert current_and_previous(states((DEC, None)), TODAY) == (None, None)
    assert current_and_previous([], TODAY) == (None, None)


def test_a_lone_snapshot_has_no_previous():
    current, previous = current_and_previous(states((SEP, SEP)), TODAY)
    assert (current.month, previous) == (SEP, None)


async def test_load_snapshot_states_reads_every_snapshot_ascending(db):
    db.add_all(
        [
            NetWorthSnapshot(month=OCT, recorded_on=SEP_22),
            NetWorthSnapshot(month=SEP, recorded_on=SEP),
        ]
    )
    await db.commit()
    loaded = await load_snapshot_states(db, TODAY)
    assert [(s.month, s.provisional, s.as_of) for s in loaded] == [
        (SEP, False, SEP),
        (OCT, True, SEP_22),
    ]


def test_state_out_is_the_wire_shape_and_one_class_under_two_names():
    from app.schemas.coverage import SnapshotStateOut as FromCoverage
    from app.schemas.net_worth import SnapshotStateOut

    assert FromCoverage is SnapshotStateOut
    assert state_out(snapshot_state(38, OCT, SEP_22, TODAY)).model_dump(mode="json") == {
        "month": "2026-10-01",
        "as_of": "2026-09-22",
        "recorded_on": "2026-09-22",
        "provisional": True,
    }
