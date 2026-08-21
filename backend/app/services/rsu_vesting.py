"""Computed RSU vest schedules (2026-08-21 spec §3). Pure module — no DB, no HTTP, no clock
(tax_whatif's posture). Whole-share tranches by CUMULATIVE FLOOR so every grant's vests sum
exactly to its share count; dates ride the 3rd-Wednesday quarterly grid the user's grants use,
except the stored first_vest_date, which is always taken verbatim (off-convention grants stay
expressible).

Precondition (enforced at the API boundary, not here): cliff_pct is fenced into (0, 1], so a
non-positive or over-100% cliff is unrepresentable upstream and needs no runtime guard below."""

from datetime import date
from decimal import Decimal

ONE = Decimal("1")
QUARTERLY_STEP = Decimal("0.0625")  # 6.25% — exact at Numeric(7,4)


def third_wednesday(year: int, month: int) -> date:
    """weekday(): Monday=0 ... Wednesday=2."""
    offset = (2 - date(year, month, 1).weekday()) % 7
    return date(year, month, 1 + offset + 14)


def vest_count(cliff_pct: Decimal) -> int:
    """1 cliff vest + the 6.25% quarterlies that finish the grant. Raises ValueError when
    (1 - cliff) does not divide evenly — the API maps that to a 422."""
    remainder = ONE - cliff_pct
    if remainder < 0 or remainder % QUARTERLY_STEP != 0:
        raise ValueError("(1 - cliff_pct) must be a whole number of 6.25% steps")
    return 1 + int(remainder / QUARTERLY_STEP)


def vest_dates(first_vest_date: date, count: int) -> list[date]:
    """First vest verbatim; vest k is the 3rd Wednesday of month(first) + 3(k-1)."""
    serial = first_vest_date.year * 12 + (first_vest_date.month - 1)
    dates = [first_vest_date]
    for k in range(1, count):
        month_serial = serial + 3 * k
        dates.append(third_wednesday(month_serial // 12, month_serial % 12 + 1))
    return dates


def vest_shares(total: int, cliff_pct: Decimal) -> list[int]:
    """Cumulative floor: vest_k = floor(total x cum%_k) - already vested. The last cumulative
    percentage is exactly 1, so the sum is conserved by construction."""
    count = vest_count(cliff_pct)
    shares: list[int] = []
    vested = 0
    for k in range(count):
        cum_pct = cliff_pct + QUARTERLY_STEP * k
        cum_shares = int(total * cum_pct)  # positive Decimals: int() truncation IS floor
        shares.append(cum_shares - vested)
        vested = cum_shares
    return shares


def schedule(grant) -> list[tuple[date, int]]:
    """(date, shares) per vest for a grant-shaped object (shares, cliff_pct, first_vest_date)."""
    counts = vest_shares(grant.shares, grant.cliff_pct)
    return list(zip(vest_dates(grant.first_vest_date, len(counts)), counts, strict=True))
