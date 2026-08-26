from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import (
    Account,
    CardCredit,
    CreditCard,
    CreditLimitEvent,
    RewardCategory,
    RewardRate,
    SpendingCategory,
)
from app.schemas.credit_cards import (
    CardCreditIn,
    CardCreditOut,
    CreditCardIn,
    CreditCardOut,
    CreditLimitEventIn,
    CreditLimitEventOut,
    RewardCategoryCreate,
    RewardCategoryOut,
    RewardCategoryUpdate,
    RewardRateOut,
    RewardRatePut,
)
from app.services.money import (
    MONEY_MAX_ABS_8_2,
    MONEY_MAX_ABS_10_2,
    MONEY_MAX_ABS_12_2,
    quantize_money,
    quantize_price,
    require_reasonable_date,
)

router = APIRouter(
    prefix="/credit-cards", tags=["credit-cards"], dependencies=[Depends(get_current_user)]
)

MULTIPLIER_MAX_ABS = Decimal(10_000)  # Numeric(6,2): 4 integer digits
POINT_VALUE_MAX_ABS = Decimal(100)  # Numeric(6,4): 2 integer digits

# ROUTE ORDER IS LOAD-BEARING: /categories and /rates are declared BEFORE any
# /{card_id} route (those live in the cards section below) — FastAPI matches in
# declaration order and "/credit-cards/categories" would otherwise 422 against the
# int converter. Keep new static sub-paths above the cards section.


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


# --- cards --------------------------------------------------------------------------------


async def _get_card(db: AsyncSession, card_id: int) -> CreditCard:
    card = await db.get(CreditCard, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="card not found")
    return card


async def _card_children(
    db: AsyncSession, card_ids: list[int]
) -> tuple[dict[int, list[CardCredit]], dict[int, list[CreditLimitEvent]]]:
    credits: dict[int, list[CardCredit]] = {card_id: [] for card_id in card_ids}
    events: dict[int, list[CreditLimitEvent]] = {card_id: [] for card_id in card_ids}
    if card_ids:
        for credit in (
            (
                await db.execute(
                    select(CardCredit)
                    .where(CardCredit.card_id.in_(card_ids))
                    .order_by(CardCredit.id)
                )
            )
            .scalars()
            .all()
        ):
            credits[credit.card_id].append(credit)
        for event in (
            (
                await db.execute(
                    select(CreditLimitEvent)
                    .where(CreditLimitEvent.card_id.in_(card_ids))
                    .order_by(CreditLimitEvent.effective_date)
                )
            )
            .scalars()
            .all()
        ):
            events[event.card_id].append(event)
    return credits, events


def _card_out(
    card: CreditCard, credits: list[CardCredit], events: list[CreditLimitEvent]
) -> CreditCardOut:
    return CreditCardOut(
        id=card.id,
        name=card.name,
        slug=card.slug,
        annual_fee=card.annual_fee,
        rewards_currency=card.rewards_currency,
        point_value_cents=card.point_value_cents,
        primary_holder=card.primary_holder,
        authorized_users=card.authorized_users,
        opened_on=card.opened_on,
        is_active=card.is_active,
        account_id=card.account_id,
        notes=card.notes,
        sort_order=card.sort_order,
        credits=[CardCreditOut.model_validate(credit) for credit in credits],
        # Events arrive ascending by effective_date — the LAST one is current.
        current_limit=events[-1].limit_amount if events else None,
        limit_events=[CreditLimitEventOut.model_validate(event) for event in events],
    )


async def _one_card_out(db: AsyncSession, card: CreditCard) -> CreditCardOut:
    credits, events = await _card_children(db, [card.id])
    return _card_out(card, credits[card.id], events[card.id])


async def _validated_card_values(db: AsyncSession, body: CreditCardIn, card_id: int | None) -> dict:
    """Shared POST/PATCH validation → column dict. Raises the router's own 422/404/409s."""
    slug = slugify(body.name)
    if not slug or len(slug) > 120:
        raise HTTPException(
            status_code=422,
            detail="name must contain an ASCII letter or digit and slugify to "
            "at most 120 characters",
        )
    clash_filter = (CreditCard.slug == slug) | (CreditCard.name == body.name)
    query = select(CreditCard).where(clash_filter)
    if card_id is not None:
        query = query.where(CreditCard.id != card_id)
    if (await db.execute(query)).scalars().first() is not None:
        raise HTTPException(status_code=409, detail=f"card {slug!r} already exists")
    fee = quantize_money(body.annual_fee, "annual_fee", max_abs=MONEY_MAX_ABS_8_2)
    if fee < 0:
        raise HTTPException(status_code=422, detail="annual_fee must be non-negative")
    point_value = quantize_price(
        body.point_value_cents, "point_value_cents", max_abs=POINT_VALUE_MAX_ABS
    )
    if point_value <= 0:
        raise HTTPException(status_code=422, detail="point_value_cents must be positive")
    if body.opened_on is not None:
        require_reasonable_date(body.opened_on, "opened_on")
    if body.account_id is not None:
        account = await db.get(Account, body.account_id)
        if account is None:
            raise HTTPException(status_code=404, detail="account not found")
        if account.group != "liability":
            raise HTTPException(
                status_code=422, detail="linked account must be in the liability group"
            )
    return {
        "name": body.name,
        "slug": slug,
        "annual_fee": fee,
        "rewards_currency": body.rewards_currency,
        "point_value_cents": point_value,
        "primary_holder": body.primary_holder,
        "authorized_users": body.authorized_users,
        "opened_on": body.opened_on,
        "is_active": body.is_active,
        "account_id": body.account_id,
        "notes": body.notes,
        "sort_order": body.sort_order,
    }


@router.get("", response_model=list[CreditCardOut])
async def list_credit_cards(db: AsyncSession = Depends(get_db)) -> list[CreditCardOut]:
    cards = list(
        (await db.execute(select(CreditCard).order_by(CreditCard.sort_order, CreditCard.id)))
        .scalars()
        .all()
    )
    credits, events = await _card_children(db, [card.id for card in cards])
    return [_card_out(card, credits[card.id], events[card.id]) for card in cards]


@router.post("", response_model=CreditCardOut, status_code=201)
async def create_credit_card(
    body: CreditCardIn, db: AsyncSession = Depends(get_db)
) -> CreditCardOut:
    values = await _validated_card_values(db, body, card_id=None)
    card = CreditCard(**values)
    db.add(card)
    await db.commit()
    return await _one_card_out(db, card)


@router.patch("/{card_id}", response_model=CreditCardOut)
async def update_credit_card(
    card_id: int, body: CreditCardIn, db: AsyncSession = Depends(get_db)
) -> CreditCardOut:
    """Full replace (house style) — the client sends the whole card back."""
    card = await _get_card(db, card_id)
    values = await _validated_card_values(db, body, card_id=card_id)
    for field, value in values.items():
        setattr(card, field, value)
    await db.commit()
    return await _one_card_out(db, card)


@router.delete("/{card_id}", status_code=204)
async def delete_credit_card(card_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    """Cascades credits, cells and limit events (FK CASCADE); pins SET NULL. The
    frontend offers Undo by re-POSTing the card plus its children."""
    card = await _get_card(db, card_id)
    await db.delete(card)
    await db.commit()
    return Response(status_code=204)


# --- card credits -------------------------------------------------------------------------


def _validated_credit_value(value: Decimal) -> Decimal:
    quantized = quantize_money(value, "annual_value", max_abs=MONEY_MAX_ABS_8_2)
    if quantized < 0:
        raise HTTPException(status_code=422, detail="annual_value must be non-negative")
    return quantized


@router.post("/{card_id}/credits", response_model=CardCreditOut, status_code=201)
async def create_card_credit(
    card_id: int, body: CardCreditIn, db: AsyncSession = Depends(get_db)
) -> CardCredit:
    await _get_card(db, card_id)
    credit = CardCredit(
        card_id=card_id,
        label=body.label,
        annual_value=_validated_credit_value(body.annual_value),
        counts=body.counts,
    )
    db.add(credit)
    await db.commit()
    return credit


@router.patch("/credits/{credit_id}", response_model=CardCreditOut)
async def update_card_credit(
    credit_id: int, body: CardCreditIn, db: AsyncSession = Depends(get_db)
) -> CardCredit:
    credit = await db.get(CardCredit, credit_id)
    if credit is None:
        raise HTTPException(status_code=404, detail="credit not found")
    credit.label = body.label
    credit.annual_value = _validated_credit_value(body.annual_value)
    credit.counts = body.counts
    await db.commit()
    return credit


@router.delete("/credits/{credit_id}", status_code=204)
async def delete_card_credit(credit_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    credit = await db.get(CardCredit, credit_id)
    if credit is None:
        raise HTTPException(status_code=404, detail="credit not found")
    await db.delete(credit)
    await db.commit()
    return Response(status_code=204)


# --- credit limit events ------------------------------------------------------------------


@router.post("/{card_id}/limits", response_model=list[CreditLimitEventOut], status_code=201)
async def create_limit_event(
    card_id: int, body: CreditLimitEventIn, db: AsyncSession = Depends(get_db)
) -> list[CreditLimitEvent]:
    """Returns the card's FULL limit history ascending (the budgets-PUT precedent) so
    the editor renders without a second fetch. Same (card, date) → 409, not upsert:
    a mis-dated entry is fixed by delete-then-re-add, keeping every change deliberate."""
    await _get_card(db, card_id)
    require_reasonable_date(body.effective_date, "effective_date")
    amount = quantize_money(body.limit_amount, "limit_amount", max_abs=MONEY_MAX_ABS_12_2)
    if amount <= 0:
        raise HTTPException(status_code=422, detail="limit_amount must be positive")
    existing = (
        (
            await db.execute(
                select(CreditLimitEvent).where(
                    CreditLimitEvent.card_id == card_id,
                    CreditLimitEvent.effective_date == body.effective_date,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"limit event for {body.effective_date} already exists — delete it first",
        )
    db.add(
        CreditLimitEvent(
            card_id=card_id,
            effective_date=body.effective_date,
            limit_amount=amount,
            note=body.note,
        )
    )
    await db.commit()
    return list(
        (
            await db.execute(
                select(CreditLimitEvent)
                .where(CreditLimitEvent.card_id == card_id)
                .order_by(CreditLimitEvent.effective_date)
            )
        )
        .scalars()
        .all()
    )


@router.delete("/{card_id}/limits/{event_id}", status_code=204)
async def delete_limit_event(
    card_id: int, event_id: int, db: AsyncSession = Depends(get_db)
) -> Response:
    await _get_card(db, card_id)
    event = await db.get(CreditLimitEvent, event_id)
    if event is None or event.card_id != card_id:
        raise HTTPException(status_code=404, detail="limit event not found")
    await db.delete(event)
    await db.commit()
    return Response(status_code=204)
