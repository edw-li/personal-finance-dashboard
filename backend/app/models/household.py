from sqlalchemy import Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Person(Base):
    """A household member. A NULL person_id on an owned row means JOINT/household — never
    a missing owner — so this table holds real people only (2026-08-26 spec §4). No delete
    endpoint exists: rows here are referenced by accounts (and, later, tax inputs)."""

    __tablename__ = "people"
    __table_args__ = (
        # Exactly-one-primary. PARTIAL, so only the TRUE rows are constrained: any number
        # of non-primary members coexist and a second primary is impossible. Mirrored in
        # migration f3a91c7e2b45; it must live HERE too because the test database is built
        # by Base.metadata.create_all, which never runs migrations (DividendPayment's rule).
        Index(
            "ux_people_single_primary",
            "is_primary",
            unique=True,
            postgresql_where=text("is_primary"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    is_primary: Mapped[bool] = mapped_column(default=False)
