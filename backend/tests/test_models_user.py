from sqlalchemy import select

from app.models import User


async def test_create_user(db):
    db.add(User(email="me@example.com", password_hash="x"))
    await db.commit()
    user = (await db.execute(select(User))).scalar_one()
    assert user.email == "me@example.com"
    assert user.id == 1
    assert user.created_at is not None
