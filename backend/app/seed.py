"""Idempotent seed: admin user, household primary, tax input definitions, app settings.
Run: python -m app.seed"""

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import SessionLocal, engine
from app.models import AppSetting, Person, TaxInputDefinition, User
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


async def seed_people(db: AsyncSession) -> None:
    # Insert-only, and only into an EMPTY table. Migration f3a91c7e2b45 seeds the primary
    # row on every deployed database; this is the door for one built by
    # Base.metadata.create_all (pytest, a scratch dev box). Never re-adds a row the user
    # renamed, and never a second is_primary row — that would trip
    # ux_people_single_primary at boot, which start.sh has no way to recover from.
    existing = (await db.execute(select(Person))).scalars().first()
    if existing is None:
        db.add(Person(name="Me", is_primary=True))
        print("Created household member Me")


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


DEFAULT_SETTINGS: dict[str, dict] = {
    "swr_pct": {"value": 0.04},
    "espp_ticker": {"value": "NVDA"},
    "price_refresh_cron": {"value": "10 13 * * mon-fri"},  # 13:10 PT weekdays, after US close
}


async def seed_app_settings(db: AsyncSession) -> None:
    for key, value in DEFAULT_SETTINGS.items():
        if await db.get(AppSetting, key) is None:
            db.add(AppSetting(key=key, value=value))


async def seed() -> None:
    async with SessionLocal() as db:
        await seed_admin_user(db)
        await seed_people(db)
        await seed_tax_definitions(db)
        await seed_app_settings(db)
        await db.commit()
    print("Seed complete")


async def main() -> None:
    try:
        await seed()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
