"""App-settings wire shapes. GET/PUT both speak EFFECTIVE values: what a reader would
actually use (fallbacks applied), never the raw envelope."""

from decimal import Decimal

from pydantic import BaseModel


class AppSettingsOut(BaseModel):
    swr_pct: Decimal
    espp_ticker: str | None
    price_refresh_cron: str
    # Day of month (1–28) the monthly-update reminder lands on (2026-09-03 calendar spec §12).
    calendar_update_due_day: int


class AppSettingsUpdate(BaseModel):
    """Full-form PUT (the paycheck/espp whole-form law) for the three original settings.
    `calendar_update_due_day` is the ONE additive exception: None = leave the stored value —
    two Settings cards write this endpoint (the app-settings form and the Calendar feed
    card), and a card that does not show a field must not be able to reset it."""

    swr_pct: Decimal
    espp_ticker: str | None = None
    price_refresh_cron: str
    calendar_update_due_day: int | None = None
