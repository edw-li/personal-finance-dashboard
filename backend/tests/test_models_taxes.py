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
    assert len(TAX_INPUT_DEFINITIONS) == 45
    keys = [d[0] for d in TAX_INPUT_DEFINITIONS]
    assert len(keys) == len(set(keys)), "duplicate keys"


async def test_seed_inserts_definitions(db):
    from app.seed import seed_tax_definitions

    await seed_tax_definitions(db)
    await db.commit()
    count = (await db.execute(select(func.count(TaxInputDefinition.key)))).scalar_one()
    assert count == 45
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
    assert count == 45


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


# --- person scope (2026-08-26 spec §4) ---


async def test_per_person_keys_are_defined_and_flagged(db):
    from app.seed import seed_tax_definitions
    from app.tax_keys import PER_PERSON_KEYS

    defined = {key for key, *_ in TAX_INPUT_DEFINITIONS}
    assert set(PER_PERSON_KEYS) <= defined
    assert len(PER_PERSON_KEYS) == 19
    assert len(set(PER_PERSON_KEYS)) == 19
    # The two tracker-only keys are per-person and stored, but the engine never reads them.
    from app.services.tax_service import ENGINE_INPUT_KEYS, SUGGESTION_KEYS

    for key in ("w2_fed_withholding", "w2_state_withholding"):
        assert key in PER_PERSON_KEYS
        assert key in defined
        assert key not in ENGINE_INPUT_KEYS
        assert key not in SUGGESTION_KEYS

    await seed_tax_definitions(db)
    await db.commit()
    flagged = {
        row.key
        for row in (await db.execute(select(TaxInputDefinition))).scalars()
        if row.is_per_person
    }
    assert flagged == set(PER_PERSON_KEYS)


async def test_household_rows_cannot_duplicate_nulls_not_distinct(db):
    """PG16 NULLS NOT DISTINCT: two NULL-person rows for one (year, key) must collide.

    Without it a plain unique index treats every NULL as unique, so the engine's
    per-key SUM would silently double-count a household line."""
    db.add(TaxYear(year=2026))
    db.add(
        TaxInputDefinition(
            key="interest_total", label="Interest", section="ordinary_income", sort_order=190
        )
    )
    await db.flush()
    db.add(TaxInput(year=2026, key="interest_total", value=Decimal("100")))
    await db.commit()
    db.add(TaxInput(year=2026, key="interest_total", value=Decimal("200")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_the_same_key_may_repeat_across_people(db):
    from app.models import Person

    me = Person(name="Me", is_primary=True)
    partner = Person(name="Partner", is_primary=False)
    db.add_all([me, partner])
    db.add(TaxYear(year=2026))
    db.add(
        TaxInputDefinition(
            key="latest_w2_income",
            label="Latest W2 Income",
            section="ordinary_income",
            sort_order=40,
            is_per_person=True,
        )
    )
    await db.flush()
    db.add(TaxInput(year=2026, key="latest_w2_income", person_id=me.id, value=Decimal("150000")))
    db.add(
        TaxInput(year=2026, key="latest_w2_income", person_id=partner.id, value=Decimal("100000"))
    )
    await db.commit()
    stored = (await db.execute(select(TaxInput))).scalars().all()
    assert sorted(row.value for row in stored) == [Decimal("100000"), Decimal("150000")]

    # ...but one person still gets one row per key.
    db.add(TaxInput(year=2026, key="latest_w2_income", person_id=me.id, value=Decimal("1")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
