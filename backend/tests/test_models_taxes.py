from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import TaxBracket, TaxInput, TaxInputDefinition, TaxYear
from app.tax_keys import TAX_INPUT_DEFINITIONS


async def test_bracket_and_input_roundtrip(db):
    db.add(TaxYear(year=2024))
    db.add(
        TaxInputDefinition(
            key="annual_salary", label="Annual Salary", section="ordinary_income", sort_order=10
        )
    )
    await db.flush()
    db.add(
        TaxBracket(
            year=2024,
            jurisdiction="federal",
            bracket_index=1,
            rate=Decimal("0.10"),
            threshold=Decimal("0"),
        )
    )
    db.add(TaxInput(year=2024, key="annual_salary", value=Decimal("151000")))
    await db.commit()
    inp = (await db.execute(select(TaxInput))).scalar_one()
    assert inp.value == Decimal("151000")


async def test_one_value_per_year_per_key(db):
    db.add(TaxYear(year=2024))
    db.add(
        TaxInputDefinition(
            key="w2_bonuses", label="Bonuses", section="ordinary_income", sort_order=70
        )
    )
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
