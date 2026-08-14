from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import MonthlySpending, SpendingCategory
from app.schemas.spending import CategoryCreate, CategoryOut, CategoryUpdate

router = APIRouter(prefix="/spending", tags=["spending"], dependencies=[Depends(get_current_user)])


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)) -> list[SpendingCategory]:
    result = await db.execute(
        select(SpendingCategory).order_by(SpendingCategory.sort_order, SpendingCategory.id)
    )
    return list(result.scalars().all())


@router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(
    body: CategoryCreate, db: AsyncSession = Depends(get_db)
) -> SpendingCategory:
    slug = slugify(body.name)
    # Same guard as accounts, at this table's String(80): unicode lowercasing can
    # expand, so the slug length is checked here — 422, never a DBAPIError 500.
    if not slug or len(slug) > 80:
        raise HTTPException(
            status_code=422,
            detail="name must contain an ASCII letter or digit and slugify to "
            "at most 80 characters",
        )
    existing = (
        (
            await db.execute(
                select(SpendingCategory).where(
                    (SpendingCategory.slug == slug) | (SpendingCategory.name == body.name)
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"category {slug!r} already exists")
    category = SpendingCategory(name=body.name, slug=slug, sort_order=body.sort_order)
    db.add(category)
    await db.commit()
    return category


async def _get_category(db: AsyncSession, category_id: int) -> SpendingCategory:
    category = await db.get(SpendingCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="category not found")
    return category


@router.patch("/categories/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: int, body: CategoryUpdate, db: AsyncSession = Depends(get_db)
) -> SpendingCategory:
    category = await _get_category(db, category_id)
    # Same explicit-null guard as accounts: all patchable columns are NOT NULL.
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
    if new_name is not None and new_name != category.name:
        clash = (
            (
                await db.execute(
                    select(SpendingCategory).where(
                        SpendingCategory.name == new_name,
                        SpendingCategory.id != category_id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if clash is not None:
            raise HTTPException(status_code=409, detail="category name already in use")
    for field, value in updates.items():
        setattr(category, field, value)
    await db.commit()
    return category


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(category_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    category = await _get_category(db, category_id)
    row_count = (
        await db.execute(
            select(func.count())
            .select_from(MonthlySpending)
            .where(MonthlySpending.category_id == category_id)
        )
    ).scalar_one()
    if row_count:
        raise HTTPException(
            status_code=409,
            detail=f"category has {row_count} monthly rows — deactivate it instead",
        )
    await db.delete(category)
    await db.commit()
    return Response(status_code=204)
