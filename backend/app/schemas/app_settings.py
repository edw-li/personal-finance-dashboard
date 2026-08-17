"""App-settings wire shapes. GET/PUT both speak EFFECTIVE values: what a reader would
actually use (fallbacks applied), never the raw envelope."""

from decimal import Decimal

from pydantic import BaseModel


class AppSettingsOut(BaseModel):
    swr_pct: Decimal
    espp_ticker: str | None
    price_refresh_cron: str


class AppSettingsUpdate(BaseModel):
    """Full-form PUT (the paycheck/espp whole-form law): all three settings every time."""

    swr_pct: Decimal
    espp_ticker: str | None = None
    price_refresh_cron: str
