from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import Account, AccountBalance
from app.schemas.net_worth import AccountCreate, AccountOut, AccountUpdate

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
    if not slug:
        raise HTTPException(
            status_code=422,
            detail="name needs at least one ASCII letter or digit to derive a slug",
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
