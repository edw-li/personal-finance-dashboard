"""Coverage — the months each feed covers, in one cheap GET (2026-09-03 shell spec §7).

Presence, nothing else: no totals, no owners, no derived flags. The ribbon needs presence,
and presence is what this answers. Balances are snapshot months (the wizard writes a
snapshot per saved month); net pay is the cashflow row. Ordering is ascending so clients
can take `[0]` as the earliest covered month.

The CLASSIFICATION — which spending months count as entered, empty or missing — lives in
`services/coverage.py`, because three health checks read the same sentences and neither a
service nor a check may import a router (2026-09-04 honest-numbers spec §3). This endpoint
is the wire mapping of that one definition, and it still runs one query per table.
"""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.schemas.coverage import CoverageLatestOut, CoverageOut
from app.services.coverage import load_coverage

router = APIRouter(prefix="/coverage", tags=["coverage"], dependencies=[Depends(get_current_user)])


def _latest(months: list[date]) -> date | None:
    return months[-1] if months else None


@router.get("", response_model=CoverageOut)
async def coverage(db: AsyncSession = Depends(get_db)) -> CoverageOut:
    found = await load_coverage(db)
    return CoverageOut(
        balances=found.balances,
        spending=found.entered,
        net_pay=found.net_pay,
        spending_empty=found.empty,
        spending_missing=found.missing,
        net_pay_missing=found.net_pay_missing,
        latest=CoverageLatestOut(
            balances=_latest(found.balances),
            spending=_latest(found.entered),
            net_pay=_latest(found.net_pay),
        ),
    )
