from datetime import UTC, datetime, timedelta

import bcrypt
import jwt as pyjwt
import pytest

from app.config import settings
from app.security import create_access_token, decode_access_token, hash_password, verify_password
from tests.conftest import _REAL_GENSALT, TEST_BCRYPT_ROUNDS


def test_password_hash_roundtrip():
    h = hash_password("s3cret!")
    assert h != "s3cret!"
    assert verify_password("s3cret!", h)
    assert not verify_password("wrong", h)


def test_production_hashes_keep_bcrypts_default_cost(monkeypatch):
    """conftest caps bcrypt at its minimum cost for the whole run. With the real gensalt
    back, hash_password is the cost-12 production hash: the speed-up is test-only, and
    nothing in app/ relies on the cap."""
    monkeypatch.setattr(bcrypt, "gensalt", _REAL_GENSALT)
    h = hash_password("x")
    assert h.startswith("$2b$12$")
    assert verify_password("x", h)


def test_the_suite_hashes_at_bcrypts_minimum_cost():
    """The other half: the cap really reaches hash_password (it calls bcrypt.gensalt through
    the module attribute). Were that ever imported by name, the cap would silently stop
    applying and every logged-in test would pay ~410 ms again."""
    assert TEST_BCRYPT_ROUNDS == 4
    h = hash_password("x")
    assert h.startswith("$2b$04$")
    assert verify_password("x", h)
    assert not verify_password("y", h)


def test_jwt_roundtrip():
    token = create_access_token(user_id=1, token_version=3)
    assert decode_access_token(token) == (1, 3)


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


@pytest.mark.parametrize("ver", [None, "abc", 1.5, [1]])
def test_jwt_malformed_version_rejected(ver):
    """Only ints are ever minted, so anything else is a forged/corrupt token and must raise
    the same opaque ValueError as any other bad token -- never reach the version compare."""
    token = pyjwt.encode(
        {"sub": "1", "ver": ver, "exp": datetime.now(UTC) + timedelta(hours=1)},
        settings.secret_key,
        algorithm="HS256",
    )
    with pytest.raises(ValueError, match="invalid token"):
        decode_access_token(token)
