"""Query-time net-worth math. Nothing here is ever stored (spec section 4).

Personal-scale data (25 accounts x ~40 snapshots): full loads + in-memory sums are the
entire strategy — no aggregate SQL beyond investable_base's single-snapshot sum.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ACCOUNT_GROUPS, Account, AccountBalance, AppSetting, NetWorthSnapshot

INVESTABLE_GROUPS = ("pre_tax", "post_tax", "taxable", "equity")
DEFAULT_SWR_PCT = Decimal("0.04")

ZERO = Decimal("0.00")

BalanceKey = tuple[int, int]  # (snapshot_id, account_id)


async def load_balance_matrix(
    db: AsyncSession,
) -> tuple[list[NetWorthSnapshot], list[Account], dict[BalanceKey, Decimal]]:
    snapshots = list(
        (await db.execute(select(NetWorthSnapshot).order_by(NetWorthSnapshot.month)))
        .scalars()
        .all()
    )
    accounts = list(
        (await db.execute(select(Account).order_by(Account.sort_order, Account.id))).scalars().all()
    )
    balances = {
        (b.snapshot_id, b.account_id): b.balance
        for b in (await db.execute(select(AccountBalance))).scalars()
    }
    return snapshots, accounts, balances


def net_worth_for(
    snapshot_id: int, accounts: list[Account], balances: dict[BalanceKey, Decimal]
) -> Decimal:
    total = ZERO
    for account in accounts:
        if account.is_component:
            continue
        total += balances.get((snapshot_id, account.id), ZERO)
    return total


def group_totals_for(
    snapshot_id: int, accounts: list[Account], balances: dict[BalanceKey, Decimal]
) -> dict[str, Decimal]:
    totals = {group: ZERO for group in ACCOUNT_GROUPS}
    for account in accounts:
        if account.is_component:
            continue
        totals[account.group] += balances.get((snapshot_id, account.id), ZERO)
    return totals


async def investable_base(db: AsyncSession, month: date) -> Decimal | None:
    """Non-component pre/post-tax + taxable + equity balances of the latest snapshot
    on or before `month`; None when no snapshot exists yet (4%-line gap, not an error)."""
    snapshot_id = (
        await db.execute(
            select(NetWorthSnapshot.id)
            .where(NetWorthSnapshot.month <= month)
            .order_by(NetWorthSnapshot.month.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if snapshot_id is None:
        return None
    total = (
        await db.execute(
            select(func.coalesce(func.sum(AccountBalance.balance), 0))
            .join(Account, Account.id == AccountBalance.account_id)
            .where(
                AccountBalance.snapshot_id == snapshot_id,
                Account.is_component.is_(False),
                Account.group.in_(INVESTABLE_GROUPS),
            )
        )
    ).scalar_one()
    return Decimal(total)


async def get_swr_pct(db: AsyncSession) -> Decimal:
    """app_settings['swr_pct'] envelope {"value": x}; the envelope is convention-only
    (Plan 1 forward note) — any unexpected shape falls back to the seeded default."""
    setting = await db.get(AppSetting, "swr_pct")
    if setting is None or not isinstance(setting.value, dict):
        return DEFAULT_SWR_PCT
    raw = setting.value.get("value")
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        return DEFAULT_SWR_PCT
    try:
        parsed = Decimal(str(raw))
    except ArithmeticError:
        return DEFAULT_SWR_PCT
    # Decimal("NaN")/"Infinity"/"1e100000" all CONSTRUCT successfully — a leaked
    # non-finite or absurd rate turns the 4%-line math downstream into a 500. A
    # withdrawal rate outside [0, 1] is nonsense; fall back rather than crash.
    if not parsed.is_finite() or parsed < 0 or parsed > 1:
        return DEFAULT_SWR_PCT
    return parsed
