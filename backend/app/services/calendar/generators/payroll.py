"""Paydays (spec §6 payroll row): semi-monthly only — any other cadence omits THAT
person's paydays and the router names them in the health footer. Net pay per check is the
router's `paycheck_calc.breakdown(profile)['net_pay']`, passed in.

One payroll start (2026-09-23 spec §W1): a source carrying its person's `timeline` emits no
payday on or before `starts_on` — the first profile's date, the day the grid's own check pays
the half-month before the job — and prices each payday by the profile in force on THAT day, so
a raise shows from its first check and a September job has no paydays in August."""

from bisect import bisect_right
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.services.business_days import semi_monthly_paydays

from ..model import Event, Item, Window, make_event


def person_suffix(name: str) -> str:
    """The ONE person-tag grammar: `"<label> — <name>"` — this is its definition, and the
    frontend's stripPersonSuffix peels it."""
    return f" — {name}"


@dataclass(frozen=True)
class PayRate:
    """One profile's slice of a person's payroll timeline: from `effective_date` on, each
    payday pays `net_pay` — or is not emitted at all when that profile is not semi-monthly."""

    effective_date: date
    semi_monthly: bool
    net_pay: Decimal | None = None  # None = not computable (a hand-edited profile)


@dataclass(frozen=True)
class PaydaySource:
    name: str
    semi_monthly: bool
    net_pay: Decimal | None = None  # None = not computable (a hand-edited profile)
    person_id: int | None = None
    # §W1: the person's whole timeline, oldest first, and the first profile's date. With a
    # timeline the two fields above only describe TODAY's profile (the health note's business);
    # without one — a caller that has a single rate — the source is priced exactly as before.
    timeline: tuple[PayRate, ...] = ()
    starts_on: date | None = None


def _rate_on(source: PaydaySource, payday: date) -> PayRate | None:
    """The slice in force on `payday`: the newest one effective on or before it. None before
    the first — which the `starts_on` fence has already excluded, so only a hand-built source
    whose timeline starts later than its `starts_on` can reach it."""
    index = bisect_right([rate.effective_date for rate in source.timeline], payday) - 1
    return source.timeline[index] if index >= 0 else None


def payday_events(sources: list[PaydaySource], window: Window) -> list[Event]:
    """Labels carry the name only when there is somebody to tell apart (v1's rule, pinned):
    a one-profile household keeps the bare "Payday". The count is of PROFILED people."""
    labelled = len(sources) > 1
    events: list[Event] = []
    for source in sources:
        if not source.timeline and not source.semi_monthly:
            continue
        for month in window.months():
            for payday in semi_monthly_paydays(month.year, month.month):
                if not window.contains(payday):
                    continue
                net_pay = source.net_pay
                if source.timeline:
                    if source.starts_on is not None and payday <= source.starts_on:
                        continue  # before the job: nothing is paid (§W1)
                    rate = _rate_on(source, payday)
                    if rate is None or not rate.semi_monthly:
                        continue  # paid on another cadence that day: no payday to show
                    net_pay = rate.net_pay
                events.append(
                    make_event(
                        payday,
                        "payday",
                        "payday",
                        ("Payday" + person_suffix(source.name)) if labelled else "Payday",
                        "Payday",
                        detail=source.name if labelled else None,
                        amount=net_pay,
                        direction="in",
                        basis="scheduled",
                        href="/paycheck",
                        items=(Item(source.name, net_pay, source.person_id, None),),
                    )
                )
    return events
