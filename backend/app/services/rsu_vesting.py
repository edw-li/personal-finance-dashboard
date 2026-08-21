"""Computed RSU vest schedules (2026-08-21 spec §3). Pure module — no DB, no HTTP, no clock
(tax_whatif's posture). Whole-share tranches by CUMULATIVE FLOOR so every grant's vests sum
exactly to its share count; dates ride the 3rd-Wednesday quarterly grid the user's grants use,
except the stored first_vest_date, which is always taken verbatim (off-convention grants stay
expressible).

Precondition (enforced at the API boundary, not here): cliff_pct is fenced into (0, 1], so a
non-positive or over-100% cliff is unrepresentable upstream and needs no runtime guard below.
vest_quantum DOES carry a guard (`vest_shares` raises on < 1): unlike a bad cliff, a zero
divides and a negative silently CEILINGS, so a hand-edited row must land in the computed
GETs' ValueError degradation rather than a 500 or a wrong schedule."""

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


def vest_shares(total: int, cliff_pct: Decimal, quantum: int = 1) -> list[int]:
    """Cumulative floor TO A MULTIPLE OF `quantum`: vest_k = floor_q(total x cum%_k) - already
    vested, and the FINAL vest trues up to `total` itself (so conservation holds even when
    total is not a multiple of the quantum). quantum=1 is the plain cumulative floor and the
    historical behavior, bit for bit.

    The quantum is real broker behavior, not a modeling knob (2026-08-21, spec §8.2): the
    user's offer grant vests in whole tens — 2100 @ 25% cliff floors to 520, quarterlies to
    130, with 140 true-ups exactly where the cumulative lands on a multiple of ten — while
    every focal refresh floors to single shares. Verified against all 13 broker tranches.
    """
    if quantum < 1:
        # A zero divides below and a NEGATIVE silently ceilings — both are hand-edit-only
        # states, and both must degrade like a bad cliff (the computed GETs catch ValueError).
        raise ValueError("vest_quantum must be a positive integer")
    count = vest_count(cliff_pct)
    shares: list[int] = []
    vested = 0
    for k in range(count):
        cum_pct = cliff_pct + QUARTERLY_STEP * k
        if k == count - 1:
            cum_shares = total  # the true-up: everything granted has vested by the last date
        else:
            # positive Decimals: int() truncation IS floor, and flooring the floor to the
            # quantum is flooring to the quantum.
            cum_shares = int(total * cum_pct) // quantum * quantum
        shares.append(cum_shares - vested)
        vested = cum_shares
    return shares


def schedule(grant) -> list[tuple[date, int]]:
    """(date, shares) per vest for a grant-shaped object (shares, cliff_pct, first_vest_date,
    vest_quantum)."""
    counts = vest_shares(grant.shares, grant.cliff_pct, grant.vest_quantum)
    return list(zip(vest_dates(grant.first_vest_date, len(counts)), counts, strict=True))
