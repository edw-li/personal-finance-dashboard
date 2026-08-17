"""App-settings vertical (spec §6 /settings). GET returns EFFECTIVE values via the same
readers the app uses; PUT is full-form and stores the readers' envelope {"value": ...}.

The cron guard is server-side (plan-4 forward note: '* * * * *' would hammer Yahoo):
parse with the scheduler's own CronTrigger, reject sub-hourly cadence and numeric
day-of-week (APScheduler numbers days 0=Mon — the recorded prod mis-seed). The scheduler
reads the cron ONCE at boot; this router only stores — the UI carries the restart note."""

from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.portfolio import _normalize_ticker
from app.database import get_db
from app.models import AppSetting
from app.schemas.app_settings import AppSettingsOut, AppSettingsUpdate
from app.services.money import quantize_pct
from app.services.net_worth_calc import get_swr_pct
from app.services.scheduler import SCHEDULER_TIMEZONE, read_cron_setting

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(get_current_user)])

ZERO = Decimal("0")
# Hourly is the floor: the scheduler exists for one post-close refresh (+ the spec's
# optional midday tick) — anything faster is a Yahoo-rate mistake, not a use case.
MIN_FIRE_GAP = timedelta(minutes=60)
# Fixed probe anchor (a Monday) keeps the guard deterministic; 8 successive fires is
# enough to catch multi-fire-per-hour shapes like "10,40 13 * * *".
_PROBE_ANCHOR = datetime(2026, 1, 5, tzinfo=ZoneInfo(SCHEDULER_TIMEZONE))
_PROBE_FIRES = 8


async def _read_espp_ticker(db: AsyncSession) -> str | None:
    # Mirrors the espp router's first hop, normalization included (blank/absent/malformed
    # -> unconfigured, "nvda" -> "NVDA"): GET must report the ticker espp would actually
    # resolve. Promote a shared reader if a third consumer ever appears.
    setting = await db.get(AppSetting, "espp_ticker")
    if setting is None or not isinstance(setting.value, dict):
        return None
    raw = setting.value.get("value")
    ticker = raw.strip().upper() if isinstance(raw, str) else ""
    return ticker or None


def _validated_swr(value: Decimal) -> Decimal:
    # get_swr_pct's fallback bounds as HARD validation: what the reader silently
    # discards, the writer refuses. The `+ ZERO` is the house signed-zero collapse
    # (taxes.py's trick): "-0" clears the `< 0` check — it compares EQUAL to zero — and
    # would otherwise be stored and echoed as "-0.000000".
    if not value.is_finite() or value < 0 or value > 1:
        raise HTTPException(status_code=422, detail="swr_pct: must be a fraction between 0 and 1")
    return quantize_pct(value) + ZERO


def _validated_cron(value: str) -> str:
    cron = value.strip()
    try:
        trigger = CronTrigger.from_crontab(cron, timezone=SCHEDULER_TIMEZONE)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=(
                "price_refresh_cron: not a valid 5-field cron expression (e.g. '10 13 * * mon-fri')"
            ),
        ) from None
    day_of_week = cron.split()[4]
    if any(ch.isdigit() for ch in day_of_week):
        raise HTTPException(
            status_code=422,
            detail=(
                "price_refresh_cron: use day NAMES in the day-of-week field (e.g. mon-fri) "
                "— the scheduler numbers days 0=Mon, so numeric days are misread"
            ),
        )
    previous: datetime | None = None
    now = _PROBE_ANCHOR
    for _ in range(_PROBE_FIRES):
        nxt = trigger.get_next_fire_time(previous, now)
        # Live defensive branch for impossible date combinations: "0 0 30 2 *" PARSES
        # (day 30 and month 2 are each in range) but can never fire, so there is no next
        # time to compare. NOT the same as "0 0 29 2 *", which does fire — in leap years.
        if nxt is None:
            break
        if previous is not None and nxt - previous < MIN_FIRE_GAP:
            raise HTTPException(
                status_code=422,
                detail="price_refresh_cron: must not fire more often than hourly",
            )
        previous, now = nxt, nxt
    return cron


@router.get("", response_model=AppSettingsOut)
async def get_settings(db: AsyncSession = Depends(get_db)) -> AppSettingsOut:
    return AppSettingsOut(
        swr_pct=await get_swr_pct(db),
        espp_ticker=await _read_espp_ticker(db),
        price_refresh_cron=await read_cron_setting(db),
    )


@router.put("", response_model=AppSettingsOut)
async def put_settings(
    body: AppSettingsUpdate, db: AsyncSession = Depends(get_db)
) -> AppSettingsOut:
    swr = _validated_swr(body.swr_pct)
    ticker = (
        ""
        if body.espp_ticker is None or not body.espp_ticker.strip()
        else _normalize_ticker(body.espp_ticker)
    )
    cron = _validated_cron(body.price_refresh_cron)
    # Envelope {"value": ...} is the readers' convention (Plan 1 note). swr is stored as a
    # plain-notation STRING — get_swr_pct Decimal(str(raw))s it back losslessly, where a
    # float would round-trip through binary. Get-then-set on three rows is the accepted
    # single-user TOCTOU class (accounts/securities/taxes precedent).
    for key, value in (
        ("swr_pct", {"value": format(swr, "f")}),
        ("espp_ticker", {"value": ticker}),
        ("price_refresh_cron", {"value": cron}),
    ):
        setting = await db.get(AppSetting, key)
        if setting is None:
            db.add(AppSetting(key=key, value=value))
        else:
            setting.value = value
    await db.commit()
    return AppSettingsOut(swr_pct=swr, espp_ticker=ticker or None, price_refresh_cron=cron)
