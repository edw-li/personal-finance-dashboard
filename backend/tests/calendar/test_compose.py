"""`compose()` — every family, one fold, one overlay, one sort (2026-09-03 calendar spec
§5). Pure: `today` is a parameter and `Sources` is plain values."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.calendar import Sources, compose
from app.services.calendar.generators.custom import CustomRow
from app.services.calendar.generators.payroll import PaydaySource
from app.services.calendar.model import Window
from app.services.calendar.overrides import Override
from tests.calendar.test_generators import COPY, ritual_status

TODAY = date(2026, 8, 24)


def test_compose_runs_every_family_folds_overlays_and_sorts():
    grants = [
        SimpleNamespace(
            label="A",
            shares=400,
            cliff_pct=Decimal("0.25"),
            first_vest_date=date(2026, 3, 18),
            vest_quantum=1,
        ),
        SimpleNamespace(
            label="B",
            shares=160,
            cliff_pct=Decimal("0.25"),
            first_vest_date=date(2026, 3, 18),
            vest_quantum=1,
        ),
    ]
    sources = Sources(
        grants=grants,
        quote=Decimal("500"),
        payday_sources=[PaydaySource("Me", True, Decimal("5000"), 1)],
        custom_rows=[
            CustomRow(
                3, date(2026, 9, 15), "Zoo membership", None, amount=Decimal("120"), direction="out"
            )
        ],
        # No month status (2026-09-23 spec §T6): the reminder asks an empty book for its first
        # balances on Sep 1 and Oct 1 — neither lands in this two-day window.
    )
    events = compose(
        Window(date(2026, 9, 15), date(2026, 9, 16)),
        today=TODAY,
        sources=sources,
        overrides={
            "rsu:vest:2026-09-16": Override("rsu:vest:2026-09-16", False, False, "sell 10", None)
        },
    )
    assert [(e.event_date, e.type, e.label) for e in events] == [
        (date(2026, 9, 15), "custom", "Zoo membership"),
        (date(2026, 9, 15), "payday", "Payday"),
        (date(2026, 9, 15), "tax_deadline", "Tax deadline — Q3 estimated payment"),
        (date(2026, 9, 16), "rsu_vest", "RSU vest — 2 grants"),
    ]
    vest = events[-1]
    assert (vest.amount, vest.note, len(vest.items)) == (Decimal("17500.00"), "sell 10", 2)
    assert {e.key for e in events} == {
        "custom:3:2026-09-15",
        "payroll:payday:2026-09-15",
        "tax:2026-q3:2026-09-15",
        "rsu:vest:2026-09-16",
    }


def test_compose_with_empty_sources_yields_only_the_always_on_families():
    events = compose(Window(date(2026, 9, 1), date(2026, 9, 30)), today=TODAY, sources=Sources())
    # Tax Q3 + the monthly reminder on Sep 1, asking an empty book for its first balances
    # (2026-09-23 spec §T6) — nothing else exists.
    assert sorted({e.type for e in events}) == ["tax_deadline", "update_due"]
    reminder = next(e for e in events if e.type == "update_due")
    assert (reminder.label, reminder.key) == (
        "Monthly update — Sep 1 balances",
        "ritual:2026-08:2026-09-01",
    )


def test_same_day_reminders_read_oldest_month_first():
    """A backlog re-dated to one day (lane T code review, minor 1): the monthly reminders sort by
    the month they ask about, oldest first — Oct, Nov, Dec, Jan — not alphabetically by label
    ("Jan 1…" before "November…" before "Oct 1…")."""
    today = date(2027, 1, 5)
    events = compose(
        Window(today, today),
        today=today,
        sources=Sources(month_status=ritual_status(today, **COPY)),
    )
    assert [e.key for e in events if e.type == "update_due"] == [
        "ritual:2026-09:2026-10-01",
        "ritual:2026-10:2026-11-01",
        "ritual:2026-11:2026-12-01",
        "ritual:2026-12:2027-01-01",
    ]
