"""The calendar engine (2026-09-03 calendar spec §5): generated events are computed on read
from the services the owning pages already use, folded per (type, date) for vests and
paydays, and overlaid with the user's overrides. `compose()` is the only public entry.

Pure — no DB, no HTTP, no clock (`today` is a PARAMETER). The ROUTER loads `Sources`;
pytest drives this with literals."""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from app.services.espp_calc import OfferingInfo, StoredPeriod

from .fold import fold_same_day
from .generators import cards, custom, dividends, espp, payroll, ritual, rsu, taxes
from .generators.cards import CardFacts
from .generators.custom import CustomRow
from .generators.dividends import ExDividend
from .generators.payroll import PaydaySource
from .generators.taxes import TaxFacts
from .model import Event, Window
from .overrides import Override
from .overrides import apply as apply_overrides


@dataclass
class Sources:
    """Everything the generators read, as plain values. `cards` and `tax_facts` are the
    two the ROUTER derives rather than reads straight off a table (card roster + credits,
    the withholding tracker) — see api/calendar.py's `_card_facts` / `_tax_facts`."""

    grants: list = field(default_factory=list)  # grant-shaped rows (rsu_vesting.schedule)
    # generators.rsu.resolve's parallel list, when the ROUTER already resolved the
    # schedules for its health footer; None = let the generator resolve them.
    vest_schedules: list | None = None
    quote: Decimal | None = None  # latest employer quote; None = vests unpriced
    stored_periods: list[StoredPeriod] = field(default_factory=list)
    offerings: list[OfferingInfo] = field(default_factory=list)
    unsold_lots: list[tuple[date, date]] = field(default_factory=list)
    ex_dividends: list[ExDividend] = field(default_factory=list)  # HELD securities only
    payday_sources: list[PaydaySource] = field(default_factory=list)
    custom_rows: list[CustomRow] = field(default_factory=list)
    due_day: int = 1
    entered_months: set[date] = field(default_factory=set)  # first-of-month snapshot months
    tax_facts: dict[int, TaxFacts] = field(default_factory=dict)
    cards: list[CardFacts] = field(default_factory=list)


def compose(
    window: Window,
    *,
    today: date,
    sources: Sources,
    overrides: dict[str, Override] | None = None,
) -> list[Event]:
    """Every event in the window, folded, overlaid, sorted by (date, type, label)."""
    events: list[Event] = []
    events += rsu.vest_events(
        sources.grants, window, quote=sources.quote, schedules=sources.vest_schedules
    )
    events += espp.espp_events(
        sources.stored_periods, sources.offerings, sources.unsold_lots, window
    )
    events += dividends.ex_dividend_events(sources.ex_dividends, window)
    events += payroll.payday_events(sources.payday_sources, window)
    events += taxes.tax_deadline_events(window, today, sources.tax_facts)
    events += cards.card_events(sources.cards, window, today)
    events += ritual.ritual_events(window, today, sources.due_day, sources.entered_months)
    events += custom.custom_events(sources.custom_rows, window)
    composed = apply_overrides(fold_same_day(events), overrides or {})
    composed.sort(key=lambda event: (event.event_date, event.type, event.label))
    return composed


__all__ = ["Sources", "compose"]
