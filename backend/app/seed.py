"""Idempotent seed: admin user, tax input definitions. Run: python -m app.seed"""

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import SessionLocal, engine
from app.models import TaxInputDefinition, User
from app.security import hash_password
from app.tax_keys import TAX_INPUT_DEFINITIONS


async def seed_admin_user(db: AsyncSession) -> None:
    email = settings.admin_email.strip().lower()
    existing = (await db.execute(select(User))).scalars().first()
    if existing is None:
        db.add(User(email=email, password_hash=hash_password(settings.admin_password)))
        print(f"Created user {email}")
    elif existing.email != email:
        existing.email = email  # single-user app: rename, don't duplicate
        print(f"Updated admin email to {email}")


async def seed_tax_definitions(db: AsyncSession) -> None:
    existing = set((await db.execute(select(TaxInputDefinition.key))).scalars().all())
    for key, label, section, sort_order, is_derived in TAX_INPUT_DEFINITIONS:
        if key not in existing:
            db.add(
                TaxInputDefinition(
                    key=key,
                    label=label,
                    section=section,
                    sort_order=sort_order,
                    is_derived=is_derived,
                )
            )


async def seed() -> None:
    async with SessionLocal() as db:
        await seed_admin_user(db)
        await seed_tax_definitions(db)
        await db.commit()
    print("Seed complete")


async def main() -> None:
    try:
        await seed()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
