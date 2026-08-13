from datetime import UTC, datetime, timedelta

import jwt as pyjwt
import pytest

from app.config import settings
from app.security import create_access_token, decode_access_token, hash_password, verify_password


def test_password_hash_roundtrip():
    h = hash_password("s3cret!")
    assert h != "s3cret!"
    assert verify_password("s3cret!", h)
    assert not verify_password("wrong", h)


def test_jwt_roundtrip():
    token = create_access_token(user_id=1)
    assert decode_access_token(token) == 1


def test_jwt_garbage_rejected():
    with pytest.raises(ValueError):
        decode_access_token("not.a.token")


def test_jwt_wrong_signature_rejected():
    forged = pyjwt.encode({"sub": "1"}, "a-different-key-at-least-32-bytes", algorithm="HS256")
    with pytest.raises(ValueError):
        decode_access_token(forged)


def test_jwt_without_exp_rejected():
    """A key-signed token minted without exp must not be an immortal credential."""
    immortal = pyjwt.encode({"sub": "1"}, settings.secret_key, algorithm="HS256")
    with pytest.raises(ValueError):
        decode_access_token(immortal)


def test_jwt_expired_rejected():
    stale = pyjwt.encode(
        {"sub": "1", "exp": datetime.now(UTC) - timedelta(seconds=1)},
        settings.secret_key,
        algorithm="HS256",
    )
    with pytest.raises(ValueError):
        decode_access_token(stale)


def test_jwt_non_numeric_sub_rejected():
    """The match= is the point: without it this passes on the unhardened decode, which
    leaks a raw "invalid literal for int()" instead of the documented ValueError."""
    token = pyjwt.encode(
        {"sub": "abc", "exp": datetime.now(UTC) + timedelta(hours=1)},
        settings.secret_key,
        algorithm="HS256",
    )
    with pytest.raises(ValueError, match="invalid token"):
        decode_access_token(token)
