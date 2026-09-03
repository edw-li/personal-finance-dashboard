"""Federal tax deadlines (spec §6 tax row): the five statutory dates, forward-adjusted.
Amounts — the safe-harbor shortfall split across remaining payment dates and the prior
year's balance on Apr 15 — arrive with Lane D through `TaxFacts`; this module already
accepts the dict so the signature never moves."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.services.business_days import next_business_day

from ..model import Event, Window, make_event


@dataclass(frozen=True)
class TaxFacts:
    """One tax year's withholding picture, reduced to what the generator prices with
    (filled by api/calendar.py from the withholding tracker — Lane D)."""

    year: int
    effective_threshold: Decimal | None = None
    total_projected: Decimal | None = None
    effective_leg: str | None = None  # "prior-year" | "current-year"
    prior_year_balance: Decimal | None = None  # positive balance owed for year-1 (Apr 15 filing)


def nominal_dates(year: int) -> list[tuple[date, str, str, str]]:
    """(nominal date, detail, entity_ref, short_label) — Jan 15 of Y is Y-1's Q4."""
    return [
        (date(year, 1, 15), f"Q4 {year - 1} estimated payment", f"{year - 1}-q4", "Q4 est. tax"),
        (
            date(year, 4, 15),
            "federal filing + Q1 estimated payment",
            f"{year}-q1",
            "Filing + Q1 est.",
        ),
        (date(year, 6, 15), "Q2 estimated payment", f"{year}-q2", "Q2 est. tax"),
        (date(year, 9, 15), "Q3 estimated payment", f"{year}-q3", "Q3 est. tax"),
        (
            date(year, 10, 15),
            "extension filing deadline",
            f"{year}-extension",
            "Extension deadline",
        ),
    ]


def tax_deadline_events(
    window: Window, today: date, facts_by_year: dict[int, TaxFacts]
) -> list[Event]:
    events: list[Event] = []
    for year in range(window.start.year, window.end.year + 1):
        for nominal, which, ref, short in nominal_dates(year):
            due = next_business_day(nominal)
            if not window.contains(due):
                continue
            events.append(
                make_event(
                    due,
                    "tax_deadline",
                    ref,
                    f"Tax deadline — {which}",
                    short,
                    detail=which,
                    direction="out",
                    basis="scheduled",
                    href="/taxes",
                )
            )
    return events
