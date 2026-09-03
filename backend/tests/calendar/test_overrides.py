"""The user-edit overlay (2026-09-03 calendar spec §13): done / hidden / note / the figure
actually paid, keyed by the event's stable key."""

from datetime import date
from decimal import Decimal

from app.services.calendar.model import make_event
from app.services.calendar.overrides import Override, apply


def q3():
    return make_event(
        date(2026, 9, 15),
        "tax_deadline",
        "2026-q3",
        "Tax deadline — Q3 estimated payment",
        "Q3 est. tax",
        amount=Decimal("1200"),
        direction="out",
        basis="estimated",
        href="/taxes",
    )


def test_apply_sets_done_hidden_note_and_the_users_figure():
    [event] = apply(
        [q3()],
        {
            "tax:2026-q3:2026-09-15": Override(
                "tax:2026-q3:2026-09-15", True, False, "paid via EFTPS", Decimal("1250")
            )
        },
    )
    assert (event.done, event.hidden, event.note) == (True, False, "paid via EFTPS")
    assert (event.amount, event.basis, event.amount_overridden) == (
        Decimal("1250.00"),
        "confirmed",
        True,
    )


def test_a_null_override_amount_leaves_the_derived_figure():
    [event] = apply(
        [q3()],
        {"tax:2026-q3:2026-09-15": Override("tax:2026-q3:2026-09-15", False, True, None, None)},
    )
    assert (event.amount, event.basis, event.amount_overridden, event.hidden) == (
        Decimal("1200.00"),
        "estimated",
        False,
        True,
    )


def test_orphan_keys_are_ignored_and_unmatched_events_untouched():
    original = q3()
    assert apply(
        [original],
        {"rsu:vest:2099-01-01": Override("rsu:vest:2099-01-01", True, True, None, None)},
    ) == [original]
