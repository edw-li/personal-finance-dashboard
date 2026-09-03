"""Federal tax deadlines (spec §6 tax row): the five statutory dates, forward-adjusted,
priced from `TaxFacts` — the safe-harbor shortfall split across the REMAINING current-year
payment dates plus the prior year's balance on the Apr 15 filing. A date the tracker cannot
see (a past one, a year without facts, facts without both harbor figures) keeps v1's bare
date: null amount, `scheduled` basis, the statutory sentence as its detail."""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_DOWN, Decimal

from app.services.business_days import next_business_day

from ..model import MONEY_QUANTUM, Event, Window, make_event, money


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


def payment_dates(tax_year: int) -> list[date]:
    """The four estimated-payment due dates of ONE tax year, forward-adjusted: Apr 15, Jun 15,
    Sep 15 of the year and Jan 15 of the next (that Q4 date belongs to THIS tax year)."""
    return [
        next_business_day(date(tax_year, 4, 15)),
        next_business_day(date(tax_year, 6, 15)),
        next_business_day(date(tax_year, 9, 15)),
        next_business_day(date(tax_year + 1, 1, 15)),
    ]


def _split(total: Decimal, count: int) -> list[Decimal]:
    """Even cent shares; the LAST date absorbs the rounding remainder so the parts sum
    exactly. The share TRUNCATES rather than rounding (money() is half-up), so a stray cent
    is asked for on the last date instead of being pre-paid on the first."""
    share = (total / count).quantize(MONEY_QUANTUM, rounding=ROUND_DOWN)
    return [share] * (count - 1) + [money(total - share * (count - 1))]


def _priced(
    due: date, ref: str, tax_year: int, today: date, facts: TaxFacts | None
) -> tuple[Decimal | None, str | None]:
    """(amount, verdict) for one payment date, or (None, None) when the tracker cannot see it:
    a past date (history), a year without facts, or facts without both harbor figures."""
    if facts is None or due < today:
        return None, None
    amount: Decimal | None = None
    parts: list[str] = []
    if facts.effective_threshold is not None and facts.total_projected is not None:
        remaining = [d for d in payment_dates(tax_year) if d >= today]
        if due in remaining:
            shortfall = max(Decimal("0"), facts.effective_threshold - facts.total_projected)
            share = _split(shortfall, len(remaining))[remaining.index(due)]
            amount = share
            leg = facts.effective_leg or "current-year"
            parts.append(
                "Safe harbor met — no payment needed"
                if shortfall == 0
                else f"Shortfall ${shortfall:,.2f} to the {leg} leg — ${share:,.2f} of it here"
            )
    if (
        ref.endswith("-q1")
        and facts.prior_year_balance is not None
        and facts.prior_year_balance > 0
    ):
        amount = (amount or Decimal("0")) + facts.prior_year_balance
        parts.append(f"files {tax_year - 1}: balance ≈ ${facts.prior_year_balance:,.2f}")
    if amount is None:
        return None, None
    return money(amount), " · ".join(parts)


def tax_deadline_events(
    window: Window, today: date, facts_by_year: dict[int, TaxFacts]
) -> list[Event]:
    events: list[Event] = []
    for year in range(window.start.year, window.end.year + 1):
        for nominal, which, ref, short in nominal_dates(year):
            due = next_business_day(nominal)
            if not window.contains(due):
                continue
            # Jan 15 of Y is tax year Y-1's Q4; the extension is Y-1's return; the rest are Y's.
            tax_year = year - 1 if ref.endswith(("-q4", "-extension")) else year
            # The extension is a FILING date, never a payment one — it carries no share.
            amount, verdict = (
                (None, None)
                if ref.endswith("-extension")
                else _priced(due, ref, tax_year, today, facts_by_year.get(tax_year))
            )
            events.append(
                make_event(
                    due,
                    "tax_deadline",
                    ref,
                    f"Tax deadline — {which}",
                    short,
                    detail=verdict if verdict is not None else which,
                    amount=amount,
                    direction="out",
                    basis="estimated" if amount is not None else "scheduled",
                    href="/taxes",
                )
            )
    return events
