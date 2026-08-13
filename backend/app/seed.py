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
            db.add(
                User(
                    email=settings.admin_email,
                    password_hash=hash_password(settings.admin_password),
                )
            )
            print(f"Created user {settings.admin_email}")
        else:
            print(f"User {settings.admin_email} already exists")
        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed())
