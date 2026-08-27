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
    assert len(TAX_INPUT_DEFINITIONS) == 43
    keys = [d[0] for d in TAX_INPUT_DEFINITIONS]
    assert len(keys) == len(set(keys)), "duplicate keys"


async def test_seed_inserts_definitions(db):
    from app.seed import seed_tax_definitions

    await seed_tax_definitions(db)
    await db.commit()
    count = (await db.execute(select(func.count(TaxInputDefinition.key)))).scalar_one()
    assert count == 43
    # payload fidelity, not just count — a transposed tuple in tax_keys.py fits the columns
    row = await db.get(TaxInputDefinition, "gross_paycheck")
    assert (row.label, row.section, row.sort_order, row.is_derived) == (
        "Gross Paycheck",
        "ordinary_income",
        20,
        True,
    )
    # idempotent
    await seed_tax_definitions(db)
    await db.commit()
    count = (await db.execute(select(func.count(TaxInputDefinition.key)))).scalar_one()
    assert count == 43


async def test_tax_input_value_keeps_four_decimal_places(db):
    # The sheet stores fractional inputs (state-exempt pct 0.9645); 2 dp would corrupt them
    # and break Plan 5's cent-exact golden tests.
    db.add(TaxYear(year=2025))
    db.add(
        TaxInputDefinition(
            key="unq_div_state_exempt_pct",
            label="Unq Div: State Exempt Percentage",
            section="ordinary_income",
            sort_order=170,
        )
    )
    await db.flush()
    db.add(TaxInput(year=2025, key="unq_div_state_exempt_pct", value=Decimal("0.9645")))
    await db.commit()
    stored = (await db.execute(select(TaxInput.value))).scalar_one()
    assert stored == Decimal("0.9645")


# --- filing status (2026-08-26 spec §4) ---


async def test_tax_year_defaults_to_single(db):
    """History is untouched by the migration: a year written without a status IS single."""
    db.add(TaxYear(year=2024))
    await db.commit()
    assert (await db.get(TaxYear, 2024)).filing_status == "single"


async def test_filing_statuses_constant():
    from app.tax_keys import FILING_STATUSES, MARRIED_JOINT, MARRIED_SEPARATE, SINGLE

    assert FILING_STATUSES == (SINGLE, MARRIED_JOINT, MARRIED_SEPARATE)
    assert FILING_STATUSES == ("single", "married_joint", "married_separate")


async def test_brackets_are_unique_per_year_jurisdiction_status_and_index(db):
    """The status dimension sits INSIDE the natural key: one year carries a single-filer
    table and an MFJ table for the same jurisdiction, and the engine walks exactly one."""
    db.add(TaxYear(year=2026))
    await db.flush()
    db.add(
        TaxBracket(
            year=2026,
            jurisdiction="federal",
            filing_status="single",
            bracket_index=1,
            rate=Decimal("0.10"),
            threshold=Decimal("0"),
        )
    )
    db.add(
        TaxBracket(
            year=2026,
            jurisdiction="federal",
            filing_status="married_joint",
            bracket_index=1,
            rate=Decimal("0.10"),
            threshold=Decimal("0"),
        )
    )
    await db.commit()
    stored = (await db.execute(select(TaxBracket))).scalars().all()
    assert sorted(row.filing_status for row in stored) == ["married_joint", "single"]

    # ...and the SAME (year, jurisdiction, status, index) still collides.
    db.add(
        TaxBracket(
            year=2026,
            jurisdiction="federal",
            filing_status="married_joint",
            bracket_index=1,
            rate=Decimal("0.22"),
            threshold=Decimal("0"),
        )
    )
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_bracket_defaults_to_single(db):
    db.add(TaxYear(year=2026))
    await db.flush()
    db.add(
        TaxBracket(
            year=2026,
            jurisdiction="state",
            bracket_index=1,
            rate=Decimal("0.01"),
            threshold=Decimal("0"),
        )
    )
    await db.commit()
    assert (await db.execute(select(TaxBracket))).scalar_one().filing_status == "single"
