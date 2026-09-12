from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import User
from app.models.assistant_finding import AssistantFinding
from app.schemas.assistant_findings import FindingCreate, FindingOut
from app.services.assistant_evidence import validate_receipt

router = APIRouter(prefix="/assistant/findings", tags=["assistant findings"])


@router.get("", response_model=list[FindingOut])
async def list_findings(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return list(
        (
            await db.execute(
                select(AssistantFinding)
                .where(AssistantFinding.user_id == user.id)
                .order_by(AssistantFinding.created_at.desc(), AssistantFinding.id.desc())
                .limit(200)
            )
        ).scalars()
    )


@router.post("", response_model=FindingOut, status_code=201)
async def create_finding(
    body: FindingCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    validate_receipt(body.receipt, body.evidence, body.context, body.evidence_as_of, user.id)
    row = AssistantFinding(
        user_id=user.id,
        title=body.title,
        content=body.content,
        model_used=body.model_used,
        context=body.context,
        evidence=[metric.model_dump(mode="json", by_alias=True) for metric in body.evidence],
        evidence_as_of=body.evidence_as_of,
    )
    db.add(row)
    await db.commit()
    return row


@router.get("/{finding_id}", response_model=FindingOut)
async def get_finding(
    finding_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    row = (
        await db.execute(
            select(AssistantFinding).where(
                AssistantFinding.id == finding_id, AssistantFinding.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Saved finding not found.")
    return row


@router.delete("/{finding_id}", status_code=204)
async def delete_finding(
    finding_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    row = await get_finding(finding_id, user, db)
    await db.delete(row)
    await db.commit()
    return Response(status_code=204)
