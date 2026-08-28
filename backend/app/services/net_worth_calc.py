"""Query-time net-worth math. Nothing here is ever stored (spec section 4).

Personal-scale data (25 accounts x ~40 snapshots): full loads + in-memory sums are the
entire strategy — no aggregate SQL beyond the investable-base sums (single-snapshot
and grouped).
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ACCOUNT_GROUPS, Account, AccountBalance, AppSetting, NetWorthSnapshot

# Re-exported: tests and future readers look for the household vocabulary next to the
# function that uses it, and moving the constant would be churn for nothing.
from app.services.ownership import JOINT, parse_owner  # noqa: F401

INVESTABLE_GROUPS = ("pre_tax", "post_tax", "taxable", "equity")
DEFAULT_SWR_PCT = Decimal("0.04")

ZERO = Decimal("0.00")

BalanceKey = tuple[int, int]  # (snapshot_id, account_id)


def owner_clause(owner: str) -> ColumnElement[bool]:
    """THE definition of net-worth ownership (household spec §5.2) — one function, so the
    two endpoints cannot drift apart. The portfolio's twin is
    services.portfolio_accounts.portfolio_owner_clause; both parse through
    services.ownership.parse_owner, so the GRAMMAR cannot drift either.

    `joint` selects the NULL-owned accounts only. A person id selects that person's accounts
    PLUS the joint ones, because "primary holder, spouse secondary" is what a joint account
    actually is: a person's view is "mine and ours", never "mine alone". The person views
    therefore OVERLAP by design and must never be summed — the disjoint split for stacking
    is owner_totals_for below.

    Raises ValueError (via parse_owner) on anything else so the router answers 422.
    """
    person_id = parse_owner(owner)
    if person_id is None:
        return Account.person_id.is_(None)
    return or_(Account.person_id == person_id, Account.person_id.is_(None))


async def load_balance_matrix(
    db: AsyncSession,
    owner_filter: ColumnElement[bool] | None = None,
) -> tuple[list[NetWorthSnapshot], list[Account], dict[BalanceKey, Decimal]]:
    """`owner_filter` (owner_clause's output) scopes the ACCOUNT list, and that is the whole
    filtering seam: net_worth_for / group_totals_for / owner_totals_for each sum over the
    list they are handed, so scoping it here scopes every rollup at once — plus the
    endpoints' own `accounts`/`series` payloads, which should show the same scope the totals
    describe. A per-function owner argument would be three places to forget.

    Balances stay loaded whole: the out-of-scope rows are inert (nothing looks them up), and
    a join to filter them would buy nothing at 25 accounts x ~40 snapshots.
    """
    snapshots = list(
        (await db.execute(select(NetWorthSnapshot).order_by(NetWorthSnapshot.month)))
        .scalars()
        .all()
    )
    account_q = select(Account).order_by(Account.sort_order, Account.id)
    if owner_filter is not None:
        account_q = account_q.where(owner_filter)
    accounts = list((await db.execute(account_q)).scalars().all())
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


def owner_totals_for(
    snapshot_id: int, accounts: list[Account], balances: dict[BalanceKey, Decimal]
) -> dict[int | None, Decimal]:
    """EXCLUSIVE ownership: every account counts once, under its stored person_id, with None
    its own ("Joint") bucket. Deliberately NOT owner_clause's inclusive person view — a stack
    has to be disjoint, and stacking three inclusive views would count every joint dollar
    two or three times. The invariant this buys: sum(owner_totals_for(...).values()) ==
    net_worth_for(...) over the same account list, which is what lets the owner stack land
    exactly on the net-worth line.

    Only owners that actually hold a non-component account appear; a person with nothing to
    their name is absent rather than a zero row.
    """
    totals: dict[int | None, Decimal] = {}
    for account in accounts:
        if account.is_component:
            continue
        totals[account.person_id] = totals.get(account.person_id, ZERO) + balances.get(
            (snapshot_id, account.id), ZERO
        )
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


async def investable_bases(db: AsyncSession, months: list[date]) -> list[Decimal | None]:
    """investable_base for many months in TWO queries — the spending matrix's per-month
    loop was ~2 queries x months (2026-08-24 audit N+1; spec §3 sanctions the fix).

    Resolution is identical by construction: snapshot months are UNIQUE, so "latest
    snapshot on or before M" is one walk over the ascending list; a snapshot with no
    matching balances is absent from the grouped sum and reads ZERO, matching the
    single-month coalesce. Byte-identical output is pinned in tests against
    investable_base itself and by the matrix endpoint's four_pct assertions.
    """
    if not months:
        return []
    snapshots = list(
        (
            await db.execute(
                select(NetWorthSnapshot.id, NetWorthSnapshot.month).order_by(NetWorthSnapshot.month)
            )
        ).all()
    )
    if not snapshots:
        return [None] * len(months)
    totals = {
        snapshot_id: Decimal(total)
        for snapshot_id, total in (
            await db.execute(
                select(
                    AccountBalance.snapshot_id,
                    func.coalesce(func.sum(AccountBalance.balance), 0),
                )
                .join(Account, Account.id == AccountBalance.account_id)
                .where(
                    Account.is_component.is_(False),
                    Account.group.in_(INVESTABLE_GROUPS),
                )
                .group_by(AccountBalance.snapshot_id)
            )
        ).all()
    }
    bases: list[Decimal | None] = []
    for month in months:
        latest: int | None = None
        for snapshot_id, snapshot_month in snapshots:  # ascending; last <= month wins
            if snapshot_month <= month:
                latest = snapshot_id
            else:
                break
        bases.append(None if latest is None else totals.get(latest, ZERO))
    return bases


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
