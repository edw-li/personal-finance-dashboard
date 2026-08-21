"""Pure vest-schedule math: the 3rd-Wednesday quarterly grid and cumulative-floor tranches.

No DB, no HTTP, no clock (`rsu_vesting`'s posture) — every date below is hand-derived from a
known weekday anchor and every tranche list is hand-floored, so nothing here depends on the day
the suite runs. The conservation assertions (`sum(shares) == total`) are the load-bearing ones:
per-vest rounding that did NOT ride a running cumulative would leak or invent shares on any
grant whose count does not divide evenly, and the leak would only surface in a tax figure.
"""

from datetime import date
from decimal import Decimal

import pytest

from app.services.rsu_vesting import (
    schedule,
    third_wednesday,
    vest_count,
    vest_dates,
    vest_shares,
)


def test_third_wednesday_known_dates():
    assert third_wednesday(2024, 9) == date(2024, 9, 18)  # Sep 1 2024 is a Sunday
    assert third_wednesday(2025, 6) == date(2025, 6, 18)
    assert third_wednesday(2025, 1) == date(2025, 1, 15)  # Jan 1 2025 IS a Wednesday
    assert third_wednesday(2025, 12) == date(2025, 12, 17)
    assert third_wednesday(2026, 3) == date(2026, 3, 18)
    assert third_wednesday(2026, 6) == date(2026, 6, 17)
    assert third_wednesday(2026, 9) == date(2026, 9, 16)
    assert third_wednesday(2026, 12) == date(2026, 12, 16)
    assert third_wednesday(2027, 3) == date(2027, 3, 17)


def test_vest_count_by_cliff():
    assert vest_count(Decimal("0.25")) == 13  # new-hire: 25% + 12 x 6.25%
    assert vest_count(Decimal("0.0625")) == 16  # refresh: 16 x 6.25%
    assert vest_count(Decimal("1")) == 1  # degenerate single-vest grant is legal
    with pytest.raises(ValueError):
        vest_count(Decimal("0.30"))  # (1 - 0.30) / 0.0625 = 11.2
    with pytest.raises(ValueError):
        # The remainder < 0 branch: a cliff over 100% would otherwise return a NEGATIVE
        # count and make `vest_shares` hand back an empty schedule instead of raising.
        vest_count(Decimal("1.5"))


def test_vest_dates_quarterly_grid_from_first_vest():
    dates = vest_dates(date(2024, 9, 18), 5)
    # First vest verbatim, then 3rd Wednesdays of month+3k.
    assert dates == [
        date(2024, 9, 18),
        date(2024, 12, 18),
        date(2025, 3, 19),
        date(2025, 6, 18),
        date(2025, 9, 17),
    ]


def test_vest_dates_respects_off_convention_first_vest():
    # A stored first vest that is NOT a 3rd Wednesday stays verbatim; later vests snap to grid.
    dates = vest_dates(date(2025, 6, 2), 2)
    assert dates == [date(2025, 6, 2), date(2025, 9, 17)]


def test_vest_shares_refresh_alternates_62_63():
    shares = vest_shares(1000, Decimal("0.0625"))
    assert shares == [62, 63] * 8
    assert sum(shares) == 1000


def test_vest_shares_new_hire_cliff_then_quarterly():
    shares = vest_shares(700, Decimal("0.25"))
    assert shares == [175, 43, 44, 44, 44, 43, 44, 44, 44, 43, 44, 44, 44]
    assert sum(shares) == 700


def test_vest_shares_conserves_prime_totals():
    shares = vest_shares(997, Decimal("0.0625"))
    assert len(shares) == 16
    assert sum(shares) == 997
    assert all(s >= 0 for s in shares)


def test_vest_shares_leaves_real_zero_tranches_on_a_tiny_grant():
    # 5 shares over 16 vests: the cumulative floor cannot advance most quarters, so the
    # schedule genuinely contains 0-share vests. That is deliberate, not a rounding bug —
    # downstream renders them, and collapsing them would break the conservation sum.
    shares = vest_shares(5, Decimal("0.0625"))
    assert sum(shares) == 5
    assert len(shares) == 16
    assert 0 in shares


def test_schedule_zips_dates_and_shares():
    class Grant:
        shares = 320
        cliff_pct = Decimal("0.0625")
        first_vest_date = date(2025, 6, 18)

    events = schedule(Grant())
    assert len(events) == 16
    assert events[0] == (date(2025, 6, 18), 20)
    assert events[-1][0] == date(2029, 3, 21)  # Mar 2029: Mar 1 is a Thursday -> 3rd Wed = 21st
    assert sum(s for _, s in events) == 320
