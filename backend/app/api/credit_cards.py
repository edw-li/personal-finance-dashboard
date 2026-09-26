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
    Person,
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
from app.schemas.ordering import OrderIn
from app.services.changelog import ChangeBatch, batch_header, change_batch, row_image
from app.services.money import (
    MONEY_MAX_ABS_8_2,
    MONEY_MAX_ABS_10_2,
    MONEY_MAX_ABS_12_2,
    quantize_money,
    quantize_price,
    require_reasonable_date,
)
from app.services.ordering import (
    STALE_CARDS,
    STALE_REWARD_CATEGORIES,
    apply_order,
    in_list_order,
    next_sort_order,
    order_lock,
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


# --- Activity labels (2026-09-25 polish spec §6.1) ----------------------------------------


def _edit_label(noun: str, name: str, before: dict, after: dict, *, off: str, on: str) -> str:
    """A PATCH's label. When `is_active` is the only column that moved, the edit was the
    row's one-click toggle, and the label says so in the button's own verb — the roster's
    Archive / Unarchive, the categories' Hide / Show."""
    moved = {key for key, value in after.items() if before.get(key) != value}
    if moved == {"is_active"}:
        return f"{on if after['is_active'] else off} {noun} {name}"
    return f"Edited {noun} {name}"


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
    return list((await db.execute(in_list_order(RewardCategory))).scalars())


@router.post("/categories", response_model=RewardCategoryOut, status_code=201)
async def create_reward_category(
    body: RewardCategoryCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
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
    sort_order = body.sort_order
    if sort_order is None:
        # No position given: append after the last row (2026-09-23 reorder spec §3.3), under
        # the list's lock (decision 16).
        await db.execute(order_lock(RewardCategory))
        sort_order = (await db.execute(next_sort_order(RewardCategory.sort_order))).scalar_one()
    category = RewardCategory(
        name=body.name,
        slug=slug,
        sort_order=sort_order,
        annual_spend=_validated_annual_spend(body.annual_spend),
        spending_category_id=body.spending_category_id,
        pinned_card_id=body.pinned_card_id,
    )
    db.add(category)
    await db.flush()
    batch.record_insert(category)
    batch.label = f"Added reward category {category.name}"
    response.headers.update(batch_header(await batch.commit()))
    return category


@router.put("/categories/order", response_model=list[RewardCategoryOut])
async def reorder_reward_categories(
    body: OrderIn, db: AsyncSession = Depends(get_db)
) -> list[RewardCategory]:
    """Drag-to-reorder the Categories & weights rows (2026-09-23 spec §3.2): `ids` is every
    reward category in its new order; sort_order becomes 0…n−1 in ONE transaction, and only
    rows whose value moves are written. Unlogged like the rest of this router — the client's
    Undo re-sends the previous order. Serialized per list (decision 16): the order lock
    comes first. Declared before /categories/{category_id}."""
    await db.execute(order_lock(RewardCategory))
    categories = list((await db.execute(in_list_order(RewardCategory))).scalars())
    ordered, changed = apply_order(categories, body.ids, stale_detail=STALE_REWARD_CATEGORIES)
    if changed:  # the order as stored writes nothing
        await db.commit()
    return ordered


@router.patch("/categories/{category_id}", response_model=RewardCategoryOut)
async def update_reward_category(
    category_id: int,
    body: RewardCategoryUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
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
    before = row_image(category)
    for field, value in updates.items():
        setattr(category, field, value)
    batch.record_update(category, before)
    batch.label = _edit_label(
        "reward category", category.name, before, row_image(category), off="Hid", on="Showed"
    )
    response.headers.update(batch_header(await batch.commit()))
    return category


@router.delete("/categories/{category_id}", status_code=204)
async def delete_reward_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """Deletes the row AND its matrix cells — the cells by their own explicit DELETEs, each
    imaged, so the Activity card's Undo restores them with the row. Unlike spending categories
    there is no monthly history to orphan — cells are cheap to re-enter — so no guard."""
    category = await _get_reward_category(db, category_id)
    cells = (
        (
            await db.execute(
                select(RewardRate)
                .where(RewardRate.category_id == category_id)
                .order_by(RewardRate.id)
            )
        )
        .scalars()
        .all()
    )
    for rate in cells:
        batch.record_delete(rate)
        await db.delete(rate)
    # The cells reach the database before the row: with no relationship() between these
    # models the unit of work orders deletes by class name, RewardCategory ahead of RewardRate,
    # and the FK cascade would take cells the session still means to delete.
    await db.flush()
    batch.record_delete(category)
    batch.label = f"Deleted reward category {category.name}"
    await db.delete(category)
    return Response(status_code=204, headers=batch_header(await batch.commit()))


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
    body: list[RewardRatePut],
    response: Response,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> list[RewardRate]:
    """Bulk matrix save: upsert cells, delete where multiplier is null. ATOMIC — any
    validation failure raises before the single commit, applying nothing. Returns the
    full post-save cell list (the matrix re-renders without a second fetch). Every cell it
    adds, changes or clears is a row of ONE change batch, so one Undo reverts the whole save;
    an all-unchanged save records nothing and names no batch."""
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
    added: list[RewardRate] = []
    for entry in body:
        key = (entry.card_id, entry.category_id)
        row = existing.get(key)
        if entry.multiplier is None:
            if row is not None:
                batch.record_delete(row)
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
            rate = RewardRate(
                card_id=entry.card_id,
                category_id=entry.category_id,
                multiplier=multiplier,
                note=entry.note,
                monthly_cap=cap,
            )
            db.add(rate)
            added.append(rate)
        else:
            before = row_image(row)
            row.multiplier = multiplier
            row.note = entry.note
            row.monthly_cap = cap
            batch.record_update(row, before)
    await db.flush()  # the new cells' ids, which their images need
    for rate in added:
        batch.record_insert(rate)
    changed = batch.rows
    batch.label = f"Edited {changed} reward multiplier{'' if changed == 1 else 's'}"
    response.headers.update(batch_header(await batch.commit()))
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
        # ENUMERATION SITE 1 of 2 (the other is _validated_card_values' dict). A column
        # missing from either one is silently dropped on the wire — the audit's §3.6 hazard.
        person_id=card.person_id,
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


async def _cards_out(db: AsyncSession, cards: list[CreditCard]) -> list[CreditCardOut]:
    """The list GET's wire for these cards, in this order. The reorder PUT answers through
    it too, so its rows are built exactly as `GET /credit-cards` builds them."""
    credits, events = await _card_children(db, [card.id for card in cards])
    return [_card_out(card, credits[card.id], events[card.id]) for card in cards]


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
    # 422, not 404: the net-worth router's sentence for the same mistake, and the UI renders
    # it verbatim. Checked BEFORE the write so a bad id never surfaces as asyncpg's
    # ForeignKeyViolationError inside a 500.
    if body.person_id is not None and (await db.get(Person, body.person_id)) is None:
        raise HTTPException(status_code=422, detail=f"unknown person_id: {body.person_id}")
    return {
        "name": body.name,
        "slug": slug,
        "annual_fee": fee,
        "rewards_currency": body.rewards_currency,
        "point_value_cents": point_value,
        # ENUMERATION SITE 2 of 2 (the other is _card_out). Both verbs share this dict, so
        # create and full-replace patch carry ownership by construction.
        "person_id": body.person_id,
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
    return await _cards_out(db, list((await db.execute(in_list_order(CreditCard))).scalars()))


@router.post("", response_model=CreditCardOut, status_code=201)
async def create_credit_card(
    body: CreditCardIn, db: AsyncSession = Depends(get_db)
) -> CreditCardOut:
    values = await _validated_card_values(db, body, card_id=None)
    if values["sort_order"] is None:
        # No position given: append after the last card (2026-09-23 reorder spec §3.3), under
        # the list's lock (decision 16).
        await db.execute(order_lock(CreditCard))
        values["sort_order"] = (
            await db.execute(next_sort_order(CreditCard.sort_order))
        ).scalar_one()
    card = CreditCard(**values)
    db.add(card)
    await db.commit()
    return await _one_card_out(db, card)


@router.put("/order", response_model=list[CreditCardOut])
async def reorder_credit_cards(
    body: OrderIn, db: AsyncSession = Depends(get_db)
) -> list[CreditCardOut]:
    """Drag-to-reorder the card list (2026-09-23 spec §3.2): `ids` is every card, active
    and inactive, in its new order; sort_order becomes 0…n−1 in ONE transaction, and only
    rows whose value moves are written. Answers exactly as the list GET does. Unlogged like
    the rest of this router — the client's Undo re-sends the previous order. Serialized per
    list (decision 16): the order lock comes first. Declared before the /{card_id} routes."""
    await db.execute(order_lock(CreditCard))
    cards = list((await db.execute(in_list_order(CreditCard))).scalars())
    ordered, changed = apply_order(cards, body.ids, stale_detail=STALE_CARDS)
    if changed:  # the order as stored writes nothing
        await db.commit()
    return await _cards_out(db, ordered)


@router.patch("/{card_id}", response_model=CreditCardOut)
async def update_credit_card(
    card_id: int, body: CreditCardIn, db: AsyncSession = Depends(get_db)
) -> CreditCardOut:
    """Full replace (house style) — the client sends the whole card back, except that an
    absent or null sort_order keeps the stored one (2026-09-23 reorder spec §3.3): the
    list's drag owns that column, and an edit form holding a stale copy must not undo it."""
    card = await _get_card(db, card_id)
    values = await _validated_card_values(db, body, card_id=card_id)
    if values["sort_order"] is None:
        del values["sort_order"]
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
        reset_cadence=body.reset_cadence,
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
    credit.reset_cadence = body.reset_cadence
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
