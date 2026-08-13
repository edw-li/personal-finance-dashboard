from sqlalchemy import delete

from app.models import User
from app.security import create_access_token


async def test_login_success(client, seeded_user):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "me@example.com", "password": "correct-horse"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]


async def test_login_wrong_password(client, seeded_user):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "me@example.com", "password": "nope"},
    )
    assert resp.status_code == 401


async def test_login_unknown_email_same_error(client, seeded_user):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "who@example.com", "password": "nope"},
    )
    assert resp.status_code == 401
    # Same detail as wrong password — don't leak which emails exist. (Response TIMING still
    # differs ~186ms since bcrypt runs only for known emails — accepted trade-off for a
    # single-account app; a dummy-hash compare would cost more than the leak is worth.)
    assert resp.json()["detail"] == "Incorrect email or password"


async def test_me_requires_auth(client):
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


async def test_me_returns_email(auth_client):
    resp = await auth_client.get("/api/v1/auth/me")
    assert resp.status_code == 200
    assert resp.json() == {"email": "me@example.com"}


async def test_change_password_wrong_current(auth_client):
    resp = await auth_client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "nope", "new_password": "new-pass-123"},
    )
    assert resp.status_code == 400


async def test_change_password_success(auth_client, client):
    resp = await auth_client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "correct-horse", "new_password": "new-pass-123"},
    )
    assert resp.status_code == 204
    client.headers.pop("Authorization")
    relogin = await client.post(
        "/api/v1/auth/login",
        json={"email": "me@example.com", "password": "new-pass-123"},
    )
    assert relogin.status_code == 200


async def test_login_rate_limited(client, seeded_user):
    for _ in range(10):
        await client.post(
            "/api/v1/auth/login",
            json={"email": "me@example.com", "password": "nope"},
        )
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "me@example.com", "password": "nope"},
    )
    assert resp.status_code == 429


async def test_me_rejects_token_for_missing_user(client, db, seeded_user):
    token = create_access_token(seeded_user.id)
    await db.execute(delete(User).where(User.id == seeded_user.id))
    await db.commit()
    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


async def test_me_rejects_garbage_token(client):
    client.headers["Authorization"] = "Bearer not.a.real.token"
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


async def test_login_normalizes_email(client, seeded_user):
    # Pins the cross-file coupling with seed.py's .strip().lower() normalization
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "  ME@Example.COM  ", "password": "correct-horse"},
    )
    assert resp.status_code == 200


async def test_login_long_password_is_401_not_500(client, seeded_user):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "me@example.com", "password": "a" * 200},
    )
    assert resp.status_code == 401


async def test_change_password_multibyte_over_72_bytes_rejected(auth_client):
    # 40 accented chars pass the 72-CHAR schema cap but are 80 BYTES — the endpoint
    # catch is the authoritative enforcement.
    resp = await auth_client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "correct-horse", "new_password": "é" * 40},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Password must be at most 72 bytes"
