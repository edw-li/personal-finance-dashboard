import os
import re
from contextlib import contextmanager

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.database import Base, get_db
from app.main import app
from app.models import User
from app.rate_limit import limiter
from app.security import hash_password
from tests.portfolio_factories import reset_accounts

# The test database is disposable and torn down aggressively (drop_all + TRUNCATE between
# tests), so concurrent suite runs against one database deadlock each other. FINANCE_TEST_DB
# lets each runner (CI shard, parallel worktree agent) claim its own database; the name must
# keep a *_test suffix so the destructive statements below can never target a real database.
_TEST_DB_NAME = os.environ.get("FINANCE_TEST_DB", "finance_test")
if not re.fullmatch(r"[a-z0-9_]+_test(_[a-z0-9_]+)?", _TEST_DB_NAME):
    raise RuntimeError(
        f"FINANCE_TEST_DB={_TEST_DB_NAME!r} must match '<name>_test[_suffix]' "
        "to guard the destructive test teardown"
    )

# make_url().set() survives query params / odd DSNs, unlike string surgery; guarantees the
# destructive drop_all below can only ever target the *_test database.
TEST_DATABASE_URL = make_url(settings.database_url).set(database=_TEST_DB_NAME)


async def _ensure_test_database() -> None:
    """Create the test database if missing — self-heals stale dev volumes and plain-CI Postgres."""
    admin = create_async_engine(make_url(settings.database_url), isolation_level="AUTOCOMMIT")
    async with admin.connect() as conn:
        exists = await conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :name").bindparams(name=_TEST_DB_NAME)
        )
        if not exists:
            await conn.execute(text(f'CREATE DATABASE "{_TEST_DB_NAME}"'))
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


@pytest.fixture(autouse=True)
def _reset_portfolio_account_factory():
    # The db fixture TRUNCATEs between tests; the label -> row memo must not outlive it.
    reset_accounts()


@pytest.fixture(autouse=True)
def _reset_assistant_module_state():
    # The catalog verdict and the outbound-transport hook are module globals: a probe
    # cached (or a MockTransport left) by one test would otherwise decide the next one.
    # Imported here so the assistant service isn't pulled in at conftest import time.
    from app.services import assistant_models

    assistant_models.reset_catalog_cache()
    assistant_models.TRANSPORT_OVERRIDE = None


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


@pytest.fixture
def forbid_writes(db):
    """A context-manager FACTORY: inside `with forbid_writes():` any flush of the shared test
    session that carries new, dirty or deleted objects fails the test (2026-09-03
    planning-sandboxes spec §14). A factory rather than an always-on fixture so a test can
    seed and commit first, then engage the guard around the one request under proof.

    Attached to the SYNC session underneath the AsyncSession — SQLAlchemy's ORM events are
    dispatched there. Removed in `finally`, so a failing assertion cannot leave the listener
    on a session the next test reuses.
    """

    @contextmanager
    def guard():
        def refuse(session, flush_context, instances):
            if session.new or session.dirty or session.deleted:
                raise AssertionError(
                    "write attempted under forbid_writes: "
                    f"new={list(session.new)} dirty={list(session.dirty)} "
                    f"deleted={list(session.deleted)}"
                )

        sync_session = db.sync_session
        event.listen(sync_session, "before_flush", refuse)
        try:
            yield
        finally:
            event.remove(sync_session, "before_flush", refuse)

    return guard
