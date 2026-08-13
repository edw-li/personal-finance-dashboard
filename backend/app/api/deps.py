from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.security import decode_access_token

bearer = HTTPBearer(auto_error=False)

AUTH_401_HEADERS = {"WWW-Authenticate": "Bearer"}  # RFC 9110 §15.5.2: 401 MUST carry it


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated", headers=AUTH_401_HEADERS)
    try:
        user_id = decode_access_token(credentials.credentials)
    except ValueError:
        raise HTTPException(
            status_code=401, detail="Invalid or expired token", headers=AUTH_401_HEADERS
        ) from None
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=401, detail="Invalid or expired token", headers=AUTH_401_HEADERS
        )
    return user
