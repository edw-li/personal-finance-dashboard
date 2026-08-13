# Plan 1: Foundation — Scaffold, Auth, Schema

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable, tested skeleton of the finance dashboard: FastAPI backend with single-user JWT auth and the complete database schema, React frontend shell with login and protected navigation, Docker/Compose packaging, and CI.

**Architecture:** Two-container pattern copied from `photography-webpage` (Nginx-served React SPA proxying `/api` to FastAPI; PostgreSQL on host in prod, in Docker for dev). All 21 tables from the spec land here via Alembic so later plans only add behavior, not schema. Derived values are never stored.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 (async) + asyncpg, Alembic, PyJWT + bcrypt, slowapi; React 19 + TypeScript + Vite 6 + react-router 7; PostgreSQL 16; Docker Compose; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-12-finance-dashboard-design.md` (covers spec phases 1, 2, and 3a — schema. The importer is Plan 2.)

**Plan roadmap** (each plan ships working software):
1. **Foundation** (this plan) — scaffold, CI, auth, full schema
2. Importer — sheet parsers, dry-run diff, real-data import + reconciliation
3. Net worth + spending modules + monthly wizard
4. Portfolio + prices (yfinance, scheduler, holdings/XIRR)
5. Taxes + comp modules (tax engine w/ golden tests, ESPP, paycheck, focal)
6. Overview page, visual pass, OCI deploy, parallel-run cutover

**Machine notes (edyli's Windows box):**
- Only Python 3.8 is installed; Task 1 installs Python 3.12 (backend requires it). Docker Desktop 27 + Compose v2 already present. Node 18.12 is EOL but builds this exact stack in photography-webpage; upgrading to Node 22 LTS is optional.
- Local pip needs `--trusted-host pypi.org --trusted-host files.pythonhosted.org` (corporate TLS interception). If `docker build` fails on pip SSL for the same reason, don't fight it locally — images build clean in CI and on the OCI instance.
- Shell commands below are Git Bash syntax (works in Claude Code's Bash tool on this machine).

---

## File structure

```
personal-finance-dashboard/
├── .github/workflows/ci.yml          # CI: backend lint+tests, frontend build, docker builds
├── .gitignore
├── .env.example                      # prod env template (root, read by compose)
├── docker-compose.prod.yml           # backend + frontend containers (prod)
├── Dockerfile                        # frontend: node build → nginx
├── nginx.conf                        # SPA + /api proxy + TLS (Cloudflare origin certs)
├── index.html, package.json, vite.config.ts, tsconfig*.json, eslint.config.js
├── src/
│   ├── main.tsx, App.tsx, index.css
│   ├── api/client.ts                 # typed fetch wrapper w/ Bearer token
│   ├── api/auth.ts                   # login / me / changePassword calls
│   ├── contexts/AuthContext.tsx      # token state, login/logout
│   ├── components/ProtectedRoute.tsx
│   ├── components/Layout.tsx/.css    # sidebar nav shell
│   ├── pages/LoginPage.tsx/.css
│   ├── pages/PlaceholderPage.tsx     # stub for module pages (replaced in Plans 3-6)
│   └── types/api.ts                  # shared API types
└── backend/
    ├── Dockerfile, start.sh          # migrate + seed + uvicorn
    ├── docker-compose.yml            # dev-only Postgres on :5433
    ├── docker/initdb/01-test-db.sql  # creates finance_test DB
    ├── requirements.txt, requirements-dev.txt, pyproject.toml (ruff+pytest config)
    ├── alembic.ini, alembic/env.py, alembic/versions/
    ├── app/
    │   ├── main.py                   # app factory, CORS, routers, /health
    │   ├── config.py                 # pydantic-settings
    │   ├── database.py               # async engine, Base (naming conventions), get_db
    │   ├── security.py               # bcrypt hash/verify, JWT create/decode
    │   ├── rate_limit.py             # slowapi limiter
    │   ├── seed.py                   # idempotent: admin user, tax defs, app settings
    │   ├── tax_keys.py               # the 41 tax-input definitions (shared w/ Plans 2, 5)
    │   ├── api/deps.py               # get_current_user
    │   ├── api/auth.py               # login, me, change-password
    │   └── models/                   # user, net_worth, spending, portfolio, taxes, comp, app_setting
    └── tests/
        ├── conftest.py               # engine/db/client/auth_client fixtures
        ├── test_health.py, test_security.py, test_auth.py
        └── test_models_{net_worth,spending,portfolio,taxes,comp}.py
```

Responsibilities: `models/*` one file per domain; `security.py` is pure functions (no FastAPI imports); `api/*` thin routers; `tax_keys.py` is the single source of truth for tax-input keys (importer and tax engine both consume it later — do not duplicate the list).

---

### Task 1: Dev environment + repo scaffolding

**Files:**
- Create: `.gitignore`
- Create: `.gitattributes`

- [ ] **Step 1: Install Python 3.12**

Run: `winget install -e --id Python.Python.3.12 --source winget --accept-package-agreements --accept-source-agreements`
(`--source winget` is required — the msstore source fails with a certificate error behind this
machine's TLS-intercepting proxy. The install triggers a UAC dialog that a human must approve.)
Then verify in a NEW shell: `py -3.12 --version`
Expected: `Python 3.12.x`

- [ ] **Step 2: Verify Docker is running**

Run: `docker info --format '{{.ServerVersion}}'`
Expected: a version string (e.g. `27.4.0`). If it errors, start Docker Desktop first.

- [ ] **Step 3: Create `.gitignore`**

```gitignore
# Python
__pycache__/
*.pyc
.venv/
.pytest_cache/
.ruff_cache/

# Node
node_modules/
dist/

# Env & secrets
.env
.env.*
!.env.example

# Editor/OS
.vscode/
.idea/
.DS_Store
Thumbs.db
desktop.ini

# Tooling leftovers
vite.config.ts.timestamp-*
```

- [ ] **Step 3b: Create `.gitattributes`** (this Windows box has system-wide `core.autocrlf=true`;
without LF normalization, fresh checkouts materialize `backend/start.sh` as CRLF and Docker bakes
a broken `#!/bin/sh\r` shebang into the image — this exact defect is live in photography-webpage)

```gitattributes
* text=auto eol=lf
*.png binary
*.jpg binary
*.ico binary
*.woff2 binary
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore .gitattributes
git commit -m "chore: add gitignore and gitattributes"
```

---

### Task 2: Backend skeleton with health endpoint (TDD)

**Files:**
- Create: `backend/requirements.txt`, `backend/requirements-dev.txt`, `backend/pyproject.toml`
- Create: `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/main.py`
- Test: `backend/tests/__init__.py`, `backend/tests/test_health.py`

- [ ] **Step 1: Create requirements files**

`backend/requirements.txt` (exact pins per Task 2 quality review — floor pins let pytest-asyncio
jump a major version mid-plan; a proper cross-platform lockfile, e.g. `uv pip compile`, is a
Plan 6 hardening item. Bump pins deliberately, never implicitly):
```
fastapi==0.141.1
uvicorn[standard]==0.52.1
sqlalchemy[asyncio]==2.0.52
asyncpg==0.31.0
alembic==1.19.1
pydantic==2.13.4
pydantic-settings==2.15.0
PyJWT==2.13.0
bcrypt==5.0.0
slowapi==0.1.10
python-multipart==0.0.32
```

`backend/requirements-dev.txt`:
```
pytest==9.1.1
pytest-asyncio==1.4.0
httpx==0.28.1
ruff==0.16.2
```

- [ ] **Step 2: Create `backend/pyproject.toml` (tool config only)**

```toml
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "ASYNC"]

[tool.ruff.lint.flake8-bugbear]
# FastAPI's Depends()/Query()/etc. in argument defaults are intentional (B008)
extend-immutable-calls = [
    "fastapi.Depends", "fastapi.Query", "fastapi.Path", "fastapi.Body",
    "fastapi.Header", "fastapi.Form", "fastapi.File", "fastapi.Security",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
# BOTH loop scopes must be session — pytest-asyncio 1.x defaults tests to a function-scoped
# loop, which makes session-scoped async fixtures (Task 3's engine/db) run on a DIFFERENT
# event loop than the tests, producing cross-loop RuntimeErrors with asyncpg.
asyncio_default_fixture_loop_scope = "session"
asyncio_default_test_loop_scope = "session"
testpaths = ["tests"]
```

- [ ] **Step 3: Create venv and install**

```bash
cd backend
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org -r requirements.txt -r requirements-dev.txt
```
Expected: installs succeed. All later `pytest`/`ruff`/`alembic` commands in this plan mean `backend/.venv/Scripts/<tool>` run from `backend/`.

- [ ] **Step 4: Write the failing health test**

`backend/tests/__init__.py`: empty file.

`backend/tests/test_health.py`:
```python
from httpx import ASGITransport, AsyncClient

from app.main import app


async def test_health():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pytest tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app'`

- [ ] **Step 6: Write config and app**

`backend/app/__init__.py`: empty file.

`backend/app/config.py` (hardened per Task 2 quality review: fail closed on dev secrets outside
dev, reject wildcard CORS, package-relative .env so the CWD doesn't matter, tolerate shared env
files via extra="ignore"):
```python
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET_KEY = "change-me-to-a-random-secret"
DEV_ADMIN_PASSWORD = "changeme123"


class Settings(BaseSettings):
    environment: str = "dev"
    database_url: str = "postgresql+asyncpg://finance:finance@localhost:5433/finance"
    secret_key: str = DEV_SECRET_KEY
    access_token_expire_hours: int = 24
    cors_origins: str = "http://localhost:5173"
    admin_email: str = "admin@example.com"
    admin_password: str = DEV_ADMIN_PASSWORD

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def _validate_safety(self) -> "Settings":
        if self.environment != "dev":
            if self.secret_key == DEV_SECRET_KEY:
                raise ValueError("SECRET_KEY must be set outside dev")
            if self.admin_password == DEV_ADMIN_PASSWORD:
                raise ValueError("ADMIN_PASSWORD must be set outside dev")
        if "*" in self.cors_origin_list:
            raise ValueError("CORS_ORIGINS must list explicit origins, not '*'")
        return self

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
```

`backend/app/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

app = FastAPI(title="Personal Finance Dashboard", docs_url=None, redoc_url=None, openapi_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 6b: Add config-safety tests and env example**

`backend/tests/test_config.py` (each test passes the values it asserts about explicitly —
ambient env vars like an exported SECRET_KEY must not change outcomes):
```python
import pytest

from app.config import DEV_ADMIN_PASSWORD, DEV_SECRET_KEY, Settings


def test_dev_secret_key_rejected_outside_dev():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(environment="prod", secret_key=DEV_SECRET_KEY)


def test_dev_admin_password_rejected_outside_dev():
    with pytest.raises(ValueError, match="ADMIN_PASSWORD"):
        Settings(environment="prod", secret_key="x" * 64, admin_password=DEV_ADMIN_PASSWORD)


def test_prod_with_real_secrets_ok():
    s = Settings(environment="prod", secret_key="x" * 64, admin_password="real-password")
    assert s.environment == "prod"


def test_wildcard_cors_rejected():
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        Settings(cors_origins="*")
```

`backend/.env.example` (dev-facing; the root `.env.example` for prod arrives in Task 13):
```env
# Local dev config for the backend (all optional — defaults work for dev).
# ENVIRONMENT=dev
# DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance
# SECRET_KEY=
# ADMIN_EMAIL=admin@example.com
# ADMIN_PASSWORD=changeme123
# CORS_ORIGINS=http://localhost:5173
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest -v`
Expected: PASS (test_health + 4 config tests)

- [ ] **Step 8: Lint and commit**

```bash
ruff check .
git add backend
git commit -m "feat: backend skeleton with health endpoint"
```

---

### Task 3: Dev database, async SQLAlchemy base, test fixtures

**Files:**
- Create: `backend/docker-compose.yml`, `backend/docker/initdb/01-test-db.sql`
- Create: `backend/app/database.py`
- Test: `backend/tests/conftest.py`

- [ ] **Step 1: Create dev Postgres compose file**

`backend/docker-compose.yml`. The explicit `name:` is load-bearing: without it Compose derives the
project name from the directory (`backend`), which is IDENTICAL to photography-webpage's dev
compose — the two stacks would share container/volume names and `down -v` in either repo would
destroy the other's data. Port 5433 avoids the port clash; `name:` avoids the namespace clash.
Loopback-only binding keeps the finance DB off the LAN; image pinned like everything else:
```yaml
name: finance-dashboard

services:
  db:
    image: postgres:16.14-alpine
    environment:
      POSTGRES_USER: finance
      POSTGRES_PASSWORD: finance
      POSTGRES_DB: finance
    ports:
      - "127.0.0.1:5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U finance -d finance"]
      interval: 2s
      timeout: 3s
      retries: 15
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/initdb:/docker-entrypoint-initdb.d:ro

volumes:
  pgdata:
```

`backend/docker/initdb/01-test-db.sql`:
```sql
CREATE DATABASE finance_test OWNER finance;
```

- [ ] **Step 2: Start the dev DB and verify both databases exist**

```bash
docker compose -f docker-compose.yml up -d --wait db
docker compose -f docker-compose.yml exec -T db psql -U finance -c "\l" | grep finance
```
Expected: lines for `finance` and `finance_test`. (`--wait` blocks on the healthcheck so psql
can't race the server start. `finance_test` is self-healing: the conftest bootstrap in Step 4
creates it if missing, so a stale volume no longer needs `down -v`. `-T` avoids "the input
device is not a TTY" under Git Bash.)

- [ ] **Step 3: Create `backend/app/database.py`**

```python
from collections.abc import AsyncGenerator

from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",  # CheckConstraints MUST be explicitly named
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# pool_pre_ping: the prod backend outlives host-Postgres restarts and sits idle for hours;
# without it the first request after any DB restart fails on a stale pooled connection.
engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
```

- [ ] **Step 4: Create `backend/tests/conftest.py`**

The `client` fixture overrides `get_db` so API code shares the test session; tables are truncated between tests.

```python
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.database import Base, get_db
from app.main import app

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
```

- [ ] **Step 5: Update the health test to use the fixture and verify everything still passes**

Replace `backend/tests/test_health.py` with:
```python
async def test_health(client):
    resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

Run: `pytest -v`
Expected: PASS (6 passed: health + 4 config + naming convention)

- [ ] **Step 5b: Pin the naming convention with a regression test**

The `fk` token typo (`referenced_` vs `referred_table_name`) would have crashed every
ForeignKey-bearing model at import — this test makes the convention impossible to break silently.

`backend/tests/test_database.py`:
```python
from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Table,
    UniqueConstraint,
)

from app.database import NAMING_CONVENTION, Base


def test_naming_convention_generates_expected_names():
    md = MetaData(naming_convention=NAMING_CONVENTION)
    Table("parents", md, Column("id", Integer, primary_key=True))
    child = Table(
        "children",
        md,
        Column("id", Integer, primary_key=True),
        Column("parent_id", Integer, ForeignKey("parents.id")),
        Column("a", Integer),
        Column("b", Integer),
        CheckConstraint("a >= 0", name="a_nonnegative"),
        UniqueConstraint("a", "b"),
        Index(None, "a"),
        Index(None, "a", "b"),
    )
    constraint_names = {c.name for c in child.constraints}
    assert "pk_children" in constraint_names
    assert "fk_children_parent_id_parents" in constraint_names
    assert "uq_children_a" in constraint_names
    assert "ck_children_a_nonnegative" in constraint_names
    assert {i.name for i in child.indexes} == {"ix_children_a", "ix_children_a_b"}
    # Pin the wiring, not just the dict — a plain MetaData() in database.py would silently
    # revert every constraint to Postgres defaults while the assertions above stayed green.
    assert Base.metadata.naming_convention == NAMING_CONVENTION
```

Run: `pytest tests/test_database.py -v`
Expected: PASS

- [ ] **Step 6: Lint and commit**

```bash
ruff check .
git add backend
git commit -m "feat: dev database, async SQLAlchemy base, test fixtures"
```

---

### Task 4: Alembic + User model + seed script

> **Pre-step (from Task 3 re-review):** `backend/tests/test_database.py` in the worktree does
> not yet contain the `Base.metadata.naming_convention` wiring assertion shown in Step 5b above
> (added to the plan during the pause). Apply that one-line assertion + the `Base` import,
> verify the suite still passes, commit as
> `test: pin naming-convention wiring into Base.metadata` — then start Task 4 proper.

**Files:**
- Create: `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/script.py.mako`
- Create: `backend/app/models/__init__.py`, `backend/app/models/user.py`
- Create: `backend/app/seed.py`
- Test: `backend/tests/test_models_user.py`

- [ ] **Step 1: Write the failing user-model test**

`backend/tests/test_models_user.py`:
```python
from sqlalchemy import select

from app.models import User


async def test_create_user(db):
    db.add(User(email="me@example.com", password_hash="x"))
    await db.commit()
    user = (await db.execute(select(User))).scalar_one()
    assert user.email == "me@example.com"
    assert user.id == 1
    assert user.created_at is not None
```

Run: `pytest tests/test_models_user.py -v`
Expected: FAIL — `ImportError: cannot import name 'User'`

- [ ] **Step 2: Create the User model**

`backend/app/models/user.py`:
```python
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

`backend/app/models/__init__.py` (import every model here so `Base.metadata` and Alembic autogenerate see them — extended in Tasks 7-10):
```python
from app.models.user import User

__all__ = ["User"]
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `pytest tests/test_models_user.py -v`
Expected: PASS

- [ ] **Step 4: Initialize Alembic (async template)**

```bash
alembic init -t async alembic
```

Then edit `backend/alembic.ini`: set
```ini
sqlalchemy.url =
```
(blank — env.py injects it) and leave the rest as generated.

Edit `backend/alembic/env.py`: replace the `target_metadata = None` block and config-url wiring with:
```python
from app.config import settings
from app.database import Base
import app.models  # noqa: F401  (registers all models on Base.metadata)

# configparser interpolation: a literal % in DATABASE_URL (e.g. URL-encoded password chars
# like %40) crashes every alembic command unless escaped as %%.
config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
target_metadata = Base.metadata
```
(Keep the generated async `run_migrations_online`/`run_migrations_offline` functions as-is.)

- [ ] **Step 5: Generate and apply the first migration**

```bash
alembic revision --autogenerate -m "users table"
ruff check --fix alembic/versions/ && ruff format alembic/versions/
```
(The fixup pair is required after EVERY autogenerate — generated migrations violate UP/I001/E501
and format rules; the fixes are cosmetic and leave DDL/constraint names unchanged. Applies to
Tasks 7-10 as well.)

Review the file created under `backend/alembic/versions/`: it must create exactly the `users` table with unique constraint on `email` (named `uq_users_email` per the naming convention, PK `pk_users`). Then:
```bash
alembic upgrade head
docker compose -f docker-compose.yml exec db psql -U finance -d finance -c "\dt"
```
Expected: `users` and `alembic_version` tables listed.

- [ ] **Step 6: Create the seed script**

`backend/app/seed.py` (idempotent; run at container start and by hand; extended in Task 9 with tax definitions/settings):
```python
"""Idempotent seed: admin user from env. Run: python -m app.seed"""
import asyncio

from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models import User
from app.security import hash_password


async def seed() -> None:
    async with SessionLocal() as db:
        existing = (
            await db.execute(select(User).where(User.email == settings.admin_email))
        ).scalar_one_or_none()
        if existing is None:
            db.add(User(email=settings.admin_email,
                        password_hash=hash_password(settings.admin_password)))
            print(f"Created user {settings.admin_email}")
        else:
            print(f"User {settings.admin_email} already exists")
        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed())
```
Note: `app.security` doesn't exist yet — it's written in Task 5. Don't run seed until Task 5 is done.

- [ ] **Step 7: Lint and commit**

```bash
ruff check .
git add backend
git commit -m "feat: alembic setup, user model, seed script"
```

---

### Task 5: Security utilities — bcrypt + JWT (TDD)

**Files:**
- Create: `backend/app/security.py`
- Test: `backend/tests/test_security.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_security.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_security.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.security'`

- [ ] **Step 3: Implement `backend/app/security.py`**

```python
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.config import settings

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def create_access_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(UTC) + timedelta(hours=settings.access_token_expire_hours),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> int:
    """Return the user id, or raise ValueError for any invalid/expired token."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError) as exc:
        raise ValueError("invalid token") from exc
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_security.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Lint and commit**

```bash
ruff check .
git add backend
git commit -m "feat: bcrypt password hashing and JWT utilities"
```

---

### Task 6: Auth API — login, me, change-password, rate limit (TDD)

**Files:**
- Create: `backend/app/rate_limit.py`, `backend/app/api/__init__.py`, `backend/app/api/deps.py`, `backend/app/api/auth.py`
- Create: `backend/app/schemas/__init__.py`, `backend/app/schemas/auth.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_auth.py`, modify `backend/tests/conftest.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/conftest.py` — the three imports go at the TOP of the file with the
existing imports (ruff E402 fails on mid-file imports); the fixtures go at the bottom:
```python
from app.models import User
from app.rate_limit import limiter
from app.security import hash_password


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
    token = resp.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return client
```

`backend/tests/test_auth.py`:
```python
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
    # Same detail as wrong password — don't leak which emails exist
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
```

Run: `pytest tests/test_auth.py -v`
Expected: FAIL — 404s / import errors (endpoints don't exist)

- [ ] **Step 2: Create rate limiter and schemas**

`backend/app/rate_limit.py`:
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

AUTH_ATTEMPT = "10/minute"
```

`backend/app/schemas/__init__.py`: empty file.

`backend/app/schemas/auth.py`:
```python
from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    email: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
```

- [ ] **Step 3: Create the current-user dependency**

`backend/app/api/__init__.py`: empty file.

`backend/app/api/deps.py`:
```python
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.security import decode_access_token

bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        user_id = decode_access_token(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from None
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user
```

- [ ] **Step 4: Create the auth router**

`backend/app/api/auth.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import User
from app.rate_limit import AUTH_ATTEMPT, limiter
from app.schemas.auth import ChangePasswordRequest, LoginRequest, MeResponse, TokenResponse
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
@limiter.limit(AUTH_ATTEMPT)
async def login(
    request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    user = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(email=user.email)


@router.post("/change-password", status_code=204)
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    return Response(status_code=204)
```

- [ ] **Step 5: Wire limiter and router into the app**

Replace `backend/app/main.py` with:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api import auth
from app.config import settings
from app.rate_limit import limiter

app = FastAPI(title="Personal Finance Dashboard", docs_url=None, redoc_url=None, openapi_url=None)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 6: Run the full suite**

Run: `pytest -v`
Expected: PASS (all tests including the 8 auth tests)

- [ ] **Step 7: Seed and smoke-test the live server**

```bash
python -m app.seed
uvicorn app.main:app --port 8000 &
sleep 2
curl -s -X POST http://localhost:8000/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"admin@example.com","password":"changeme123"}'
kill %1
```
Expected: JSON with `access_token`.

- [ ] **Step 8: Lint and commit**

```bash
ruff check .
git add backend
git commit -m "feat: single-user JWT auth (login, me, change-password, rate limit)"
```

---

### Task 7: Schema — net worth + spending tables

**Files:**
- Create: `backend/app/models/net_worth.py`, `backend/app/models/spending.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/test_models_net_worth.py`, `backend/tests/test_models_spending.py`

> Applies to all schema tasks (7–10): any `CheckConstraint` added now or later MUST be
> explicitly named — the `ck_` naming convention raises on unnamed check constraints.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_models_net_worth.py`:
```python
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Account, AccountBalance, NetWorthSnapshot


async def test_balance_roundtrip(db):
    acct = Account(name="Wells Fargo Checking", slug="wells-fargo-checking",
                   group="cash", sort_order=1)
    snap = NetWorthSnapshot(month=date(2023, 9, 1), recorded_on=date(2023, 9, 24))
    db.add_all([acct, snap])
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=acct.id,
                          balance=Decimal("14512.34")))
    await db.commit()
    bal = (await db.execute(select(AccountBalance))).scalar_one()
    assert bal.balance == Decimal("14512.34")


async def test_one_balance_per_account_per_snapshot(db):
    acct = Account(name="A", slug="a", group="cash", sort_order=1)
    snap = NetWorthSnapshot(month=date(2024, 1, 1))
    db.add_all([acct, snap])
    await db.flush()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=acct.id, balance=Decimal("1")))
    await db.commit()
    db.add(AccountBalance(snapshot_id=snap.id, account_id=acct.id, balance=Decimal("2")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_snapshot_month_unique(db):
    db.add(NetWorthSnapshot(month=date(2024, 1, 1)))
    await db.commit()
    db.add(NetWorthSnapshot(month=date(2024, 1, 1)))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
```

`backend/tests/test_models_spending.py`:
```python
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import MonthlyCashflow, MonthlySpending, SpendingCategory


async def test_spending_roundtrip(db):
    cat = SpendingCategory(name="Food & Dining", slug="food-dining", sort_order=8)
    db.add(cat)
    await db.flush()
    db.add(MonthlySpending(month=date(2023, 8, 1), category_id=cat.id,
                           amount=Decimal("252.37")))
    db.add(MonthlyCashflow(month=date(2023, 8, 1), net_pay=Decimal("5000.00")))
    await db.commit()
    row = (await db.execute(select(MonthlySpending))).scalar_one()
    assert row.amount == Decimal("252.37")


async def test_one_amount_per_category_per_month(db):
    cat = SpendingCategory(name="Travel", slug="travel", sort_order=19)
    db.add(cat)
    await db.flush()
    db.add(MonthlySpending(month=date(2024, 2, 1), category_id=cat.id, amount=Decimal("1")))
    await db.commit()
    db.add(MonthlySpending(month=date(2024, 2, 1), category_id=cat.id, amount=Decimal("2")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
```

Run: `pytest tests/test_models_net_worth.py tests/test_models_spending.py -v`
Expected: FAIL — ImportError

- [ ] **Step 2: Create the models**

`backend/app/models/net_worth.py`:
```python
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

ACCOUNT_GROUPS = ("cash", "pre_tax", "post_tax", "taxable", "equity", "other", "liability")


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    group: Mapped[str] = mapped_column(String(20))  # one of ACCOUNT_GROUPS
    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)


class NetWorthSnapshot(Base):
    __tablename__ = "net_worth_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    month: Mapped[date] = mapped_column(Date, unique=True)  # first of month
    recorded_on: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)


class AccountBalance(Base):
    __tablename__ = "account_balances"
    __table_args__ = (UniqueConstraint("snapshot_id", "account_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_id: Mapped[int] = mapped_column(
        ForeignKey("net_worth_snapshots.id", ondelete="CASCADE")
    )
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    balance: Mapped[Decimal] = mapped_column(Numeric(14, 2))
```

`backend/app/models/spending.py`:
```python
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SpendingCategory(Base):
    __tablename__ = "spending_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)


class MonthlySpending(Base):
    __tablename__ = "monthly_spending"
    __table_args__ = (UniqueConstraint("month", "category_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    month: Mapped[date] = mapped_column(Date)  # first of month
    category_id: Mapped[int] = mapped_column(
        ForeignKey("spending_categories.id", ondelete="CASCADE")
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))


class MonthlyCashflow(Base):
    __tablename__ = "monthly_cashflow"

    month: Mapped[date] = mapped_column(Date, primary_key=True)  # first of month
    net_pay: Mapped[Decimal] = mapped_column(Numeric(12, 2))
```

Replace `backend/app/models/__init__.py`:
```python
from app.models.net_worth import ACCOUNT_GROUPS, Account, AccountBalance, NetWorthSnapshot
from app.models.spending import MonthlyCashflow, MonthlySpending, SpendingCategory
from app.models.user import User

__all__ = [
    "ACCOUNT_GROUPS",
    "Account",
    "AccountBalance",
    "MonthlyCashflow",
    "MonthlySpending",
    "NetWorthSnapshot",
    "SpendingCategory",
    "User",
]
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pytest tests/test_models_net_worth.py tests/test_models_spending.py -v`
Expected: PASS (5 passed)

- [ ] **Step 4: Generate and apply the migration**

```bash
alembic revision --autogenerate -m "net worth and spending tables"
ruff check --fix alembic/versions/ && ruff format alembic/versions/
```
Review: creates `accounts`, `net_worth_snapshots`, `account_balances` (unique on snapshot_id+account_id), `spending_categories`, `monthly_spending` (unique on month+category_id), `monthly_cashflow`. Then:
```bash
alembic upgrade head
```
Expected: no errors.

- [ ] **Step 5: Lint and commit**

```bash
ruff check .
git add backend
git commit -m "feat: net worth and spending schema"
```

---

### Task 8: Schema — portfolio tables

**Files:**
- Create: `backend/app/models/portfolio.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/test_models_portfolio.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_models_portfolio.py`:
```python
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import (
    DividendPayment,
    LatestPrice,
    PositionTransaction,
    PriceHistory,
    Security,
)


async def test_security_and_transaction_roundtrip(db):
    sec = Security(ticker="VOO", name="Vanguard 500 Index Fund ETF",
                   industry="ETF", holding_type="etf")
    db.add(sec)
    await db.flush()
    db.add(PositionTransaction(
        security_id=sec.id, account="RH Taxable", type="buy",
        txn_date=None, shares=Decimal("119.261466"), price=Decimal("584.62"),
        sort_index=3,
    ))
    db.add(DividendPayment(security_id=sec.id, account="RH Taxable",
                           pay_date=date(2025, 3, 20), amount=Decimal("171.55")))
    db.add(LatestPrice(security_id=sec.id, price=Decimal("710.17"),
                       quoted_at=datetime(2026, 8, 12, 20, 0, tzinfo=UTC),
                       source="yfinance"))
    db.add(PriceHistory(security_id=sec.id, date=date(2026, 8, 11),
                        close=Decimal("708.42")))
    await db.commit()
    txn = (await db.execute(select(PositionTransaction))).scalar_one()
    assert txn.shares == Decimal("119.261466")
    assert txn.txn_date is None  # sheet rows lack dates; importer flags these


async def test_ticker_unique(db):
    db.add(Security(ticker="VTI", name="A", holding_type="etf"))
    await db.commit()
    db.add(Security(ticker="VTI", name="B", holding_type="etf"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_one_close_per_day(db):
    sec = Security(ticker="SCHD", name="Schwab US Dividend", holding_type="etf")
    db.add(sec)
    await db.flush()
    db.add(PriceHistory(security_id=sec.id, date=date(2026, 1, 2), close=Decimal("34")))
    await db.commit()
    db.add(PriceHistory(security_id=sec.id, date=date(2026, 1, 2), close=Decimal("35")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
```

Run: `pytest tests/test_models_portfolio.py -v`
Expected: FAIL — ImportError

- [ ] **Step 2: Create `backend/app/models/portfolio.py`**

`sort_index` on transactions preserves spreadsheet row order — cost-basis folding must process
transactions in this order because most rows have no date (Plan 4 depends on it).

```python
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

HOLDING_TYPES = ("etf", "mutual_fund", "stock", "private")
TRANSACTION_TYPES = ("buy", "sell", "split")
PRICE_SOURCES = ("yfinance", "manual")


class Security(Base):
    __tablename__ = "securities"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticker: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    industry: Mapped[str | None] = mapped_column(String(80))
    holding_type: Mapped[str] = mapped_column(String(20))  # one of HOLDING_TYPES
    is_manual_priced: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)
    annual_dividend: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    ex_div_date: Mapped[date | None] = mapped_column(Date)


class PositionTransaction(Base):
    __tablename__ = "position_transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    security_id: Mapped[int] = mapped_column(ForeignKey("securities.id", ondelete="CASCADE"))
    account: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(10))  # one of TRANSACTION_TYPES
    txn_date: Mapped[date | None] = mapped_column(Date)
    shares: Mapped[Decimal] = mapped_column(Numeric(16, 6))
    price: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    fees: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    split_factor: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    sort_index: Mapped[int] = mapped_column(default=0)
    notes: Mapped[str | None] = mapped_column(Text)


class DividendPayment(Base):
    __tablename__ = "dividend_payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    security_id: Mapped[int] = mapped_column(ForeignKey("securities.id", ondelete="CASCADE"))
    account: Mapped[str | None] = mapped_column(String(80))
    pay_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    notes: Mapped[str | None] = mapped_column(Text)


class LatestPrice(Base):
    __tablename__ = "latest_prices"

    security_id: Mapped[int] = mapped_column(
        ForeignKey("securities.id", ondelete="CASCADE"), primary_key=True
    )
    price: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    quoted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(20))  # one of PRICE_SOURCES


class PriceHistory(Base):
    __tablename__ = "price_history"
    __table_args__ = (UniqueConstraint("security_id", "date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    security_id: Mapped[int] = mapped_column(ForeignKey("securities.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    close: Mapped[Decimal] = mapped_column(Numeric(14, 4))
```

Add to `backend/app/models/__init__.py` imports and `__all__`:
```python
from app.models.portfolio import (
    HOLDING_TYPES,
    PRICE_SOURCES,
    TRANSACTION_TYPES,
    DividendPayment,
    LatestPrice,
    PositionTransaction,
    PriceHistory,
    Security,
)
```
(and append `"DividendPayment", "HOLDING_TYPES", "LatestPrice", "PRICE_SOURCES", "PositionTransaction", "PriceHistory", "Security", "TRANSACTION_TYPES"` to `__all__`.)

- [ ] **Step 3: Run tests to verify they pass**

Run: `pytest tests/test_models_portfolio.py -v`
Expected: PASS (3 passed)

- [ ] **Step 4: Generate and apply the migration**

```bash
alembic revision --autogenerate -m "portfolio tables"
ruff check --fix alembic/versions/ && ruff format alembic/versions/
alembic upgrade head
```
Review: creates `securities`, `position_transactions`, `dividend_payments`, `latest_prices`, `price_history` (unique security_id+date).

- [ ] **Step 5: Lint and commit**

```bash
ruff check .
git add backend
git commit -m "feat: portfolio schema"
```

---

### Task 9: Schema — tax tables + definitions seed

**Files:**
- Create: `backend/app/tax_keys.py`, `backend/app/models/taxes.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/seed.py`
- Test: `backend/tests/test_models_taxes.py`

- [ ] **Step 1: Create `backend/app/tax_keys.py`**

This is the single source of truth for tax-input line items, transcribed from the Taxes sheet
rows 2–42 (section, key, label, is_derived). The importer (Plan 2) maps sheet rows → keys and the
tax engine (Plan 5) consumes values by key. Do not rename keys after data is imported.

```python
"""Tax input definitions: (key, label, section, sort_order, is_derived).

is_derived marks line items the sheet computes from others (gray cells); the UI
offers a computed suggestion but the stored value remains editable.
"""

ORDINARY_INCOME = "ordinary_income"
DEDUCTIONS = "deductions"
CAPITAL_GAINS = "capital_gains"

TAX_INPUT_DEFINITIONS: list[tuple[str, str, str, int, bool]] = [
    ("annual_salary", "Annual Salary", ORDINARY_INCOME, 10, False),
    ("gross_paycheck", "Gross Paycheck", ORDINARY_INCOME, 20, True),
    ("pay_periods", "Pay Periods", ORDINARY_INCOME, 30, False),
    ("latest_w2_income", "Latest W2 Income", ORDINARY_INCOME, 40, True),
    ("other_w2_income", "Other W2 Income", ORDINARY_INCOME, 50, True),
    ("w2_stock_rsus_sold", "W2: Stock/RSUs Sold", ORDINARY_INCOME, 60, False),
    ("w2_bonuses", "W2: Bonuses", ORDINARY_INCOME, 70, False),
    ("w2_salary_checkpoint", "W2: Salary Checkpoint", ORDINARY_INCOME, 80, False),
    ("w2_espp_sale_component", "W2: ESPP Sale Component", ORDINARY_INCOME, 90, False),
    ("w2_employer_hsa", "W2: Employer HSA Contribution", ORDINARY_INCOME, 100, False),
    ("w2_other", "W2: Other", ORDINARY_INCOME, 110, False),
    ("stcg_total", "Short Term Capital Gain/Loss", ORDINARY_INCOME, 120, True),
    ("stcg_standard", "STCG: Standard Gain/Loss", ORDINARY_INCOME, 130, False),
    ("stcg_espp_component", "STCG: ESPP Sale Component", ORDINARY_INCOME, 140, False),
    ("unqualified_dividends", "Unqualified Dividends", ORDINARY_INCOME, 150, True),
    ("unq_div_us_treasuries_etf", "Unq Div: US Treasuries ETF", ORDINARY_INCOME, 160, False),
    ("unq_div_state_exempt_pct", "Unq Div: State Exempt Percentage", ORDINARY_INCOME, 170, False),
    ("unq_div_other", "Unq Div: Other Dividends", ORDINARY_INCOME, 180, False),
    ("interest_total", "Interest", ORDINARY_INCOME, 190, True),
    ("interest_standard", "Interest: Standard", ORDINARY_INCOME, 200, False),
    ("interest_us_treasuries", "Interest: US Treasuries", ORDINARY_INCOME, 210, False),
    ("other_income_1099", "Other Income (e.g. 1099 MISC)", ORDINARY_INCOME, 220, False),
    ("trad_401k_contributions", "Traditional 401k Contributions", DEDUCTIONS, 10, False),
    ("hsa_contributions", "HSA Contributions", DEDUCTIONS, 20, False),
    ("hsa_contributions_employer", "HSA Contributions (Employer)", DEDUCTIONS, 30, False),
    ("capital_loss_deductions", "Capital Loss Deductions", DEDUCTIONS, 40, False),
    ("other_pretax_deductions", "Other Pre-tax Deductions", DEDUCTIONS, 50, True),
    ("pretax_dental", "Pre-tax: Dental", DEDUCTIONS, 60, False),
    ("pretax_vision", "Pre-tax: Vision", DEDUCTIONS, 70, False),
    ("standard_deduction", "Standard Deduction", DEDUCTIONS, 80, False),
    ("itemized_deduction", "Itemized Deduction", DEDUCTIONS, 90, True),
    ("itemized_salt", "Itemized: SALT Amount", DEDUCTIONS, 100, False),
    ("itemized_donations", "Itemized: Donations/Tithes", DEDUCTIONS, 110, False),
    ("itemized_vehicle_reg", "Itemized: Vehicle Registration Fees", DEDUCTIONS, 120, False),
    ("itemized_sec199a_div", "Itemized: Sec 199A Div (20%)", DEDUCTIONS, 130, False),
    ("itemized_other", "Itemized: Other Items", DEDUCTIONS, 140, False),
    ("ltcg_total", "Long Term Capital Gain/Loss", CAPITAL_GAINS, 10, True),
    ("ltcg_brokerage", "LTCG: Brokerage Gain/Loss", CAPITAL_GAINS, 20, False),
    ("ltcg_espp_component", "LTCG: ESPP Sale Component", CAPITAL_GAINS, 30, False),
    ("qualified_dividends", "Qualified Dividends", CAPITAL_GAINS, 40, False),
    ("other_capital_gains", "Other Capital Gains", CAPITAL_GAINS, 50, False),
]

JURISDICTIONS = (
    "federal",
    "state",
    "medicare",
    "social_security",
    "disability",
    "capital_gains",
)
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_models_taxes.py`:
```python
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import TaxBracket, TaxInput, TaxInputDefinition, TaxYear
from app.tax_keys import TAX_INPUT_DEFINITIONS


async def test_bracket_and_input_roundtrip(db):
    db.add(TaxYear(year=2024))
    db.add(TaxInputDefinition(key="annual_salary", label="Annual Salary",
                              section="ordinary_income", sort_order=10))
    await db.flush()
    db.add(TaxBracket(year=2024, jurisdiction="federal", bracket_index=1,
                      rate=Decimal("0.10"), threshold=Decimal("0")))
    db.add(TaxInput(year=2024, key="annual_salary", value=Decimal("151000")))
    await db.commit()
    inp = (await db.execute(select(TaxInput))).scalar_one()
    assert inp.value == Decimal("151000")


async def test_one_value_per_year_per_key(db):
    db.add(TaxYear(year=2024))
    db.add(TaxInputDefinition(key="w2_bonuses", label="Bonuses",
                              section="ordinary_income", sort_order=70))
    await db.flush()
    db.add(TaxInput(year=2024, key="w2_bonuses", value=Decimal("1")))
    await db.commit()
    db.add(TaxInput(year=2024, key="w2_bonuses", value=Decimal("2")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_definitions_constant_is_complete():
    assert len(TAX_INPUT_DEFINITIONS) == 41
    keys = [d[0] for d in TAX_INPUT_DEFINITIONS]
    assert len(keys) == len(set(keys)), "duplicate keys"


async def test_seed_inserts_definitions(db):
    from app.seed import seed_tax_definitions

    await seed_tax_definitions(db)
    await db.commit()
    count = (await db.execute(select(func.count(TaxInputDefinition.key)))).scalar_one()
    assert count == 41
    # idempotent
    await seed_tax_definitions(db)
    await db.commit()
    count = (await db.execute(select(func.count(TaxInputDefinition.key)))).scalar_one()
    assert count == 41
```

Run: `pytest tests/test_models_taxes.py -v`
Expected: FAIL — ImportError

- [ ] **Step 3: Create `backend/app/models/taxes.py`**

```python
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TaxYear(Base):
    __tablename__ = "tax_years"

    year: Mapped[int] = mapped_column(primary_key=True)
    notes: Mapped[str | None] = mapped_column(Text)


class TaxBracket(Base):
    __tablename__ = "tax_brackets"
    __table_args__ = (UniqueConstraint("year", "jurisdiction", "bracket_index"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(ForeignKey("tax_years.year", ondelete="CASCADE"))
    jurisdiction: Mapped[str] = mapped_column(String(20))  # one of tax_keys.JURISDICTIONS
    bracket_index: Mapped[int] = mapped_column()
    rate: Mapped[Decimal] = mapped_column(Numeric(7, 4))
    threshold: Mapped[Decimal] = mapped_column(Numeric(12, 2))


class TaxInputDefinition(Base):
    __tablename__ = "tax_input_definitions"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    label: Mapped[str] = mapped_column(String(120))
    section: Mapped[str] = mapped_column(String(30))
    sort_order: Mapped[int] = mapped_column(default=0)
    is_derived: Mapped[bool] = mapped_column(default=False)


class TaxInput(Base):
    __tablename__ = "tax_inputs"
    __table_args__ = (UniqueConstraint("year", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(ForeignKey("tax_years.year", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(
        ForeignKey("tax_input_definitions.key", ondelete="CASCADE")
    )
    value: Mapped[Decimal] = mapped_column(Numeric(14, 2))
```

Add to `backend/app/models/__init__.py`:
```python
from app.models.taxes import TaxBracket, TaxInput, TaxInputDefinition, TaxYear
```
(append `"TaxBracket", "TaxInput", "TaxInputDefinition", "TaxYear"` to `__all__`.)

- [ ] **Step 4: Extend the seed script**

Replace `backend/app/seed.py` with:
```python
"""Idempotent seed: admin user, tax input definitions. Run: python -m app.seed"""
import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import SessionLocal
from app.models import TaxInputDefinition, User
from app.security import hash_password
from app.tax_keys import TAX_INPUT_DEFINITIONS


async def seed_admin_user(db: AsyncSession) -> None:
    existing = (
        await db.execute(select(User).where(User.email == settings.admin_email))
    ).scalar_one_or_none()
    if existing is None:
        db.add(User(email=settings.admin_email,
                    password_hash=hash_password(settings.admin_password)))
        print(f"Created user {settings.admin_email}")


async def seed_tax_definitions(db: AsyncSession) -> None:
    existing = set(
        (await db.execute(select(TaxInputDefinition.key))).scalars().all()
    )
    for key, label, section, sort_order, is_derived in TAX_INPUT_DEFINITIONS:
        if key not in existing:
            db.add(TaxInputDefinition(key=key, label=label, section=section,
                                      sort_order=sort_order, is_derived=is_derived))


async def seed() -> None:
    async with SessionLocal() as db:
        await seed_admin_user(db)
        await seed_tax_definitions(db)
        await db.commit()
    print("Seed complete")


if __name__ == "__main__":
    asyncio.run(seed())
```

- [ ] **Step 5: Run tests, migrate, and commit**

```bash
pytest tests/test_models_taxes.py -v
```
Expected: PASS (4 passed)

```bash
alembic revision --autogenerate -m "tax tables"
ruff check --fix alembic/versions/ && ruff format alembic/versions/
alembic upgrade head
python -m app.seed
ruff check .
git add backend
git commit -m "feat: tax schema and input definitions seed"
```

---

### Task 10: Schema — comp modules + app settings

**Files:**
- Create: `backend/app/models/comp.py`, `backend/app/models/app_setting.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/seed.py`
- Test: `backend/tests/test_models_comp.py`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_models_comp.py`:
```python
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.models import AppSetting, CompEvent, EsppLot, EsppPeriod, PaycheckProfile


async def test_espp_lot_roundtrip(db):
    db.add(EsppLot(purchase_date=date(2024, 2, 29), qualifying_date=date(2025, 9, 1),
                   shares=Decimal("260"), subscription_price=Decimal("48.509"),
                   purchase_fmv=Decimal("79.112"), purchase_price=Decimal("41.23265")))
    await db.commit()
    lot = (await db.execute(select(EsppLot))).scalar_one()
    assert lot.sold_date is None
    assert lot.shares == Decimal("260")


async def test_paycheck_profile_roundtrip(db):
    db.add(PaycheckProfile(
        effective_date=date(2026, 3, 1), annual_salary=Decimal("188930"),
        trad_401k_pct=Decimal("0.13"), roth_401k_pct=Decimal("0"),
        after_tax_401k_pct=Decimal("0.03"), espp_pct=Decimal("0.11"),
        withholding_pct=Decimal("0.334009166"),
        dental_vision_per_check=Decimal("12.50"), hsa_per_check=Decimal("100.00"),
    ))
    await db.commit()
    p = (await db.execute(select(PaycheckProfile))).scalar_one()
    assert p.pay_periods_per_year == 24
    assert p.withholding_pct == Decimal("0.334009166")


async def test_comp_event_and_period_and_setting(db):
    db.add(CompEvent(focal_year=2025, current_base=Decimal("151000"),
                     new_base=Decimal("162000"), unvested_rsus=Decimal("2152"),
                     unvested_price=Decimal("129.565056"), refresh_rsus=Decimal("502"),
                     grant_price=Decimal("129.59")))
    db.add(EsppPeriod(label="2026 Feb purchase", period_start=date(2025, 9, 1),
                      period_end=date(2026, 2, 27), semi_annual_base=Decimal("81000"),
                      additional_payments=Decimal("0"), contribution_pct=Decimal("0.14")))
    db.add(AppSetting(key="swr_pct", value={"value": 0.04}))
    await db.commit()
    setting = await db.get(AppSetting, "swr_pct")
    assert setting.value == {"value": 0.04}
```

Run: `pytest tests/test_models_comp.py -v`
Expected: FAIL — ImportError

- [ ] **Step 2: Create the models**

`backend/app/models/comp.py`:
```python
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EsppLot(Base):
    __tablename__ = "espp_lots"

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_date: Mapped[date] = mapped_column(Date, unique=True)
    qualifying_date: Mapped[date] = mapped_column(Date)
    shares: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    subscription_price: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    purchase_fmv: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    purchase_price: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    sold_date: Mapped[date | None] = mapped_column(Date)
    sold_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    notes: Mapped[str | None] = mapped_column(Text)


class EsppPeriod(Base):
    __tablename__ = "espp_periods"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(60), unique=True)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    semi_annual_base: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    additional_payments: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    contribution_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9))


class PaycheckProfile(Base):
    __tablename__ = "paycheck_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    effective_date: Mapped[date] = mapped_column(Date, unique=True)
    annual_salary: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    pay_periods_per_year: Mapped[int] = mapped_column(default=24)
    trad_401k_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    roth_401k_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    after_tax_401k_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    espp_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    withholding_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    dental_vision_per_check: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    hsa_per_check: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    notes: Mapped[str | None] = mapped_column(Text)


class CompEvent(Base):
    __tablename__ = "comp_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    focal_year: Mapped[int] = mapped_column(unique=True)
    current_base: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    new_base: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    unvested_rsus: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    unvested_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    refresh_rsus: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    grant_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    notes: Mapped[str | None] = mapped_column(Text)
```

`backend/app/models/app_setting.py`:
```python
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB)
```

Add to `backend/app/models/__init__.py`:
```python
from app.models.app_setting import AppSetting
from app.models.comp import CompEvent, EsppLot, EsppPeriod, PaycheckProfile
```
(append `"AppSetting", "CompEvent", "EsppLot", "EsppPeriod", "PaycheckProfile"` to `__all__`.)

- [ ] **Step 3: Seed default settings**

In `backend/app/seed.py`, add after `seed_tax_definitions`:
```python
DEFAULT_SETTINGS: dict[str, dict] = {
    "swr_pct": {"value": 0.04},
    "espp_ticker": {"value": "NVDA"},
    "price_refresh_cron": {"value": "10 13 * * 1-5"},  # 13:10 PT weekdays, after US close
}


async def seed_app_settings(db: AsyncSession) -> None:
    from app.models import AppSetting

    for key, value in DEFAULT_SETTINGS.items():
        if await db.get(AppSetting, key) is None:
            db.add(AppSetting(key=key, value=value))
```
and call it in `seed()` after `seed_tax_definitions(db)`:
```python
        await seed_app_settings(db)
```

- [ ] **Step 4: Run tests, migrate, and commit**

```bash
pytest -v
```
Expected: PASS (full suite)

```bash
alembic revision --autogenerate -m "comp and settings tables"
ruff check --fix alembic/versions/ && ruff format alembic/versions/
alembic upgrade head
python -m app.seed
ruff check .
git add backend
git commit -m "feat: comp module and app settings schema"
```

---

### Task 11: Frontend scaffold — Vite app, router, API client

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js`, `index.html`
- Create: `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`
- Create: `src/api/client.ts`, `src/types/api.ts`, `src/pages/PlaceholderPage.tsx`

- [ ] **Step 1: Create `package.json`** (versions proven on this machine by photography-webpage)

```json
{
  "name": "personal-finance-dashboard",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "lucide-react": "^0.575.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router-dom": "^7.13.1"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.1",
    "@types/node": "^24.10.1",
    "@types/react": "^19.2.7",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^4.7.0",
    "eslint": "^9.39.1",
    "eslint-plugin-react-hooks": "^7.0.1",
    "eslint-plugin-react-refresh": "^0.4.24",
    "globals": "^16.5.0",
    "typescript": "~5.9.3",
    "typescript-eslint": "^8.48.0",
    "vite": "^6.4.1"
  }
}
```

- [ ] **Step 2: Create build configs**

`vite.config.ts`:
```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
```

`tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
```

`tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo"
  },
  "include": ["src"]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo"
  },
  "include": ["vite.config.ts"]
}
```

`eslint.config.js`:
```js
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
)
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Finance Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create the API client and types**

`src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

`src/types/api.ts`:
```ts
export interface TokenResponse {
  access_token: string
  token_type: string
}

export interface MeResponse {
  email: string
}
```

`src/api/client.ts`:
```ts
const TOKEN_KEY = 'finance_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`/api/v1${path}`, { ...options, headers })

  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearToken()
    window.location.assign('/login')
    throw new ApiError('Session expired', 401)
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      // non-JSON error body
    }
    throw new ApiError(detail, res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
```

- [ ] **Step 4: Create the minimal app shell**

`src/index.css`:
```css
:root {
  --bg: #0f1115;
  --surface: #171a21;
  --surface-2: #1e222c;
  --border: #262b36;
  --text: #e6e9ef;
  --muted: #8b93a3;
  --accent: #4f8cff;
  --positive: #3fb968;
  --negative: #e05252;
  font-family: system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

a {
  color: var(--accent);
  text-decoration: none;
}

button {
  font: inherit;
}
```

`src/pages/PlaceholderPage.tsx`:
```tsx
export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>{title}</h1>
      <p style={{ color: 'var(--muted)' }}>Coming soon.</p>
    </div>
  )
}
```

`src/App.tsx` (routes are expanded in Task 12; this step just proves the toolchain):
```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import PlaceholderPage from './pages/PlaceholderPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<PlaceholderPage title="Finance Dashboard" />} />
      </Routes>
    </BrowserRouter>
  )
}
```

`src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 5: Install and verify the build**

```bash
npm install
npm run lint
npm run build
```
Expected: lint clean; build succeeds producing `dist/`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json eslint.config.js index.html src
git commit -m "feat: frontend scaffold (Vite + React + TS + router + API client)"
```

---

### Task 12: Frontend auth — context, login page, protected layout

**Files:**
- Create: `src/api/auth.ts`, `src/contexts/AuthContext.tsx`, `src/components/ProtectedRoute.tsx`
- Create: `src/components/Layout.tsx`, `src/components/Layout.css`, `src/pages/LoginPage.tsx`, `src/pages/LoginPage.css`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create the auth API module**

`src/api/auth.ts`:
```ts
import { api, clearToken, setToken } from './client'
import type { MeResponse, TokenResponse } from '../types/api'

export async function login(email: string, password: string): Promise<void> {
  const res = await api<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setToken(res.access_token)
}

export function logout(): void {
  clearToken()
}

export async function fetchMe(): Promise<MeResponse> {
  return api<MeResponse>('/auth/me')
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await api<void>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
}
```

- [ ] **Step 2: Create the auth context**

`src/contexts/AuthContext.tsx`:
```tsx
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import * as authApi from '../api/auth'
import { getToken } from '../api/client'

interface AuthState {
  email: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setIsLoading(false)
      return
    }
    authApi
      .fetchMe()
      .then((me) => setEmail(me.email))
      .catch(() => setEmail(null))
      .finally(() => setIsLoading(false))
  }, [])

  const login = useCallback(async (loginEmail: string, password: string) => {
    await authApi.login(loginEmail, password)
    const me = await authApi.fetchMe()
    setEmail(me.email)
  }, [])

  const logout = useCallback(() => {
    authApi.logout()
    setEmail(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{ email, isAuthenticated: email !== null, isLoading, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
```

- [ ] **Step 3: Create ProtectedRoute and Layout**

`src/components/ProtectedRoute.tsx`:
```tsx
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}
```

`src/components/Layout.tsx`:
```tsx
import {
  Banknote,
  Briefcase,
  LayoutDashboard,
  LineChart,
  LogOut,
  Receipt,
  Settings,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './Layout.css'

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/net-worth', label: 'Net Worth', icon: TrendingUp },
  { to: '/spending', label: 'Spending', icon: Wallet },
  { to: '/portfolio', label: 'Portfolio', icon: LineChart },
  { to: '/taxes', label: 'Taxes', icon: Receipt },
  { to: '/espp', label: 'ESPP', icon: Banknote },
  { to: '/paycheck', label: 'Paycheck', icon: Banknote },
  { to: '/comp', label: 'Comp', icon: Briefcase },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Layout() {
  const { logout } = useAuth()
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-title">Finance</div>
        <nav>
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className="nav-link">
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <button className="logout-button" onClick={logout}>
          <LogOut size={16} />
          <span>Log out</span>
        </button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
```

`src/components/Layout.css`:
```css
.layout {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  display: flex;
  flex-direction: column;
  width: 210px;
  padding: 1rem 0.75rem;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.sidebar-title {
  padding: 0.25rem 0.75rem 1rem;
  font-size: 1.1rem;
  font-weight: 700;
}

.sidebar nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  color: var(--muted);
}

.nav-link:hover {
  background: var(--surface-2);
  color: var(--text);
}

.nav-link.active {
  background: var(--surface-2);
  color: var(--text);
}

.logout-button {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.75rem;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  cursor: pointer;
}

.logout-button:hover {
  background: var(--surface-2);
  color: var(--text);
}

.content {
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 4: Create the login page**

`src/pages/LoginPage.tsx`:
```tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import './LoginPage.css'

export default function LoginPage() {
  const { isAuthenticated, isLoading, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!isLoading && isAuthenticated) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Finance Dashboard</h1>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
```

`src/pages/LoginPage.css`:
```css
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}

.login-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 320px;
  padding: 2rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.login-card h1 {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
  text-align: center;
}

.login-card label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: var(--muted);
}

.login-card input {
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}

.login-card button {
  padding: 0.6rem;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}

.login-card button:disabled {
  opacity: 0.6;
}

.login-error {
  font-size: 0.85rem;
  color: var(--negative);
}
```

- [ ] **Step 5: Wire the routes**

Replace `src/App.tsx`:
```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import PlaceholderPage from './pages/PlaceholderPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<PlaceholderPage title="Overview" />} />
              <Route path="/net-worth" element={<PlaceholderPage title="Net Worth" />} />
              <Route path="/spending" element={<PlaceholderPage title="Spending" />} />
              <Route path="/portfolio" element={<PlaceholderPage title="Portfolio" />} />
              <Route path="/taxes" element={<PlaceholderPage title="Taxes" />} />
              <Route path="/espp" element={<PlaceholderPage title="ESPP" />} />
              <Route path="/paycheck" element={<PlaceholderPage title="Paycheck" />} />
              <Route path="/comp" element={<PlaceholderPage title="Comp" />} />
              <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
              <Route path="*" element={<PlaceholderPage title="Not Found" />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
```

- [ ] **Step 6: Verify build and manual login flow**

```bash
npm run lint
npm run build
```
Expected: clean.

Manual check (backend dev DB + server running from Task 6 Step 7 setup):
```bash
cd backend && (.venv/Scripts/uvicorn app.main:app --port 8000 &) && cd ..
npm run dev
```
In the browser at `http://localhost:5173`: visiting `/` redirects to `/login`; logging in with
`admin@example.com` / `changeme123` lands on Overview with the sidebar; wrong password shows
"Incorrect email or password"; Log out returns to `/login`. Stop both servers after.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat: frontend auth flow and protected layout shell"
```

---

### Task 13: Docker packaging + CI

**Files:**
- Create: `backend/Dockerfile`, `backend/start.sh`, `Dockerfile`, `nginx.conf`, `docker-compose.prod.yml`, `.env.example`, `.dockerignore`, `.github/workflows/ci.yml`

- [ ] **Step 1: Backend Dockerfile and start script**

`backend/.dockerignore` (keeps the venv, caches, and local secrets out of the image — `.env`
matters because `COPY . .` would otherwise bake a developer's local secrets into an image layer):
```
.venv
.pytest_cache
.ruff_cache
__pycache__
tests
docker-compose.yml
.env
```

`backend/start.sh`:
```sh
#!/bin/sh
set -e
alembic upgrade head
python -m app.seed
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`backend/Dockerfile`:
```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PYTHONPATH=/app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x start.sh

CMD ["./start.sh"]
```

- [ ] **Step 2: Frontend Dockerfile and nginx config**

`.dockerignore` (repo root):
```
node_modules
dist
backend
.git
```

`Dockerfile` (repo root):
```dockerfile
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.25-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

`nginx.conf` (server_name uses a placeholder domain — set during Plan 6 deploy when the
subdomain is chosen; HTTP works as-is for local compose testing):
```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        client_max_body_size 20m;
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
}
```
Note: the HTTPS server block (Cloudflare origin certs, 443, HTTP→HTTPS redirect) is added in
Plan 6 by copying `photography-webpage/nginx.conf` lines 1–21 with the finance domain.

- [ ] **Step 3: Prod compose file and env template**

`docker-compose.prod.yml`:
```yaml
services:
  backend:
    build: ./backend
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      ENVIRONMENT: prod
      DATABASE_URL: postgresql+asyncpg://${POSTGRES_USER:-finance}:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}@host.docker.internal:5432/${POSTGRES_DB:-finance}
      SECRET_KEY: ${SECRET_KEY:?Set SECRET_KEY in .env}
      CORS_ORIGINS: ${CORS_ORIGINS:-http://localhost}
      ADMIN_EMAIL: ${ADMIN_EMAIL:?Set ADMIN_EMAIL in .env}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:?Set ADMIN_PASSWORD in .env}

  frontend:
    build: .
    restart: unless-stopped
    depends_on:
      - backend
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /etc/ssl/cloudflare:/etc/ssl/cloudflare:ro
```

`.env.example`:
```env
# ── Database (host PostgreSQL) ────────────────────────────
POSTGRES_USER=finance
POSTGRES_PASSWORD=<your-db-password>
POSTGRES_DB=finance

# ── Backend ───────────────────────────────────────────────
ENVIRONMENT=prod
# Generate with: openssl rand -hex 32
SECRET_KEY=<your-secret-key>
CORS_ORIGINS=https://<your-finance-subdomain>
ADMIN_EMAIL=<your-login-email>
ADMIN_PASSWORD=<your-login-password>
```

- [ ] **Step 4: Validate compose config and image builds**

```bash
docker compose -f docker-compose.prod.yml config -q && echo "compose OK"
docker build -t finance-frontend . 
docker build -t finance-backend ./backend
docker run --rm --entrypoint sh finance-backend -c "od -c start.sh | head -2"
```
Expected: `compose OK` (with a `.env` present or vars exported); both images build; the `od`
output shows `#   !   /   b   i   n   /   s   h  \n` with NO `\r` — this guards against CRLF
line endings getting baked into the image from a Windows checkout (the reason `.gitattributes`
exists). If the backend build fails on pip SSL (corporate proxy), note it and rely on the CI
docker-build job — images are built on the OCI box in production anyway.

- [ ] **Step 5: Create CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main, edwli/*]
  pull_request:
    branches: [main]

jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16.14-alpine
        env:
          POSTGRES_USER: finance
          POSTGRES_PASSWORD: finance
          # finance (not finance_test): DATABASE_URL points at finance, and the conftest
          # bootstrap creates finance_test from it — same flow as dev.
          POSTGRES_DB: finance
        ports:
          - "5433:5432"
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r backend/requirements.txt -r backend/requirements-dev.txt
      - run: ruff check backend
      - run: ruff format --check backend
      - run: pytest -v
        working-directory: backend
        env:
          DATABASE_URL: postgresql+asyncpg://finance:finance@localhost:5433/finance
      # Migration smoke + drift guard: upgrade an empty DB to head, then verify the
      # migrations and Base.metadata agree (catches "changed a model, forgot a migration").
      - run: alembic upgrade head && alembic check
        working-directory: backend
        env:
          DATABASE_URL: postgresql+asyncpg://finance:finance@localhost:5433/finance

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run build

  docker-build:
    runs-on: ubuntu-latest
    needs: [backend, frontend]
    steps:
      - uses: actions/checkout@v4
      - name: Build frontend image
        run: docker build -t finance-frontend .
      - name: Build backend image
        run: docker build -t finance-backend ./backend
```

- [ ] **Step 6: Commit and verify CI**

```bash
git add backend/Dockerfile backend/start.sh Dockerfile nginx.conf docker-compose.prod.yml .env.example .dockerignore .github
git commit -m "feat: docker packaging and CI"
```
If the GitHub remote exists: `git push` and confirm all three CI jobs pass. If no remote yet,
create a **private** repo first: `gh repo create personal-finance-dashboard --private --source=. --push`.

---

## Definition of done (Plan 1)

- `pytest` green: health, security, auth (8 tests), and model tests for all 21 tables.
- `ruff check .` and `npm run lint` / `npm run build` clean.
- `alembic upgrade head` from empty DB creates the full schema; `python -m app.seed` is idempotent.
- Manual flow works: login → sidebar shell → logout; wrong password rejected; 11th rapid login attempt rate-limited.
- CI green on all three jobs in the private GitHub repo.
- No spreadsheet data yet (that's Plan 2), no charts yet (Plans 3-6).
