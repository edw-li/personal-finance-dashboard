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
from app.services.business_days import next_business_day, semi_monthly_paydays
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

_MONTH_NAMES = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)  # our own literal — calendar.month_name is locale-dependent


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

    # ex_dividend — announced dates on ACTIVELY-HELD securities. The router folds the
    # positions and passes only held tickers; §3's refresh keeps the column honest
    # (future-only, cleared once past), so no date math is needed here beyond clipping.
    for ticker, ex_date in announced_ex_divs:
        if in_range(ex_date):
            events.append(
                CalendarEvent(
                    event_date=ex_date,
                    type="ex_dividend",
                    label=f"Ex-dividend — {ticker}",
                    detail=ticker,
                    href="/portfolio",
                )
            )

    # payday — ONLY the semi-monthly cadence (spec §5: pay_periods_per_year == 24; any
    # other cadence omits paydays entirely — the page legend says so in words — because
    # guessing biweekly anchors would be wrong money on the calendar).
    if payday_semi_monthly:
        year, month = start.year, start.month
        while (year, month) <= (end.year, end.month):
            for payday in semi_monthly_paydays(year, month):
                if in_range(payday):
                    events.append(
                        CalendarEvent(
                            event_date=payday,
                            type="payday",
                            label="Payday",
                            detail=None,
                            href="/paycheck",
                        )
                    )
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)

    # tax_deadline — static federal rules adjusted FORWARD (the IRS moves a weekend/
    # holiday due date to the NEXT business day — the opposite of payroll). Jan 15 of
    # year Y is year Y-1's Q4. Apr 15 is ONE event: filing and Q1 share the date, and
    # two same-label events would collide their ICS UIDs.
    for year in range(start.year, end.year + 1):
        for nominal, which in (
            (date(year, 1, 15), f"Q4 {year - 1} estimated payment"),
            (date(year, 4, 15), "federal filing + Q1 estimated payment"),
            (date(year, 6, 15), "Q2 estimated payment"),
            (date(year, 9, 15), "Q3 estimated payment"),
            (date(year, 10, 15), "extension filing deadline"),
        ):
            due = next_business_day(nominal)
            if in_range(due):
                events.append(
                    CalendarEvent(
                        event_date=due,
                        type="tax_deadline",
                        label=f"Tax deadline — {which}",
                        detail=which,
                        href="/taxes",
                    )
                )

    # update_due — one reminder while the previous month's net-worth snapshot is
    # missing, dated max(1st-of-current-month, today) (spec §5: pinned to the month's
    # start but never in the past; today >= its own 1st always, so the max IS today —
    # the expression keeps the spec's wording visible).
    if missing_update_month is not None:
        due = max(date(today.year, today.month, 1), today)
        if in_range(due):
            month_name = _MONTH_NAMES[missing_update_month.month - 1]
            events.append(
                CalendarEvent(
                    event_date=due,
                    type="update_due",
                    label="Monthly update due",
                    detail=f"Enter {month_name} {missing_update_month.year}",
                    href="/update",
                )
            )

    events.sort(key=lambda event: (event.event_date, event.type, event.label))
    return events
