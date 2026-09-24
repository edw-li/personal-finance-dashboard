import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api import (
    activity,
    app_settings,
    assistant,
    assistant_findings,
    auth,
    calendar,
    comp,
    coverage,
    credit_cards,
    espp,
    export,
    household,
    import_,
    limits,
    metrics,
    month_review,
    net_worth,
    overview,
    paycheck,
    portfolio,
    prefs,
    prices,
    projection,
    spending,
    system,
    taxes,
)

# Aliased: the data-health router module and this file's liveness `def health()` below
# would otherwise share the name, and the last binding wins (2026-09-03 lifecycle L3).
from app.api import health as health_api
from app.config import settings
from app.rate_limit import limiter
from app.services import clock

# uvicorn configures only its own loggers — application records (scheduler boots, price
# refresh results) otherwise fall through to logging.lastResort at WARNING and all INFO
# is silently dropped (Task 7 review I1). basicConfig is a no-op if a root handler
# already exists, so this never fights an outer logging config.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger(__name__)

# One "today" for the browser too (2026-09-23 spec §K1, §0.4(a)).
PRODUCT_TODAY_HEADER = "X-Product-Today"


class ProductTodayHeader:
    """Names the server's product day on every /api response the app answers — a 401, a 404 and
    a 422 as much as a 200 — so the browser's todayIso(), currentMonthIso() and currentYear()
    (src/utils/months.ts) answer the SERVER's day instead of their own clock (spec §K1). The one
    exception is an unhandled exception's 500: Starlette's ServerErrorMiddleware answers it from
    outside every user middleware, so it carries no day (the client simply keeps the last one).

    Plain ASGI rather than BaseHTTPMiddleware: it only adds a header to the start message, so a
    streamed body (the assistant's SSE) passes through untouched."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return

        async def send_with_today(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).append(
                    PRODUCT_TODAY_HEADER, clock.product_today().isoformat()
                )
            await send(message)

        await self.app(scope, receive, send_with_today)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    override = clock.product_today_override()
    if override is not None:
        # One WARNING line naming the override (spec §K1) and what it can still write: every date
        # the app derives from the product day follows it, so a price refresh dates its weekly
        # value row on the fake day in whatever database this process is attached to. The
        # scheduled refresh is therefore not started at all; the manual one is named (review
        # minor 11).
        logger.warning(
            "PRODUCT_TODAY override: the product day is %s, not the real day (dev only). The "
            "scheduler is not started; a manual 'Refresh prices' would still write this day's "
            "weekly value row into the attached database.",
            override.isoformat(),
        )
    scheduler = None
    if settings.scheduler_enabled and override is None:
        from app.services.scheduler import start_scheduler

        try:
            scheduler = await start_scheduler()
        except Exception:
            # A background nicety must never veto the API (Task 7 review I2): serve
            # without refreshes and say so — ERROR is visible even unconfigured.
            logger.exception("scheduler failed to start — API continues")
    try:
        yield
    finally:
        if scheduler is not None:
            # Async under the hood: shutdown() only schedules the real stop on the
            # loop; uvicorn keeps the loop alive past this return (Task 7 review M2).
            scheduler.shutdown(wait=False)


app = FastAPI(
    title="Personal Finance Dashboard",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Added first, so it sits INSIDE the CORS middleware: every /api response the app answers —
# handled errors (401, 404, 422, 429) included — carries the day, and CORS below exposes it. An
# unhandled exception's 500 comes from ServerErrorMiddleware, outside both, without it.
app.add_middleware(ProductTodayHeader)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Same-origin in prod (nginx) and dev (the Vite proxy); a cross-origin dev page must still be
    # able to read the day (spec §K1).
    expose_headers=[PRODUCT_TODAY_HEADER],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(import_.router, prefix="/api/v1")
app.include_router(activity.router, prefix="/api/v1")
app.include_router(net_worth.router, prefix="/api/v1")
app.include_router(household.router, prefix="/api/v1")
app.include_router(spending.router, prefix="/api/v1")
app.include_router(month_review.router, prefix="/api/v1")
app.include_router(metrics.router, prefix="/api/v1")
app.include_router(portfolio.router, prefix="/api/v1")
app.include_router(prices.router, prefix="/api/v1")
app.include_router(taxes.router, prefix="/api/v1")
app.include_router(espp.router, prefix="/api/v1")
app.include_router(paycheck.router, prefix="/api/v1")
app.include_router(limits.router, prefix="/api/v1")
app.include_router(comp.router, prefix="/api/v1")
app.include_router(calendar.router, prefix="/api/v1")
# Unauthenticated by design: the feed token in the URL is the credential (calendar spec §11).
app.include_router(calendar.feed_router, prefix="/api/v1")
app.include_router(coverage.router, prefix="/api/v1")
app.include_router(credit_cards.router, prefix="/api/v1")
app.include_router(projection.router, prefix="/api/v1")
app.include_router(app_settings.router, prefix="/api/v1")
app.include_router(prefs.router, prefix="/api/v1")
app.include_router(system.router, prefix="/api/v1")
app.include_router(health_api.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")
app.include_router(overview.router, prefix="/api/v1")
app.include_router(assistant.router, prefix="/api/v1")
app.include_router(assistant_findings.router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
