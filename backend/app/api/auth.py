from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import User
from app.rate_limit import AUTH_ATTEMPT, limiter
from app.schemas.auth import ChangePasswordRequest, LoginRequest, MeResponse, TokenResponse
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
@limiter.limit(AUTH_ATTEMPT)
async def login(
    request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    email = body.email.strip().lower()  # must match seed.py's normalization
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    try:
        password_ok = user is not None and verify_password(body.password, user.password_hash)
    except ValueError:
        # >72-byte password or corrupt stored hash — treat as failed credentials, never 500
        password_ok = False
    if not password_ok:
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(email=user.email)


@router.post("/change-password", status_code=204)
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    try:
        current_ok = verify_password(body.current_password, user.password_hash)
    except ValueError:
        current_ok = False
    if not current_ok:
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    try:
        user.password_hash = hash_password(body.new_password)
    except ValueError:
        raise HTTPException(status_code=400, detail="Password must be at most 72 bytes") from None
    await db.commit()
    return Response(status_code=204)
