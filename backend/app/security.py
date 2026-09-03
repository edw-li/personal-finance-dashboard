from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.config import settings

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def create_access_token(user_id: int, token_version: int = 0) -> str:
    payload = {
        "sub": str(user_id),
        "ver": token_version,
        "exp": datetime.now(UTC) + timedelta(hours=settings.access_token_expire_hours),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> tuple[int, int]:
    """Return (user id, token version), or raise ValueError for any invalid/expired token.

    A token minted before versions existed has no `ver` and reads as 0, so this deploy
    signs nobody out (2026-09-03 shell spec §10).
    """
    try:
        # require: PyJWT only enforces exp when the claim is present, so a key-signed token
        # minted without one would never expire. ValueError: int() on a non-numeric sub would
        # otherwise escape uncaught, leaking "invalid literal for int()" to the caller.
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
        return int(payload["sub"]), int(payload.get("ver", 0))
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise ValueError("invalid token") from exc
