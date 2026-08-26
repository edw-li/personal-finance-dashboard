from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import CreditCard, RewardCategory, RewardRate, SpendingCategory
from app.schemas.credit_cards import (
    RewardCategoryCreate,
    RewardCategoryOut,
    RewardCategoryUpdate,
    RewardRateOut,
    RewardRatePut,
)
from app.services.money import MONEY_MAX_ABS_10_2, MONEY_MAX_ABS_12_2, quantize_money

router = APIRouter(
    prefix="/credit-cards", tags=["credit-cards"], dependencies=[Depends(get_current_user)]
)

MULTIPLIER_MAX_ABS = Decimal(10_000)  # Numeric(6,2): 4 integer digits

# ROUTE ORDER IS LOAD-BEARING: /categories and /rates are declared BEFORE any
# /{card_id} route (Task 6 appends those below) — FastAPI matches in declaration
# order and "/credit-cards/categories" would otherwise 422 against the int converter.


# --- reward categories (matrix rows) ------------------------------------------------------


async def _get_reward_category(db: AsyncSession, category_id: int) -> RewardCategory:
    category = await db.get(RewardCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="reward category not found")
    return category


async def _validated_category_refs(
    db: AsyncSession, spending_category_id: int | None, pinned_card_id: int | None
) -> None:
    if spending_category_id is not None:
        if await db.get(SpendingCategory, spending_category_id) is None:
            raise HTTPException(status_code=404, detail="spending category not found")
    if pinned_card_id is not None:
        if await db.get(CreditCard, pinned_card_id) is None:
            raise HTTPException(status_code=404, detail="card not found")


def _validated_annual_spend(value: Decimal | None) -> Decimal | None:
    if value is None:
        return None
    quantized = quantize_money(value, "annual_spend", max_abs=MONEY_MAX_ABS_12_2)
    if quantized < 0:
        raise HTTPException(status_code=422, detail="annual_spend must be non-negative")
    return quantized


@router.get("/categories", response_model=list[RewardCategoryOut])
async def list_reward_categories(db: AsyncSession = Depends(get_db)) -> list[RewardCategory]:
    result = await db.execute(
        select(RewardCategory).order_by(RewardCategory.sort_order, RewardCategory.id)
    )
    return list(result.scalars().all())


@router.post("/categories", response_model=RewardCategoryOut, status_code=201)
async def create_reward_category(
    body: RewardCategoryCreate, db: AsyncSession = Depends(get_db)
) -> RewardCategory:
    slug = slugify(body.name)
    if not slug or len(slug) > 80:
        raise HTTPException(
            status_code=422,
            detail="name must contain an ASCII letter or digit and slugify to "
            "at most 80 characters",
        )
    existing = (
        (
            await db.execute(
                select(RewardCategory).where(
                    (RewardCategory.slug == slug) | (RewardCategory.name == body.name)
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"reward category {slug!r} already exists")
    await _validated_category_refs(db, body.spending_category_id, body.pinned_card_id)
    category = RewardCategory(
        name=body.name,
        slug=slug,
        sort_order=body.sort_order,
        annual_spend=_validated_annual_spend(body.annual_spend),
        spending_category_id=body.spending_category_id,
        pinned_card_id=body.pinned_card_id,
    )
    db.add(category)
    await db.commit()
    return category


@router.patch("/categories/{category_id}", response_model=RewardCategoryOut)
async def update_reward_category(
    category_id: int, body: RewardCategoryUpdate, db: AsyncSession = Depends(get_db)
) -> RewardCategory:
    category = await _get_reward_category(db, category_id)
    updates = body.model_dump(exclude_unset=True)
    # NOT NULL columns ignore explicit nulls (spending-categories precedent); the three
    # nullable columns take null as CLEAR (schema docstring).
    for field in ("name", "sort_order", "is_active"):
        if field in updates and updates[field] is None:
            del updates[field]
    new_name = updates.get("name")
    if new_name is not None:
        new_slug = slugify(new_name)
        if not new_slug or len(new_slug) > 80:
            raise HTTPException(
                status_code=422,
                detail="name must contain at least one ASCII letter or digit",
            )
        if new_name != category.name:
            clash = (
                (
                    await db.execute(
                        select(RewardCategory).where(
                            (RewardCategory.name == new_name) | (RewardCategory.slug == new_slug),
                            RewardCategory.id != category_id,
                        )
                    )
                )
                .scalars()
                .first()
            )
            if clash is not None:
                raise HTTPException(status_code=409, detail="reward category name already in use")
            updates["slug"] = new_slug
    if "annual_spend" in updates:
        updates["annual_spend"] = _validated_annual_spend(updates["annual_spend"])
    await _validated_category_refs(
        db, updates.get("spending_category_id"), updates.get("pinned_card_id")
    )
    for field, value in updates.items():
        setattr(category, field, value)
    await db.commit()
    return category


@router.delete("/categories/{category_id}", status_code=204)
async def delete_reward_category(category_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    """Deletes the row AND its matrix cells (FK CASCADE). Unlike spending categories
    there is no monthly history to orphan — cells are cheap to re-enter, so no guard."""
    category = await _get_reward_category(db, category_id)
    await db.delete(category)
    await db.commit()
    return Response(status_code=204)


# --- reward rates (matrix cells) ----------------------------------------------------------


async def _all_rates(db: AsyncSession) -> list[RewardRate]:
    return list(
        (await db.execute(select(RewardRate).order_by(RewardRate.card_id, RewardRate.category_id)))
        .scalars()
        .all()
    )


@router.get("/rates", response_model=list[RewardRateOut])
async def list_reward_rates(db: AsyncSession = Depends(get_db)) -> list[RewardRate]:
    return await _all_rates(db)


@router.put("/rates", response_model=list[RewardRateOut])
async def put_reward_rates(
    body: list[RewardRatePut], db: AsyncSession = Depends(get_db)
) -> list[RewardRate]:
    """Bulk matrix save: upsert cells, delete where multiplier is null. ATOMIC — any
    validation failure raises before the single commit, applying nothing. Returns the
    full post-save cell list (the matrix re-renders without a second fetch)."""
    seen: set[tuple[int, int]] = set()
    for entry in body:
        key = (entry.card_id, entry.category_id)
        if key in seen:
            raise HTTPException(
                status_code=422,
                detail=f"duplicate cell for card {entry.card_id}, category {entry.category_id}",
            )
        seen.add(key)
    card_ids = {entry.card_id for entry in body}
    category_ids = {entry.category_id for entry in body}
    if card_ids:
        found_cards = set(
            (await db.execute(select(CreditCard.id).where(CreditCard.id.in_(card_ids))))
            .scalars()
            .all()
        )
        missing = card_ids - found_cards
        if missing:
            raise HTTPException(status_code=404, detail=f"card {min(missing)} not found")
    if category_ids:
        found = set(
            (await db.execute(select(RewardCategory.id).where(RewardCategory.id.in_(category_ids))))
            .scalars()
            .all()
        )
        missing = category_ids - found
        if missing:
            raise HTTPException(status_code=404, detail=f"reward category {min(missing)} not found")
    existing = {
        (rate.card_id, rate.category_id): rate
        for rate in (await db.execute(select(RewardRate))).scalars()
    }
    for entry in body:
        key = (entry.card_id, entry.category_id)
        row = existing.get(key)
        if entry.multiplier is None:
            if row is not None:
                await db.delete(row)
            continue
        multiplier = quantize_money(entry.multiplier, "multiplier", max_abs=MULTIPLIER_MAX_ABS)
        if multiplier <= 0:
            raise HTTPException(status_code=422, detail="multiplier must be positive")
        cap: Decimal | None = None
        if entry.monthly_cap is not None:
            cap = quantize_money(entry.monthly_cap, "monthly_cap", max_abs=MONEY_MAX_ABS_10_2)
            if cap <= 0:
                raise HTTPException(status_code=422, detail="monthly_cap must be positive")
        if row is None:
            db.add(
                RewardRate(
                    card_id=entry.card_id,
                    category_id=entry.category_id,
                    multiplier=multiplier,
                    note=entry.note,
                    monthly_cap=cap,
                )
            )
        else:
            row.multiplier = multiplier
            row.note = entry.note
            row.monthly_cap = cap
    await db.commit()
    return await _all_rates(db)
