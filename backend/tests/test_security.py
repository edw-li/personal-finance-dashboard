import pytest

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
    import jwt as pyjwt

    forged = pyjwt.encode({"sub": "1"}, "other-key", algorithm="HS256")
    with pytest.raises(ValueError):
        decode_access_token(forged)
