"""Forward-looking event composition for GET /calendar (2026-08-24 spec §5).

Pure module — no DB, no HTTP, no clock (`today` is a PARAMETER; rsu_vesting's posture).
The ROUTER loads inputs and hands them over as plain values; pytest drives this with
literals. GET-never-rejects law: a degradable source (a hand-edited grant the vest
scheduler refuses) drops ITS events with a logged warning and never takes the payload
down — api/comp.py catches the same pair and degrades the same way.

Labels carry IDENTITY (grant label, lot purchase date) on purpose: the frontend's ICS
UID is `{type}-{date}-{slugified label}`, and two grants genuinely vest the same day —
identical labels would collide their UIDs and make calendar apps merge distinct events.
The spec §5 table's detail strings are kept verbatim as `detail`.
"""

import logging
from dataclasses import dataclass
from datetime import date

from app.services import rsu_vesting
from app.services.espp_calc import OfferingInfo, StoredPeriod, plan_year_rows

logger = logging.getLogger(__name__)

# Wire vocabulary, pinned once: schemas/calendar.py's Literal and the frontend's
# CalendarEventType both spell exactly these eight.
EVENT_TYPES = (
    "rsu_vest",
    "espp_purchase",
    "espp_qualify",
    "ex_dividend",
    "payday",
    "offering_start",
    "tax_deadline",
    "update_due",
)


@dataclass(frozen=True)
class CalendarEvent:
    """One calendar entry. `event_date`, not `date` — the DailyBar.bar_date naming
    convention (an attribute named `date` shadows the type). The WIRE field is `date`
    (schemas/calendar.py maps it)."""

    event_date: date
    type: str  # one of EVENT_TYPES
    label: str
    detail: str | None
    href: str


def compose(
    start: date,
    end: date,
    *,
    today: date,
    grants: list,  # grant-shaped: label, shares, cliff_pct, first_vest_date, vest_quantum
    stored_periods: list[StoredPeriod],  # EVERY stored period, chain order (period_end, id)
    offerings: list[OfferingInfo],
    unsold_lots: list[tuple[date, date]],  # (purchase_date, qualifying_date)
    announced_ex_divs: list[tuple[str, date]],  # (ticker, next_ex_div_date), HELD only
    payday_semi_monthly: bool,
    missing_update_month: date | None,  # prev month's 1st when it lacks a snapshot
) -> list[CalendarEvent]:
    """Every event in [start, end] inclusive, sorted by (date, type, label) — the spec's
    (date, type) order with a deterministic tiebreak for same-day same-type events."""
    events: list[CalendarEvent] = []

    def in_range(day: date) -> bool:
        return start <= day <= end

    # rsu_vest — computed tranches, clipped. Zero-share tranches are real vest events
    # (comp.py keeps them too) and appear so the calendar matches the /comp table.
    for grant in grants:
        try:
            tranches = rsu_vesting.schedule(grant)
        except (ValueError, OverflowError) as exc:
            logger.warning("calendar: grant %r cannot be scheduled — %s", grant.label, exc)
            continue
        for vest_date, shares in tranches:
            if in_range(vest_date):
                events.append(
                    CalendarEvent(
                        event_date=vest_date,
                        type="rsu_vest",
                        label=f"RSU vest — {grant.label}",
                        detail=f"{shares} sh — {grant.label}",  # unpriced in v1 (spec §5)
                        href="/comp",
                    )
                )

    # espp_purchase — stored + derived period ends, one plan per year the range touches.
    # Pricing inputs are deliberately empty: the calendar needs labels and end dates
    # only, and plan_year_rows leaves rows unpriced without complaint.
    for year in range(start.year, end.year + 1):
        rows, _warnings = plan_year_rows(year, stored_periods, [], None, None)
        for row in rows:
            if in_range(row.period_end):
                events.append(
                    CalendarEvent(
                        event_date=row.period_end,
                        type="espp_purchase",
                        label=f"ESPP purchase — {row.label}",
                        detail=row.label,
                        href="/espp",
                    )
                )

    # espp_qualify — UNSOLD lots only (the router filters sold_date IS NULL; a sold lot
    # has nothing left to qualify). purchase_date is unique per lot, so it is the label's
    # identity; qualifying dates CAN collide across lots.
    for purchase_date, qualifying_date in unsold_lots:
        if in_range(qualifying_date):
            events.append(
                CalendarEvent(
                    event_date=qualifying_date,
                    type="espp_qualify",
                    label=f"ESPP lot qualifies — {purchase_date.isoformat()}",
                    detail=f"{purchase_date.isoformat()} lot qualifies",
                    href="/espp",
                )
            )

    # offering_start — stored rows only (spec §5: no projected enrollment windows).
    for offering in offerings:
        if in_range(offering.offering_start):
            events.append(
                CalendarEvent(
                    event_date=offering.offering_start,
                    type="offering_start",
                    label="ESPP offering starts",
                    detail=f"subscription price {offering.subscription_price}",
                    href="/espp",
                )
            )

    events.sort(key=lambda event: (event.event_date, event.type, event.label))
    return events
