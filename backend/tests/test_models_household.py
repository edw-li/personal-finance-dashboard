"""Person model constraints (2026-08-26 spec §4).

The exactly-one-primary invariant is the DATABASE's job, not the router's: a partial
unique index over is_primary constrains only the TRUE rows, so any number of non-primary
members coexist while a second primary is impossible. The index is declared on the model
because this test database is built by Base.metadata.create_all, which never runs
migrations (the ux_dividend_auto_event precedent)."""

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Person


async def test_person_defaults_to_not_primary(db):
    person = Person(name="Partner")
    db.add(person)
    await db.commit()
    assert person.is_primary is False


async def test_a_second_primary_is_impossible(db):
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    db.add(Person(name="Partner", is_primary=True))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_any_number_of_non_primary_members_coexist(db):
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    db.add_all([Person(name="Partner"), Person(name="Roommate")])
    await db.commit()
    names = (await db.execute(select(Person.name).order_by(Person.id))).scalars().all()
    assert list(names) == ["Me", "Partner", "Roommate"]


async def test_person_name_is_unique(db):
    db.add(Person(name="Me", is_primary=True))
    await db.commit()
    db.add(Person(name="Me"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
