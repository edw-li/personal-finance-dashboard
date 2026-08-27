"""Person-roster reads shared by the taxes engine feed and the tax importer.

The household router owns people CRUD; this is the two-line READ every other module
needs, in one place, so "who is the primary person" can never be answered two ways.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Person


async def load_people(db: AsyncSession) -> list[Person]:
    """Every person, PRIMARY FIRST then by id — the column order the taxes payloads use."""
    people = list((await db.execute(select(Person))).scalars())
    return sorted(people, key=lambda person: (not person.is_primary, person.id))


def primary_person(people: list[Person]) -> Person | None:
    """The primary row, or None on a database whose roster has not been seeded — a
    create_all test database, or any deploy older than the household migration. Callers
    treat None as "person_id stays NULL", which is exactly the pre-migration spelling."""
    return people[0] if people and people[0].is_primary else None
