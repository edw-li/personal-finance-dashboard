import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api import (
    app_settings,
    auth,
    calendar,
    comp,
    credit_cards,
    espp,
    household,
    import_,
    limits,
    net_worth,
    overview,
    paycheck,
    portfolio,
    prices,
    projection,
    spending,
    system,
    taxes,
)
from app.config import settings
from app.rate_limit import limiter

# uvicorn configures only its own loggers — application records (scheduler boots, price
# refresh results) otherwise fall through to logging.lastResort at WARNING and all INFO
# is silently dropped (Task 7 review I1). basicConfig is a no-op if a root handler
# already exists, so this never fights an outer logging config.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    scheduler = None
    if settings.scheduler_enabled:
        from app.services.scheduler import start_scheduler

        try:
            scheduler = await start_scheduler()
        except Exception:
            # A background nicety must never veto the API (Task 7 review I2): serve
            # without refreshes and say so — ERROR is visible even unconfigured.
            logging.getLogger(__name__).exception("scheduler failed to start — API continues")
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(import_.router, prefix="/api/v1")
app.include_router(net_worth.router, prefix="/api/v1")
app.include_router(household.router, prefix="/api/v1")
app.include_router(spending.router, prefix="/api/v1")
app.include_router(portfolio.router, prefix="/api/v1")
app.include_router(prices.router, prefix="/api/v1")
app.include_router(taxes.router, prefix="/api/v1")
app.include_router(espp.router, prefix="/api/v1")
app.include_router(paycheck.router, prefix="/api/v1")
app.include_router(limits.router, prefix="/api/v1")
app.include_router(comp.router, prefix="/api/v1")
app.include_router(calendar.router, prefix="/api/v1")
app.include_router(credit_cards.router, prefix="/api/v1")
app.include_router(projection.router, prefix="/api/v1")
app.include_router(app_settings.router, prefix="/api/v1")
app.include_router(system.router, prefix="/api/v1")
app.include_router(overview.router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
