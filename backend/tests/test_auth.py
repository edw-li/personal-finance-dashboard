import jwt as pyjwt
from sqlalchemy import delete

from app.config import settings
from app.models import User
from app.security import ALGORITHM, create_access_token


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
    assert resp.status_code == 200
    assert resp.json()["access_token"]
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


async def test_renew_issues_a_fresh_token_with_a_later_expiry(auth_client, client):
    old = client.headers["Authorization"].split(" ", 1)[1]
    resp = await auth_client.post("/api/v1/auth/renew")
    assert resp.status_code == 200, resp.text
    new = resp.json()["access_token"]
    old_claims = pyjwt.decode(old, settings.secret_key, algorithms=[ALGORITHM])
    new_claims = pyjwt.decode(new, settings.secret_key, algorithms=[ALGORITHM])
    # Same subject and version: a renewal EXTENDS a session, it never starts a new one, so a
    # password change elsewhere still ends this one at its next request.
    assert (new_claims["sub"], new_claims["ver"]) == (old_claims["sub"], old_claims["ver"])
    # `>=`, not `>`, and no `new != old`: `exp` is a whole number of seconds, so renewing
    # inside the same second as the login re-mints a byte-identical token. The guarantee is
    # that the expiry never moves BACKWARDS -- a renewal can only ever buy time.
    assert new_claims["exp"] >= old_claims["exp"]
    client.headers["Authorization"] = f"Bearer {new}"
    assert (await client.get("/api/v1/auth/me")).status_code == 200


async def test_renew_requires_auth(client):
    assert (await client.post("/api/v1/auth/renew")).status_code == 401


async def test_change_password_signs_out_every_other_session_but_not_this_one(
    auth_client, client, seeded_user
):
    other = create_access_token(seeded_user.id, seeded_user.token_version)
    resp = await auth_client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "correct-horse", "new_password": "new-pass-123"},
    )
    assert resp.status_code == 200, resp.text
    fresh = resp.json()["access_token"]
    # The token minted BEFORE the change is dead everywhere...
    client.headers["Authorization"] = f"Bearer {other}"
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    # ...and the one the response carried keeps this tab signed in.
    client.headers["Authorization"] = f"Bearer {fresh}"
    assert (await client.get("/api/v1/auth/me")).status_code == 200


async def test_legacy_token_without_a_version_claim_still_works(client, seeded_user):
    # Tokens issued before this deploy carry no `ver`; they are read as version 0 and stay
    # valid until their own expiry -- the deploy itself logs nobody out.
    payload = pyjwt.decode(
        create_access_token(seeded_user.id, 0), settings.secret_key, algorithms=[ALGORITHM]
    )
    del payload["ver"]
    legacy = pyjwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)
    client.headers["Authorization"] = f"Bearer {legacy}"
    assert (await client.get("/api/v1/auth/me")).status_code == 200
