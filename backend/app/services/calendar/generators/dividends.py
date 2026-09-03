"""Ex-dividend dates on HELD securities (spec §6 dividend row): held shares × the latest
stored per-share amount, or null when either is unknown. Pay dates stay out."""

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from ..model import Event, Window, make_event, money, shorten

_REF_SAFE = re.compile(r"[^A-Za-z0-9._-]")


@dataclass(frozen=True)
class ExDividend:
    ticker: str
    ex_date: date
    shares: Decimal | None = None
    per_share: Decimal | None = None


def ex_dividend_events(announced: list[ExDividend], window: Window) -> list[Event]:
    events: list[Event] = []
    for item in announced:
        if not window.contains(item.ex_date):
            continue
        priced = item.shares is not None and item.per_share is not None
        amount = money(item.shares * item.per_share) if priced else None
        detail = item.ticker
        if priced:
            detail += f" · {item.shares.normalize():f} sh × ${item.per_share:.6f}"
        events.append(
            make_event(
                item.ex_date,
                "ex_dividend",
                _REF_SAFE.sub("-", item.ticker)[:60],
                f"Ex-dividend — {item.ticker}",
                shorten(f"Ex-div {item.ticker}"),
                detail=detail,
                amount=amount,
                direction="in",
                basis="estimated",
                href="/portfolio",
            )
        )
    return events
