from sqlalchemy import select

from app import seed as seed_module
from app.models import AppSetting, TaxInputDefinition, User
from app.seed import seed_admin_user, seed_app_settings, seed_tax_definitions
from app.tax_keys import TAX_INPUT_DEFINITIONS


async def test_seed_admin_user_creates_user(db, monkeypatch):
    monkeypatch.setattr(seed_module.settings, "admin_email", "Admin@Example.com")
    monkeypatch.setattr(seed_module.settings, "admin_password", "changeme123")
    await seed_admin_user(db)
    await db.commit()
    user = (await db.execute(select(User))).scalar_one()
    assert user.email == "admin@example.com"  # normalized: strip + lower
    assert user.password_hash.startswith("$2b$")


async def test_seed_admin_user_renames_existing_instead_of_duplicating(db, monkeypatch):
    # The rename branch caused a real incident in Plan 1 Task 13 (boot test renamed the
    # dev admin). Pin: single-user app renames, never inserts a second row.
    monkeypatch.setattr(seed_module.settings, "admin_password", "changeme123")
    monkeypatch.setattr(seed_module.settings, "admin_email", "first@example.com")
    await seed_admin_user(db)
    await db.commit()
    monkeypatch.setattr(seed_module.settings, "admin_email", "second@example.com")
    await seed_admin_user(db)
    await db.commit()
    users = (await db.execute(select(User))).scalars().all()
    assert len(users) == 1
    assert users[0].email == "second@example.com"


async def test_seed_admin_user_is_idempotent_and_keeps_password(db, monkeypatch):
    monkeypatch.setattr(seed_module.settings, "admin_email", "same@example.com")
    monkeypatch.setattr(seed_module.settings, "admin_password", "changeme123")
    await seed_admin_user(db)
    await db.commit()
    original_hash = (await db.execute(select(User))).scalar_one().password_hash
    monkeypatch.setattr(seed_module.settings, "admin_password", "a-different-password")
    await seed_admin_user(db)
    await db.commit()
    user = (await db.execute(select(User))).scalar_one()
    assert user.password_hash == original_hash  # re-seeding never rotates the password


async def test_seed_app_settings_inserts_defaults_once(db):
    await seed_app_settings(db)
    await db.commit()
    keys = set((await db.execute(select(AppSetting.key))).scalars().all())
    assert keys == {"swr_pct", "espp_ticker", "price_refresh_cron"}


async def test_seed_app_settings_never_overwrites_user_edits(db):
    await seed_app_settings(db)
    await db.commit()
    setting = await db.get(AppSetting, "swr_pct")
    setting.value = {"value": 0.035}
    await db.commit()
    await seed_app_settings(db)
    await db.commit()
    assert (await db.get(AppSetting, "swr_pct")).value == {"value": 0.035}


async def test_seed_tax_definitions_inserts_all_and_is_insert_only(db):
    await seed_tax_definitions(db)
    await db.commit()
    rows = (await db.execute(select(TaxInputDefinition))).scalars().all()
    assert len(rows) == len(TAX_INPUT_DEFINITIONS) == 43
    # Insert-only contract (Plan 1 forward note): label edits do NOT propagate.
    edited = await db.get(TaxInputDefinition, "annual_salary")
    edited.label = "User Edited Label"
    await db.commit()
    await seed_tax_definitions(db)
    await db.commit()
    assert (await db.get(TaxInputDefinition, "annual_salary")).label == "User Edited Label"
