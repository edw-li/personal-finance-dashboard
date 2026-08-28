"""contribution_limits constraints (2026-08-27 two-income-streams spec §3 item 3).

Both invariants are the DATABASE's job. The unique key is what makes the API's bulk PUT
an upsert rather than a duplicate factory, and CHECK (value > 0) is what lets
services/limit_check.py divide by a stored limit with no zero guard. Both are declared on
the model as well as in the migration because this test database is built by
Base.metadata.create_all, which never runs migrations (the ux_dividend_auto_event
precedent)."""

from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import ContributionLimit


async def test_one_row_per_year_and_key(db):
    db.add(ContributionLimit(year=2026, key="limit_401k_elective", value=Decimal("24500.00")))
    await db.commit()
    db.add(ContributionLimit(year=2026, key="limit_401k_elective", value=Decimal("24000.00")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_the_same_key_coexists_across_years(db):
    db.add_all(
        [
            ContributionLimit(year=2026, key="limit_401k_elective", value=Decimal("24500.00")),
            ContributionLimit(year=2027, key="limit_401k_elective", value=Decimal("25000.00")),
        ]
    )
    await db.commit()
    years = (
        await db.execute(select(ContributionLimit.year).order_by(ContributionLimit.year))
    ).scalars()
    assert list(years) == [2026, 2027]


async def test_a_zero_limit_is_refused(db):
    db.add(ContributionLimit(year=2026, key="limit_hsa_self", value=Decimal("0.00")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_a_negative_limit_is_refused(db):
    db.add(ContributionLimit(year=2026, key="limit_hsa_self", value=Decimal("-1.00")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
