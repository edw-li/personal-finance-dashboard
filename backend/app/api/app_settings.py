"""App-settings vertical (spec §6 /settings). GET returns EFFECTIVE values via the same
readers the app uses; PUT is PARTIAL by field (2026-09-06 spec §3.5) and stores the
readers' envelope {"value": ...} — several Settings cards write this one endpoint, so a
card that does not show a field must not be able to reset it.

The cron guard is server-side (plan-4 forward note: '* * * * *' would hammer Yahoo):
parse with the scheduler's own CronTrigger, reject sub-hourly cadence and numeric
day-of-week (APScheduler numbers days 0=Mon — the recorded prod mis-seed). A saved cron
is HOT-APPLIED to the live job (reschedule_price_refresh) — the old restart ritual is
gone; boot still reads the stored value, so a no-scheduler process loses nothing."""

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
from app.services.scheduler import (
    SCHEDULER_TIMEZONE,
    read_cron_setting,
    reschedule_price_refresh,
)

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


# The §423 statutory maximum discount, and the plan the app was built against.
DEFAULT_ESPP_DISCOUNT = Decimal("0.15")
MAX_ESPP_DISCOUNT = Decimal("0.15")
ESPP_DISCOUNT_MESSAGE = "espp_discount_pct must be between 0 and 0.15 (the §423 maximum)"


def _validated_discount(value: Decimal) -> Decimal:
    # What the reader discards, the writer refuses (_validated_swr's rule). `+ ZERO` is the
    # house signed-zero collapse: "-0" clears `< 0` and would store as "-0.000000".
    if not value.is_finite() or value < 0 or value > MAX_ESPP_DISCOUNT:
        raise HTTPException(status_code=422, detail=ESPP_DISCOUNT_MESSAGE)
    return quantize_pct(value) + ZERO


async def read_espp_discount(db: AsyncSession) -> Decimal:
    """app_settings['espp_discount_pct'] envelope {"value": "0.15"}; any unexpected shape
    falls back to the §423 maximum (get_swr_pct's posture, bounds included). Imported by
    api/espp.py, api/paycheck.py and api/taxes.py — every figure the discount prices reads
    it here, so there is exactly one place a plan-wide rate can come from."""
    setting = await db.get(AppSetting, "espp_discount_pct")
    if setting is None or not isinstance(setting.value, dict):
        return DEFAULT_ESPP_DISCOUNT
    raw = setting.value.get("value")
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        return DEFAULT_ESPP_DISCOUNT
    try:
        parsed = Decimal(str(raw))
    except ArithmeticError:
        return DEFAULT_ESPP_DISCOUNT
    # Decimal("NaN")/"Infinity"/"1e100000" all CONSTRUCT successfully — a leaked non-finite
    # or absurd rate would price every purchase in the app. Fall back rather than crash.
    if not parsed.is_finite() or parsed < 0 or parsed > MAX_ESPP_DISCOUNT:
        return DEFAULT_ESPP_DISCOUNT
    return parsed


DEFAULT_UPDATE_DUE_DAY = 1
MAX_UPDATE_DUE_DAY = 28  # every month has a 28th — the reminder can never miss a month


async def read_update_due_day(db: AsyncSession) -> int:
    """app_settings['calendar_update_due_day'] envelope {"value": 1..28}; any unexpected
    shape falls back to the default (get_swr_pct's posture). Imported by api/calendar.py."""
    setting = await db.get(AppSetting, "calendar_update_due_day")
    if setting is None or not isinstance(setting.value, dict):
        return DEFAULT_UPDATE_DUE_DAY
    raw = setting.value.get("value")
    if isinstance(raw, bool) or not isinstance(raw, int):
        return DEFAULT_UPDATE_DUE_DAY
    return raw if 1 <= raw <= MAX_UPDATE_DUE_DAY else DEFAULT_UPDATE_DUE_DAY


def _validated_due_day(value: int) -> int:
    if not 1 <= value <= MAX_UPDATE_DUE_DAY:
        raise HTTPException(
            status_code=422,
            detail=f"calendar_update_due_day: must be between 1 and {MAX_UPDATE_DUE_DAY}",
        )
    return value


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
        espp_discount_pct=await read_espp_discount(db),
        price_refresh_cron=await read_cron_setting(db),
        calendar_update_due_day=await read_update_due_day(db),
    )


@router.put("", response_model=AppSettingsOut)
async def put_settings(
    body: AppSettingsUpdate, db: AsyncSession = Depends(get_db)
) -> AppSettingsOut:
    """PARTIAL by field (2026-09-06 spec §3.5): `model_dump(exclude_unset=True)` is the house
    PATCH convention, so an absent key keeps the stored value while an explicit null is the
    writing card's own intention — which is what still lets a card clear the ticker.
    Validation, and the cron's hot-apply, run only on PRESENT fields."""
    provided = body.model_dump(exclude_unset=True)
    updates: dict[str, dict] = {}
    if "swr_pct" in provided and body.swr_pct is not None:
        updates["swr_pct"] = {"value": format(_validated_swr(body.swr_pct), "f")}
    if "espp_ticker" in provided:
        # The one field whose null MEANS something: an empty ticker is "unconfigured".
        ticker = (
            ""
            if body.espp_ticker is None or not body.espp_ticker.strip()
            else _normalize_ticker(body.espp_ticker)
        )
        updates["espp_ticker"] = {"value": ticker}
    if "espp_discount_pct" in provided and body.espp_discount_pct is not None:
        updates["espp_discount_pct"] = {
            "value": format(_validated_discount(body.espp_discount_pct), "f")
        }
    if "price_refresh_cron" in provided and body.price_refresh_cron is not None:
        updates["price_refresh_cron"] = {"value": _validated_cron(body.price_refresh_cron)}
    if "calendar_update_due_day" in provided and body.calendar_update_due_day is not None:
        updates["calendar_update_due_day"] = {
            "value": _validated_due_day(body.calendar_update_due_day)
        }
    # Every raise is behind us — write only now, so a 422 on the third field cannot leave the
    # first two committed. Envelope {"value": ...} is the readers' convention, and a Decimal
    # stores as a plain-notation STRING so the reader re-reads it losslessly.
    for key, value in updates.items():
        setting = await db.get(AppSetting, key)
        if setting is None:
            db.add(AppSetting(key=key, value=value))
        else:
            setting.value = value
    await db.commit()
    # AFTER the commit, and ONLY when the cron was actually written: the stored value is what
    # a crashed reschedule (or a scheduler-less process) falls back to at the next boot.
    if "price_refresh_cron" in updates:
        reschedule_price_refresh(updates["price_refresh_cron"]["value"])
    # One answer, one code path: the response is the GET's effective read, so a partial save
    # can never echo a field it did not write.
    return await get_settings(db)
