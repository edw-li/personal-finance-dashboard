"""App-settings wire shapes. GET/PUT both speak EFFECTIVE values: what a reader would
actually use (fallbacks applied), never the raw envelope."""

from decimal import Decimal

from pydantic import BaseModel


class AppSettingsOut(BaseModel):
    swr_pct: Decimal
    espp_ticker: str | None
    # The plan's ESPP discount as a FRACTION: 0.15 = 15 % off. Plan-wide, not per offering
    # — one rate prices every purchase the app models (2026-09-06 spec §1.5).
    espp_discount_pct: Decimal
    price_refresh_cron: str
    # Day of month (1–28) the monthly-update reminder lands on (2026-09-03 calendar spec §12).
    calendar_update_due_day: int


class AppSettingsUpdate(BaseModel):
    """PARTIAL PUT (2026-09-06 spec §3.5): several Settings cards write this one endpoint,
    and a card that does not show a field must not be able to reset it. ABSENT keeps the
    stored value; PRESENT is validated and written — which is why `espp_ticker: null` still
    CLEARS the ticker, the one field whose empty value is a real user intention."""

    swr_pct: Decimal | None = None
    espp_ticker: str | None = None
    espp_discount_pct: Decimal | None = None
    price_refresh_cron: str | None = None
    calendar_update_due_day: int | None = None
