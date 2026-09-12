from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.schemas.metrics import SpendingMetricsOut
from app.services.metrics import load_spending_metrics
from app.services.money import require_first_of_month

router = APIRouter(prefix="/metrics", tags=["metrics"], dependencies=[Depends(get_current_user)])


@router.get("/spending", response_model=SpendingMetricsOut)
async def spending_metrics(
    month: date | None = None, db: AsyncSession = Depends(get_db)
) -> SpendingMetricsOut:
    if month is not None:
        require_first_of_month(month)
    return await load_spending_metrics(db, month)
