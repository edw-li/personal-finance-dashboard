"""The employer ticker: THE reader of app_settings['espp_ticker'] (batch 2 integration, 2026-09-24).

One setting names the employer's stock for the ESPP lots, the RSU vests and the withholding
card's vest leg. Its readers used to be four copies of one rule: the espp router's quote chain,
the Settings GET, the read caches' fingerprint binding and the employer history backfill. A copy
that drifted would price vests with one ticker while a cache fingerprinted the quote of another,
or show one ticker in Settings while the pages resolved a different one. So they all call this
function, and tests/test_employer_ticker.py pins every one of them on each stored shape and
fences a second direct read out of app/.

A service, not a router: read_cache and price_service need it too, and a service may not import
a router (2026-09-23 spec §K3)."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting


async def read_employer_ticker(db: AsyncSession) -> str | None:
    """The ticker the app resolves, or None when unconfigured.

    The envelope (`{"value": ...}`) is convention only (Plan 1 note), so an absent row, a value
    that is not a string, or anything that is not an envelope all read as "no ticker", never
    raising, like net_worth_calc.get_swr_pct minus the default (there is no sane fallback
    ticker). A string is trimmed and upper-cased, as portfolio._normalize_ticker does to a
    typed one, so a hand-stored "nvda" still meets the NVDA securities row. A blank one is
    unconfigured: the Settings PUT stores "" when the ticker is cleared."""
    setting = await db.get(AppSetting, "espp_ticker")
    if setting is None or not isinstance(setting.value, dict):
        return None
    raw = setting.value.get("value")
    ticker = raw.strip().upper() if isinstance(raw, str) else ""
    return ticker or None
