import os
import re
import warnings
from contextlib import contextmanager

import bcrypt
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

# The test database is disposable and torn down aggressively (drop_all + create_all once per
# run, then every row deleted and every sequence restarted after each test — see
# reset_database), so concurrent suite runs against one database wipe each other's rows and
# deadlock on the drop_all. FINANCE_TEST_DB lets each runner (CI shard, parallel worktree
# agent) claim its own database; the name must keep a *_test suffix so the destructive
# statements below can never target a real database.
#
# Parallel runs (`pytest -n 4`, pytest-xdist; opt-in — the default stays serial): every
# worker is its own process with PYTEST_XDIST_WORKER=gw0, gw1, … and claims
# `<FINANCE_TEST_DB>_<worker>` (finance_test_gw0, finance_test_speed_gw1, …), bootstrapped by
# its own session `engine` fixture, so workers never share a row or a drop_all. Without -n
# the variable is unset and the name is FINANCE_TEST_DB exactly.
_BASE_TEST_DB_NAME = os.environ.get("FINANCE_TEST_DB", "finance_test")
_XDIST_WORKER = os.environ.get("PYTEST_XDIST_WORKER")
_TEST_DB_NAME = f"{_BASE_TEST_DB_NAME}_{_XDIST_WORKER}" if _XDIST_WORKER else _BASE_TEST_DB_NAME
for _name in (_BASE_TEST_DB_NAME, _TEST_DB_NAME):
    if not re.fullmatch(r"[a-z0-9_]+_test(_[a-z0-9_]+)?", _name):
        raise RuntimeError(
            f"FINANCE_TEST_DB={_BASE_TEST_DB_NAME!r} (worker database {_TEST_DB_NAME!r}) "
            "must match '<name>_test[_suffix]' to guard the destructive test teardown"
        )

# The server the test databases live on. A "localhost" host is dialled as 127.0.0.1: Windows
# resolves localhost to ::1 first, and the dev Postgres publishes 5433 on 127.0.0.1 only
# (docker-compose.yml), so every new connection — and every cancel request asyncpg sends
# when a test cancels a query, which reconnects by host NAME — first sat through ~2 s of
# refused IPv6 connection attempts (measured 2,050 ms vs 25 ms: ~14 s of a serial run, and
# again in every -n worker). CI's service container listens on every interface, so the IPv4
# loopback reaches it too. Any other host is used as configured.
_SERVER_URL = make_url(settings.database_url)
if _SERVER_URL.host == "localhost":
    _SERVER_URL = _SERVER_URL.set(host="127.0.0.1")

# make_url().set() survives query params / odd DSNs, unlike string surgery; guarantees the
# destructive drop_all below can only ever target the *_test database.
TEST_DATABASE_URL = _SERVER_URL.set(database=_TEST_DB_NAME)


async def _ensure_test_database() -> None:
    """Create the test database if missing — self-heals stale dev volumes and plain-CI Postgres."""
    admin = create_async_engine(_SERVER_URL, isolation_level="AUTOCOMMIT")
    async with admin.connect() as conn:
        exists = await conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :name").bindparams(name=_TEST_DB_NAME)
        )
        if not exists:
            await conn.execute(text(f'CREATE DATABASE "{_TEST_DB_NAME}"'))
    await admin.dispose()


@pytest.fixture(scope="session")
async def engine():
    global _FAST_RESET_SQL, _TRUNCATE_SQL
    await _ensure_test_database()
    eng = create_async_engine(TEST_DATABASE_URL)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    # The reset's statements walk the tables create_all just built: sorted_tables is read NOW,
    # not at import, so the reset and the schema can never disagree about which tables exist.
    _FAST_RESET_SQL = _fast_reset_sql()
    _TRUNCATE_SQL = _truncate_sql()
    yield eng
    await eng.dispose()


# How long either reset path waits for a lock before it gives up. Neither statement conflicts
# with anything a finished test should still hold, so a wait means a leaked transaction is
# holding row locks (or, for TRUNCATE, any lock at all): without a limit the run would hang
# at that teardown forever; with one, the reset raises and names the lock.
_RESET_LOCK_TIMEOUT = "30s"


def _fast_reset_sql() -> str:
    """One statement (a DO block works through asyncpg's prepared path; a ';'-joined string
    would not): delete children first, then put every sequence back at its start — what
    TRUNCATE … RESTART IDENTITY did, without TRUNCATE's per-table file swap (~10-13 ms a
    table on the dev box's Docker Postgres, ~0.5 s a test).

    EVERY sequence in the schema, not only the ones a test's committed rows advanced: nextval
    is not transactional, so an insert that rolled back still moved its sequence; and a
    snapshot restore parks each sequence at max(id) + 1 with is_called false, which
    pg_sequences reports as last_value NULL — exactly like an untouched sequence — so a
    "reset only what was read" filter misses it and the next test's first row is id 2.
    Resetting every one costs no more (median ~5 ms either way). setval(seq, start, false)
    makes the next nextval return start — RESTART IDENTITY's state, serial or identity.

    Two ways it behaves unlike TRUNCATE, beyond speed:
    - DELETE takes no table lock that conflicts with a reader or with an uncommitted insert,
      so a test that leaks an open transaction no longer hangs its own teardown (TRUNCATE's
      ACCESS EXCLUSIVE lock waited for it). The leaked transaction's uncommitted rows are
      invisible to the DELETE and are not removed. Only rows it has locked (updated, deleted,
      SELECT … FOR UPDATE) make the reset wait, and then for _RESET_LOCK_TIMEOUT at most.
    - Freed tuple slots get reused, so rows can sit out of insertion order even in a table
      no test updated, and a query without ORDER BY returns them that way (a freshly
      truncated table filled in insertion order). A new flake of that shape points at a
      missing ORDER BY, not at the reset.

    synchronous_commit is off for this one transaction: its COMMIT returns without waiting
    for the WAL flush. Under -n 4 (four workers flushing at once) that wait made the rare
    0.5-3 s resets: the slowest reset of a run went from 0.8-3.1 s to 36-52 ms. Other
    sessions still see the commit at once — visibility does not wait for the flush — and a
    crash could only lose a reset of a disposable database whose schema every run rebuilds."""
    deletes = "\n".join(
        f'    DELETE FROM "{t.name}";' for t in reversed(Base.metadata.sorted_tables)
    )
    return (
        "DO $reset$\nDECLARE s record;\nBEGIN\n"
        "    PERFORM set_config('synchronous_commit', 'off', true);\n"
        f"    PERFORM set_config('lock_timeout', '{_RESET_LOCK_TIMEOUT}', true);\n"
        f"{deletes}\n"
        "    FOR s IN SELECT schemaname, sequencename, start_value FROM pg_sequences\n"
        "             WHERE schemaname = current_schema() LOOP\n"
        "        PERFORM setval(format('%I.%I', s.schemaname, s.sequencename)::regclass,\n"
        "                       s.start_value, false);\n"
        "    END LOOP;\n"
        "END $reset$"
    )


def _truncate_sql() -> str:
    names = ", ".join(f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables))
    return f"TRUNCATE {names} RESTART IDENTITY CASCADE"


# Built once per run by the session `engine` fixture, right after create_all.
_FAST_RESET_SQL: str | None = None
_TRUNCATE_SQL: str | None = None


async def reset_database(engine) -> bool:
    """Empty every table and restart every sequence, committed — the state each test
    starts from. The fast DELETE path first; on ANY failure (an FK cycle a child-first DELETE
    cannot satisfy, a lock held past _RESET_LOCK_TIMEOUT, a schema surprise) the TRUNCATE path
    in a fresh transaction, so a surprise never leaves a dirty database. The warning says so:
    a fast path that always fails would otherwise put the suite back at ~20 min without a
    word. The TRUNCATE path has the same lock timeout, so a lock that blocks both makes the
    reset RAISE after 2 x 30 s rather than hang the run.

    Returns True when the fast statement did the reset, False when TRUNCATE had to."""
    try:
        async with engine.begin() as conn:
            await conn.exec_driver_sql(_FAST_RESET_SQL)
        return True
    except Exception as exc:
        # Clean up FIRST: under `-W error` the warning raises, and it must not be able to skip
        # the TRUNCATE and leave this test's rows to the next one.
        async with engine.begin() as conn:
            await conn.exec_driver_sql(f"SET LOCAL lock_timeout = '{_RESET_LOCK_TIMEOUT}'")
            await conn.exec_driver_sql(_TRUNCATE_SQL)
        # The driver's error, not str(exc): SQLAlchemy's message repeats the whole DO block.
        warnings.warn(
            f"fast test-database reset failed, fell back to TRUNCATE: "
            f"{getattr(exc, 'orig', exc)!r}",
            UserWarning,
            stacklevel=2,
        )
        return False


@pytest.fixture
async def db(engine):
    # Shared-session contract: `client` drives endpoints through THIS session. After an
    # endpoint raises IntegrityError the session is poisoned — `await db.rollback()` before
    # reusing it — and concurrent requests within one test are not permitted.
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    # Not a per-test rollback: many tests open their own sessions on `engine` and commit
    # for real (read cache, reorder serialization, the assistant, export, the lifecycle CLI).
    if not await reset_database(engine):
        # The database IS clean (TRUNCATE saw to it), but a fast path that falls back quietly
        # would put the suite back at ~20 min without anything failing. What the fast path
        # could not delete is this test's doing (a stray table referencing a model table, a
        # lock left held), so the error lands here, on the test that caused it, and fails the
        # run — serially or under -n alike, since a teardown error is an ordinary report.
        pytest.fail(
            "the per-test reset fell back to TRUNCATE after this test — the fast DELETE path "
            "could not reset what it left behind (the warning above says why)",
            pytrace=False,
        )


@pytest.fixture
async def client(db):
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


# bcrypt reads its cost from the salt, so capping gensalt makes every hash the tests mint
# cost 4 (bcrypt's minimum, ~1 ms) instead of the default 12 (~200 ms), and checkpw reads the
# cost back out of the hash, so a login against one is ~1 ms too: ~410 ms saved per
# logged-in test (seeded_user hashes, auth_client logs in). hash_password calls
# bcrypt.gensalt() through the module attribute, which is what this replaces; production
# code is untouched, and test_security.py pins both halves (cost 4 here, 12 with the real
# gensalt).
_REAL_GENSALT = bcrypt.gensalt
TEST_BCRYPT_ROUNDS = 4


@pytest.fixture(scope="session", autouse=True)
def _cheap_bcrypt():
    def gensalt(rounds: int = 12, prefix: bytes = b"2b") -> bytes:
        return _REAL_GENSALT(rounds=TEST_BCRYPT_ROUNDS, prefix=prefix)

    # A session fixture cannot use the function-scoped monkeypatch.
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(bcrypt, "gensalt", gensalt)
        yield


@pytest.fixture(scope="session", autouse=True)
def _no_scheduler_in_tests():
    # ASGITransport never runs the lifespan today; pin the invariant for any future
    # TestClient/LifespanManager use (Task 7 review M7). The snapshot job rides the same
    # scheduler and is pinned off the same way (2026-09-03 data-lifecycle spec §8).
    settings.scheduler_enabled = False
    settings.snapshot_enabled = False


@pytest.fixture(autouse=True)
def _isolated_data_dir(tmp_path, monkeypatch):
    # Snapshots and restore points are FILES (2026-09-03 data-lifecycle spec §8); every test
    # gets its own empty tree so one test's ZIPs never read as another's, and nothing lands
    # in ./data. Restored by monkeypatch; settings is the module singleton the code reads.
    monkeypatch.setattr(settings, "data_dir", str(tmp_path / "data"))


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    limiter.reset()


@pytest.fixture(autouse=True)
def _reset_portfolio_account_factory():
    # The db fixture empties every table between tests; the label -> row memo must not
    # outlive it.
    reset_accounts()


@pytest.fixture(autouse=True)
def _reset_assistant_module_state():
    # The catalog verdict and the outbound-transport hook are module globals: a probe
    # cached (or a MockTransport left) by one test would otherwise decide the next one.
    # Imported here so the assistant service isn't pulled in at conftest import time.
    from app.services import assistant_models

    assistant_models.reset_catalog_cache()
    assistant_models.TRANSPORT_OVERRIDE = None


@pytest.fixture(autouse=True)
def _clear_read_caches():
    # The review book and the month savings are memoised per data fingerprint (2026-09-23
    # spec §P4). The db fixture's reset restarts every sequence, so two tests can seed
    # byte-identical tables — and a test that pins the clock or patches a loader must never
    # be answered by an entry another test left behind. Imported here, like the assistant
    # module above, so conftest stays import-light.
    from app.services import read_cache

    read_cache.clear_read_caches()
    yield
    read_cache.clear_read_caches()


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
