from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import ACCOUNT_GROUPS, Account, AccountBalance, NetWorthSnapshot
from app.schemas.net_worth import (
    AccountCreate,
    AccountOut,
    AccountSeries,
    AccountUpdate,
    BalanceEntry,
    GroupSummary,
    MonthBalancesOut,
    MonthUpsert,
    MonthUpsertResult,
    SummaryOut,
    TimeseriesOut,
)
from app.services.money import mom_pct, quantize_money, require_first_of_month
from app.services.net_worth_calc import group_totals_for, load_balance_matrix, net_worth_for

router = APIRouter(
    prefix="/net-worth", tags=["net-worth"], dependencies=[Depends(get_current_user)]
)

# Patchable account columns whose EXPLICIT null is a clear rather than a no-op — i.e. the
# nullable ones. Every other patchable column is NOT NULL, so "name": null must never
# reach the ORM as a NULL write (see update_account).
NULLABLE_ACCOUNT_FIELDS = frozenset({"suggest_source"})


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
    # Drop explicit nulls on the NOT NULL columns: "name": null is a no-op request, not a
    # write of NULL. The nullable ones are tri-state (the spending net_pay precedent) —
    # exclude_unset is model_fields_set, so an omitted field is left alone while a
    # provided null falls through below and writes None = clear.
    updates = {
        field: value
        for field, value in body.model_dump(exclude_unset=True).items()
        if value is not None or field in NULLABLE_ACCOUNT_FIELDS
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
        # After the quarterly filter, so the list stays aligned with `months`.
        notes=[s.notes for s in snapshots],
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


@router.get("/months/{month}", response_model=MonthBalancesOut)
async def get_month(month: date, db: AsyncSession = Depends(get_db)) -> MonthBalancesOut:
    require_first_of_month(month)
    snapshot = (
        await db.execute(select(NetWorthSnapshot).where(NetWorthSnapshot.month == month))
    ).scalar_one_or_none()
    if snapshot is None:
        return MonthBalancesOut(
            month=month, exists=False, recorded_on=None, notes=None, balances=[]
        )
    rows = (
        (
            await db.execute(
                select(AccountBalance)
                .where(AccountBalance.snapshot_id == snapshot.id)
                .order_by(AccountBalance.account_id)
            )
        )
        .scalars()
        .all()
    )
    return MonthBalancesOut(
        month=month,
        exists=True,
        recorded_on=snapshot.recorded_on,
        notes=snapshot.notes,
        balances=[BalanceEntry(account_id=r.account_id, balance=r.balance) for r in rows],
    )


@router.put("/months/{month}", response_model=MonthUpsertResult)
async def put_month(
    month: date, body: MonthUpsert, db: AsyncSession = Depends(get_db)
) -> MonthUpsertResult:
    require_first_of_month(month)
    ids = [entry.account_id for entry in body.balances]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="duplicate account_id in balances")
    # Validate everything BEFORE any write so a rejected body creates no snapshot.
    quantized: dict[int, Decimal] = {
        entry.account_id: quantize_money(entry.balance, f"balance[account_id={entry.account_id}]")
        for entry in body.balances
    }
    if ids:
        known = set((await db.execute(select(Account.id).where(Account.id.in_(ids)))).scalars())
        missing = sorted(set(ids) - known)
        if missing:
            raise HTTPException(status_code=422, detail=f"unknown account_id(s): {missing}")

    snapshot = (
        await db.execute(select(NetWorthSnapshot).where(NetWorthSnapshot.month == month))
    ).scalar_one_or_none()
    snapshot_created = snapshot is None
    if snapshot is None:
        if not body.balances:
            # An empty month would poison the summary KPI and the coverage ribbon,
            # and no DELETE /months exists to undo it. Meta-only PUTs remain legal
            # on months that already exist.
            raise HTTPException(
                status_code=422,
                detail="refusing to create an empty month — include at least one balance",
            )
        snapshot = NetWorthSnapshot(
            month=month,
            recorded_on=body.recorded_on or date.today(),
            notes=body.notes,
        )
        db.add(snapshot)
        await db.flush()
    else:
        provided = body.model_fields_set
        if "recorded_on" in provided:
            snapshot.recorded_on = body.recorded_on
        if "notes" in provided:
            snapshot.notes = body.notes

    existing = {
        row.account_id: row
        for row in (
            await db.execute(
                select(AccountBalance).where(AccountBalance.snapshot_id == snapshot.id)
            )
        ).scalars()
    }
    created = updated = unchanged = 0
    for account_id, value in quantized.items():
        row = existing.get(account_id)
        if row is None:
            db.add(AccountBalance(snapshot_id=snapshot.id, account_id=account_id, balance=value))
            created += 1
        elif row.balance != value:
            row.balance = value
            updated += 1
        else:
            unchanged += 1
    await db.commit()
    return MonthUpsertResult(
        month=month,
        snapshot_created=snapshot_created,
        created=created,
        updated=updated,
        unchanged=unchanged,
    )
