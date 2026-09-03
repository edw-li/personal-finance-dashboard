"""Card events (2026-09-03 calendar spec §6 card row): `opened_on` anniversaries → a
`card_fee` (when annual_fee > 0) and a `card_anniversary`; counted credits → a
`card_credit` on their reset date (`calendar` = Jan 1, `anniversary` = the card's
anniversary). No `opened_on` → no fee or anniversary (the router counts those cards in the
health footer). Pure — CardFacts are plain values."""

import calendar as _calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from ..model import Event, Window, make_event, shorten

HREF = "/credit-cards"
# 5/24: an account opened 24 months ago stops counting against Chase's new-card rule.
FALLS_OFF_YEAR = 2


@dataclass(frozen=True)
class CardCreditFacts:
    credit_id: int
    label: str
    annual_value: Decimal
    reset_cadence: str  # "calendar" | "anniversary"


@dataclass(frozen=True)
class CardFacts:
    card_id: int
    name: str
    annual_fee: Decimal
    opened_on: date | None
    credits: tuple[CardCreditFacts, ...] = ()  # counted credits only (the router filters)


def anniversary(opened_on: date, year: int) -> date:
    """The opening date's anniversary in `year`; a Feb 29 opening lands on Feb 28."""
    day = min(opened_on.day, _calendar.monthrange(year, opened_on.month)[1])
    return date(year, opened_on.month, day)


def card_events(cards: list[CardFacts], window: Window, today: date) -> list[Event]:
    events: list[Event] = []
    for card in cards:
        for year in range(window.start.year, window.end.year + 1):
            if card.opened_on is not None:
                years_open = year - card.opened_on.year
                anniv = anniversary(card.opened_on, year)
                if years_open >= 1 and window.contains(anniv):
                    detail = f"Year {years_open} with {card.name}"
                    if years_open == FALLS_OFF_YEAR:
                        detail += " — falls off 5/24"
                    events.append(
                        make_event(
                            anniv,
                            "card_anniversary",
                            str(card.card_id),
                            f"{card.name} anniversary",
                            shorten(f"{card.name} anniv."),
                            detail=detail,
                            basis="confirmed",
                            href=HREF,
                        )
                    )
                    if card.annual_fee > 0:
                        events.append(
                            make_event(
                                anniv,
                                "card_fee",
                                f"{card.card_id}-fee",
                                f"{card.name} annual fee",
                                "Card fee",
                                detail=f"${card.annual_fee:,.2f} annual fee — year {years_open}",
                                amount=card.annual_fee,
                                direction="out",
                                basis="confirmed",
                                href=HREF,
                            )
                        )
            for credit in card.credits:
                if credit.reset_cadence == "calendar":
                    reset = date(year, 1, 1)
                elif card.opened_on is not None and year > card.opened_on.year:
                    reset = anniversary(card.opened_on, year)
                else:
                    continue  # an anniversary reset needs an opened_on (health footer names it)
                # The opening year's Jan 1 is BEFORE the card existed — that reset never
                # happened, so it is not an event (the anniversary arm cannot hit this).
                if card.opened_on is not None and reset < card.opened_on:
                    continue
                if window.contains(reset):
                    events.append(
                        make_event(
                            reset,
                            "card_credit",
                            f"credit-{credit.credit_id}",
                            f"{card.name} — {credit.label} resets",
                            "Credit resets",
                            detail=f"${credit.annual_value:,.2f} to use this year",
                            amount=credit.annual_value,
                            direction="neutral",  # a credit is value to use, not cash in
                            basis="confirmed",
                            href=HREF,
                        )
                    )
    return events
