"""One "today" for the browser too (2026-09-23 spec §K1): every /api response — errors
included — names the server's product day, which src/api/client.ts hands to the day store."""

import logging
from datetime import date

import pytest

from app.main import PRODUCT_TODAY_HEADER, app, lifespan
from app.services import clock

DAY = date(2026, 10, 3)


@pytest.fixture(autouse=True)
def pinned_day(monkeypatch):
    monkeypatch.setattr(clock, "product_today", lambda: DAY)


async def test_a_200_names_the_product_day(client):
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.headers[PRODUCT_TODAY_HEADER] == "2026-10-03"


async def test_a_401_names_it(client):
    response = await client.get("/api/v1/coverage")
    assert response.status_code == 401
    assert response.headers[PRODUCT_TODAY_HEADER] == "2026-10-03"


async def test_a_404_names_it_routed_or_not(auth_client):
    unknown = await auth_client.get("/api/v1/no-such-route")
    missing = await auth_client.get("/api/v1/net-worth/summary?month=2026-05-01")
    assert (unknown.status_code, missing.status_code) == (404, 404)
    assert unknown.headers[PRODUCT_TODAY_HEADER] == "2026-10-03"
    assert missing.headers[PRODUCT_TODAY_HEADER] == "2026-10-03"


async def test_a_422_names_it(auth_client):
    response = await auth_client.get("/api/v1/net-worth/months/2026-05-02")
    assert response.status_code == 422
    assert response.headers[PRODUCT_TODAY_HEADER] == "2026-10-03"


async def test_only_api_paths_carry_the_day(client):
    response = await client.get("/not-the-api")
    assert response.status_code == 404
    assert PRODUCT_TODAY_HEADER not in response.headers


async def test_a_cross_origin_dev_page_may_read_it(client):
    response = await client.get("/api/v1/health", headers={"Origin": "http://localhost:5173"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    exposed = response.headers["access-control-expose-headers"].lower()
    assert PRODUCT_TODAY_HEADER.lower() in exposed


async def test_startup_warns_once_naming_the_override(monkeypatch, caplog):
    monkeypatch.setenv("PRODUCT_TODAY", "2026-10-01")
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    with caplog.at_level(logging.WARNING, logger="app.main"):
        async with lifespan(app):
            pass
    lines = [
        record.getMessage()
        for record in caplog.records
        if record.levelno == logging.WARNING and "PRODUCT_TODAY" in record.getMessage()
    ]
    assert len(lines) == 1 and "2026-10-01" in lines[0]
