"""RSU vests (2026-09-03 calendar spec §6 rsu row): one event per grant tranche, priced at
the latest employer quote — the fold merges same-day tranches into one chip with items."""

import logging
from decimal import Decimal

from app.services import rsu_vesting
from app.services.withholding_calc import CA_SUPPLEMENTAL, FED_SUPPLEMENTAL

from ..model import Event, Item, Window, make_event, money

logger = logging.getLogger(__name__)

# The sell-to-cover legs withholding_calc prices a vest with. Marginal FICA is NOT here: it
# depends on year-to-date wages, which no single event can know — so the detail says
# "≈" and the gross stays the amount (spec §6).
SUPPLEMENTAL = FED_SUPPLEMENTAL + CA_SUPPLEMENTAL


def after_sell_to_cover(gross: Decimal) -> Decimal:
    return money(gross * (1 - SUPPLEMENTAL))


def vest_events(grants: list, window: Window, *, quote: Decimal | None) -> list[Event]:
    """`grants` are grant-shaped rows (label, shares, cliff_pct, first_vest_date,
    vest_quantum). A row rsu_vesting refuses drops its events with a warning (GET-never-
    rejects); zero-share tranches are real vest events and stay (comp.py keeps them too)."""
    events: list[Event] = []
    for grant in grants:
        try:
            tranches = rsu_vesting.schedule(grant)
        except (ValueError, OverflowError) as exc:
            logger.warning("calendar: grant %r cannot be scheduled — %s", grant.label, exc)
            continue
        for vest_date, shares in tranches:
            if not window.contains(vest_date):
                continue
            value = None if quote is None else money(quote * shares)
            detail = f"{shares} sh — {grant.label}"
            if value is not None:
                detail += f" · ≈ ${after_sell_to_cover(value):,.2f} after sell-to-cover"
            events.append(
                make_event(
                    vest_date,
                    "rsu_vest",
                    "vest",  # ONE ref per date: the fold merges the grants (spec §6 key note)
                    f"RSU vest — {grant.label}",
                    "RSU vest",
                    detail=detail,
                    amount=value,
                    direction="in",
                    basis="estimated",
                    href="/comp",
                    items=(Item(grant.label, value, None, f"{shares} sh"),),
                )
            )
    return events
