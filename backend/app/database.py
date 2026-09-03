from collections.abc import AsyncGenerator, Mapping

from sqlalchemy import MetaData
from sqlalchemy.engine import URL, make_url
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


def database_url_parts(url: str | None = None) -> dict[str, str]:
    """The connection fields of a SQLAlchemy DSN, percent-DECODED (`s%40cret` -> `s@cret`).

    The restore drill's credential source (backend/scripts/restore_drill.sh). Inside the
    backend container DATABASE_URL is the ONLY database config that exists: compose passes no
    POSTGRES_USER/POSTGRES_PASSWORD and backend/.dockerignore keeps .env out of the image, so
    a drill reading only POSTGRES_* fell back to the literal `finance:finance` and could not
    connect. make_url does the decoding, exactly as conftest's test-database surgery does —
    string splitting would hand back a still-encoded password that asyncpg then rejects.
    """
    parsed = make_url(url if url is not None else settings.database_url)
    return {
        "host": parsed.host or "localhost",
        "port": str(parsed.port or 5432),
        "user": parsed.username or "",
        "password": parsed.password or "",
        "database": parsed.database or "",
    }


def database_url_from_parts(parts: Mapping[str, str], *, driver: str = "postgresql+asyncpg") -> str:
    """The inverse of database_url_parts: a DSN with the credentials RE-ENCODED.

    The pair has to round-trip. The drill decodes DATABASE_URL to get its credentials and
    then builds two more DSNs from them (the maintenance database it creates the scratch on,
    and the scratch database it points the app at); concatenating the decoded password back
    into a URL by hand would turn `s%40cret` into `s@cret` and produce a DSN with two @ in it.
    """
    return URL.create(
        driver,
        username=parts["user"] or None,
        password=parts["password"] or None,
        host=parts["host"] or None,
        port=int(parts["port"]) if parts.get("port") else None,
        database=parts["database"] or None,
    ).render_as_string(hide_password=False)
