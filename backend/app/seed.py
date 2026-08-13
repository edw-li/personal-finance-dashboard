"""Idempotent seed: admin user from env. Run: python -m app.seed"""

import asyncio

from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal, engine
from app.models import User
from app.security import hash_password


async def seed() -> None:
    email = settings.admin_email.strip().lower()
    async with SessionLocal() as db:
        existing = (await db.execute(select(User))).scalars().first()
        if existing is None:
            db.add(User(email=email, password_hash=hash_password(settings.admin_password)))
            print(f"Created user {email}")
        elif existing.email != email:
            existing.email = email  # single-user app: rename, don't duplicate
            print(f"Updated admin email to {email}")
        else:
            print(f"User {email} already exists")
        await db.commit()


async def main() -> None:
    try:
        await seed()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
