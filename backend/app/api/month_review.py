from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.month_review import MonthReview
from app.schemas.month_review import (
    BatchCloseIn,
    BatchCloseOut,
    MonthReviewListOut,
    MonthReviewOut,
    MonthSaveIn,
    MonthSaveOut,
)
from app.services.changelog import ChangeBatch, change_batch, row_image
from app.services.money import require_first_of_month
from app.services.month_review import load_review_book, lock_review_inputs
from app.services.month_writes import write_balances, write_spending
from app.services.review_input_v1 import revision

router = APIRouter(
    prefix="/month-review", tags=["month review"], dependencies=[Depends(get_current_user)]
)


@router.get("", response_model=MonthReviewListOut)
async def list_month_reviews(db: AsyncSession = Depends(get_db)) -> MonthReviewListOut:
    book = await load_review_book(db)
    return MonthReviewListOut(
        adopted_on=book.adopted_on,
        default_month=book.default_month,
        months=list(book.months.values()),
    )


@router.get("/months/{month}", response_model=MonthReviewOut)
async def get_month_review(month: date, db: AsyncSession = Depends(get_db)) -> MonthReviewOut:
    require_first_of_month(month)
    return (await load_review_book(db, extra_months=[month])).months[month]


def _conflict(current: MonthReviewOut) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "month_revision_conflict",
            "message": (
                "This month's inputs changed after you loaded them. Review the latest values "
                "before saving; your draft is still available."
            ),
            "current_revision": current.input_revision,
            "review": current.model_dump(mode="json"),
        },
    )


@router.put("/months/{month}", response_model=MonthSaveOut)
async def save_month(
    month: date,
    body: MonthSaveIn,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> MonthSaveOut:
    require_first_of_month(month)
    # Omission and explicit null have different write semantics for take-home/metadata.
    request_hash = revision(body.model_dump(mode="json", exclude_unset=True))
    try:
        await lock_review_inputs(db)
        initial = await load_review_book(db, extra_months=[month])
        current = initial.months[month]
        metadata = initial.reviews.get(month)
        if metadata and body.request_id and metadata.last_request_id == str(body.request_id):
            if metadata.last_request_hash != request_hash:
                raise HTTPException(
                    status_code=409,
                    detail="This request ID was already used for different changes.",
                )
            if metadata.last_response is not None:
                response = MonthSaveOut.model_validate(metadata.last_response)
                await db.rollback()  # release read locks without creating another batch
                return response
        if body.expected_revision != current.input_revision:
            raise _conflict(current)
        balance_result = (
            None
            if body.balances is None
            else await write_balances(month, body.balances, db, batch, record_metadata=True)
        )
        spending_result = (
            None if body.spending is None else await write_spending(month, body.spending, db, batch)
        )
        await db.flush()
        after_inputs = await load_review_book(db, extra_months=[month])
        digest = after_inputs.months[month].input_revision
        before = row_image(metadata) if metadata else None
        if metadata is None:
            metadata = MonthReview(month=month)
            db.add(metadata)
        same_inputs = metadata.confirmation_revision == digest
        metadata.zero_spending_confirmed = bool(
            (same_inputs and metadata.zero_spending_confirmed)
            or (body.spending is not None and body.spending.confirm_zero)
        )
        metadata.confirmation_revision = digest
        # A harmless save of an unchanged closed month preserves its certification.
        if not (same_inputs and metadata.reviewed_revision == digest and metadata.closed_at):
            metadata.balances_reviewed = body.reviewed.balances
            metadata.spending_reviewed = body.reviewed.spending
            metadata.take_home_reviewed = body.reviewed.take_home
        await db.flush()
        check = (await load_review_book(db, extra_months=[month])).months[month]
        if body.close:
            blockers = list(check.blockers)
            if not all(body.reviewed.model_dump().values()):
                blockers.append(
                    "Confirm balances, spending, and take-home on the review checklist."
                )
            if blockers:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "code": "month_not_ready",
                        "message": " ".join(blockers),
                        "blockers": blockers,
                    },
                )
            metadata.reviewed_revision = digest
            metadata.closed_at = datetime.now(UTC)
            metadata.closed_by = batch.actor
        await db.flush()
        final = (await load_review_book(db, extra_months=[month])).months[month]
        batch.label = f"{'Closed' if body.close else 'Saved'} {month:%b %Y} month"
        batch.month = month
        # The response stored for idempotency contains the eventual batch ID; storing it
        # is itself a review-metadata change, so a supplied ID always has a real batch.
        out = MonthSaveOut(
            month=month, review=final, balances=balance_result, spending=spending_result
        )
        if body.request_id:
            metadata.last_request_id = str(body.request_id)
            metadata.last_request_hash = request_hash
            out.batch_id = batch.id
            metadata.last_response = out.model_dump(mode="json")
        await db.flush()
        if before is None:
            batch.record_insert(metadata, month=month)
        else:
            batch.record_update(metadata, before, month=month)
        out.batch_id = await batch.commit()
        return out
    except Exception:
        await db.rollback()
        raise


@router.post("/batch-close", response_model=BatchCloseOut)
async def batch_close(
    body: BatchCloseIn,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> BatchCloseOut:
    dates = [item.month for item in body.months]
    for month in dates:
        require_first_of_month(month)
    if len(set(dates)) != len(dates):
        raise HTTPException(status_code=422, detail="Each month can appear only once.")
    if not all(body.reviewed.model_dump().values()):
        raise HTTPException(
            status_code=422, detail="Confirm all three feeds for the selected historical months."
        )
    try:
        await lock_review_inputs(db)
        book = await load_review_book(db, extra_months=dates)
        for item in body.months:
            state = book.months[item.month]
            if state.input_revision != item.expected_revision:
                raise _conflict(state)
            if not state.legacy_eligible or not state.can_close:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"{item.month:%B %Y} is not eligible for historical batch review. "
                        "Review it individually."
                    ),
                )
        stamp = datetime.now(UTC)
        for item in body.months:
            row = book.reviews[item.month]
            before = row_image(row)
            row.confirmation_revision = row.reviewed_revision = book.months[
                item.month
            ].input_revision
            row.balances_reviewed = row.spending_reviewed = row.take_home_reviewed = True
            row.closed_at = stamp
            row.closed_by = batch.actor
            batch.record_update(row, before, month=item.month)
        await db.flush()
        after = await load_review_book(db, extra_months=dates)
        batch.label = f"Reviewed {len(dates)} historical months"
        batch_id = await batch.commit()
        return BatchCloseOut(months=[after.months[month] for month in dates], batch_id=batch_id)
    except Exception:
        await db.rollback()
        raise
