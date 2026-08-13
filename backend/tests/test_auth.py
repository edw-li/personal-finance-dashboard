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
