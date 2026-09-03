"""The sandbox conformance test (2026-09-03 planning-sandboxes spec §14): no sandbox path
writes. Routes are DISCOVERED from app.routes — every path ending in /preview or /what-if,
plus GET /projection — so a future preview endpoint without a registered body fails here
the day it is mounted. Each route is called with a valid body under `forbid_writes` (any
flush carrying new/dirty/deleted objects fails the test) and every table's row count must
be unchanged afterwards."""

from datetime import date
from decimal import Decimal

import pytest
from fastapi.routing import APIRoute
from sqlalchemy import func, select

from app.database import Base
from app.main import app
from app.models import Account, AccountBalance, NetWorthSnapshot, Person
from app.seed import seed_tax_definitions
from tests.test_tax_service import YEAR_BRACKETS, YEAR_INPUTS

PROFILES = "/api/v1/paycheck/profiles"

# (method, path) → a body that computes a NON-trivial scenario against `seed_everything`.
SANDBOX_BODIES: dict[tuple[str, str], dict | None] = {
    ("POST", "/api/v1/paycheck/preview"): {
        "overrides": {"trad_401k_pct": "0.15", "hsa_per_check": "250", "hsa_coverage": "family"}
    },
    ("POST", "/api/v1/taxes/what-if"): {
        "year": 2024,
        "overrides": {"qualified_dividends": "2500", "interest_total": None},
    },
    ("GET", "/api/v1/projection"): None,
}


def mounted_routes(routes, prefix: str = "") -> list[tuple[str, str]]:
    """Every (method, full path) the app serves, walked from `app.routes`.

    FastAPI >= 0.141 does not flatten `include_router` into `app.routes` any more: it
    stores a wrapper carrying the original router and the prefix it was mounted under, so
    a plain `isinstance(route, APIRoute)` scan of `app.routes` finds nothing. Both shapes
    are handled, plus a Starlette Mount, so this discovery keeps working either way.
    """
    found: list[tuple[str, str]] = []
    for route in routes:
        if isinstance(route, APIRoute):
            found += [
                (method, prefix + route.path)
                for method in route.methods
                if method not in {"HEAD", "OPTIONS"}
            ]
            continue
        context = getattr(route, "include_context", None)
        included = getattr(route, "original_router", None)
        if context is not None and included is not None:
            found += mounted_routes(included.routes, prefix + (context.prefix or ""))
        elif hasattr(route, "routes"):  # a Mount / sub-application
            found += mounted_routes(route.routes, prefix + getattr(route, "path", ""))
    return found


def sandbox_routes() -> list[tuple[str, str]]:
    return sorted(
        (method, path)
        for method, path in mounted_routes(app.routes)
        if path.endswith("/preview")
        or path.endswith("/what-if")
        or (path == "/api/v1/projection" and method == "GET")
    )


async def row_counts(db) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in Base.metadata.sorted_tables:
        counts[table.name] = (
            await db.execute(select(func.count()).select_from(table))
        ).scalar_one()
    return counts


async def seed_everything(auth_client, db) -> None:
    """Enough for all three routes to answer 200: a person with a profile, the 2024 tax
    year through the real editors, and one investable snapshot. Committed BEFORE the
    guard is engaged."""
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    resp = await auth_client.post(
        PROFILES,
        json={
            "effective_date": "2020-01-01",
            "annual_salary": "120000",
            "pay_periods_per_year": 24,
            "trad_401k_pct": "0.10",
            "hsa_per_check": "100",
        },
    )
    assert resp.status_code == 201, resp.text
    await seed_tax_definitions(db)
    await db.commit()
    inputs = {key: str(value) for key, value in YEAR_INPUTS[2024].items()}
    resp = await auth_client.put("/api/v1/taxes/years/2024/inputs", json={"values": inputs})
    assert resp.status_code == 200, resp.text
    brackets = {
        name: [{"rate": str(rate), "threshold": str(threshold)} for rate, threshold in table]
        for name, table in YEAR_BRACKETS[2024].items()
    }
    resp = await auth_client.put(
        "/api/v1/taxes/years/2024/brackets", json={"jurisdictions": brackets}
    )
    assert resp.status_code == 200, resp.text
    taxable = Account(name="Brokerage", slug="brokerage", group="taxable", sort_order=1)
    snap = NetWorthSnapshot(month=date.today().replace(day=1))
    db.add_all([taxable, snap])
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=taxable.id, balance=Decimal("100000.00")))
    await db.commit()


def test_every_sandbox_route_has_a_registered_body():
    """Discovery ↔ registry, both ways: a new preview route must be added to SANDBOX_BODIES
    (and thereby walked), and a registered path must still be mounted."""
    assert set(sandbox_routes()) == set(SANDBOX_BODIES)


@pytest.mark.parametrize("method,path", sorted(SANDBOX_BODIES))
async def test_sandbox_route_writes_nothing(auth_client, db, forbid_writes, method, path):
    await seed_everything(auth_client, db)
    before = await row_counts(db)
    with forbid_writes():
        if method == "GET":
            resp = await auth_client.get(path)
        else:
            resp = await auth_client.post(path, json=SANDBOX_BODIES[(method, path)])
    assert resp.status_code == 200, resp.text
    db.expire_all()  # re-read from Postgres, not from the identity map
    assert await row_counts(db) == before


async def test_forbid_writes_catches_a_write(db, forbid_writes):
    """The guard itself: a flush with a new object inside the block fails loudly."""
    with pytest.raises(AssertionError, match="write attempted under forbid_writes"):
        with forbid_writes():
            db.add(Person(name="Ghost", is_primary=True))
            await db.flush()
    await db.rollback()
