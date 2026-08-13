from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Table,
    UniqueConstraint,
)

from app.database import NAMING_CONVENTION


def test_naming_convention_generates_expected_names():
    md = MetaData(naming_convention=NAMING_CONVENTION)
    Table("parents", md, Column("id", Integer, primary_key=True))
    child = Table(
        "children",
        md,
        Column("id", Integer, primary_key=True),
        Column("parent_id", Integer, ForeignKey("parents.id")),
        Column("a", Integer),
        Column("b", Integer),
        CheckConstraint("a >= 0", name="a_nonnegative"),
        UniqueConstraint("a", "b"),
        Index(None, "a"),
        Index(None, "a", "b"),
    )
    constraint_names = {c.name for c in child.constraints}
    assert "pk_children" in constraint_names
    assert "fk_children_parent_id_parents" in constraint_names
    assert "uq_children_a" in constraint_names
    assert "ck_children_a_nonnegative" in constraint_names
    assert {i.name for i in child.indexes} == {"ix_children_a", "ix_children_a_b"}
