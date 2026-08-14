from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import ACCOUNT_GROUPS, Account, AccountBalance
from app.schemas.net_worth import (
    AccountCreate,
    AccountOut,
    AccountSeries,
    AccountUpdate,
    GroupSummary,
    SummaryOut,
    TimeseriesOut,
)
from app.services.money import mom_pct
from app.services.net_worth_calc import group_totals_for, load_balance_matrix, net_worth_for

router = APIRouter(
    prefix="/net-worth", tags=["net-worth"], dependencies=[Depends(get_current_user)]
)


@router.get("/accounts", response_model=list[AccountOut])
async def list_accounts(db: AsyncSession = Depends(get_db)) -> list[Account]:
    result = await db.execute(select(Account).order_by(Account.sort_order, Account.id))
    return list(result.scalars().all())


@router.post("/accounts", response_model=AccountOut, status_code=201)
async def create_account(body: AccountCreate, db: AsyncSession = Depends(get_db)) -> Account:
    slug = slugify(body.name)
    # len guard: unicode lowercasing can EXPAND ('İ' -> 2 code points), so a <=120-char
    # name can slugify past String(120) — 422 here, never a DBAPIError 500.
    if not slug or len(slug) > 120:
        raise HTTPException(
            status_code=422,
            detail="name must contain an ASCII letter or digit and slugify to "
            "at most 120 characters",
        )
    existing = (
        (
            await db.execute(
                select(Account).where((Account.slug == slug) | (Account.name == body.name))
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"account {slug!r} already exists")
    account = Account(
        name=body.name,
        slug=slug,
        group=body.group,
        sort_order=body.sort_order,
        is_component=body.is_component,
    )
    db.add(account)
    await db.commit()
    return account


async def _get_account(db: AsyncSession, account_id: int) -> Account:
    account = await db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="account not found")
    return account


@router.patch("/accounts/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: int, body: AccountUpdate, db: AsyncSession = Depends(get_db)
) -> Account:
    account = await _get_account(db, account_id)
    # Drop explicit nulls: every patchable column is NOT NULL, so "name": null is a
    # no-op request, not a write of NULL.
    updates = {
        field: value
        for field, value in body.model_dump(exclude_unset=True).items()
        if value is not None
    }
    new_name = updates.get("name")
    if new_name is not None and not slugify(new_name):
        # Same rule as create: PATCH must not produce a blank/whitespace display name.
        raise HTTPException(
            status_code=422,
            detail="name must contain at least one ASCII letter or digit",
        )
    if new_name is not None and new_name != account.name:
        clash = (
            (
                await db.execute(
                    select(Account).where(Account.name == new_name, Account.id != account_id)
                )
            )
            .scalars()
            .first()
        )
        if clash is not None:
            raise HTTPException(status_code=409, detail="account name already in use")
    # slug is the importer's natural key — never rewritten here. A sheet-side rename is
    # the importer's job (per-run alias semantics, Plan 2 forward note).
    for field, value in updates.items():
        setattr(account, field, value)
    await db.commit()
    return account


@router.delete("/accounts/{account_id}", status_code=204)
async def delete_account(account_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    account = await _get_account(db, account_id)
    balance_count = (
        await db.execute(
            select(func.count())
            .select_from(AccountBalance)
            .where(AccountBalance.account_id == account_id)
        )
    ).scalar_one()
    if balance_count:
        raise HTTPException(
            status_code=409,
            detail=f"account has {balance_count} balance rows — deactivate it instead",
        )
    await db.delete(account)
    await db.commit()
    return Response(status_code=204)


QUARTER_END_MONTHS = (3, 6, 9, 12)


@router.get("/timeseries", response_model=TimeseriesOut)
async def timeseries(
    granularity: Literal["monthly", "quarterly"] = "monthly",
    db: AsyncSession = Depends(get_db),
) -> TimeseriesOut:
    snapshots, accounts, balances = await load_balance_matrix(db)
    if granularity == "quarterly":
        snapshots = [s for s in snapshots if s.month.month in QUARTER_END_MONTHS]
    net_worth = [net_worth_for(s.id, accounts, balances) for s in snapshots]
    mom = [
        None if i == 0 else mom_pct(net_worth[i], net_worth[i - 1]) for i in range(len(net_worth))
    ]
    per_snapshot_groups = [group_totals_for(s.id, accounts, balances) for s in snapshots]
    group_totals = {
        group: [totals[group] for totals in per_snapshot_groups] for group in ACCOUNT_GROUPS
    }
    return TimeseriesOut(
        months=[s.month for s in snapshots],
        accounts=[AccountOut.model_validate(a) for a in accounts],
        series=[
            AccountSeries(
                account_id=a.id,
                values=[balances.get((s.id, a.id)) for s in snapshots],
            )
            for a in accounts
        ],
        group_totals=group_totals,
        net_worth=net_worth,
        mom_pct=mom,
    )


@router.get("/summary", response_model=SummaryOut)
async def summary(db: AsyncSession = Depends(get_db)) -> SummaryOut:
    snapshots, accounts, balances = await load_balance_matrix(db)
    if not snapshots:
        return SummaryOut(month=None, net_worth=None, mom_delta=None, mom_pct=None, groups=[])
    latest = snapshots[-1]
    previous = snapshots[-2] if len(snapshots) > 1 else None
    latest_nw = net_worth_for(latest.id, accounts, balances)
    latest_groups = group_totals_for(latest.id, accounts, balances)
    prev_nw = net_worth_for(previous.id, accounts, balances) if previous else None
    prev_groups = group_totals_for(previous.id, accounts, balances) if previous else None
    return SummaryOut(
        month=latest.month,
        net_worth=latest_nw,
        mom_delta=None if prev_nw is None else latest_nw - prev_nw,
        mom_pct=mom_pct(latest_nw, prev_nw),
        groups=[
            GroupSummary(
                group=group,
                total=latest_groups[group],
                mom_delta=None
                if prev_groups is None
                else latest_groups[group] - prev_groups[group],
            )
            for group in ACCOUNT_GROUPS
        ],
    )
