import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.database import Base, get_db
from app.main import app
from app.models import User
from app.rate_limit import limiter
from app.security import hash_password

# make_url().set() survives query params / odd DSNs, unlike string surgery; guarantees the
# destructive drop_all below can only ever target the *_test database.
TEST_DATABASE_URL = make_url(settings.database_url).set(database="finance_test")


async def _ensure_test_database() -> None:
    """Create finance_test if missing — self-heals stale dev volumes and plain-CI Postgres."""
    admin = create_async_engine(make_url(settings.database_url), isolation_level="AUTOCOMMIT")
    async with admin.connect() as conn:
        exists = await conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = 'finance_test'"))
        if not exists:
            await conn.execute(text("CREATE DATABASE finance_test"))
    await admin.dispose()


@pytest.fixture(scope="session")
async def engine():
    await _ensure_test_database()
    eng = create_async_engine(TEST_DATABASE_URL)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture
async def db(engine):
    # Shared-session contract: `client` drives endpoints through THIS session. After an
    # endpoint raises IntegrityError the session is poisoned — `await db.rollback()` before
    # reusing it — and concurrent requests within one test are not permitted.
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    tables = Base.metadata.sorted_tables
    if tables:
        names = ", ".join(f'"{t.name}"' for t in reversed(tables))
        async with engine.begin() as conn:
            await conn.exec_driver_sql(f"TRUNCATE {names} RESTART IDENTITY CASCADE")


@pytest.fixture
async def client(db):
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(scope="session", autouse=True)
def _no_scheduler_in_tests():
    # ASGITransport never runs the lifespan today; pin the invariant for any future
    # TestClient/LifespanManager use (Task 7 review M7).
    settings.scheduler_enabled = False


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    limiter.reset()


@pytest.fixture
async def seeded_user(db):
    user = User(email="me@example.com", password_hash=hash_password("correct-horse"))
    db.add(user)
    await db.commit()
    return user


@pytest.fixture
async def auth_client(client, seeded_user):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "me@example.com", "password": "correct-horse"},
    )
    assert resp.status_code == 200, resp.text  # fail loudly, not with an opaque KeyError
    token = resp.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return client
