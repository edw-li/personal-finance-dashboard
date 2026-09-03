"""Coverage — the months each feed covers, in one cheap GET (2026-09-03 shell spec §7).

Three DISTINCT month lists, nothing else: no totals, no owners, no derived flags. The ribbon
needs presence, and presence is what this answers. Balances are snapshot months (the wizard
writes a snapshot per saved month); spending is any category row; net pay is the cashflow
row. Ordering is ascending so clients can take `[0]` as the earliest covered month.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import MonthlyCashflow, MonthlySpending, NetWorthSnapshot
from app.schemas.coverage import CoverageOut

router = APIRouter(prefix="/coverage", tags=["coverage"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=CoverageOut)
async def coverage(db: AsyncSession = Depends(get_db)) -> CoverageOut:
    balances = (
        (
            await db.execute(
                select(NetWorthSnapshot.month).distinct().order_by(NetWorthSnapshot.month)
            )
        )
        .scalars()
        .all()
    )
    spending = (
        (await db.execute(select(MonthlySpending.month).distinct().order_by(MonthlySpending.month)))
        .scalars()
        .all()
    )
    net_pay = (
        (await db.execute(select(MonthlyCashflow.month).distinct().order_by(MonthlyCashflow.month)))
        .scalars()
        .all()
    )
    return CoverageOut(balances=list(balances), spending=list(spending), net_pay=list(net_pay))
