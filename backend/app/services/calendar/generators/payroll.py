"""Paydays (spec §6 payroll row): semi-monthly only — any other cadence omits THAT
person's paydays and the router names them in the health footer. Net pay per check is the
router's `paycheck_calc.breakdown(profile)['net_pay']`, passed in."""

from dataclasses import dataclass
from decimal import Decimal

from app.services.business_days import semi_monthly_paydays

from ..model import Event, Item, Window, make_event


def person_suffix(name: str) -> str:
    """The ONE person-tag grammar: `"<label> — <name>"` (calendar_events.person_suffix's
    definition, kept byte-identical — the frontend's stripPersonSuffix peels it)."""
    return f" — {name}"


@dataclass(frozen=True)
class PaydaySource:
    name: str
    semi_monthly: bool
    net_pay: Decimal | None = None  # None = not computable (a hand-edited profile)
    person_id: int | None = None


def payday_events(sources: list[PaydaySource], window: Window) -> list[Event]:
    """Labels carry the name only when there is somebody to tell apart (v1's rule, pinned):
    a one-profile household keeps the bare "Payday". The count is of PROFILED people."""
    labelled = len(sources) > 1
    events: list[Event] = []
    for source in sources:
        if not source.semi_monthly:
            continue
        for month in window.months():
            for payday in semi_monthly_paydays(month.year, month.month):
                if not window.contains(payday):
                    continue
                events.append(
                    make_event(
                        payday,
                        "payday",
                        "payday",
                        ("Payday" + person_suffix(source.name)) if labelled else "Payday",
                        "Payday",
                        detail=source.name if labelled else None,
                        amount=source.net_pay,
                        direction="in",
                        basis="scheduled",
                        href="/paycheck",
                        items=(Item(source.name, source.net_pay, source.person_id, None),),
                    )
                )
    return events
